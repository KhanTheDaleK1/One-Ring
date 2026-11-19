//! Clean-room OSC codec for the Console Console / Console Console (UDP `:10023`).
//!
//! Implements OSC 1.0 framing (`i`, `f`, `s`, `b`), the Console keepalive/identity messages, channel /
//! DCA / main parameter helpers, scene recall, `/meters/1` blob parsing, and the fader-float ↔ dB
//! law documented in `docs/re-findings/console.md`.
//!
//! This module is transport-agnostic: it produces and consumes byte vectors. The adapter layer owns
//! the UDP socket, keepalive timer, reconnect backoff, and write debouncing.

use super::ProtocolError;

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

/// Default Console OSC UDP port.
pub const CONSOLE_UDP_PORT: u16 = 10023;

/// Recommended `/xremote` refresh interval. The console expires subscriptions after 10 s.
pub const XREMOTE_INTERVAL_MS: u64 = 8_000;

/// Fader position that corresponds to unity (0 dB) on the interoperability baseline.
pub const FADER_UNITY: f32 = 0.75;

/// dB per decade for the fader taper: `10 / log10(4/3)`.
pub const FADER_DB_PER_DECADE: f32 = 80.04;

/// Below this dB value a fader is treated as fully off.
pub const FADER_MIN_DB: f32 = -90.0;

pub const MAX_CHANNEL: u8 = 32;
pub const MAX_DCA: u8 = 8;

// -------------------------------------------------------------------------------------------------
// OSC arguments
// -------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum OscArg {
    Int(i32),
    Float(f32),
    String(String),
    Blob(Vec<u8>),
    Bool(bool),
    Nil,
}

impl OscArg {
    pub fn type_tag(&self) -> char {
        match self {
            OscArg::Int(_) => 'i',
            OscArg::Float(_) => 'f',
            OscArg::String(_) => 's',
            OscArg::Blob(_) => 'b',
            OscArg::Bool(true) => 'T',
            OscArg::Bool(false) => 'F',
            OscArg::Nil => 'N',
        }
    }
}

impl From<i32> for OscArg {
    fn from(v: i32) -> Self {
        OscArg::Int(v)
    }
}

impl From<f32> for OscArg {
    fn from(v: f32) -> Self {
        OscArg::Float(v)
    }
}

impl From<&str> for OscArg {
    fn from(v: &str) -> Self {
        OscArg::String(v.to_string())
    }
}

impl From<String> for OscArg {
    fn from(v: String) -> Self {
        OscArg::String(v)
    }
}

// -------------------------------------------------------------------------------------------------
// OSC message
// -------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct OscMessage {
    pub address: String,
    pub args: Vec<OscArg>,
}

impl OscMessage {
    pub fn new(address: impl Into<String>, args: Vec<OscArg>) -> Self {
        Self {
            address: address.into(),
            args,
        }
    }

    /// Encode as a complete OSC 1.0 packet.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(32);
        push_osc_string(&mut out, &self.address);

        let mut tags = String::with_capacity(self.args.len() + 1);
        tags.push(',');
        for a in &self.args {
            tags.push(a.type_tag());
        }
        push_osc_string(&mut out, &tags);

        for a in &self.args {
            match a {
                OscArg::Int(v) => out.extend_from_slice(&v.to_be_bytes()),
                OscArg::Float(v) => out.extend_from_slice(&v.to_be_bytes()),
                OscArg::String(s) => push_osc_string(&mut out, s),
                OscArg::Blob(b) => push_osc_blob(&mut out, b),
                // OSC 1.0 "True"/"False" carry no payload bytes.
                OscArg::Bool(_) => {}
                OscArg::Nil => {}
            }
        }
        out
    }

    /// Decode one complete OSC 1.0 packet.
    pub fn decode(buf: &[u8]) -> Result<Self, ProtocolError> {
        let mut pos = 0usize;
        let address = read_osc_string(buf, &mut pos)?;
        if !address.starts_with('/') {
            return Err(ProtocolError::malformed(format!(
                "OSC address must start with '/', got {address:?}"
            )));
        }

        let tags = read_osc_string(buf, &mut pos)?;
        let mut chars = tags.chars();
        match chars.next() {
            Some(',') => {}
            _ => {
                return Err(ProtocolError::malformed(
                    "OSC type tag string must start with ','",
                ))
            }
        }

        let mut args = Vec::new();
        for tag in chars {
            let arg = match tag {
                'i' => OscArg::Int(read_i32_be(buf, &mut pos)?),
                'f' => OscArg::Float(read_f32_be(buf, &mut pos)?),
                's' => OscArg::String(read_osc_string(buf, &mut pos)?),
                'b' => OscArg::Blob(read_osc_blob(buf, &mut pos)?),
                'T' => OscArg::Bool(true),
                'F' => OscArg::Bool(false),
                'N' => OscArg::Nil,
                other => {
                    return Err(ProtocolError::unsupported(format!(
                        "OSC type tag '{other}' is not supported by the Console codec"
                    )))
                }
            };
            args.push(arg);
        }

        Ok(Self { address, args })
    }

    // -- Console convenience constructors ----------------------------------------------------------

    /// `/xremote` — subscribe to asynchronous updates. Refresh every [`XREMOTE_INTERVAL_MS`].
    pub fn xremote() -> Self {
        Self::new("/xremote", vec![])
    }

    /// `/meters ,s "<sub_path>"` — subscribe to meter pushes (e.g. `"/meters/1"`).
    /// Expires after ~10 s on the console, so refresh alongside `/xremote`.
    pub fn meters(sub_path: &str) -> Self {
        Self::new("/meters", vec![OscArg::String(sub_path.to_string())])
    }

    /// `/xinfo` — request console identity/version.
    pub fn xinfo() -> Self {
        Self::new("/xinfo", vec![])
    }

    /// `/info` — identity string (usually a console reply).
    pub fn info() -> Self {
        Self::new("/info", vec![])
    }

    /// `/status` — status string (usually a console reply).
    pub fn status() -> Self {
        Self::new("/status", vec![])
    }

    /// `/ch/NN/mix/fader` with a clamped `0.0..=1.0` float.
    pub fn channel_fader(channel: u8, fader: f32) -> Result<Self, ProtocolError> {
        validate_channel(channel)?;
        Ok(Self::new(
            format!("/ch/{channel:02}/mix/fader"),
            vec![OscArg::Float(clamp01(fader))],
        ))
    }

    /// `/ch/NN/mix/on` (`true` = on, `false` = muted).
    pub fn channel_on(channel: u8, on: bool) -> Result<Self, ProtocolError> {
        validate_channel(channel)?;
        Ok(Self::new(
            format!("/ch/{channel:02}/mix/on"),
            vec![OscArg::Int(if on { 1 } else { 0 })],
        ))
    }

    /// `/ch/NN/config/name`.
    pub fn channel_name(channel: u8, name: &str) -> Result<Self, ProtocolError> {
        validate_channel(channel)?;
        Ok(Self::new(
            format!("/ch/{channel:02}/config/name"),
            vec![OscArg::String(name.to_string())],
        ))
    }

    /// `/dca/N/fader` with a clamped `0.0..=1.0` float.
    pub fn dca_fader(dca: u8, fader: f32) -> Result<Self, ProtocolError> {
        validate_dca(dca)?;
        Ok(Self::new(
            format!("/dca/{dca}/fader"),
            vec![OscArg::Float(clamp01(fader))],
        ))
    }

    /// `/dca/N/on` (`true` = on, `false` = muted).
    pub fn dca_on(dca: u8, on: bool) -> Result<Self, ProtocolError> {
        validate_dca(dca)?;
        Ok(Self::new(
            format!("/dca/{dca}/on"),
            vec![OscArg::Int(if on { 1 } else { 0 })],
        ))
    }

    /// `/main/st/mix/fader`.
    pub fn main_stereo_fader(fader: f32) -> Self {
        Self::new("/main/st/mix/fader", vec![OscArg::Float(clamp01(fader))])
    }

    /// `/main/st/mix/on`.
    pub fn main_stereo_on(on: bool) -> Self {
        Self::new(
            "/main/st/mix/on",
            vec![OscArg::Int(if on { 1 } else { 0 })],
        )
    }

    /// `/-action/goscene` — recall a console scene (1..=100). High-impact.
    pub fn go_scene(scene: u32) -> Result<Self, ProtocolError> {
        if !(1..=100).contains(&scene) {
            return Err(ProtocolError::malformed(format!(
                "scene index {scene} out of range 1..=100"
            )));
        }
        Ok(Self::new(
            "/-action/goscene",
            vec![OscArg::Int(scene as i32)],
        ))
    }

    /// `/-action/gosnippet` — recall a snippet (1..=100). High-impact.
    pub fn go_snippet(snippet: u32) -> Result<Self, ProtocolError> {
        if !(1..=100).contains(&snippet) {
            return Err(ProtocolError::malformed(format!(
                "snippet index {snippet} out of range 1..=100"
            )));
        }
        Ok(Self::new(
            "/-action/gosnippet",
            vec![OscArg::Int(snippet as i32)],
        ))
    }
}

// -------------------------------------------------------------------------------------------------
// Console meters
// -------------------------------------------------------------------------------------------------

/// Decoded `/meters/1` payload.
#[derive(Debug, Clone, PartialEq)]
pub struct MeterFrame {
    /// Raw level bytes, one per meter, in console order.
    pub levels: Vec<u8>,
}

impl MeterFrame {
    /// Convert every byte to approximate dBFS (`None` = silent/`-∞`).
    pub fn levels_db(&self) -> Vec<Option<f32>> {
        self.levels.iter().copied().map(meter_byte_to_db).collect()
    }

    pub fn peak_db(&self) -> Option<f32> {
        self.levels_db()
            .into_iter()
            .flatten()
            .fold(None, |acc: Option<f32>, v| Some(acc.map_or(v, |a| a.max(v))))
    }
}

/// Parse the inner blob of an Console `/meters/1` message.
///
/// Layout: `[uint32 little-endian count][count × uint8 level]`.
pub fn parse_meters_blob(blob: &[u8]) -> Result<MeterFrame, ProtocolError> {
    if blob.len() < 4 {
        return Err(ProtocolError::TooShort {
            expected: 4,
            actual: blob.len(),
        });
    }
    let count = u32::from_le_bytes([blob[0], blob[1], blob[2], blob[3]]) as usize;
    if blob.len() < 4 + count {
        return Err(ProtocolError::TooShort {
            expected: 4 + count,
            actual: blob.len(),
        });
    }
    Ok(MeterFrame {
        levels: blob[4..4 + count].to_vec(),
    })
}

/// Extract the first blob from an OSC message and parse it as `/meters/1`.
pub fn parse_meters_message(msg: &OscMessage) -> Result<MeterFrame, ProtocolError> {
    match msg.args.first() {
        Some(OscArg::Blob(blob)) => parse_meters_blob(blob),
        _ => Err(ProtocolError::malformed(
            "/meters/1 message did not carry a blob argument",
        )),
    }
}

/// Convert an Console meter byte (linear peak magnitude) to dBFS.
pub fn meter_byte_to_db(v: u8) -> Option<f32> {
    if v == 0 {
        None
    } else {
        Some(20.0 * (v as f32 / 255.0).log10())
    }
}

// -------------------------------------------------------------------------------------------------
// Fader law
// -------------------------------------------------------------------------------------------------

/// Convert a fader float (`0.0..=1.0`) to dB. Returns `None` for fully off.
pub fn fader_to_db(fader: f32) -> Option<f32> {
    let f = clamp01(fader);
    if f <= 1e-6 {
        None
    } else {
        Some(FADER_DB_PER_DECADE * (f / FADER_UNITY).log10())
    }
}

/// Convert dB to a fader float (`0.0..=1.0`), clamped at the console's lower limit.
pub fn db_to_fader(db: f32) -> f32 {
    if !db.is_finite() || db <= FADER_MIN_DB {
        0.0
    } else {
        clamp01(FADER_UNITY * 10f32.powf(db / FADER_DB_PER_DECADE))
    }
}

// -------------------------------------------------------------------------------------------------
// Internal OSC helpers
// -------------------------------------------------------------------------------------------------

fn clamp01(v: f32) -> f32 {
    if v.is_nan() {
        0.0
    } else {
        v.clamp(0.0, 1.0)
    }
}

fn validate_channel(channel: u8) -> Result<(), ProtocolError> {
    if (1..=MAX_CHANNEL).contains(&channel) {
        Ok(())
    } else {
        Err(ProtocolError::malformed(format!(
            "channel {channel} out of range 1..={MAX_CHANNEL}"
        )))
    }
}

fn validate_dca(dca: u8) -> Result<(), ProtocolError> {
    if (1..=MAX_DCA).contains(&dca) {
        Ok(())
    } else {
        Err(ProtocolError::malformed(format!(
            "DCA {dca} out of range 1..={MAX_DCA}"
        )))
    }
}

fn push_osc_string(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(s.as_bytes());
    out.push(0);
    while out.len() % 4 != 0 {
        out.push(0);
    }
}

fn push_osc_blob(out: &mut Vec<u8>, b: &[u8]) {
    out.extend_from_slice(&(b.len() as i32).to_be_bytes());
    out.extend_from_slice(b);
    while out.len() % 4 != 0 {
        out.push(0);
    }
}

fn read_osc_string(buf: &[u8], pos: &mut usize) -> Result<String, ProtocolError> {
    if *pos >= buf.len() {
        return Err(ProtocolError::TooShort {
            expected: *pos + 1,
            actual: buf.len(),
        });
    }
    let start = *pos;
    let nul = buf[start..]
        .iter()
        .position(|&b| b == 0)
        .ok_or_else(|| ProtocolError::malformed("unterminated OSC string"))?;
    let end = start + nul;
    let s = std::str::from_utf8(&buf[start..end])?.to_string();
    let mut next = end + 1;
    while next % 4 != 0 {
        next += 1;
    }
    if next > buf.len() {
        return Err(ProtocolError::TooShort {
            expected: next,
            actual: buf.len(),
        });
    }
    *pos = next;
    Ok(s)
}

fn read_i32_be(buf: &[u8], pos: &mut usize) -> Result<i32, ProtocolError> {
    if *pos + 4 > buf.len() {
        return Err(ProtocolError::TooShort {
            expected: *pos + 4,
            actual: buf.len(),
        });
    }
    let v = i32::from_be_bytes([buf[*pos], buf[*pos + 1], buf[*pos + 2], buf[*pos + 3]]);
    *pos += 4;
    Ok(v)
}

fn read_f32_be(buf: &[u8], pos: &mut usize) -> Result<f32, ProtocolError> {
    if *pos + 4 > buf.len() {
        return Err(ProtocolError::TooShort {
            expected: *pos + 4,
            actual: buf.len(),
        });
    }
    let v = f32::from_be_bytes([buf[*pos], buf[*pos + 1], buf[*pos + 2], buf[*pos + 3]]);
    *pos += 4;
    Ok(v)
}

fn read_osc_blob(buf: &[u8], pos: &mut usize) -> Result<Vec<u8>, ProtocolError> {
    if *pos + 4 > buf.len() {
        return Err(ProtocolError::TooShort {
            expected: *pos + 4,
            actual: buf.len(),
        });
    }
    let len = i32::from_be_bytes([buf[*pos], buf[*pos + 1], buf[*pos + 2], buf[*pos + 3]]);
    *pos += 4;
    if len < 0 {
        return Err(ProtocolError::malformed("negative OSC blob length"));
    }
    let len = len as usize;
    if *pos + len > buf.len() {
        return Err(ProtocolError::TooShort {
            expected: *pos + len,
            actual: buf.len(),
        });
    }
    let data = buf[*pos..*pos + len].to_vec();
    *pos += len;
    while *pos % 4 != 0 {
        *pos += 1;
    }
    if *pos > buf.len() {
        return Err(ProtocolError::TooShort {
            expected: *pos,
            actual: buf.len(),
        });
    }
    Ok(data)
}

// -------------------------------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xremote_wire_bytes_are_exact() {
        let bytes = OscMessage::xremote().encode();
        assert_eq!(
            bytes,
            vec![
                0x2F, 0x78, 0x72, 0x65, 0x6D, 0x6F, 0x74, 0x65, 0x00, 0x00, 0x00, 0x00, // "/xremote" + pad to 12
                0x2C, 0x00, 0x00, 0x00, // ","
            ]
        );
    }

    #[test]
    fn channel_fader_roundtrip() {
        let msg = OscMessage::channel_fader(1, 0.75).unwrap();
        let bytes = msg.encode();
        assert_eq!(&bytes[..20], b"/ch/01/mix/fader\0\0\0\0");
        assert_eq!(&bytes[20..24], b",f\0\0");
        assert_eq!(
            f32::from_be_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]),
            0.75
        );
        assert_eq!(OscMessage::decode(&bytes).unwrap(), msg);
    }

    #[test]
    fn channel_on_roundtrip() {
        let msg = OscMessage::channel_on(1, true).unwrap();
        let bytes = msg.encode();
        assert_eq!(&bytes[..16], b"/ch/01/mix/on\0\0\0");
        assert_eq!(&bytes[16..20], b",i\0\0");
        assert_eq!(&bytes[20..24], &[0, 0, 0, 1]);
        assert_eq!(OscMessage::decode(&bytes).unwrap(), msg);
    }

    #[test]
    fn scene_recall_roundtrip() {
        let msg = OscMessage::go_scene(4).unwrap();
        let bytes = msg.encode();
        assert_eq!(&bytes[..20], b"/-action/goscene\0\0\0\0");
        assert_eq!(OscMessage::decode(&bytes).unwrap(), msg);
    }

    #[test]
    fn rejects_out_of_range_targets() {
        assert!(OscMessage::channel_fader(0, 0.5).is_err());
        assert!(OscMessage::channel_fader(33, 0.5).is_err());
        assert!(OscMessage::dca_on(9, true).is_err());
        assert!(OscMessage::go_scene(0).is_err());
        assert!(OscMessage::go_scene(101).is_err());
    }

    #[test]
    fn fader_law_anchors() {
        assert_eq!(fader_to_db(0.0), None);
        assert!((fader_to_db(0.75).unwrap() - 0.0).abs() < 0.01);
        assert!((fader_to_db(1.0).unwrap() - 10.0).abs() < 0.05);
        assert!((db_to_fader(0.0) - 0.75).abs() < 0.001);
        assert!((db_to_fader(10.0) - 1.0).abs() < 0.001);
        assert_eq!(db_to_fader(-100.0), 0.0);
    }

    #[test]
    fn fader_law_is_monotonic() {
        let mut prev = f32::NEG_INFINITY;
        for i in 1..=100 {
            let db = fader_to_db(i as f32 / 100.0).unwrap();
            assert!(db > prev);
            prev = db;
        }
    }

    #[test]
    fn meter_blob_parses_little_endian_count() {
        // count = 3, levels = [255, 128, 0]
        let blob = [3, 0, 0, 0, 255, 128, 0];
        let frame = parse_meters_blob(&blob).unwrap();
        assert_eq!(frame.levels, vec![255, 128, 0]);

        let db = frame.levels_db();
        assert!((db[0].unwrap() - 0.0).abs() < 0.001);
        assert!((db[1].unwrap() - (-5.98)).abs() < 0.02);
        assert_eq!(db[2], None);
    }

    #[test]
    fn meter_message_extracts_blob() {
        let msg = OscMessage::new("/meters/1", vec![OscArg::Blob(vec![2, 0, 0, 0, 200, 10])]);
        let frame = parse_meters_message(&msg).unwrap();
        assert_eq!(frame.levels, vec![200, 10]);
    }

    #[test]
    fn bool_false_encodes_as_f_tag_and_roundtrips() {
        let msg = OscMessage::new("/test/bool", vec![OscArg::Bool(true), OscArg::Bool(false)]);
        let bytes = msg.encode();
        assert_eq!(OscMessage::decode(&bytes).unwrap(), msg);
    }

    #[test]
    fn meters_subscription_encodes_path() {
        let msg = OscMessage::meters("/meters/1");
        let decoded = OscMessage::decode(&msg.encode()).unwrap();
        assert_eq!(decoded.address, "/meters");
        assert_eq!(decoded.args, vec![OscArg::String("/meters/1".into())]);
    }

    #[test]
    fn truncated_buffers_error_cleanly() {
        assert!(OscMessage::decode(&[0x2F]).is_err());
        assert!(parse_meters_blob(&[1, 0]).is_err());
        let short = [5, 0, 0, 0, 1, 2];
        assert!(parse_meters_blob(&short).is_err());
    }
}
