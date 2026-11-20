//! Clean-room two-way hardware video switcher protocol (UDP :9910).
//!
//! Implements the reliable-UDP binary packet framing (12-byte header, session ID,
//! packet ACK/retransmit, and four-character command chunks) so One Ring can
//! monitor and control hardware video switchers on the LAN with zero external SDKs.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const DEFAULT_SWITCHER_PORT: u16 = 9910;

pub const FLAG_ACK_REQUEST: u8 = 0x01;
pub const FLAG_NEW_SESSION: u8 = 0x02;
pub const FLAG_RETRANSMIT: u8 = 0x04;
pub const FLAG_RETRANSMIT_REQUEST: u8 = 0x08;
pub const FLAG_ACK_REPLY: u8 = 0x10;

pub const HELLO_PACKET: [u8; 20] = [
    0x10, 0x14, 0x53, 0xAB, 0, 0, 0, 0, 0, 0x3A, 0, 0, 0x01, 0, 0, 0, 0, 0, 0, 0,
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitcherInput {
    pub id: u16,
    pub long_name: String,
    pub short_name: String,
    pub is_external: bool,
    pub is_bus_source: bool,
    pub is_aux_source: bool,
}

impl SwitcherInput {
    pub fn new(id: u16, long_name: String, short_name: String) -> Self {
        let is_external = (1..=999).contains(&id);
        let is_bus_source = id == 0
            || is_external
            || id == 1000
            || id == 2001
            || id == 2002
            || ((3000..4000).contains(&id) && id % 10 == 0)
            || (6000..6100).contains(&id);
        let is_aux_source =
            is_bus_source || (7000..7100).contains(&id) || (10000..11000).contains(&id);
        Self {
            id,
            long_name,
            short_name,
            is_external,
            is_bus_source,
            is_aux_source,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitcherState {
    pub host: String,
    pub port: u16,
    pub link: String,
    pub detail: String,
    pub product: String,
    pub version: String,
    pub inputs: Vec<SwitcherInput>,
    pub program: BTreeMap<u8, u16>,
    pub preview: BTreeMap<u8, u16>,
    pub position: BTreeMap<u8, f64>,
    pub in_transition: BTreeMap<u8, bool>,
    pub style: BTreeMap<u8, u8>,
    pub next_selection: BTreeMap<u8, u8>,
    pub mix_rate: BTreeMap<u8, u8>,
    pub key_on_air: BTreeMap<u8, BTreeMap<u8, bool>>,
    pub dsk_on_air: BTreeMap<u8, bool>,
    pub dsk_tie: BTreeMap<u8, bool>,
    pub ftb_black: BTreeMap<u8, bool>,
    pub ftb_in_transition: BTreeMap<u8, bool>,
    pub aux: BTreeMap<u8, u16>,
    pub macros: BTreeMap<u16, String>,
    pub macro_running: Option<u16>,
    pub streaming: bool,
    pub recording: bool,
    pub has_streaming: bool,
    pub has_recording: bool,
    pub tally: BTreeMap<u16, u8>,
}

impl Default for SwitcherState {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: DEFAULT_SWITCHER_PORT,
            link: "idle".to_string(),
            detail: "Not connected".to_string(),
            product: String::new(),
            version: String::new(),
            inputs: Vec::new(),
            program: BTreeMap::new(),
            preview: BTreeMap::new(),
            position: BTreeMap::new(),
            in_transition: BTreeMap::new(),
            style: BTreeMap::new(),
            next_selection: BTreeMap::new(),
            mix_rate: BTreeMap::new(),
            key_on_air: BTreeMap::new(),
            dsk_on_air: BTreeMap::new(),
            dsk_tie: BTreeMap::new(),
            ftb_black: BTreeMap::new(),
            ftb_in_transition: BTreeMap::new(),
            aux: BTreeMap::new(),
            macros: BTreeMap::new(),
            macro_running: None,
            streaming: false,
            recording: false,
            has_streaming: false,
            has_recording: false,
            tally: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PacketHeader {
    pub flags: u8,
    pub length: usize,
    pub session_id: u16,
    pub ack_id: u16,
    pub remote_id: u16,
}

pub fn parse_packet_header(buf: &[u8]) -> Option<PacketHeader> {
    if buf.len() < 12 {
        return None;
    }
    let flags = buf[0] >> 3;
    let length = (((buf[0] & 0x07) as usize) << 8) | (buf[1] as usize);
    let session_id = u16::from_be_bytes([buf[2], buf[3]]);
    let ack_id = u16::from_be_bytes([buf[4], buf[5]]);
    let remote_id = u16::from_be_bytes([buf[10], buf[11]]);
    Some(PacketHeader {
        flags,
        length,
        session_id,
        ack_id,
        remote_id,
    })
}

pub fn build_ack_packet(session_id: u16, remote_id: u16) -> [u8; 12] {
    let mut p = [0u8; 12];
    p[0] = FLAG_ACK_REPLY << 3;
    p[1] = 12;
    let s = session_id.to_be_bytes();
    p[2] = s[0];
    p[3] = s[1];
    let r = remote_id.to_be_bytes();
    p[4] = r[0];
    p[5] = r[1];
    p
}

pub fn build_command_chunk(fourcc: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let len = (8 + data.len()) as u16;
    let mut out = Vec::with_capacity(len as usize);
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(fourcc);
    out.extend_from_slice(data);
    out
}

pub fn build_command_packet(session_id: u16, local_id: u16, fourcc: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let chunk = build_command_chunk(fourcc, data);
    let total_len = 12 + chunk.len();
    let mut pkt = vec![0u8; 12];
    pkt[0] = (FLAG_ACK_REQUEST << 3) | (((total_len >> 8) as u8) & 0x07);
    pkt[1] = (total_len & 0xFF) as u8;
    let s = session_id.to_be_bytes();
    pkt[2] = s[0];
    pkt[3] = s[1];
    let lid = local_id.to_be_bytes();
    pkt[10] = lid[0];
    pkt[11] = lid[1];
    pkt.extend_from_slice(&chunk);
    pkt
}

fn read_u16(d: &[u8], off: usize) -> u16 {
    if off + 1 < d.len() {
        u16::from_be_bytes([d[off], d[off + 1]])
    } else {
        0
    }
}

fn read_cstr(d: &[u8], start: usize, end: usize) -> String {
    if start >= d.len() {
        return String::new();
    }
    let slice = &d[start..end.min(d.len())];
    let nul = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
    String::from_utf8_lossy(&slice[..nul]).trim().to_string()
}

/// Parse all 4CC chunks in a packet payload and apply them into `state`.
/// Returns `true` if `InCm` (initial state dump complete) was observed.
pub fn apply_payload(payload: &[u8], state: &mut SwitcherState) -> bool {
    let mut init_complete = false;
    let mut off = 0usize;
    while off + 8 <= payload.len() {
        let len = read_u16(payload, off) as usize;
        if len < 8 || off + len > payload.len() {
            break;
        }
        let name = &payload[off + 4..off + 8];
        let d = &payload[off + 8..off + len];
        if apply_chunk(name, d, state) {
            init_complete = true;
        }
        off += len;
    }
    init_complete
}

fn apply_chunk(name: &[u8], d: &[u8], state: &mut SwitcherState) -> bool {
    match name {
        b"InCm" => {
            state.link = "online".to_string();
            state.detail = if state.product.is_empty() {
                "Connected".to_string()
            } else {
                format!("Connected · {}", state.product)
            };
            return true;
        }
        b"_ver" if d.len() >= 4 => {
            state.version = format!("{}.{}", read_u16(d, 0), read_u16(d, 2));
        }
        b"_pin" => {
            state.product = read_cstr(d, 0, 44);
        }
        b"InPr" if d.len() >= 26 => {
            let id = read_u16(d, 0);
            let long_name = read_cstr(d, 2, 22);
            let short_name = read_cstr(d, 22, 26);
            let item = SwitcherInput::new(id, long_name, short_name);
            if let Some(existing) = state.inputs.iter_mut().find(|i| i.id == id) {
                *existing = item;
            } else {
                state.inputs.push(item);
                state.inputs.sort_by_key(|i| (if i.is_external { 0u8 } else { 1u8 }, i.id));
            }
        }
        b"PrgI" if d.len() >= 4 => {
            let me = d[0];
            let src = read_u16(d, 2);
            if state.program.get(&me).copied() != Some(src)
                && state.in_transition.get(&me).copied().unwrap_or(false)
            {
                state.in_transition.insert(me, false);
                state.position.insert(me, 0.0);
            }
            state.program.insert(me, src);
        }
        b"PrvI" if d.len() >= 4 => {
            state.preview.insert(d[0], read_u16(d, 2));
        }
        b"TrPs" if d.len() >= 6 => {
            let me = d[0];
            let is_on = d[1] != 0;
            let pos = (read_u16(d, 4) as f64) / 10000.0;
            state.in_transition.insert(me, is_on);
            state.position.insert(me, if is_on { pos } else { 0.0 });
        }
        b"TrSS" if d.len() >= 5 => {
            state.style.insert(d[0], d[3]);
            state.next_selection.insert(d[0], d[4]);
        }
        b"TMxP" if d.len() >= 2 => {
            state.mix_rate.insert(d[0], d[1]);
        }
        b"KeOn" if d.len() >= 3 => {
            state
                .key_on_air
                .entry(d[0])
                .or_default()
                .insert(d[1], d[2] != 0);
        }
        b"DskS" if d.len() >= 3 => {
            state.dsk_on_air.insert(d[0], d[1] != 0);
        }
        b"DskP" if d.len() >= 2 => {
            state.dsk_tie.insert(d[0], d[1] != 0);
        }
        b"FtbS" if d.len() >= 3 => {
            state.ftb_black.insert(d[0], d[1] != 0);
            state.ftb_in_transition.insert(d[0], d[2] != 0);
        }
        b"AuxS" if d.len() >= 4 => {
            state.aux.insert(d[0], read_u16(d, 2));
        }
        b"MPrp" if d.len() >= 8 => {
            let idx = read_u16(d, 0);
            if d[2] != 0 {
                let name_len = read_u16(d, 4) as usize;
                let title = read_cstr(d, 8, 8 + name_len);
                let final_name = if title.is_empty() {
                    format!("Macro {}", idx + 1)
                } else {
                    title
                };
                state.macros.insert(idx, final_name);
            } else {
                state.macros.remove(&idx);
            }
        }
        b"MRPr" if d.len() >= 4 => {
            state.macro_running = if d[0] & 1 != 0 {
                Some(read_u16(d, 2))
            } else {
                None
            };
        }
        b"StRS" if d.len() >= 2 => {
            state.streaming = (read_u16(d, 0) & 4) != 0;
            state.has_streaming = true;
        }
        b"RTMS" if d.len() >= 2 => {
            state.recording = (read_u16(d, 0) & 1) != 0;
            state.has_recording = true;
        }
        b"TlSr" if d.len() >= 2 => {
            let n = read_u16(d, 0) as usize;
            let mut tally = BTreeMap::new();
            for i in 0..n {
                let base = 2 + i * 3;
                if base + 2 < d.len() {
                    tally.insert(read_u16(d, base), d[base + 2]);
                }
            }
            state.tally = tally;
        }
        _ => {}
    }
    false
}

// --- Outbound switcher command builders ---

pub fn cmd_set_program(me: u8, source: u16) -> (&'static [u8; 4], Vec<u8>) {
    let s = source.to_be_bytes();
    (b"CPgI", vec![me, 0, s[0], s[1]])
}

pub fn cmd_set_preview(me: u8, source: u16) -> (&'static [u8; 4], Vec<u8>) {
    let s = source.to_be_bytes();
    (b"CPvI", vec![me, 0, s[0], s[1]])
}

pub fn cmd_cut(me: u8) -> (&'static [u8; 4], Vec<u8>) {
    (b"DCut", vec![me, 0, 0, 0])
}

pub fn cmd_auto(me: u8) -> (&'static [u8; 4], Vec<u8>) {
    (b"DAut", vec![me, 0, 0, 0])
}

pub fn cmd_set_position(me: u8, pos: f64) -> (&'static [u8; 4], Vec<u8>) {
    let clamped = (pos.clamp(0.0, 1.0) * 10000.0).round() as u16;
    let p = clamped.to_be_bytes();
    (b"CTPs", vec![me, 0, p[0], p[1]])
}

pub fn cmd_set_key_on_air(me: u8, keyer: u8, on: bool) -> (&'static [u8; 4], Vec<u8>) {
    (b"CKOn", vec![me, keyer, u8::from(on), 0])
}

pub fn cmd_set_dsk_on_air(dsk: u8, on: bool) -> (&'static [u8; 4], Vec<u8>) {
    (b"CDsL", vec![dsk, u8::from(on), 0, 0])
}

pub fn cmd_dsk_auto(dsk: u8) -> (&'static [u8; 4], Vec<u8>) {
    (b"DDsA", vec![dsk, 0, 0, 0])
}

pub fn cmd_fade_to_black(me: u8) -> (&'static [u8; 4], Vec<u8>) {
    (b"FtbA", vec![me, 0, 0, 0])
}

pub fn cmd_set_aux(aux: u8, source: u16) -> (&'static [u8; 4], Vec<u8>) {
    let s = source.to_be_bytes();
    (b"CAuS", vec![1, aux, s[0], s[1]])
}

pub fn cmd_run_macro(index: u16) -> (&'static [u8; 4], Vec<u8>) {
    let i = index.to_be_bytes();
    (b"MAct", vec![i[0], i[1], 0, 0])
}

pub fn cmd_stop_macro() -> (&'static [u8; 4], Vec<u8>) {
    (b"MAct", vec![0xFF, 0xFF, 1, 0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ack_and_command_packet_round_trip() {
        let ack = build_ack_packet(0x1234, 42);
        let hdr = parse_packet_header(&ack).unwrap();
        assert_eq!(hdr.flags, FLAG_ACK_REPLY);
        assert_eq!(hdr.length, 12);
        assert_eq!(hdr.session_id, 0x1234);
        assert_eq!(hdr.ack_id, 42);

        let (cc, data) = cmd_set_preview(0, 3);
        let pkt = build_command_packet(0x1234, 7, cc, &data);
        let phdr = parse_packet_header(&pkt).unwrap();
        assert_eq!(phdr.flags, FLAG_ACK_REQUEST);
        assert_eq!(phdr.length, pkt.len());
        assert_eq!(phdr.remote_id, 7);
        assert_eq!(&pkt[16..20], b"CPvI");
    }

    #[test]
    fn parses_inputs_program_preview_ftb_and_init_complete() {
        let mut payload = Vec::new();
        let mut inpr = vec![0u8; 26];
        inpr[1] = 2; // input id 2
        inpr[2..8].copy_from_slice(b"Cam 2\0");
        inpr[22..26].copy_from_slice(b"CAM2");
        payload.extend_from_slice(&build_command_chunk(b"InPr", &inpr));
        payload.extend_from_slice(&build_command_chunk(b"PrgI", &[0, 0, 0, 2]));
        payload.extend_from_slice(&build_command_chunk(b"PrvI", &[0, 0, 0, 3]));
        payload.extend_from_slice(&build_command_chunk(b"FtbS", &[0, 1, 0]));
        payload.extend_from_slice(&build_command_chunk(b"InCm", &[]));

        let mut st = SwitcherState::default();
        assert!(apply_payload(&payload, &mut st));
        assert_eq!(st.link, "online");
        assert_eq!(st.inputs.len(), 1);
        assert_eq!(st.inputs[0].short_name, "CAM2");
        assert_eq!(st.program.get(&0), Some(&2));
        assert_eq!(st.preview.get(&0), Some(&3));
        assert_eq!(st.ftb_black.get(&0), Some(&true));
    }
}
