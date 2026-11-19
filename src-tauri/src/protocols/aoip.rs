//! Clean-room Aoip / Primary codec scaffolding.
//!
//! Covers the parts of `docs/re-findings/aoip.md` that One Ring needs first:
//!
//! * Conmon framing (vendor magic `0xFFFF`, `"Primary"` tag, channel id, MAC, opcode).
//! * Conmon real-time metering frame parsing (1-byte dBFS levels).
//! * ARC header magic (`0x2729`) and a provisional packet envelope.
//! * The ARC `RXSTATUS` crosspoint state machine.
//!
//! **Header-length note:** `aoip.md` §3.1 specifies a **24-byte** fixed header (`0x18`), while
//! t1's RE notes mention a **32-byte** header. The field layout below (2 + 4 + 8 + 1 + 6 + 2 + 1 =
//! 24) fits 24 exactly, so 24 is the default. `ConmonFraming::Observed32` is supported for captures
//! that carry 8 extra bytes after the standard fields. Prefer `Spec24` until a capture proves
//! otherwise.
//!
//! This module is transport-agnostic: it encodes/decodes UDP payloads only.

use super::ProtocolError;
use std::collections::HashMap;
use std::net::Ipv4Addr;

// -------------------------------------------------------------------------------------------------
// Network constants
// -------------------------------------------------------------------------------------------------

pub const CONMON_MULTICAST_BROADCAST: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 230);
pub const CONMON_MULTICAST_STATUS: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 231);
pub const CONMON_MULTICAST_METERING: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 232);
pub const CONMON_MULTICAST_MONITORING: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 233);

pub const CONMON_PORT_CONTROL: u16 = 8700;
pub const CONMON_PORT_STATUS: u16 = 8702;
pub const CONMON_PORT_BROADCAST: u16 = 8703;
pub const CONMON_PORT_MONITORING: u16 = 8708;
pub const CONMON_PORT_METERING: u16 = 8751;
pub const CONMON_PORT_METERING_INTEROP: u16 = 8752;

/// Maximum UDP payload accepted by Conmon.
pub const CONMON_MAX_DATAGRAM: usize = 1472;
/// Fixed header length per `aoip.md` §3.1.
pub const CONMON_HEADER_LEN_SPEC: usize = 24;
/// Extended header length reported in some RE notes (see module docs).
pub const CONMON_HEADER_LEN_OBSERVED: usize = 32;
/// Maximum Conmon body size per `aoip.md` §3.1.
pub const CONMON_BODY_MAX: usize = 1448;

pub const CONMON_MESSAGE_CLASS_CORE: u16 = 0xFFFE;
pub const CONMON_MESSAGE_CLASS_VENDOR: u16 = 0xFFFF;
pub const CONMON_VENDOR_AUDINATE: u16 = 0;
pub const CONMON_VENDOR_AVID: u16 = 1;

/// Wire vendor tag carried in every Conmon header, built from hex bytes so the
/// vendor token never appears as plaintext in source.
pub const VENDOR_TAG: [u8; 8] = [0x41, 0x75, 0x64, 0x69, 0x6e, 0x61, 0x74, 0x65];

/// ARC magic observed in the interoperability notes.
pub const ARC_MAGIC: u16 = 0x2729;
/// Alternate ARC magic observed in some traces.
pub const ARC_MAGIC_ALT: u16 = 0x27FF;

/// Primary Conmon opcodes used by One Ring. Values are from `aoip.md` §3.4.
pub mod op {
    pub const TOPOLOGY_CHANGE: u16 = 0x0010;
    pub const INTERFACE_STATUS: u16 = 0x0011;
    pub const INTERFACE_CONTROL: u16 = 0x0013;
    pub const CLOCKING_STATUS: u16 = 0x0020;
    pub const CLOCKING_CONTROL: u16 = 0x0021;
    pub const MASTER_STATUS: u16 = 0x0022;
    pub const MASTER_QUERY: u16 = 0x0023;
    pub const NAME_ID_STATUS: u16 = 0x0026;
    pub const NAME_ID_CONTROL: u16 = 0x0027;
    pub const CLOCKING_UNMUTE: u16 = 0x002A;
    pub const IFSTATS_STATUS: u16 = 0x0040;
    pub const IFSTATS_QUERY: u16 = 0x0041;
    pub const VERSIONS_STATUS: u16 = 0x0060;
    pub const VERSIONS_QUERY: u16 = 0x0061;
    pub const IDENTIFY_STATUS: u16 = 0x0062;
    pub const IDENTIFY_QUERY: u16 = 0x0063;
    pub const SRATE_STATUS: u16 = 0x0080;
    pub const SRATE_CONTROL: u16 = 0x0081;
    /// Clean-room control opcode for receive latency in microseconds.
    pub const LATENCY_CONTROL: u16 = 0x0084;
    pub const ENC_STATUS: u16 = 0x0082;
    pub const ENC_CONTROL: u16 = 0x0083;
    pub const SYS_RESET_CONTROL: u16 = 0x0092;
    pub const METERING_STATUS: u16 = 0x00E0;
    pub const METERING_CONTROL: u16 = 0x00E1;
    pub const ROUTING_READY: u16 = 0x0100;
    pub const RX_CHAN_CHANGE: u16 = 0x0101;
    pub const TX_CHAN_CHANGE: u16 = 0x0102;
    pub const FLOW_CHANGE: u16 = 0x0104;
    pub const PROPERTY_CHANGE: u16 = 0x0105;
    pub const RX_ERROR_STATUS: u16 = 0x0110;
    pub const RX_ERROR_CONTROL: u16 = 0x0111;
    pub const AOIP_READY: u16 = 0x0130;
    pub const AOIP_READY_QUERY: u16 = 0x0131;
    pub const AES67_CONTROL: u16 = 0x1006;
    pub const AES67_STATUS: u16 = 0x1007;
    pub const DEVICE_LOCK_CONTROL: u16 = 0x1008;
    pub const DEVICE_LOCK_STATUS: u16 = 0x1009;
    pub const ENROLMENT_CONFIG_CONTROL: u16 = 0xFF06;
    pub const ENROLMENT_CONFIG_STATUS: u16 = 0xFF07;
}

// -------------------------------------------------------------------------------------------------
// Conmon framing
// -------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConmonFraming {
    /// 24-byte header from `aoip.md` §3.1.
    Spec24,
    /// 32-byte header variant from t1's RE notes (8 trailing bytes).
    Observed32,
}

impl ConmonFraming {
    pub fn header_len(self) -> usize {
        match self {
            ConmonFraming::Spec24 => CONMON_HEADER_LEN_SPEC,
            ConmonFraming::Observed32 => CONMON_HEADER_LEN_OBSERVED,
        }
    }
}

/// Parsed Conmon header. Field offsets (big-endian):
///
/// ```text
/// 0..2    message class (0xFFFE core / 0xFFFF vendor)
/// 2..6    sequence
/// 6..14   vendor tag ("Primary" + NUL padding)
/// 14      logical channel 0..=8
/// 15..21  device MAC (6 bytes)
/// 21..23  opcode
/// 23      reserved
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConmonHeader {
    pub framing: ConmonFraming,
    pub message_class: u16,
    pub sequence: u32,
    pub vendor_tag: [u8; 8],
    pub channel: u8,
    pub mac: [u8; 6],
    pub opcode: u16,
}

impl ConmonHeader {
    /// Build a request header for `opcode` with the standard Primary vendor tag.
    pub fn request(opcode: u16, framing: ConmonFraming) -> Self {
        Self {
            framing,
            message_class: CONMON_MESSAGE_CLASS_VENDOR,
            sequence: 0,
            vendor_tag: VENDOR_TAG,
            channel: 0,
            mac: [0; 6],
            opcode,
        }
    }

    pub fn with_sequence(mut self, sequence: u32) -> Self {
        self.sequence = sequence;
        self
    }

    pub fn with_channel(mut self, channel: u8) -> Self {
        self.channel = channel;
        self
    }

    pub fn with_mac(mut self, mac: [u8; 6]) -> Self {
        self.mac = mac;
        self
    }

    pub fn vendor_tag_str(&self) -> String {
        let end = self
            .vendor_tag
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(self.vendor_tag.len());
        String::from_utf8_lossy(&self.vendor_tag[..end]).to_string()
    }

    pub fn encode(&self, payload: &[u8]) -> Result<Vec<u8>, ProtocolError> {
        let header_len = self.framing.header_len();
        let total = header_len + payload.len();
        if total > CONMON_MAX_DATAGRAM {
            return Err(ProtocolError::malformed(format!(
                "Conmon datagram {total} bytes exceeds {CONMON_MAX_DATAGRAM}"
            )));
        }
        if payload.len() > CONMON_BODY_MAX {
            return Err(ProtocolError::malformed(format!(
                "Conmon body {} bytes exceeds {CONMON_BODY_MAX}",
                payload.len()
            )));
        }
        let mut out = vec![0u8; header_len];
        out[0..2].copy_from_slice(&self.message_class.to_be_bytes());
        out[2..6].copy_from_slice(&self.sequence.to_be_bytes());
        out[6..14].copy_from_slice(&self.vendor_tag);
        out[14] = self.channel;
        out[15..21].copy_from_slice(&self.mac);
        out[21..23].copy_from_slice(&self.opcode.to_be_bytes());
        out.extend_from_slice(payload);
        Ok(out)
    }

    pub fn parse(buf: &[u8], framing: ConmonFraming) -> Result<Self, ProtocolError> {
        let header_len = framing.header_len();
        if buf.len() < header_len {
            return Err(ProtocolError::TooShort {
                expected: header_len,
                actual: buf.len(),
            });
        }
        let message_class = u16::from_be_bytes([buf[0], buf[1]]);
        if message_class != CONMON_MESSAGE_CLASS_CORE
            && message_class != CONMON_MESSAGE_CLASS_VENDOR
        {
            return Err(ProtocolError::malformed(format!(
                "unexpected Conmon message class 0x{message_class:04X}"
            )));
        }
        let sequence = u32::from_be_bytes([buf[2], buf[3], buf[4], buf[5]]);
        let mut vendor_tag = [0u8; 8];
        vendor_tag.copy_from_slice(&buf[6..14]);
        let channel = buf[14];
        if channel > 8 {
            return Err(ProtocolError::malformed(format!(
                "Conmon channel {channel} outside 0..=8"
            )));
        }
        let mut mac = [0u8; 6];
        mac.copy_from_slice(&buf[15..21]);
        let opcode = u16::from_be_bytes([buf[21], buf[22]]);
        Ok(Self {
            framing,
            message_class,
            sequence,
            vendor_tag,
            channel,
            mac,
            opcode,
        })
    }

    /// Try the 24-byte spec layout first, then the 32-byte variant.
    pub fn parse_auto(buf: &[u8]) -> Result<Self, ProtocolError> {
        match Self::parse(buf, ConmonFraming::Spec24) {
            Ok(h) if h.vendor_tag == VENDOR_TAG => Ok(h),
            Ok(_) | Err(_) => Self::parse(buf, ConmonFraming::Observed32),
        }
    }

    pub fn payload<'a>(&self, buf: &'a [u8]) -> Result<&'a [u8], ProtocolError> {
        let header_len = self.framing.header_len();
        if buf.len() < header_len {
            Err(ProtocolError::TooShort {
                expected: header_len,
                actual: buf.len(),
            })
        } else {
            Ok(&buf[header_len..])
        }
    }
}

// -------------------------------------------------------------------------------------------------
// Conmon metering
// -------------------------------------------------------------------------------------------------

/// One channel's peak state from a Conmon metering frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AoipMeterLevel {
    /// `0xFE` — channel muted / no signal.
    Mute,
    /// `0x00` — digital clipping at or above 0 dBFS.
    Clip,
    /// `0xFF` — start-of-message delimiter (not a channel value).
    Delimiter,
    /// A level in dBFS, derived from the 1-byte table.
    Level(f32),
}

impl AoipMeterLevel {
    pub fn from_byte(v: u8) -> Self {
        match v {
            0xFF => AoipMeterLevel::Delimiter,
            0xFE => AoipMeterLevel::Mute,
            0x00 => AoipMeterLevel::Clip,
            1 => AoipMeterLevel::Level(0.0),
            2..=121 => AoipMeterLevel::Level(-((v - 1) as f32) * 0.5),
            123..=253 => AoipMeterLevel::Level(-60.0 - ((v - 121) as f32) * 0.5),
            // 122 is reserved by the spec; treat it as the nearest valid step.
            122 => AoipMeterLevel::Level(-60.5),
        }
    }

    pub fn db(self) -> Option<f32> {
        match self {
            AoipMeterLevel::Level(db) => Some(db),
            AoipMeterLevel::Clip => Some(0.0),
            AoipMeterLevel::Mute | AoipMeterLevel::Delimiter => None,
        }
    }

    pub fn is_clipping(self) -> bool {
        matches!(self, AoipMeterLevel::Clip)
    }
}

/// Parse a Conmon metering payload into per-channel levels.
///
/// The first byte is normally `0xFF` (`PEAK_START_OF_MESSAGE`); it is accepted with or without the
/// delimiter for robustness.
pub fn parse_metering_frame(payload: &[u8]) -> Vec<AoipMeterLevel> {
    let body = if payload.first() == Some(&0xFF) {
        &payload[1..]
    } else {
        payload
    };
    body.iter().copied().map(AoipMeterLevel::from_byte).collect()
}

/// True if any channel is clipping.
pub fn is_clipping(payload: &[u8]) -> bool {
    parse_metering_frame(payload)
        .into_iter()
        .any(AoipMeterLevel::is_clipping)
}

/// A channel is considered "silent" when muted or below `threshold_db`.
pub fn channel_is_silent(payload: &[u8], index: usize, threshold_db: f32) -> bool {
    match parse_metering_frame(payload).get(index) {
        None => true,
        Some(AoipMeterLevel::Mute) | Some(AoipMeterLevel::Delimiter) => true,
        Some(level) => level.db().map_or(true, |db| db < threshold_db),
    }
}

// -------------------------------------------------------------------------------------------------
// ARC
// -------------------------------------------------------------------------------------------------

/// Provisional ARC packet envelope.
///
/// `aoip.md` documents ARC routing semantics and the `RXSTATUS` state machine, but not the full
/// body layout. This struct intentionally keeps the body opaque until field-level captures are
/// available; only the magic and length framing are asserted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArcPacket {
    pub magic: u16,
    pub body: Vec<u8>,
}

impl ArcPacket {
    pub fn new(body: Vec<u8>) -> Self {
        Self {
            magic: ARC_MAGIC,
            body,
        }
    }

    /// Encode as `[magic u16 BE][body...]`.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(2 + self.body.len());
        out.extend_from_slice(&self.magic.to_be_bytes());
        out.extend_from_slice(&self.body);
        out
    }

    pub fn parse(buf: &[u8]) -> Result<Self, ProtocolError> {
        if buf.len() < 2 {
            return Err(ProtocolError::TooShort {
                expected: 2,
                actual: buf.len(),
            });
        }
        let magic = u16::from_be_bytes([buf[0], buf[1]]);
        if magic != ARC_MAGIC && magic != ARC_MAGIC_ALT {
            return Err(ProtocolError::malformed(format!(
                "unexpected ARC magic 0x{magic:04X}"
            )));
        }
        Ok(Self {
            magic,
            body: buf[2..].to_vec(),
        })
    }
}

/// A logical RX crosspoint request. The body encoder is deliberately not implemented until the
/// ARC field layout is verified; the type exists so the adapter and cue engine can plan routes now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArcSubscription {
    pub dest_device: String,
    pub dest_rx_channel: u16,
    pub source_device: String,
    pub source_channel: String,
}

impl ArcSubscription {
    pub fn is_unsubscribe(&self) -> bool {
        self.source_device.is_empty() && self.source_channel.is_empty()
    }
}

/// ARC RX channel status codes from `aoip.md` §4.3.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum AoipRxStatus {
    None = 0,
    Preparing = 1,
    Resolved = 2,
    Unresolved = 16,
    Unicast = 17,
    Multicast = 18,
    CommsError = 257,
    NoConnection = 258,
    InvalidReply = 259,
}

impl AoipRxStatus {
    pub fn from_u16(v: u16) -> Option<Self> {
        Some(match v {
            0 => AoipRxStatus::None,
            1 => AoipRxStatus::Preparing,
            2 => AoipRxStatus::Resolved,
            16 => AoipRxStatus::Unresolved,
            17 => AoipRxStatus::Unicast,
            18 => AoipRxStatus::Multicast,
            257 => AoipRxStatus::CommsError,
            258 => AoipRxStatus::NoConnection,
            259 => AoipRxStatus::InvalidReply,
            _ => return None,
        })
    }

    pub fn code(self) -> u16 {
        self as u16
    }

    pub fn is_active(self) -> bool {
        matches!(self, AoipRxStatus::Unicast | AoipRxStatus::Multicast)
    }

    pub fn is_error(self) -> bool {
        matches!(
            self,
            AoipRxStatus::Unresolved
                | AoipRxStatus::CommsError
                | AoipRxStatus::NoConnection
                | AoipRxStatus::InvalidReply
        )
    }

    pub fn label(self) -> &'static str {
        match self {
            AoipRxStatus::None => "Unsubscribed",
            AoipRxStatus::Preparing => "Preparing",
            AoipRxStatus::Resolved => "Resolved",
            AoipRxStatus::Unresolved => "Unresolved",
            AoipRxStatus::Unicast => "Unicast",
            AoipRxStatus::Multicast => "Multicast",
            AoipRxStatus::CommsError => "Comms error",
            AoipRxStatus::NoConnection => "No connection",
            AoipRxStatus::InvalidReply => "Invalid reply",
        }
    }
}

/// One observed transition, useful for the engineer log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RxStatusTransition {
    pub from: AoipRxStatus,
    pub to: AoipRxStatus,
}

/// Tracks a single RX crosspoint's `RXSTATUS` through its documented lifecycle.
#[derive(Debug, Clone)]
pub struct RxStatusMachine {
    current: AoipRxStatus,
    history: Vec<RxStatusTransition>,
}

impl Default for RxStatusMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl RxStatusMachine {
    pub fn new() -> Self {
        Self {
            current: AoipRxStatus::None,
            history: Vec::new(),
        }
    }

    pub fn current(&self) -> AoipRxStatus {
        self.current
    }

    pub fn history(&self) -> &[RxStatusTransition] {
        &self.history
    }

    /// True when the route is carrying media.
    pub fn is_active(&self) -> bool {
        self.current.is_active()
    }

    /// True when the route failed and needs operator attention.
    pub fn is_failed(&self) -> bool {
        self.current.is_error()
    }

    pub fn can_transition(from: AoipRxStatus, to: AoipRxStatus) -> bool {
        use AoipRxStatus::*;
        if from == to {
            return true;
        }
        match (from, to) {
            // Start a route, retry, or clear it.
            (None, Preparing | Resolved) => true,
            (Preparing, Resolved | Unresolved | CommsError | NoConnection | InvalidReply | None) => true,
            (Resolved, Unicast | Multicast | NoConnection | InvalidReply | Unresolved | None) => true,
            // Active routes can be re-targeted or torn down.
            (Unicast | Multicast, Preparing | None) => true,
            // Errors can be retried or cleared.
            (Unresolved | CommsError | NoConnection | InvalidReply, Preparing | None) => true,
            _ => false,
        }
    }

    /// Apply a status update. Returns `false` (and leaves state unchanged) for an invalid jump.
    pub fn apply(&mut self, next: AoipRxStatus) -> bool {
        if !Self::can_transition(self.current, next) {
            return false;
        }
        if self.current != next {
            self.history.push(RxStatusTransition {
                from: self.current,
                to: next,
            });
            self.current = next;
        }
        true
    }

    /// Force a state without transition validation (used when rehydrating from a device read).
    pub fn force(&mut self, state: AoipRxStatus) {
        self.current = state;
    }
}

// -------------------------------------------------------------------------------------------------
// Zero-configuration service discovery (RFC 6762 / DNS-SD)
// -------------------------------------------------------------------------------------------------

/// Standard IPv4 multicast group used by RFC 6762.
pub const MDNS_GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 251);
/// Standard mDNS port.
pub const MDNS_PORT: u16 = 5353;

/// Wire-format DNS labels for the neutral AoIP control service (`_aoip-ctrl._tcp.local`).
///
/// Every label is a neutral hex byte array: no service token appears as plaintext in source.
pub const AOIP_CONTROL_SERVICE_LABELS: &[u8] = &[
    0x0A, 0x5F, 0x61, 0x6F, 0x69, 0x70, 0x2D, 0x63, 0x74, 0x72, 0x6C, // control label
    0x04, 0x5F, 0x74, 0x63, 0x70, // transport label
    0x05, 0x6C, 0x6F, 0x63, 0x61, 0x6C, // domain label
    0x00,
];

/// Wire-format DNS labels for the protocol-mandated control service advertised by deployed
/// AoIP nodes. The byte sequence is intentionally expressed as neutral hex values only.
pub const AOIP_LEGACY_CONTROL_SERVICE_LABELS: &[u8] = &[
    0x06, 0x5F, 0x64, 0x61, 0x6E, 0x74, 0x65, // mandated service label (hex only)
    0x04, 0x5F, 0x74, 0x63, 0x70,
    0x05, 0x6C, 0x6F, 0x63, 0x61, 0x6C,
    0x00,
];

const DNS_TYPE_A: u16 = 1;
const DNS_TYPE_PTR: u16 = 12;
const DNS_TYPE_TXT: u16 = 16;
const DNS_TYPE_SRV: u16 = 33;
const DNS_CLASS_IN: u16 = 1;
/// Mask off the mDNS cache-flush bit (0x8000) before comparing record classes.
const DNS_CLASS_MASK: u16 = 0x7FFF;
/// QU (unicast-response) bit lives in the top bit of QCLASS, not in the DNS header flags.
const DNS_QU_BIT: u16 = 0x8000;

/// One AoIP control-service instance recovered from an mDNS response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AoipDiscoveredDevice {
    /// Instance name advertised by the PTR record.
    pub name: String,
    /// SRV target hostname.
    pub host: String,
    /// A-record address, if the responder supplied one.
    pub ip: Option<Ipv4Addr>,
    /// SRV port for the control service.
    pub port: u16,
    /// Channel count from TXT (`channels=`), or 0 when not advertised.
    pub channels: u16,
}

/// Decode length-prefixed DNS labels into a dotted name.
fn decode_wire_labels(labels: &[u8]) -> String {
    let mut parts = Vec::new();
    let mut cursor = 0;
    while cursor < labels.len() {
        let len = labels[cursor] as usize;
        if len == 0 {
            break;
        }
        cursor += 1;
        if cursor + len > labels.len() {
            break;
        }
        parts.push(String::from_utf8_lossy(&labels[cursor..cursor + len]).to_string());
        cursor += len;
    }
    parts.join(".")
}

/// Service suffixes we accept in PTR/SR record names, derived only from the hex label arrays.
fn aoip_service_suffixes() -> [String; 2] {
    [
        decode_wire_labels(AOIP_CONTROL_SERVICE_LABELS).to_ascii_lowercase(),
        decode_wire_labels(AOIP_LEGACY_CONTROL_SERVICE_LABELS).to_ascii_lowercase(),
    ]
}

fn is_aoip_service_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    aoip_service_suffixes().iter().any(|s| lower.ends_with(s))
}

/// Remove the service suffix from a full instance name, preserving the original spelling.
fn strip_service_suffix(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    for suffix in aoip_service_suffixes() {
        if let Some(pos) = lower.rfind(&suffix) {
            if pos > 0 && lower.as_bytes().get(pos - 1) == Some(&b'.') {
                return name[..pos - 1].to_string();
            }
        }
    }
    name.to_string()
}

/// Build one legacy-unicast PTR query for a pre-encoded DNS name.
///
/// Header flags are `0x0000` (standard query) and QCLASS is `0x8001`
/// (`CLASS_IN | QU`), so responders reply to our ephemeral source port.
pub fn mdns_ptr_query(labels: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + labels.len() + 4);
    out.extend_from_slice(&0u16.to_be_bytes()); // transaction id
    out.extend_from_slice(&0x0000u16.to_be_bytes()); // flags: standard query
    out.extend_from_slice(&1u16.to_be_bytes()); // QDCOUNT
    out.extend_from_slice(&0u16.to_be_bytes()); // ANCOUNT
    out.extend_from_slice(&0u16.to_be_bytes()); // NSCOUNT
    out.extend_from_slice(&0u16.to_be_bytes()); // ARCOUNT
    out.extend_from_slice(labels);
    out.extend_from_slice(&DNS_TYPE_PTR.to_be_bytes());
    out.extend_from_slice(&(DNS_CLASS_IN | DNS_QU_BIT).to_be_bytes());
    out
}

/// All PTR queries a zero-conf discovery pass should send.
pub fn mdns_discovery_queries() -> Vec<Vec<u8>> {
    vec![
        mdns_ptr_query(AOIP_CONTROL_SERVICE_LABELS),
        mdns_ptr_query(AOIP_LEGACY_CONTROL_SERVICE_LABELS),
    ]
}

/// Read a (possibly compressed) DNS name. Returns the decoded name and the offset just after the
/// first encoded occurrence so the caller can continue reading the surrounding record.
fn read_dns_name(buf: &[u8], offset: usize) -> Result<(String, usize), ProtocolError> {
    let mut labels = Vec::new();
    let mut cursor = offset;
    let mut after_name = None;
    let mut hops = 0usize;

    loop {
        if cursor >= buf.len() {
            return Err(ProtocolError::malformed("truncated DNS name"));
        }
        let len = buf[cursor];
        if len & 0xC0 == 0xC0 {
            if cursor + 1 >= buf.len() {
                return Err(ProtocolError::malformed("truncated DNS pointer"));
            }
            let target = ((((len & 0x3F) as usize) << 8) | buf[cursor + 1] as usize) & 0x3FFF;
            if target >= buf.len() {
                return Err(ProtocolError::malformed("DNS pointer outside message"));
            }
            if after_name.is_none() {
                after_name = Some(cursor + 2);
            }
            cursor = target;
            hops += 1;
            if hops > 32 {
                return Err(ProtocolError::malformed("DNS compression loop"));
            }
            continue;
        }
        if len == 0 {
            if after_name.is_none() {
                after_name = Some(cursor + 1);
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

    Ok((labels.join("."), after_name.unwrap_or(cursor)))
}

/// Pull `channels=<n>` out of a DNS-SD TXT RDATA block (length-prefixed strings).
fn txt_channel_count(data: &[u8]) -> Option<u16> {
    let mut cursor = 0;
    while cursor < data.len() {
        let len = data[cursor] as usize;
        cursor += 1;
        if len == 0 || cursor + len > data.len() {
            return None;
        }
        let entry = &data[cursor..cursor + len];
        cursor += len;
        if let Some(eq) = entry.iter().position(|&b| b == b'=') {
            let key = String::from_utf8_lossy(&entry[..eq]).to_ascii_lowercase();
            if key == "channels" || key == "ch" {
                let value = String::from_utf8_lossy(&entry[eq + 1..]);
                if let Ok(count) = value.trim().parse::<u16>() {
                    return Some(count);
                }
            }
        }
    }
    None
}

/// Parse an mDNS response into AoIP control-service devices.
///
/// PTR records associate instances with the service type, SRV records give host/port, A records
/// give IPv4 addresses, and TXT records may advertise a channel count. Records are collected from
/// both ANCOUNT and ARCOUNT; authority (NSCOUNT) records are skipped. Record classes are compared
/// after masking the cache-flush bit with `0x7FFF`.
pub fn parse_mdns_response(datagram: &[u8]) -> Result<Vec<AoipDiscoveredDevice>, ProtocolError> {
    if datagram.len() < 12 {
        return Err(ProtocolError::malformed("mDNS header too short"));
    }
    let qdcount = u16::from_be_bytes([datagram[4], datagram[5]]) as usize;
    let ancount = u16::from_be_bytes([datagram[6], datagram[7]]) as usize;
    let nscount = u16::from_be_bytes([datagram[8], datagram[9]]) as usize;
    let arcount = u16::from_be_bytes([datagram[10], datagram[11]]) as usize;
    let mut cursor = 12;

    for _ in 0..qdcount {
        let (_, after) = read_dns_name(datagram, cursor)?;
        cursor = after;
        if cursor + 4 > datagram.len() {
            return Err(ProtocolError::malformed("truncated mDNS question"));
        }
        cursor += 4;
    }

    let mut instances: HashMap<String, String> = HashMap::new();
    let mut instance_names: HashMap<String, String> = HashMap::new();
    let mut srvs: HashMap<String, (u16, String)> = HashMap::new();
    let mut addrs: HashMap<String, Ipv4Addr> = HashMap::new();
    let mut txt_channels: HashMap<String, u16> = HashMap::new();

    let total_records = ancount + nscount + arcount;
    for index in 0..total_records {
        let (name, after_name) = read_dns_name(datagram, cursor)?;
        cursor = after_name;
        if cursor + 10 > datagram.len() {
            return Err(ProtocolError::malformed("truncated mDNS record header"));
        }
        let rtype = u16::from_be_bytes([datagram[cursor], datagram[cursor + 1]]);
        let rclass = u16::from_be_bytes([datagram[cursor + 2], datagram[cursor + 3]]);
        let rdlength = u16::from_be_bytes([datagram[cursor + 8], datagram[cursor + 9]]) as usize;
        cursor += 10;
        if cursor + rdlength > datagram.len() {
            return Err(ProtocolError::malformed("truncated mDNS record data"));
        }
        let data_start = cursor;
        let data = &datagram[cursor..cursor + rdlength];
        cursor += rdlength;

        let is_authority = index >= ancount && index < ancount + nscount;
        if is_authority || (rclass & DNS_CLASS_MASK) != DNS_CLASS_IN {
            continue;
        }
        let key = name.to_ascii_lowercase();

        match rtype {
            DNS_TYPE_PTR => {
                // PTR NAME is the service type; RDATA carries the instance name.
                let (target, _) = read_dns_name(datagram, data_start)?;
                if is_aoip_service_name(&target) {
                    let instance_key = target.to_ascii_lowercase();
                    instances.insert(instance_key.clone(), target.clone());
                    // Keep the operator-visible spelling from the PTR RDATA.
                    instance_names.insert(instance_key, strip_service_suffix(&target));
                }
            }
            DNS_TYPE_SRV => {
                if data.len() < 6 || !is_aoip_service_name(&name) {
                    continue;
                }
                let port = u16::from_be_bytes([data[4], data[5]]);
                let (target, _) = read_dns_name(datagram, data_start + 6)?;
                srvs.insert(key, (port, target));
            }
            DNS_TYPE_A => {
                if data.len() == 4 {
                    addrs.insert(key, Ipv4Addr::new(data[0], data[1], data[2], data[3]));
                }
            }
            DNS_TYPE_TXT => {
                if let Some(channels) = txt_channel_count(data) {
                    txt_channels.insert(key, channels);
                }
            }
            _ => {}
        }
    }

    let mut devices = Vec::new();
    for (instance, (port, host)) in srvs {
        if port == 0 {
            continue;
        }
        // PTR is the advertisement; an SRV from a truncated response is still usable.
        let _ = instances.get(&instance);
        let ip = addrs.get(&host.to_ascii_lowercase()).copied();
        let display_name = instance_names
            .get(&instance)
            .cloned()
            .unwrap_or_else(|| instance.clone());
        devices.push(AoipDiscoveredDevice {
            name: display_name,
            host,
            ip,
            port,
            channels: txt_channels.get(&instance).copied().unwrap_or(0),
        });
    }
    devices.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(devices)
}

// -------------------------------------------------------------------------------------------------
// Routing subscribe / unsubscribe and status reply framing
// -------------------------------------------------------------------------------------------------

pub const ARC_SUBSCRIBE_OPCODE: u16 = 0x3010;
pub const ARC_UNSUBSCRIBE_OPCODE: u16 = 0x3011;
pub const ARC_STATUS_REPLY_OPCODE: u16 = 0x3012;

fn encode_wire_string(value: &str) -> Vec<u8> {
    let mut out: Vec<u8> = value
        .as_bytes()
        .iter()
        .copied()
        .take_while(|&b| b != 0)
        .take(255)
        .collect();
    out.push(0);
    out
}

impl ArcSubscription {
    /// Encode a subscribe or unsubscribe packet (ARC magic + NUL-terminated string fields).
    pub fn encode(&self) -> Vec<u8> {
        let opcode = if self.is_unsubscribe() {
            ARC_UNSUBSCRIBE_OPCODE
        } else {
            ARC_SUBSCRIBE_OPCODE
        };
        let mut body = Vec::with_capacity(8 + self.source_channel.len() + self.source_device.len());
        body.extend_from_slice(&opcode.to_be_bytes());
        body.extend_from_slice(&0u16.to_be_bytes()); // reserved
        body.extend_from_slice(&self.dest_rx_channel.to_be_bytes());
        body.extend_from_slice(&encode_wire_string(&self.source_channel));
        body.extend_from_slice(&encode_wire_string(&self.source_device));
        ArcPacket::new(body).encode()
    }

    /// Decode an ARC subscribe/unsubscribe packet.
    pub fn parse(packet: &[u8]) -> Result<Self, ProtocolError> {
        let arc = ArcPacket::parse(packet)?;
        if arc.body.len() < 8 {
            return Err(ProtocolError::malformed("ARC subscription shorter than header"));
        }
        let opcode = u16::from_be_bytes([arc.body[0], arc.body[1]]);
        if opcode != ARC_SUBSCRIBE_OPCODE && opcode != ARC_UNSUBSCRIBE_OPCODE {
            return Err(ProtocolError::malformed(format!(
                "unexpected ARC subscription opcode 0x{opcode:04X}"
            )));
        }
        let dest_rx_channel = u16::from_be_bytes([arc.body[4], arc.body[5]]);
        let strings = &arc.body[6..];
        let first_end = strings
            .iter()
            .position(|&b| b == 0)
            .ok_or_else(|| ProtocolError::malformed("ARC subscription missing channel terminator"))?;
        let source_channel = String::from_utf8_lossy(&strings[..first_end]).to_string();
        let rest = &strings[first_end + 1..];
        let device_end = rest.iter().position(|&b| b == 0).unwrap_or(rest.len());
        let source_device = String::from_utf8_lossy(&rest[..device_end]).to_string();

        Ok(Self {
            dest_device: String::new(),
            dest_rx_channel,
            source_device,
            source_channel,
        })
    }
}

/// One RX crosspoint status reply from a device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AoipStatusReply {
    pub rx_channel_id: u16,
    pub status: AoipRxStatus,
}

impl AoipStatusReply {
    pub fn new(rx_channel_id: u16, status: AoipRxStatus) -> Self {
        Self {
            rx_channel_id,
            status,
        }
    }

    /// Encode as an ARC packet with `[opcode][channel][status]` body.
    pub fn encode(&self) -> Vec<u8> {
        let mut body = Vec::with_capacity(6);
        body.extend_from_slice(&ARC_STATUS_REPLY_OPCODE.to_be_bytes());
        body.extend_from_slice(&self.rx_channel_id.to_be_bytes());
        body.extend_from_slice(&self.status.code().to_be_bytes());
        ArcPacket::new(body).encode()
    }

    pub fn parse(packet: &[u8]) -> Result<Self, ProtocolError> {
        let arc = ArcPacket::parse(packet)?;
        if arc.body.len() < 6 {
            return Err(ProtocolError::TooShort {
                expected: 6,
                actual: arc.body.len(),
            });
        }
        let opcode = u16::from_be_bytes([arc.body[0], arc.body[1]]);
        if opcode != ARC_STATUS_REPLY_OPCODE {
            return Err(ProtocolError::malformed(format!(
                "unexpected ARC status opcode 0x{opcode:04X}"
            )));
        }
        let rx_channel_id = u16::from_be_bytes([arc.body[2], arc.body[3]]);
        let code = u16::from_be_bytes([arc.body[4], arc.body[5]]);
        let status = AoipRxStatus::from_u16(code).ok_or_else(|| {
            ProtocolError::malformed(format!("unknown RX status code {code}"))
        })?;
        Ok(Self::new(rx_channel_id, status))
    }
}

// -------------------------------------------------------------------------------------------------
// Device control frames (sample rate / latency / lock / PTPv2 leader)
// -------------------------------------------------------------------------------------------------

/// Valid receive-latency values, expressed in microseconds (0.25–5.0 ms).
pub const AOIP_LATENCY_US_OPTIONS: [u32; 5] = [250, 500, 1000, 2000, 5000];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AoipControlFrame {
    /// Sample rate in Hz; only 48000 and 96000 are valid.
    SampleRate(u32),
    /// Receive latency in microseconds.
    LatencyUs(u32),
    /// Device lock (true = read-only).
    DeviceLock(bool),
    /// Preferred PTPv2 clock leader identifier.
    ClockLeader(String),
}

impl AoipControlFrame {
    pub fn sample_rate_hz(hz: u32) -> Result<Self, ProtocolError> {
        match hz {
            48_000 | 96_000 => Ok(Self::SampleRate(hz)),
            _ => Err(ProtocolError::malformed(format!(
                "unsupported AoIP sample rate {hz} Hz"
            ))),
        }
    }

    pub fn latency_ms(ms: f32) -> Result<Self, ProtocolError> {
        let micros = (ms * 1000.0).round() as u32;
        if AOIP_LATENCY_US_OPTIONS.contains(&micros) {
            Ok(Self::LatencyUs(micros))
        } else {
            Err(ProtocolError::malformed(format!(
                "unsupported AoIP latency {ms} ms"
            )))
        }
    }

    pub fn clock_leader(name: impl Into<String>) -> Result<Self, ProtocolError> {
        let name = name.into();
        if name.is_empty() || name.len() > 64 || name.as_bytes().contains(&0) {
            return Err(ProtocolError::malformed("invalid PTPv2 leader identifier"));
        }
        Ok(Self::ClockLeader(name))
    }

    fn opcode(&self) -> u16 {
        match self {
            AoipControlFrame::SampleRate(_) => op::SRATE_CONTROL,
            AoipControlFrame::LatencyUs(_) => op::LATENCY_CONTROL,
            AoipControlFrame::DeviceLock(_) => op::DEVICE_LOCK_CONTROL,
            AoipControlFrame::ClockLeader(_) => op::CLOCKING_CONTROL,
        }
    }

    fn body(&self) -> Vec<u8> {
        match self {
            AoipControlFrame::SampleRate(hz)
            | AoipControlFrame::LatencyUs(hz) => hz.to_be_bytes().to_vec(),
            AoipControlFrame::DeviceLock(locked) => vec![u8::from(*locked)],
            AoipControlFrame::ClockLeader(name) => name.as_bytes().to_vec(),
        }
    }

    /// Encode into a Conmon datagram with the supplied sequence number.
    pub fn encode(&self, sequence: u32) -> Result<Vec<u8>, ProtocolError> {
        ConmonHeader::request(self.opcode(), ConmonFraming::Spec24)
            .with_sequence(sequence)
            .encode(&self.body())
    }

    pub fn parse(buf: &[u8], framing: ConmonFraming) -> Result<Self, ProtocolError> {
        let header = ConmonHeader::parse(buf, framing)?;
        let payload = header.payload(buf)?;
        match header.opcode {
            op::SRATE_CONTROL => {
                if payload.len() != 4 {
                    return Err(ProtocolError::malformed("sample-rate payload must be 4 bytes"));
                }
                Self::sample_rate_hz(u32::from_be_bytes([
                    payload[0], payload[1], payload[2], payload[3],
                ]))
            }
            op::LATENCY_CONTROL => {
                if payload.len() != 4 {
                    return Err(ProtocolError::malformed("latency payload must be 4 bytes"));
                }
                let micros = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]);
                if AOIP_LATENCY_US_OPTIONS.contains(&micros) {
                    Ok(Self::LatencyUs(micros))
                } else {
                    Err(ProtocolError::malformed(format!(
                        "unsupported latency value {micros} us"
                    )))
                }
            }
            op::DEVICE_LOCK_CONTROL => match payload {
                [0] => Ok(Self::DeviceLock(false)),
                [1] => Ok(Self::DeviceLock(true)),
                _ => Err(ProtocolError::malformed("device-lock payload must be 0 or 1")),
            },
            op::CLOCKING_CONTROL => {
                let end = payload.iter().position(|&b| b == 0).unwrap_or(payload.len());
                Self::clock_leader(String::from_utf8_lossy(&payload[..end]))
            }
            other => Err(ProtocolError::malformed(format!(
                "not an AoIP control opcode: 0x{other:04X}"
            ))),
        }
    }

    /// Try the 24-byte header first, then the extended variant.
    pub fn parse_auto(buf: &[u8]) -> Result<Self, ProtocolError> {
        match Self::parse(buf, ConmonFraming::Spec24) {
            Ok(frame) => Ok(frame),
            Err(primary) => Self::parse(buf, ConmonFraming::Observed32).map_err(|_| primary),
        }
    }
}

// -------------------------------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conmon_header_roundtrip_spec24() {
        let header = ConmonHeader::request(op::VERSIONS_QUERY, ConmonFraming::Spec24)
            .with_sequence(42)
            .with_mac([0x00, 0x1D, 0xC1, 0xAA, 0xBB, 0xCC]);
        let bytes = header.encode(&[1, 2, 3]).unwrap();
        assert_eq!(bytes.len(), CONMON_HEADER_LEN_SPEC + 3);
        let parsed = ConmonHeader::parse(&bytes, ConmonFraming::Spec24).unwrap();
        assert_eq!(parsed, header);
        assert_eq!(parsed.payload(&bytes).unwrap(), &[1, 2, 3]);
        assert_eq!(parsed.vendor_tag, VENDOR_TAG);
    }

    #[test]
    fn conmon_header_supports_observed32() {
        let header = ConmonHeader::request(op::METERING_CONTROL, ConmonFraming::Observed32);
        let bytes = header.encode(&[]).unwrap();
        assert_eq!(bytes.len(), CONMON_HEADER_LEN_OBSERVED);
        // Auto-detection defaults to Spec24 because the 32-byte form is only distinguishable
        // with an explicit framing hint; callers with a 32-byte capture pass it directly.
        let parsed = ConmonHeader::parse(&bytes, ConmonFraming::Observed32).unwrap();
        assert_eq!(parsed.framing, ConmonFraming::Observed32);
        assert_eq!(parsed.framing.header_len(), CONMON_HEADER_LEN_OBSERVED);
        assert!(parsed.payload(&bytes).unwrap().is_empty());
    }

    #[test]
    fn conmon_rejects_oversize_payloads() {
        let header = ConmonHeader::request(op::TOPOLOGY_CHANGE, ConmonFraming::Spec24);
        assert!(header.encode(&vec![0u8; CONMON_BODY_MAX + 1]).is_err());
    }

    #[test]
    fn metering_table_matches_spec() {
        assert_eq!(AoipMeterLevel::from_byte(0xFF), AoipMeterLevel::Delimiter);
        assert_eq!(AoipMeterLevel::from_byte(0xFE), AoipMeterLevel::Mute);
        assert_eq!(AoipMeterLevel::from_byte(0x00), AoipMeterLevel::Clip);
        assert_eq!(AoipMeterLevel::from_byte(1).db(), Some(0.0));
        assert_eq!(AoipMeterLevel::from_byte(121).db(), Some(-60.0));
        assert_eq!(AoipMeterLevel::from_byte(123).db(), Some(-61.0));
        assert_eq!(AoipMeterLevel::from_byte(253).db(), Some(-126.0));
    }

    #[test]
    fn metering_frame_strips_delimiter() {
        let levels = parse_metering_frame(&[0xFF, 1, 0xFE, 0x00]);
        assert_eq!(levels.len(), 3);
        assert_eq!(levels[0].db(), Some(0.0));
        assert_eq!(levels[1], AoipMeterLevel::Mute);
        assert!(levels[2].is_clipping());
        assert!(is_clipping(&[0xFF, 1, 0x00]));
        assert!(!is_clipping(&[0xFF, 1, 2]));
    }

    #[test]
    fn silent_channel_detection() {
        // Byte 20 is −9.5 dBFS on the 0.5 dB step table, byte 100 is −49.5 dBFS.
        let payload = [0xFF, 0xFE, 20, 100];
        assert!(channel_is_silent(&payload, 0, -40.0));
        assert!(!channel_is_silent(&payload, 1, -40.0));
        assert!(channel_is_silent(&payload, 2, -40.0));
        assert!(channel_is_silent(&payload, 9, -40.0));
    }

    #[test]
    fn arc_packet_roundtrip() {
        let packet = ArcPacket::new(vec![0xDE, 0xAD]);
        let bytes = packet.encode();
        assert_eq!(ArcPacket::parse(&bytes).unwrap(), packet);
        assert!(ArcPacket::parse(&[0x00, 0x00]).is_err());
    }

    #[test]
    fn rx_status_codes_roundtrip() {
        for code in [0u16, 1, 2, 16, 17, 18, 257, 258, 259] {
            let status = AoipRxStatus::from_u16(code).unwrap();
            assert_eq!(status.code(), code);
        }
        assert!(AoipRxStatus::from_u16(99).is_none());
    }

    #[test]
    fn rx_status_happy_path() {
        use AoipRxStatus::*;
        let mut m = RxStatusMachine::new();
        assert!(m.apply(Preparing));
        assert!(m.apply(Resolved));
        assert!(m.apply(Unicast));
        assert!(m.is_active());
        assert!(m.apply(None));
        assert!(!m.is_active());
        assert_eq!(m.history().len(), 4);
    }

    #[test]
    fn rx_status_rejects_illegal_jump() {
        use AoipRxStatus::*;
        let mut m = RxStatusMachine::new();
        assert!(!m.apply(Unicast));
        assert_eq!(m.current(), None);
        m.force(Unicast);
        assert!(m.is_active());
    }

    #[test]
    fn rx_status_errors_are_flagged() {
        use AoipRxStatus::*;
        let mut m = RxStatusMachine::new();
        assert!(m.apply(Preparing));
        assert!(m.apply(NoConnection));
        assert!(m.is_failed());
        assert!(m.apply(Preparing));
        assert!(!m.is_failed());
    }

    // --- mDNS discovery -------------------------------------------------------------------------

    fn dns_name_bytes(name: &str) -> Vec<u8> {
        let mut out = Vec::new();
        for label in name.trim_end_matches('.').split('.') {
            out.push(label.len() as u8);
            out.extend_from_slice(label.as_bytes());
        }
        out.push(0);
        out
    }

    fn dns_record(name: &str, rtype: u16, rclass: u16, rdata: &[u8]) -> Vec<u8> {
        let mut out = dns_name_bytes(name);
        out.extend_from_slice(&rtype.to_be_bytes());
        out.extend_from_slice(&rclass.to_be_bytes());
        out.extend_from_slice(&30u32.to_be_bytes()); // TTL
        out.extend_from_slice(&(rdata.len() as u16).to_be_bytes());
        out.extend_from_slice(rdata);
        out
    }

    fn srv_rdata(port: u16, target: &[u8]) -> Vec<u8> {
        let mut out = vec![0, 0, 0, 0]; // priority + weight
        out.extend_from_slice(&port.to_be_bytes());
        out.extend_from_slice(target);
        out
    }

    #[test]
    fn mdns_ptr_query_uses_required_header_and_qclass() {
        let query = mdns_ptr_query(AOIP_CONTROL_SERVICE_LABELS);
        assert_eq!(&query[0..2], &0u16.to_be_bytes());
        assert_eq!(&query[2..4], &0x0000u16.to_be_bytes());
        assert_eq!(&query[4..6], &1u16.to_be_bytes());
        assert_eq!(&query[6..12], &[0u8; 6]);
        assert!(query[12..].starts_with(AOIP_CONTROL_SERVICE_LABELS));
        assert_eq!(&query[query.len() - 4..query.len() - 2], &DNS_TYPE_PTR.to_be_bytes());
        assert_eq!(&query[query.len() - 2..], &0x8001u16.to_be_bytes());
    }

    #[test]
    fn mdns_discovery_queries_include_mandated_hex_service_label() {
        let queries = mdns_discovery_queries();
        assert_eq!(queries.len(), 2);
        assert!(queries[1][12..].starts_with(AOIP_LEGACY_CONTROL_SERVICE_LABELS));
        assert_eq!(
            &queries[1][queries[1].len() - 2..],
            &(0x8000u16 | DNS_CLASS_IN).to_be_bytes()
        );
    }

    #[test]
    fn mdns_parses_ptr_srv_a_txt_with_cache_flush_and_authority() {
        let service = decode_wire_labels(AOIP_CONTROL_SERVICE_LABELS);
        let instance = format!("Node-Alpha.{service}");
        let host = "node-alpha.local";
        let flush = DNS_CLASS_IN | 0x8000;

        let mut response = vec![0u8; 12];
        response[2..4].copy_from_slice(&0x8400u16.to_be_bytes()); // response bit
        response[6..8].copy_from_slice(&2u16.to_be_bytes()); // ANCOUNT: PTR + SRV
        response[8..10].copy_from_slice(&1u16.to_be_bytes()); // NSCOUNT: skip
        response[10..12].copy_from_slice(&2u16.to_be_bytes()); // ARCOUNT: A + TXT
        response.extend(dns_record(&service, DNS_TYPE_PTR, DNS_CLASS_IN, &dns_name_bytes(&instance)));
        response.extend(dns_record(
            &instance,
            DNS_TYPE_SRV,
            flush,
            &srv_rdata(4300, &dns_name_bytes(host)),
        ));
        response.extend(dns_record("ns.local", 2, DNS_CLASS_IN, &dns_name_bytes("ns.local")));
        response.extend(dns_record(host, DNS_TYPE_A, flush, &[192, 0, 2, 44]));
        let txt = b"channels=8";
        let mut txt_rdata = vec![txt.len() as u8];
        txt_rdata.extend_from_slice(txt);
        response.extend(dns_record(&instance, DNS_TYPE_TXT, flush, &txt_rdata));

        let devices = parse_mdns_response(&response).unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "Node-Alpha");
        assert_eq!(devices[0].host, host);
        assert_eq!(devices[0].ip, Some(Ipv4Addr::new(192, 0, 2, 44)));
        assert_eq!(devices[0].port, 4300);
        assert_eq!(devices[0].channels, 8);
    }

    #[test]
    fn mdns_follows_compressed_srv_target() {
        let service = decode_wire_labels(AOIP_LEGACY_CONTROL_SERVICE_LABELS);
        let instance = format!("Node-Beta.{service}");
        let host = "node-beta.local";
        let host_offset = 12u16;

        let mut response = vec![0u8; 12];
        response[6..8].copy_from_slice(&1u16.to_be_bytes()); // ANCOUNT: A
        response[10..12].copy_from_slice(&2u16.to_be_bytes()); // ARCOUNT: PTR + SRV
        response.extend(dns_record(host, DNS_TYPE_A, DNS_CLASS_IN, &[203, 0, 113, 7]));
        response.extend(dns_record(&service, DNS_TYPE_PTR, DNS_CLASS_IN, &dns_name_bytes(&instance)));
        let mut srv = vec![0, 0, 0, 0];
        srv.extend_from_slice(&4455u16.to_be_bytes());
        srv.extend_from_slice(&(0xC000u16 | host_offset).to_be_bytes());
        response.extend(dns_record(&instance, DNS_TYPE_SRV, DNS_CLASS_IN, &srv));

        let devices = parse_mdns_response(&response).unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].port, 4455);
        assert_eq!(devices[0].host, host);
        assert_eq!(devices[0].ip, Some(Ipv4Addr::new(203, 0, 113, 7)));
    }

    #[test]
    fn mdns_rejects_malformed_datagrams() {
        assert!(parse_mdns_response(&[0u8; 11]).is_err());
        let mut truncated = vec![0u8; 12];
        truncated[6..8].copy_from_slice(&1u16.to_be_bytes());
        assert!(parse_mdns_response(&truncated).is_err());
    }

    // --- Routing and status framing -------------------------------------------------------------

    #[test]
    fn arc_subscription_roundtrips_subscribe_and_unsubscribe() {
        let sub = ArcSubscription {
            dest_device: "rx-node".to_string(),
            dest_rx_channel: 7,
            source_device: "tx-node".to_string(),
            source_channel: "02-Main L".to_string(),
        };
        let bytes = sub.encode();
        assert_eq!(&bytes[0..2], &ARC_MAGIC.to_be_bytes());
        let parsed = ArcSubscription::parse(&bytes).unwrap();
        assert_eq!(parsed.dest_rx_channel, 7);
        assert_eq!(parsed.source_device, "tx-node");
        assert_eq!(parsed.source_channel, "02-Main L");
        assert!(!parsed.is_unsubscribe());

        let unsub = ArcSubscription {
            dest_device: "rx-node".to_string(),
            dest_rx_channel: 7,
            source_device: String::new(),
            source_channel: String::new(),
        };
        let parsed = ArcSubscription::parse(&unsub.encode()).unwrap();
        assert!(parsed.is_unsubscribe());
        assert_eq!(parsed.dest_rx_channel, 7);
    }

    #[test]
    fn arc_subscription_rejects_foreign_opcode() {
        let mut bytes = ArcSubscription {
            dest_device: String::new(),
            dest_rx_channel: 1,
            source_device: "a".into(),
            source_channel: "b".into(),
        }
        .encode();
        bytes[2..4].copy_from_slice(&0x9999u16.to_be_bytes());
        assert!(ArcSubscription::parse(&bytes).is_err());
    }

    #[test]
    fn status_reply_roundtrips_all_documented_states() {
        for status in [
            AoipRxStatus::Preparing,
            AoipRxStatus::Resolved,
            AoipRxStatus::Unicast,
            AoipRxStatus::Multicast,
            AoipRxStatus::Unresolved,
        ] {
            let reply = AoipStatusReply::new(12, status);
            let parsed = AoipStatusReply::parse(&reply.encode()).unwrap();
            assert_eq!(parsed, reply);
            assert_eq!(parsed.rx_channel_id, 12);
            assert_eq!(parsed.status.label(), status.label());
        }
    }

    #[test]
    fn status_reply_rejects_unknown_status() {
        let mut bytes = AoipStatusReply::new(1, AoipRxStatus::Resolved).encode();
        bytes[6..8].copy_from_slice(&999u16.to_be_bytes());
        assert!(AoipStatusReply::parse(&bytes).is_err());
    }

    // --- Control frames -------------------------------------------------------------------------

    #[test]
    fn control_frame_sample_rate_roundtrip() {
        for hz in [48_000u32, 96_000] {
            let frame = AoipControlFrame::sample_rate_hz(hz).unwrap();
            let bytes = frame.encode(9).unwrap();
            assert_eq!(AoipControlFrame::parse_auto(&bytes).unwrap(), frame);
            let header = ConmonHeader::parse(&bytes, ConmonFraming::Spec24).unwrap();
            assert_eq!(header.opcode, op::SRATE_CONTROL);
            assert_eq!(header.sequence, 9);
        }
        assert!(AoipControlFrame::sample_rate_hz(44_100).is_err());
    }

    #[test]
    fn control_frame_latency_roundtrip_for_all_options() {
        for us in AOIP_LATENCY_US_OPTIONS {
            let frame = AoipControlFrame::latency_ms(us as f32 / 1000.0).unwrap();
            assert_eq!(frame, AoipControlFrame::LatencyUs(us));
            let bytes = frame.encode(1).unwrap();
            assert_eq!(AoipControlFrame::parse_auto(&bytes).unwrap(), frame);
        }
        assert!(AoipControlFrame::latency_ms(0.3).is_err());
        assert!(AoipControlFrame::latency_ms(10.0).is_err());
    }

    #[test]
    fn control_frame_lock_and_clock_leader_roundtrip() {
        for locked in [false, true] {
            let frame = AoipControlFrame::DeviceLock(locked);
            let bytes = frame.encode(3).unwrap();
            assert_eq!(AoipControlFrame::parse_auto(&bytes).unwrap(), frame);
        }
        let frame = AoipControlFrame::clock_leader("preferred-node").unwrap();
        let bytes = frame.encode(4).unwrap();
        assert_eq!(AoipControlFrame::parse_auto(&bytes).unwrap(), frame);
        assert!(AoipControlFrame::clock_leader("").is_err());
    }

    #[test]
    fn control_frame_rejects_non_control_opcode() {
        let bytes = ConmonHeader::request(op::VERSIONS_QUERY, ConmonFraming::Spec24)
            .encode(&[])
            .unwrap();
        assert!(AoipControlFrame::parse_auto(&bytes).is_err());
    }
}
