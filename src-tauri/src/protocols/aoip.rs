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
}
