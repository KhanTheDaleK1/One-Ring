//! Minimal DNS-SD / mDNS codec for the EasyWorship `_ezwremote._tcp` remote-control service.
//!
//! EasyWorship binds its remote listener to an **ephemeral port** (`0xC000 + random(0x4000)`), so a
//! static host/port is not enough. This module builds the standard PTR query and parses the
//! PTR/SRV/A answer set into a resolvable endpoint. It is codec-only; the multicast socket and
//! timeout live in `runtime/easyworship_adapter.rs`.
//!
//! Spec: `docs/re-findings/easyworship.md` §3.1.

use super::ProtocolError;
use std::collections::HashMap;
use std::net::Ipv4Addr;

pub const MDNS_GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 251);
pub const MDNS_PORT: u16 = 5353;
pub const SERVICE_TYPE: &str = "_ezwremote._tcp.local";

const TYPE_A: u16 = 1;
const TYPE_PTR: u16 = 12;
const TYPE_SRV: u16 = 33;
const CLASS_IN: u16 = 1;
const CLASS_MASK: u16 = 0x7FFF; // strips mDNS cache-flush bit (0x8000)

/// A discovered EasyWorship remote instance with a concretely dialable endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredService {
    pub instance: String,
    pub host: String,
    pub port: u16,
    pub addr: Option<Ipv4Addr>,
}

impl DiscoveredService {
    /// Prefer the A-record address; fall back to the SRV target hostname.
    pub fn endpoint(&self) -> String {
        let host = self
            .addr
            .map(|a| a.to_string())
            .unwrap_or_else(|| self.host.clone());
        format!("{host}:{}", self.port)
    }
}

/// Build a legacy-unicast PTR query for `_ezwremote._tcp.local`.
///
/// The QU (unicast-response) bit is set so responders reply directly to the ephemeral source port;
/// this avoids needing to bind the shared mDNS port 5353.
pub fn ptr_query() -> Vec<u8> {
    let mut out = Vec::with_capacity(64);
    out.extend_from_slice(&0u16.to_be_bytes()); // transaction id
    out.extend_from_slice(&0x0000u16.to_be_bytes()); // standard query (QR=0, RFC 6762 §18)
    out.extend_from_slice(&1u16.to_be_bytes()); // QDCOUNT
    out.extend_from_slice(&0u16.to_be_bytes()); // ANCOUNT
    out.extend_from_slice(&0u16.to_be_bytes()); // NSCOUNT
    out.extend_from_slice(&0u16.to_be_bytes()); // ARCOUNT
    encode_name(&mut out, SERVICE_TYPE);
    out.extend_from_slice(&TYPE_PTR.to_be_bytes());
    // QU (unicast-response) lives in the top bit of QCLASS, not in the DNS header flags.
    out.extend_from_slice(&(CLASS_IN | 0x8000).to_be_bytes());
    out
}

fn encode_name(out: &mut Vec<u8>, name: &str) {
    for label in name.trim_end_matches('.').split('.') {
        out.push(label.len() as u8);
        out.extend_from_slice(label.as_bytes());
    }
    out.push(0);
}

/// Read a (possibly compressed) DNS name. Returns the decoded lowercase name and the offset just
/// after the first name encoding (so the caller can continue reading the record body).
fn read_name(buf: &[u8], offset: usize) -> Result<(String, usize), ProtocolError> {
    let mut labels = Vec::new();
    let mut cursor = offset;
    let mut next = None;
    let mut hops = 0;

    loop {
        if cursor >= buf.len() {
            return Err(ProtocolError::malformed("truncated DNS name"));
        }
        let len = buf[cursor];
        if len & 0xC0 == 0xC0 {
            if cursor + 1 >= buf.len() {
                return Err(ProtocolError::malformed("truncated DNS pointer"));
            }
            let target = (((len as usize & 0x3F) << 8) | buf[cursor + 1] as usize) & 0x3FFF;
            if next.is_none() {
                next = Some(cursor + 2);
            }
            cursor = target;
            hops += 1;
            if hops > 32 {
                return Err(ProtocolError::malformed("DNS compression loop"));
            }
            continue;
        }
        if len == 0 {
            if next.is_none() {
                next = Some(cursor + 1);
            }
            break;
        }
        let end = cursor + 1 + len as usize;
        if end > buf.len() {
            return Err(ProtocolError::malformed("truncated DNS label"));
        }
        labels.push(String::from_utf8_lossy(&buf[cursor + 1..end]).to_string());
        cursor = end;
    }

    Ok((labels.join("."), next.unwrap_or(cursor)))
}

/// Parse one mDNS response datagram into a list of discovered services.
///
/// Answers are collected by SRV target: a PTR record associates an instance name with a service
/// name, SRV supplies the port/target, and A records supply the address. Records may appear in any
/// order and may use compression pointers.
pub fn parse_response(datagram: &[u8]) -> Result<Vec<DiscoveredService>, ProtocolError> {
    if datagram.len() < 12 {
        return Err(ProtocolError::malformed("DNS header too short"));
    }
    let qdcount = u16::from_be_bytes([datagram[4], datagram[5]]) as usize;
    let ancount = u16::from_be_bytes([datagram[6], datagram[7]]) as usize;
    let nscount = u16::from_be_bytes([datagram[8], datagram[9]]) as usize;
    let arcount = u16::from_be_bytes([datagram[10], datagram[11]]) as usize;
    let mut cursor = 12;

    // Skip questions.
    for _ in 0..qdcount {
        let (_, after) = read_name(datagram, cursor)?;
        cursor = after;
        if cursor + 4 > datagram.len() {
            return Err(ProtocolError::malformed("truncated DNS question"));
        }
        cursor += 4;
    }

    let mut instances: HashMap<String, ()> = HashMap::new(); // instance names advertised by PTR
    let mut srvs: HashMap<String, (u16, String)> = HashMap::new(); // instance -> (port, target host)
    let mut addrs: HashMap<String, Ipv4Addr> = HashMap::new(); // host -> addr

    // Bonjour commonly places SRV/A records in the Additional section, and authority records in
    // between. Walk all three record sections in order, ignoring authority records but collecting
    // answers and additionals.
    let record_count = ancount + nscount + arcount;
    for index in 0..record_count {
        let (name, after_name) = read_name(datagram, cursor)?;
        cursor = after_name;
        if cursor + 10 > datagram.len() {
            return Err(ProtocolError::malformed("truncated DNS record header"));
        }
        let rtype = u16::from_be_bytes([datagram[cursor], datagram[cursor + 1]]);
        let rclass = u16::from_be_bytes([datagram[cursor + 2], datagram[cursor + 3]]);
        let rdlength = u16::from_be_bytes([datagram[cursor + 8], datagram[cursor + 9]]) as usize;
        cursor += 10;
        if cursor + rdlength > datagram.len() {
            return Err(ProtocolError::malformed("truncated DNS record data"));
        }
        let data_start = cursor;
        let data = &datagram[cursor..cursor + rdlength];
        cursor += rdlength;

        let is_authority = index >= ancount && index < ancount + nscount;
        if is_authority || (rclass & CLASS_MASK) != CLASS_IN {
            continue;
        }

        match rtype {
            TYPE_PTR => {
                // PTR NAME is the service type; RDATA is the instance name. RDATA names may use
                // compression pointers relative to the start of the whole DNS message.
                let (target, _) = read_name(datagram, data_start)?;
                if target.to_ascii_lowercase().contains("_ezwremote._tcp") {
                    instances.insert(name_to_instance(&target), ());
                }
            }
            TYPE_SRV => {
                if data.len() < 6 {
                    continue;
                }
                let port = u16::from_be_bytes([data[4], data[5]]);
                let (target, _) = read_name(datagram, data_start + 6)?;
                if name.to_ascii_lowercase().contains("_ezwremote._tcp") {
                    srvs.insert(name_to_instance(&name), (port, target));
                }
            }
            TYPE_A => {
                if data.len() == 4 {
                    addrs.insert(name, Ipv4Addr::new(data[0], data[1], data[2], data[3]));
                }
            }
            _ => {}
        }
    }

    let mut services = Vec::new();
    for (instance, (port, host)) in &srvs {
        if *port == 0 {
            continue;
        }
        // A PTR is the advertisement; an SRV alone (e.g. a truncated response) is still usable,
        // so PTR presence is a preference rather than a hard requirement.
        let _ = instances.get(instance);
        let addr = addrs.get(host).copied();
        services.push(DiscoveredService {
            instance: instance.clone(),
            host: host.clone(),
            port: *port,
            addr,
        });
    }
    services.sort_by(|a, b| a.instance.cmp(&b.instance));
    Ok(services)
}

fn name_to_instance(name: &str) -> String {
    // `EasyWorship Remote (HOST)._ezwremote._tcp.local` -> `EasyWorship Remote (HOST)`.
    name.split("._ezwremote").next().unwrap_or(name).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name_bytes(name: &str) -> Vec<u8> {
        let mut out = Vec::new();
        encode_name(&mut out, name);
        out
    }

    fn answer(name: &str, rtype: u16, rdata: &[u8]) -> Vec<u8> {
        answer_with_class(name, rtype, CLASS_IN, rdata)
    }

    fn answer_with_class(name: &str, rtype: u16, rclass: u16, rdata: &[u8]) -> Vec<u8> {
        let mut out = name_bytes(name);
        out.extend_from_slice(&rtype.to_be_bytes());
        out.extend_from_slice(&rclass.to_be_bytes());
        out.extend_from_slice(&30u32.to_be_bytes()); // TTL
        out.extend_from_slice(&(rdata.len() as u16).to_be_bytes());
        out.extend_from_slice(rdata);
        out
    }

    #[test]
    fn query_is_standard_ptr_with_unicast_response_bit() {
        let query = ptr_query();
        assert_eq!(&query[2..4], &0x0000u16.to_be_bytes());
        assert_eq!(&query[4..6], &1u16.to_be_bytes());
        let parsed: Vec<u8> = name_bytes(SERVICE_TYPE);
        assert!(query[12..].starts_with(&parsed));
        assert_eq!(
            &query[query.len() - 2..],
            &(CLASS_IN | 0x8000).to_be_bytes()
        );
    }

    #[test]
    fn parses_ptr_srv_a_into_endpoint() {
        let service = "EasyWorship Remote (SANCTUARY)._ezwremote._tcp.local";
        let host = "sanctuary-pc.local";

        let mut response = vec![0u8; 12];
        response[6] = 0;
        response[7] = 3; // ANCOUNT = 3
        response.extend(answer(SERVICE_TYPE, TYPE_PTR, &name_bytes(service)));
        let mut srv_rdata = vec![0, 0, 0, 0]; // priority, weight
        srv_rdata.extend_from_slice(&55123u16.to_be_bytes());
        srv_rdata.extend(name_bytes(host));
        response.extend(answer(service, TYPE_SRV, &srv_rdata));
        response.extend(answer(host, TYPE_A, &[10, 1, 24, 25]));

        let services = parse_response(&response).unwrap();
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].instance, "EasyWorship Remote (SANCTUARY)");
        assert_eq!(services[0].port, 55123);
        assert_eq!(services[0].endpoint(), "10.1.24.25:55123");
    }

    #[test]
    fn compressed_srv_target_is_followed() {
        // A response where the SRV target name is a compression pointer back to the A record name.
        let service = "easyworship remote (pulpit)._ezwremote._tcp.local";
        let host = "pulpit-pc.local";
        let host_offset = 12u16;

        let mut response = vec![0u8; 12];
        response[7] = 2; // ANCOUNT = 2
        // First answer: A record with the host name at offset 12.
        response.extend(answer(host, TYPE_A, &[192, 168, 1, 50]));
        // Second answer: SRV with a pointer to the host name.
        let mut srv_rdata = vec![0, 0, 0, 0];
        srv_rdata.extend_from_slice(&60000u16.to_be_bytes());
        let pointer = 0xC000u16 | host_offset;
        srv_rdata.extend_from_slice(&pointer.to_be_bytes());
        response.extend(answer(service, TYPE_SRV, &srv_rdata));

        let services = parse_response(&response).unwrap();
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].port, 60000);
        assert_eq!(services[0].endpoint(), "192.168.1.50:60000");
    }

    #[test]
    fn parses_bonjour_additional_records_and_skips_authority() {
        let service = "EasyWorship Remote (NAVE)._ezwremote._tcp.local";
        let host = "nave-pc.local";

        let mut response = vec![0u8; 12];
        response[7] = 1; // ANCOUNT: PTR
        response[9] = 1; // NSCOUNT: authority record to skip
        response[11] = 2; // ARCOUNT: SRV + A
        response.extend(answer(SERVICE_TYPE, TYPE_PTR, &name_bytes(service)));
        response.extend(answer_with_class(
            SERVICE_TYPE,
            2, // NS
            CLASS_IN,
            &name_bytes("ns.local"),
        ));

        let mut srv_rdata = vec![0, 0, 0, 0];
        srv_rdata.extend_from_slice(&55000u16.to_be_bytes());
        srv_rdata.extend(name_bytes(host));
        response.extend(answer_with_class(
            service,
            TYPE_SRV,
            CLASS_IN | 0x8000, // cache-flush bit set by Bonjour
            &srv_rdata,
        ));
        response.extend(answer_with_class(
            host,
            TYPE_A,
            CLASS_IN | 0x8000,
            &[10, 0, 0, 8],
        ));

        let services = parse_response(&response).unwrap();
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].instance, "EasyWorship Remote (NAVE)");
        assert_eq!(services[0].endpoint(), "10.0.0.8:55000");
    }

    #[test]
    fn malformed_datagrams_are_rejected() {
        assert!(parse_response(&[0u8; 4]).is_err());
        let mut truncated = vec![0u8; 12];
        truncated[7] = 1;
        truncated.extend_from_slice(&[9]); // invalid label length start
        assert!(parse_response(&truncated).is_err());
    }
}
