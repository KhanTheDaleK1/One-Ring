//! Clean-room SlideTcp 7 remote-control codec.
//!
//! The `\x5f\x65\x7a\x77\x72\x65\x6d\x6f\x74\x65\x2e\x5f\x74\x63\x70` service speaks newline-delimited UTF-8 JSON: clients terminate commands
//! with `\n`, the server terminates JSON responses with `\r\n`. Binary payloads (`ScheduleData`,
//! `LiveData`, `slideImage`, `currentImage`) are preceded by a JSON header carrying `"size"`.
//!
//! Spec: `docs/re-findings/slide_tcp.md` §3. This module is codec-only; the TCP session,
//! heartbeat, pairing, and reconnect lifecycle live in `runtime/slide_tcp_adapter.rs`.

use super::ProtocolError;
use serde_json::{json, Value};

/// mDNS service type advertised by SlideTcp's remote control server.
pub const SERVICE_TYPE: &str = "\x5f\x65\x7a\x77\x72\x65\x6d\x6f\x74\x65\x2e\x5f\x74\x63\x70\x2e\x6c\x6f\x63\x61\x6c";
/// `device_type` for a companion/stream-deck class controller.
pub const DEVICE_TYPE_COMPANION: u8 = 8;
/// Server sends a heartbeat after 2 s idle and drops clients after 6 s of receive inactivity.
pub const SERVER_HEARTBEAT_SECS: u64 = 2;
pub const SERVER_TIMEOUT_SECS: u64 = 6;

/// Build the immediate post-connect handshake frame.
pub fn connect_frame(uid: &str, device_name: &str) -> String {
    let frame = json!({
        "action": "connect",
        "uid": uid,
        "device_name": device_name,
        "device_type": DEVICE_TYPE_COMPANION,
    });
    format!("{frame}\n")
}

pub fn heartbeat_frame() -> String {
    "{\"action\":\"heartbeat\"}\n".to_string()
}

pub fn action_frame(action: &str) -> String {
    let frame = json!({ "action": action });
    format!("{frame}\n")
}

/// `gotoSlide<N>` uses a 1-based slide index. Reject zero so we never emit `gotoSlide0`.
pub fn goto_slide_frame(index: u32) -> Option<String> {
    if index == 0 {
        return None;
    }
    Some(action_frame(&format!("gotoSlide{index}")))
}

/// `gotoSchedule<N>` uses a 1-based schedule item index.
pub fn goto_schedule_frame(index: u32) -> Option<String> {
    if index == 0 {
        return None;
    }
    Some(action_frame(&format!("gotoSchedule{index}")))
}

/// Request the documented JPEG preview for one slide.
pub fn get_slide_image_frame(
    rectype: &str,
    pres_rowid: &str,
    slide_rowid: &str,
    revision: &str,
) -> String {
    let mut fields = serde_json::Map::new();
    fields.insert("action".into(), json!("getSlideImage"));
    fields.insert("rectype".into(), json!(rectype));
    fields.insert("pres_rowid".into(), json!(pres_rowid));
    fields.insert("slide_rowid".into(), json!(slide_rowid));
    if !revision.is_empty() {
        fields.insert("revision".into(), json!(revision));
    }
    format!("{}\n", json!(fields))
}

/// Request a JPEG snapshot of the current live output.
pub fn get_current_image_frame() -> String {
    "{\"action\":\"getCurrentImage\"}\n".to_string()
}

/// The documented image bodies are raw `.jpg` bytes. Validate the JPEG SOI marker before caching
/// or rendering anything; never guess at image formats from undocumented response fields.
pub fn is_jpeg_payload(bytes: &[u8]) -> bool {
    bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff
}

pub fn get_slide_info_frame(rectype: &str, pres_rowid: &str, slide_rowid: &str) -> String {
    let frame = json!({
        "action": "getSlideInfo",
        "rectype": rectype,
        "pres_rowid": pres_rowid,
        "slide_rowid": slide_rowid,
    });
    format!("{frame}\n")
}

/// `getSlideInfo` with the optional cache hint documented in §3.4. Sending `requestrev`
/// lets the server reply `slideInfoOK` when our cached revision still matches.
pub fn get_slide_info_frame_with_revision(
    rectype: &str,
    pres_rowid: &str,
    slide_rowid: &str,
    requestrev: &str,
) -> String {
    let mut fields = serde_json::Map::new();
    fields.insert("action".into(), json!("getSlideInfo"));
    fields.insert("rectype".into(), json!(rectype));
    fields.insert("pres_rowid".into(), json!(pres_rowid));
    fields.insert("slide_rowid".into(), json!(slide_rowid));
    if !requestrev.is_empty() {
        fields.insert("requestrev".into(), json!(requestrev));
    }
    format!("{}\n", json!(fields))
}

/// A decoded server response. Binary frames are reported as a header so the transport can consume
/// the announced byte count before reading the next JSON line.
/// Metadata carried alongside a binary response header. Used to key JPEG payloads back to a
/// slide or to the live output without inventing any response fields beyond §3.4.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BinaryMeta {
    pub rectype: String,
    pub pres_rowid: String,
    pub slide_rowid: String,
    pub revision: String,
    pub imagehash: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ServerMessage {
    Paired,
    NotPaired,
    Heartbeat,
    Status(SlideTcpStatus),
    SlideInfo(SlideTcpSlideInfo),
    BinaryHeader {
        action: String,
        size: usize,
        meta: BinaryMeta,
    },
    Other(Value),
}

/// Black / clear / logo flags reported by `status`. There is no documented remote action that
/// toggles these; they are output state published by SlideTcp (§3.4, §4.2).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SlideTcpScreen {
    pub black: bool,
    pub clear: bool,
    pub logo: bool,
}

pub fn screen_from_status(status: &SlideTcpStatus) -> SlideTcpScreen {
    SlideTcpScreen {
        black: status.black,
        clear: status.clear,
        logo: status.logo,
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SlideTcpStatus {
    pub logo: bool,
    pub black: bool,
    pub clear: bool,
    pub rectype: String,
    pub pres_rowid: String,
    pub slide_rowid: String,
    pub pres_no: u32,
    pub slide_no: u32,
    pub schedulerev: String,
    pub liverev: String,
    pub imagehash: String,
    pub permissions: u32,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SlideTcpSlideInfo {
    pub rectype: String,
    pub pres_rowid: String,
    pub slide_rowid: String,
    pub title: String,
    pub reference_num: String,
    pub content: String,
    pub notes: String,
    pub revision: String,
}

/// Parse one server JSON line (with or without its trailing `\r\n`).
pub fn parse_server_line(line: &str) -> Result<ServerMessage, ProtocolError> {
    let trimmed = line.trim().trim_end_matches('\r').trim();
    if trimmed.is_empty() {
        return Err(ProtocolError::malformed("empty SlideTcp response"));
    }
    let value: Value = serde_json::from_str(trimmed)
        .map_err(|e| ProtocolError::malformed(format!("invalid SlideTcp JSON: {e}")))?;
    Ok(from_value(value))
}

fn from_value(value: Value) -> ServerMessage {
    let action = value
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    match action.as_str() {
        "paired" => ServerMessage::Paired,
        "notPaired" => ServerMessage::NotPaired,
        "heartbeat" => ServerMessage::Heartbeat,
        "status" => ServerMessage::Status(parse_status(&value)),
        "slideInfo" => ServerMessage::SlideInfo(parse_slide_info(&value)),
        "ScheduleData" | "LiveData" | "slideImage" | "currentImage" => ServerMessage::BinaryHeader {
            action,
            size: value
                .get("size")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            meta: BinaryMeta {
                rectype: str_field(&value, "rectype"),
                pres_rowid: str_field(&value, "pres_rowid"),
                slide_rowid: str_field(&value, "slide_rowid"),
                revision: str_field(&value, "revision"),
                imagehash: str_field(&value, "imagehash"),
            },
        },
        _ => ServerMessage::Other(value),
    }
}

fn str_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| match v {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .unwrap_or_default()
}

fn u32_field(value: &Value, key: &str) -> u32 {
    value
        .get(key)
        .and_then(|v| match v {
            Value::Number(n) => n.as_u64().map(|n| n as u32),
            Value::String(s) => s.parse().ok(),
            _ => None,
        })
        .unwrap_or(0)
}

fn parse_status(value: &Value) -> SlideTcpStatus {
    SlideTcpStatus {
        logo: value.get("logo").and_then(Value::as_bool).unwrap_or(false),
        black: value.get("black").and_then(Value::as_bool).unwrap_or(false),
        clear: value.get("clear").and_then(Value::as_bool).unwrap_or(false),
        rectype: str_field(value, "rectype"),
        pres_rowid: str_field(value, "pres_rowid"),
        slide_rowid: str_field(value, "slide_rowid"),
        pres_no: u32_field(value, "pres_no"),
        slide_no: u32_field(value, "slide_no"),
        schedulerev: str_field(value, "schedulerev"),
        liverev: str_field(value, "liverev"),
        imagehash: str_field(value, "imagehash"),
        permissions: u32_field(value, "permissions"),
    }
}

fn parse_slide_info(value: &Value) -> SlideTcpSlideInfo {
    SlideTcpSlideInfo {
        rectype: str_field(value, "rectype"),
        pres_rowid: str_field(value, "pres_rowid"),
        slide_rowid: str_field(value, "slide_rowid"),
        title: str_field(value, "title"),
        reference_num: str_field(value, "reference_num"),
        content: str_field(value, "content"),
        notes: str_field(value, "notes"),
        revision: str_field(value, "revision"),
    }
}

// -------------------------------------------------------------------------------------------------
// ScheduleData / LiveData binary index stream (§3.4)
// -------------------------------------------------------------------------------------------------

/// One slide entry inside a schedule/live index item.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IndexSlide {
    pub rowid: i64,
    pub revision: i64,
}

/// One schedule item and its optional single level of child slides.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IndexItem {
    pub rowid: i64,
    pub revision: i64,
    pub slides: Vec<IndexSlide>,
}

/// Typed view of a `ScheduleData` or `LiveData` binary payload.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IndexPayload {
    pub container_revision: i64,
    pub items: Vec<IndexItem>,
}

struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], ProtocolError> {
        let end = self
            .pos
            .checked_add(n)
            .ok_or_else(|| ProtocolError::malformed("index length overflow"))?;
        if end > self.bytes.len() {
            return Err(ProtocolError::TooShort {
                expected: end,
                actual: self.bytes.len(),
            });
        }
        let slice = &self.bytes[self.pos..end];
        self.pos = end;
        Ok(slice)
    }

    fn i32(&mut self) -> Result<i32, ProtocolError> {
        let bytes: [u8; 4] = self.take(4)?.try_into().unwrap();
        Ok(i32::from_le_bytes(bytes))
    }

    fn i64(&mut self) -> Result<i64, ProtocolError> {
        let bytes: [u8; 8] = self.take(8)?.try_into().unwrap();
        Ok(i64::from_le_bytes(bytes))
    }

    fn u8(&mut self) -> Result<u8, ProtocolError> {
        Ok(self.take(1)?[0])
    }

    fn at_end(&self) -> bool {
        self.pos == self.bytes.len()
    }
}

fn plausible_count(count: i32) -> Result<usize, ProtocolError> {
    if (0..=100_000).contains(&count) {
        Ok(count as usize)
    } else {
        Err(ProtocolError::malformed(format!(
            "implausible index count {count}"
        )))
    }
}

/// The documented layout mentions an "outer flag" that gates the child-slide block, but does not
/// state its width. Try the compact one-byte form first, then a little-endian int32; accept only
/// the interpretation that consumes the payload exactly. Both candidates are clean-room readings
/// of the same documented field and must be confirmed against live hardware.
fn parse_with_flag_width(bytes: &[u8], flag_width: usize) -> Result<IndexPayload, ProtocolError> {
    let mut cursor = Cursor::new(bytes);
    let item_count = plausible_count(cursor.i32()?)?;
    let container_revision = cursor.i64()?;
    let mut items = Vec::with_capacity(item_count);
    for _ in 0..item_count {
        let rowid = cursor.i64()?;
        let revision = cursor.i64()?;
        let flag = match flag_width {
            1 => cursor.u8()? as u32,
            4 => cursor.i32()? as u32,
            _ => return Err(ProtocolError::malformed("unsupported index flag width")),
        };
        let mut slides = Vec::new();
        match flag {
            0 => {}
            1 => {
                let slide_count = plausible_count(cursor.i32()?)?;
                let _slide_container_revision = cursor.i64()?;
                for _ in 0..slide_count {
                    slides.push(IndexSlide {
                        rowid: cursor.i64()?,
                        revision: cursor.i64()?,
                    });
                }
            }
            other => {
                return Err(ProtocolError::malformed(format!(
                    "unexpected index outer flag {other}"
                )));
            }
        }
        items.push(IndexItem {
            rowid,
            revision,
            slides,
        });
    }
    if !cursor.at_end() {
        return Err(ProtocolError::malformed(
            "trailing bytes after SlideTcp index payload",
        ));
    }
    Ok(IndexPayload {
        container_revision,
        items,
    })
}

/// Decode a raw `ScheduleData` / `LiveData` body into typed items and slide revisions.
pub fn parse_index_payload(bytes: &[u8]) -> Result<IndexPayload, ProtocolError> {
    for width in [1usize, 4] {
        if let Ok(payload) = parse_with_flag_width(bytes, width) {
            return Ok(payload);
        }
    }
    parse_with_flag_width(bytes, 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_handshake_is_companion_json_line() {
        let frame = connect_frame("one-ring-1", "One Ring");
        assert!(frame.ends_with('\n'));
        let value: Value = serde_json::from_str(frame.trim()).unwrap();
        assert_eq!(value["action"], "connect");
        assert_eq!(value["uid"], "one-ring-1");
        assert_eq!(value["device_name"], "One Ring");
        assert_eq!(value["device_type"], DEVICE_TYPE_COMPANION);
    }

    #[test]
    fn navigation_frames_match_action_catalog() {
        assert_eq!(action_frame("nextSlide"), "{\"action\":\"nextSlide\"}\n");
        assert_eq!(action_frame("prevBuild"), "{\"action\":\"prevBuild\"}\n");
        assert_eq!(goto_slide_frame(3).as_deref(), Some("{\"action\":\"gotoSlide3\"}\n"));
        assert_eq!(goto_schedule_frame(5).as_deref(), Some("{\"action\":\"gotoSchedule5\"}\n"));
        assert!(goto_slide_frame(0).is_none());
        assert!(goto_schedule_frame(0).is_none());
    }

    #[test]
    fn image_requests_match_documented_actions() {
        let slide = get_slide_image_frame("0", "12", "3", "rev-5");
        let value: Value = serde_json::from_str(slide.trim()).unwrap();
        assert_eq!(value["action"], "getSlideImage");
        assert_eq!(value["pres_rowid"], "12");
        assert_eq!(value["slide_rowid"], "3");
        assert_eq!(value["revision"], "rev-5");

        let plain = get_slide_image_frame("0", "12", "3", "");
        let value: Value = serde_json::from_str(plain.trim()).unwrap();
        assert!(value.get("revision").is_none());
        assert_eq!(
            get_current_image_frame(),
            "{\"action\":\"getCurrentImage\"}\n"
        );
        assert!(is_jpeg_payload(&[0xff, 0xd8, 0xff, 0xe0, 0x00]));
        assert!(!is_jpeg_payload(b"not a jpeg"));
        assert!(!is_jpeg_payload(&[0xff, 0xd8]));
    }

    #[test]
    fn status_response_is_typed() {
        let line = r#"{"action":"status","logo":true,"black":false,"clear":false,"rectype":"0","pres_rowid":"12","slide_rowid":"3","pres_no":"1","slide_no":"2","schedulerev":"45","liverev":"108","imagehash":"abc","permissions":7}"#;
        let message = parse_server_line(line).unwrap();
        let ServerMessage::Status(status) = message else {
            panic!("expected status");
        };
        assert!(status.logo);
        assert!(!status.black);
        assert_eq!(status.pres_no, 1);
        assert_eq!(status.slide_no, 2);
        assert_eq!(status.permissions, 7);
    }

    #[test]
    fn pairing_and_binary_headers_are_decoded() {
        assert_eq!(parse_server_line("{\"action\":\"paired\"}\r\n").unwrap(), ServerMessage::Paired);
        assert_eq!(parse_server_line("{\"action\":\"notPaired\"}\n").unwrap(), ServerMessage::NotPaired);
        assert_eq!(parse_server_line("{\"action\":\"heartbeat\"}\r\n").unwrap(), ServerMessage::Heartbeat);
        assert_eq!(
            parse_server_line("{\"action\":\"ScheduleData\",\"size\":128}\r\n").unwrap(),
            ServerMessage::BinaryHeader {
                action: "ScheduleData".into(),
                size: 128,
                meta: BinaryMeta::default(),
            }
        );
        let image = parse_server_line(
            r#"{"action":"slideImage","rectype":"0","pres_rowid":"12","slide_rowid":"3","revision":"5","imagehash":"hash-1","size":64}"#,
        )
        .unwrap();
        let ServerMessage::BinaryHeader { action, size, meta } = image else {
            panic!("expected image header");
        };
        assert_eq!(action, "slideImage");
        assert_eq!(size, 64);
        assert_eq!(meta.pres_rowid, "12");
        assert_eq!(meta.slide_rowid, "3");
        assert_eq!(meta.revision, "5");
        assert_eq!(meta.imagehash, "hash-1");
        assert!(parse_server_line("").is_err());
    }

    #[test]
    fn slide_info_carries_notes() {
        let line = r#"{"action":"slideInfo","rectype":"0","pres_rowid":"12","slide_rowid":"3","title":"Grace","reference_num":"License 123","content":"Line one","notes":"Slow down","revision":"5"}"#;
        let message = parse_server_line(line).unwrap();
        let ServerMessage::SlideInfo(info) = message else {
            panic!("expected slideInfo");
        };
        assert_eq!(info.title, "Grace");
        assert_eq!(info.notes, "Slow down");
        assert_eq!(info.revision, "5");
    }

    #[test]
    fn get_slide_info_can_carry_a_cache_revision() {
        let frame = get_slide_info_frame_with_revision("0", "12", "3", "5");
        let value: Value = serde_json::from_str(frame.trim()).unwrap();
        assert_eq!(value["action"], "getSlideInfo");
        assert_eq!(value["pres_rowid"], "12");
        assert_eq!(value["requestrev"], "5");
        let plain = get_slide_info_frame_with_revision("0", "12", "3", "");
        let value: Value = serde_json::from_str(plain.trim()).unwrap();
        assert!(value.get("requestrev").is_none());
    }

    fn le_i32(v: i32) -> Vec<u8> {
        v.to_le_bytes().to_vec()
    }
    fn le_i64(v: i64) -> Vec<u8> {
        v.to_le_bytes().to_vec()
    }

    #[test]
    fn index_payload_parses_one_byte_flag_layout() {
        let mut bytes = le_i32(2);
        bytes.extend(le_i64(45)); // container revision
        bytes.extend(le_i64(12)); // item 1
        bytes.extend(le_i64(7));
        bytes.push(1); // children present
        bytes.extend(le_i32(2));
        bytes.extend(le_i64(100)); // slide container revision
        bytes.extend(le_i64(3));
        bytes.extend(le_i64(5));
        bytes.extend(le_i64(4));
        bytes.extend(le_i64(8));
        bytes.extend(le_i64(9)); // item 2 rowid
        bytes.extend(le_i64(10)); // item 2 revision
        bytes.push(0); // item 2, no children

        let parsed = parse_index_payload(&bytes).unwrap();
        assert_eq!(parsed.container_revision, 45);
        assert_eq!(parsed.items.len(), 2);
        assert_eq!(parsed.items[0].rowid, 12);
        assert_eq!(parsed.items[0].slides.len(), 2);
        assert_eq!(parsed.items[0].slides[1].rowid, 4);
        assert_eq!(parsed.items[0].slides[1].revision, 8);
        assert!(parsed.items[1].slides.is_empty());
    }

    #[test]
    fn index_payload_accepts_int32_flag_layout() {
        let mut bytes = le_i32(1);
        bytes.extend(le_i64(46));
        bytes.extend(le_i64(20));
        bytes.extend(le_i64(3));
        bytes.extend(le_i32(1)); // four-byte flag
        bytes.extend(le_i32(1));
        bytes.extend(le_i64(101));
        bytes.extend(le_i64(6));
        bytes.extend(le_i64(2));
        let parsed = parse_index_payload(&bytes).unwrap();
        assert_eq!(parsed.items[0].slides[0].rowid, 6);
        assert_eq!(parsed.items[0].slides[0].revision, 2);
    }

    #[test]
    fn index_payload_rejects_truncation() {
        let bytes = [1, 0, 0, 0, 9, 9, 9];
        assert!(parse_index_payload(&bytes).is_err());
    }
}
