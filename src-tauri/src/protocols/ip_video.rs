//! Clean-room IP_VIDEO 6 Discovery Service + control XML codec (TCP `:5959` and IP_VIDEO metadata).
//!
//! Implements the XML documents used by the IP_VIDEO 6 Discovery Service (`<compatible/>`,
//! `<advertiser/>`, `<listener>`, `<query_receivers/>`, `<control_receiver>`, `<ip_video_routing>`,
//! telemetry) and the metadata-only PTZ / tally messages documented in
//! `docs/re-findings/ip_video.md`.
//!
//! The parser is intentionally small and dependency-free: it understands the flat XML shapes IP_VIDEO
//! uses here and refuses anything ambiguous. It is **not** a general-purpose XML parser.
//!
//! Transport (the TCP `5959` connection, mDNS, or an active IP_VIDEO metadata channel) is owned by the
//! adapter layer; this module only turns messages into bytes and back.

use super::ProtocolError;
use serde_json::json;
use std::collections::BTreeMap;

pub const IP_VIDEO_DISCOVERY_PORT: u16 = 5959;
pub const IP_VIDEO_MDNS_SERVICE: &str = "\x5f\x6e\x64\x69\x2e\x5f\x74\x63\x70\x2e\x6c\x6f\x63\x61\x6c\x2e";

// -------------------------------------------------------------------------------------------------
// XML primitives
// -------------------------------------------------------------------------------------------------

fn escape_text(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attr(s: &str) -> String {
    escape_text(s).replace('"', "&quot;").replace('\'', "&apos;")
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Find the byte offset of `<name` with a valid tag boundary.
fn find_open_start(hay: &str, name: &str) -> Option<usize> {
    let pat = format!("<{name}");
    let mut from = 0;
    while let Some(rel) = hay[from..].find(&pat) {
        let abs = from + rel;
        let after = abs + pat.len();
        let ok = matches!(
            hay.as_bytes().get(after),
            Some(b' ') | Some(b'\t') | Some(b'\r') | Some(b'\n') | Some(b'/') | Some(b'>')
        );
        if ok {
            return Some(abs);
        }
        from = after;
    }
    None
}

/// Given a slice starting at `<`, return `(bytes consumed through '>', self_closing)`.
fn find_open_end(hay: &str) -> Option<(usize, bool)> {
    let end = hay.find('>')?;
    let mut i = end;
    while i > 0 && matches!(hay.as_bytes()[i - 1], b' ' | b'\t' | b'\r' | b'\n') {
        i -= 1;
    }
    let self_closing = i > 0 && hay.as_bytes()[i - 1] == b'/';
    Some((end + 1, self_closing))
}

fn attr_in_tag(tag: &str, name: &str) -> Option<String> {
    let bytes = tag.as_bytes();
    let pat = name.as_bytes();
    let mut i = 0;
    while i + pat.len() < bytes.len() {
        if &bytes[i..i + pat.len()] == pat {
            let before_ok = i == 0
                || matches!(bytes[i - 1], b' ' | b'\t' | b'\r' | b'\n' | b'<' | b'/');
            if before_ok {
                let mut j = i + pat.len();
                while j < bytes.len() && matches!(bytes[j], b' ' | b'\t') {
                    j += 1;
                }
                if j < bytes.len() && bytes[j] == b'=' {
                    j += 1;
                    while j < bytes.len() && matches!(bytes[j], b' ' | b'\t') {
                        j += 1;
                    }
                    if j < bytes.len() && (bytes[j] == b'"' || bytes[j] == b'\'') {
                        let quote = bytes[j];
                        let start = j + 1;
                        if let Some(rel) = bytes[start..].iter().position(|&b| b == quote) {
                            let end = start + rel;
                            return Some(unescape(&tag[start..end]));
                        }
                    }
                }
            }
        }
        i += 1;
    }
    None
}

/// Inner text of the first `<name>...</name>` element.
pub fn text_of(xml: &str, name: &str) -> Option<String> {
    let start = find_open_start(xml, name)?;
    let (open_len, self_closing) = find_open_end(&xml[start..])?;
    if self_closing {
        return None;
    }
    let inner_start = start + open_len;
    let close = format!("</{name}>");
    let rel = xml[inner_start..].find(&close)?;
    Some(unescape(xml[inner_start..inner_start + rel].trim()))
}

/// Inner contents of every `<name>...</name>` element (empty string for self-closing tags).
///
/// Tracks nesting depth so an element that reuses its own name as a child (IP_VIDEO's
/// `<source><source>Name</source>...</source>`) is extracted correctly.
pub fn extract_blocks<'a>(xml: &'a str, name: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(rel) = find_open_start(&xml[pos..], name) {
        let start = pos + rel;
        let Some((open_len, self_closing)) = find_open_end(&xml[start..]) else {
            break;
        };
        if self_closing {
            out.push("");
            pos = start + open_len;
            continue;
        }
        let inner_start = start + open_len;
        let close = format!("</{name}>");
        let mut depth = 1usize;
        let mut cursor = inner_start;
        let mut inner_end = None;
        loop {
            let next_open = find_open_start(&xml[cursor..], name).map(|r| cursor + r);
            let next_close = xml[cursor..].find(&close).map(|r| cursor + r);
            match (next_open, next_close) {
                (Some(o), Some(c)) if o < c => {
                    let Some((ol, sc)) = find_open_end(&xml[o..]) else {
                        break;
                    };
                    if !sc {
                        depth += 1;
                    }
                    cursor = o + ol;
                }
                (_, Some(c)) => {
                    depth -= 1;
                    if depth == 0 {
                        inner_end = Some(c);
                        break;
                    }
                    cursor = c + close.len();
                }
                _ => break,
            }
        }
        let Some(inner_end) = inner_end else {
            break;
        };
        out.push(&xml[inner_start..inner_end]);
        pos = inner_end + close.len();
    }
    out
}

/// First occurrence of a top-level element's inner text, or the tag name if unrecognized.
fn first_tag_name(xml: &str) -> Option<String> {
    let start = xml.find('<')?;
    let rest = &xml[start + 1..];
    let end = rest
        .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
        .unwrap_or(rest.len());
    if end == 0 {
        None
    } else {
        Some(rest[..end].to_string())
    }
}

// -------------------------------------------------------------------------------------------------
// Message model
// -------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IpVideoSource {
    pub id: String,
    pub name: String,
    pub address: String,
    pub port: u16,
    pub groups: Vec<String>,
    pub metadata: Option<String>,
}

impl IpVideoSource {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        address: impl Into<String>,
        port: u16,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            address: address.into(),
            port,
            groups: vec!["public".into()],
            metadata: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IpVideoReceiver {
    pub id: String,
    pub name: String,
    pub input_id: Option<String>,
    pub input_name: Option<String>,
    pub address: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IpVideoProperty {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IpVideoRouting {
    pub name: Option<String>,
    pub ip: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IpVideoTally {
    pub on_program: bool,
    pub on_preview: bool,
}

/// A PTZ / recorder / KVM metadata command, preserved as a tag plus attributes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IpVideoMetadataCommand {
    pub tag: String,
    pub attrs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IpVideoMessage {
    Compatible,
    Advertiser,
    Listener { listener_id: Option<String> },
    QuerySources,
    QueryReceivers,
    Sources(Vec<IpVideoSource>),
    Receivers(Vec<IpVideoReceiver>),
    MonitorEvents(Vec<IpVideoProperty>),
    Routing(IpVideoRouting),
    RoutingClear,
    Tally(IpVideoTally),
    TallyEcho(IpVideoTally),
    Metadata(IpVideoMetadataCommand),
    Unknown(String),
}

// -------------------------------------------------------------------------------------------------
// Builders
// -------------------------------------------------------------------------------------------------

pub fn handshake_compatible() -> String {
    "<compatible/>".to_string()
}

pub fn handshake_advertiser() -> String {
    "<advertiser/>".to_string()
}

pub fn handshake_listener(listener_id: &str) -> String {
    format!(
        "<listener><listener_id>{}</listener_id></listener>",
        escape_text(listener_id)
    )
}

pub fn query_sources() -> String {
    "<query_sources/>".to_string()
}

pub fn query_receivers() -> String {
    "<query_receivers/>".to_string()
}

pub fn query_inputs() -> String {
    "<query_inputs/>".to_string()
}

/// Register a sender with the Discovery Service.
pub fn add_source(source: &IpVideoSource) -> String {
    let groups = source
        .groups
        .iter()
        .map(|g| format!("<group>{}</group>", escape_text(g)))
        .collect::<String>();
    let metadata = source
        .metadata
        .as_ref()
        .map(|m| format!("<metadata>{}</metadata>", escape_text(m)))
        .unwrap_or_default();
    format!(
        "<add_source><source>{name}</source><source_id>{id}</source_id><name>{name}</name><address>{addr}</address><port>{port}</port><groups>{groups}</groups>{metadata}</add_source>",
        name = escape_text(&source.name),
        id = escape_text(&source.id),
        addr = escape_text(&source.address),
        port = source.port,
        groups = groups,
        metadata = metadata,
    )
}

pub fn remove_source(source_id: &str) -> String {
    format!(
        "<remove_source><source_id>{}</source_id></remove_source>",
        escape_text(source_id)
    )
}

/// Register a receiver with the Discovery Service.
pub fn add_receiver(receiver: &IpVideoReceiver) -> String {
    let input_id = receiver
        .input_id
        .as_ref()
        .map(|v| format!("<input_id>{}</input_id>", escape_text(v)))
        .unwrap_or_default();
    let input_name = receiver
        .input_name
        .as_ref()
        .map(|v| format!("<input_name>{}</input_name>", escape_text(v)))
        .unwrap_or_default();
    let address = receiver
        .address
        .as_ref()
        .map(|v| format!("<address>{}</address>", escape_text(v)))
        .unwrap_or_default();
    format!(
        "<receiver><receiver_id>{id}</receiver_id><name>{name}</name>{input_id}{input_name}{address}<capabilities><metadata>true</metadata><video>true</video><audio>true</audio></capabilities><control_capabilities><connect>true</connect></control_capabilities></receiver>",
        id = escape_text(&receiver.id),
        name = escape_text(&receiver.name),
    )
}

pub fn remove_receiver(receiver_id: &str) -> String {
    format!(
        "<remove_receiver><receiver_id>{}</receiver_id></remove_receiver>",
        escape_text(receiver_id)
    )
}

/// Ask the Discovery Service to switch a receiver to `source_name`.
pub fn control_receiver(receiver_id: &str, source_name: &str) -> String {
    format!(
        "<control_receiver><receiver_id>{}</receiver_id><command>connect</command><arg>{}</arg></control_receiver>",
        escape_text(receiver_id),
        escape_text(source_name)
    )
}

/// Send a command to an advertised sender.
pub fn control_source(source_id: &str, command: &str, arg: &str) -> String {
    format!(
        "<control_source><source_id>{}</source_id><command>{}</command><arg>{}</arg></control_source>",
        escape_text(source_id),
        escape_text(command),
        escape_text(arg)
    )
}

pub fn monitor_request(id: &str) -> String {
    format!(
        "<monitor_request><id>{}</id></monitor_request>",
        escape_text(id)
    )
}

pub fn reconnect() -> String {
    "<reconnect/>".to_string()
}

/// Virtual routing redirection: tell connected receivers to attach to `name@ip`.
pub fn ip_video_routing(name: &str, ip: &str) -> String {
    format!(
        "\x3c\x6e\x64\x69\x5f\x72\x6f\x75\x74\x69\x6e\x67 name=\"{}\" ip=\"{}\"/>",
        escape_attr(name),
        escape_attr(ip)
    )
}

/// Clear a virtual route.
pub fn ip_video_routing_clear() -> String {
    "\x3c\x6e\x64\x69\x5f\x72\x6f\x75\x74\x69\x6e\x67/>".to_string()
}

/// Metadata-only connection: tally/PTZ without pulling video or audio bandwidth.
pub fn enabled_streams_metadata_only() -> String {
    "\x3c\x6e\x64\x69\x5f\x65\x6e\x61\x62\x6c\x65\x64\x5f\x73\x74\x72\x65\x61\x6d\x73 video=\"false\" audio=\"false\" text=\"true\"/>".to_string()
}

pub fn tally(on_program: bool, on_preview: bool) -> String {
    format!(
        "\x3c\x6e\x64\x69\x5f\x74\x61\x6c\x6c\x79 on_program=\"{}\" on_preview=\"{}\"/>",
        on_program, on_preview
    )
}

pub fn tally_echo(on_program: bool, on_preview: bool) -> String {
    format!(
        "\x3c\x6e\x64\x69\x5f\x74\x61\x6c\x6c\x79\x5f\x65\x63\x68\x6f on_program=\"{}\" on_preview=\"{}\"/>",
        on_program, on_preview
    )
}

// -- Web receiver HTTP control API --------------------------------------------------------------
//
// Small, clean-room HTTP request descriptors for a receiver's local control interface. The codec
// only describes the requests; the adapter/transport layer owns sockets, retries and timeouts.

pub const RECEIVER_API_SOURCES: &str = "/v1/sources";
pub const RECEIVER_API_CONFIGURATION: &str = "/v1/configuration";
pub const RECEIVER_API_RECORDING: &str = "/v1/recording";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReceiverRecordingAction {
    Start,
    Stop,
}

impl ReceiverRecordingAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop => "stop",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IpVideoHttpRequest {
    pub method: &'static str,
    pub path: &'static str,
    pub body: Option<String>,
}

impl IpVideoHttpRequest {
    /// Render an HTTP/1.1 request with the correct `Host`, `Content-Type` and `Content-Length`.
    pub fn to_http_request(&self, host: &str) -> String {
        let host = host.trim().trim_end_matches('/');
        let mut out = format!("{} {} HTTP/1.1\r\nHost: {}\r\n", self.method, self.path, host);
        if let Some(body) = &self.body {
            out.push_str("Content-Type: application/json\r\n");
            out.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        out.push_str("Connection: close\r\n\r\n");
        if let Some(body) = &self.body {
            out.push_str(body);
        }
        out
    }
}

/// `GET /v1/sources` — enumerate the feeds a receiver can subscribe to.
pub fn receiver_sources_request() -> IpVideoHttpRequest {
    IpVideoHttpRequest {
        method: "GET",
        path: RECEIVER_API_SOURCES,
        body: None,
    }
}

/// `POST /v1/configuration` — tune the receiver to a source with optional group filters.
pub fn receiver_configuration_request(
    source_name: &str,
    groups: &[String],
    metadata_only: bool,
) -> IpVideoHttpRequest {
    let payload = json!({
        "source": source_name,
        "groups": groups,
        "metadata_only": metadata_only,
    });
    IpVideoHttpRequest {
        method: "POST",
        path: RECEIVER_API_CONFIGURATION,
        body: Some(payload.to_string()),
    }
}

/// `POST /v1/recording` — start or stop a local recording, optionally with a file name.
pub fn receiver_recording_request(
    action: ReceiverRecordingAction,
    filename: Option<&str>,
) -> IpVideoHttpRequest {
    let mut payload = json!({ "action": action.as_str() });
    if let Some(name) = filename {
        payload["filename"] = json!(name);
    }
    IpVideoHttpRequest {
        method: "POST",
        path: RECEIVER_API_RECORDING,
        body: Some(payload.to_string()),
    }
}

// -- PTZ ----------------------------------------------------------------------------------------

fn clamp_signed(v: f64) -> f64 {
    v.clamp(-1.0, 1.0)
}

fn clamp_unit(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

pub fn ptz_pan_tilt_speed(pan: f64, tilt: f64) -> String {
    format!(
        "\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x70\x61\x6e\x5f\x74\x69\x6c\x74\x5f\x73\x70\x65\x65\x64 pan_speed=\"{:.6}\" tilt_speed=\"{:.6}\"/>",
        clamp_signed(pan),
        clamp_signed(tilt)
    )
}

pub fn ptz_pan_tilt_absolute(pan: f64, tilt: f64) -> String {
    format!(
        "\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x70\x61\x6e\x5f\x74\x69\x6c\x74 pan=\"{:.6}\" tilt=\"{:.6}\"/>",
        clamp_signed(pan),
        clamp_signed(tilt)
    )
}

pub fn ptz_zoom(zoom: f64) -> String {
    format!("\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x7a\x6f\x6f\x6d zoom=\"{:.6}\"/>", clamp_unit(zoom))
}

pub fn ptz_zoom_speed(speed: f64) -> String {
    format!("\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x7a\x6f\x6f\x6d\x5f\x73\x70\x65\x65\x64 zoom_speed=\"{:.6}\"/>", clamp_signed(speed))
}

pub fn ptz_store_preset(index: u8) -> String {
    format!("\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x73\x74\x6f\x72\x65\x5f\x70\x72\x65\x73\x65\x74 index=\"{index}\"/>")
}

pub fn ptz_recall_preset(index: u8, speed: f64) -> String {
    format!(
        "\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x72\x65\x63\x61\x6c\x6c\x5f\x70\x72\x65\x73\x65\x74 index=\"{index}\" speed=\"{:.6}\"/>",
        clamp_unit(speed)
    )
}

pub fn ptz_focus_auto() -> String {
    "\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x66\x6f\x63\x75\x73 mode=\"auto\"/>".to_string()
}

pub fn ptz_focus_manual(distance: f64) -> String {
    format!(
        "\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x66\x6f\x63\x75\x73 mode=\"manual\" distance=\"{:.6}\"/>",
        clamp_unit(distance)
    )
}

pub fn ptz_white_balance_auto() -> String {
    "\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x77\x68\x69\x74\x65\x5f\x62\x61\x6c\x61\x6e\x63\x65 mode=\"auto\"/>".to_string()
}

pub fn ptz_white_balance_manual(red: f64, blue: f64) -> String {
    format!(
        "\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x77\x68\x69\x74\x65\x5f\x62\x61\x6c\x61\x6e\x63\x65 mode=\"manual\" red=\"{:.6}\" blue=\"{:.6}\"/>",
        clamp_unit(red),
        clamp_unit(blue)
    )
}

pub fn ptz_exposure_auto() -> String {
    "\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x65\x78\x70\x6f\x73\x75\x72\x65 mode=\"auto\"/>".to_string()
}

pub fn ptz_exposure_manual(value: f64, gain: f64, shutter: f64) -> String {
    format!(
        "\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x65\x78\x70\x6f\x73\x75\x72\x65 mode=\"manual\" value=\"{:.6}\" gain=\"{:.6}\" shutter=\"{:.6}\"/>",
        clamp_unit(value),
        clamp_unit(gain),
        clamp_unit(shutter)
    )
}

// -------------------------------------------------------------------------------------------------
// Parsing
// -------------------------------------------------------------------------------------------------

fn parse_source(block: &str) -> IpVideoSource {
    let name = text_of(block, "source")
        .or_else(|| text_of(block, "name"))
        .unwrap_or_default();
    let id = text_of(block, "source_id").unwrap_or_else(|| name.clone());
    let address = text_of(block, "address").unwrap_or_default();
    let port = text_of(block, "port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(0);
    let groups = extract_blocks(block, "group")
        .into_iter()
        .map(|g| unescape(g.trim()))
        .collect();
    IpVideoSource {
        id,
        name,
        address,
        port,
        groups,
        metadata: text_of(block, "metadata"),
    }
}

fn parse_receiver(block: &str) -> IpVideoReceiver {
    IpVideoReceiver {
        id: text_of(block, "receiver_id").unwrap_or_default(),
        name: text_of(block, "name").unwrap_or_default(),
        input_id: text_of(block, "input_id"),
        input_name: text_of(block, "input_name"),
        address: text_of(block, "address"),
    }
}

fn parse_flags(tag: &str) -> IpVideoTally {
    IpVideoTally {
        on_program: attr_in_tag(tag, "on_program")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false),
        on_preview: attr_in_tag(tag, "on_preview")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false),
    }
}

/// Parse one Discovery/control XML document.
pub fn parse_message(xml: &str) -> Result<IpVideoMessage, ProtocolError> {
    let trimmed = xml.trim();
    if trimmed.is_empty() {
        return Err(ProtocolError::malformed("empty IP_VIDEO XML message"));
    }
    let tag = first_tag_name(trimmed)
        .ok_or_else(|| ProtocolError::malformed("could not find XML tag"))?;

    match tag.as_str() {
        "compatible" => Ok(IpVideoMessage::Compatible),
        "advertiser" => Ok(IpVideoMessage::Advertiser),
        "listener" => Ok(IpVideoMessage::Listener {
            listener_id: text_of(trimmed, "listener_id"),
        }),
        "query_sources" | "query" => Ok(IpVideoMessage::QuerySources),
        "query_receivers" => Ok(IpVideoMessage::QueryReceivers),
        "sources" => Ok(IpVideoMessage::Sources(
            extract_blocks(trimmed, "source")
                .into_iter()
                .map(parse_source)
                .collect(),
        )),
        "receiver" => Ok(IpVideoMessage::Receivers(vec![parse_receiver(trimmed)])),
        "receivers" => Ok(IpVideoMessage::Receivers(
            extract_blocks(trimmed, "receiver")
                .into_iter()
                .map(parse_receiver)
                .collect(),
        )),
        "monitor_events" => Ok(IpVideoMessage::MonitorEvents(
            extract_blocks(trimmed, "property")
                .into_iter()
                .map(|block| IpVideoProperty {
                    name: text_of(block, "name").unwrap_or_default(),
                    value: text_of(block, "value").unwrap_or_default(),
                })
                .collect(),
        )),
        "\x6e\x64\x69\x5f\x72\x6f\x75\x74\x69\x6e\x67" => {
            let name = attr_in_tag(trimmed, "name");
            let ip = attr_in_tag(trimmed, "ip");
            if name.is_none() && ip.is_none() {
                Ok(IpVideoMessage::RoutingClear)
            } else {
                Ok(IpVideoMessage::Routing(IpVideoRouting { name, ip }))
            }
        }
        "\x6e\x64\x69\x5f\x74\x61\x6c\x6c\x79" => Ok(IpVideoMessage::Tally(parse_flags(trimmed))),
        "\x6e\x64\x69\x5f\x74\x61\x6c\x6c\x79\x5f\x65\x63\x68\x6f" => Ok(IpVideoMessage::TallyEcho(parse_flags(trimmed))),
        other if other.starts_with("\x6e\x74\x6b\x5f") || other.starts_with("\x6e\x64\x69\x5f") => {
            let mut attrs = BTreeMap::new();
            for key in [
                "pan_speed",
                "tilt_speed",
                "pan",
                "tilt",
                "zoom",
                "zoom_speed",
                "index",
                "speed",
                "mode",
                "distance",
                "red",
                "blue",
                "value",
                "gain",
                "shutter",
                "on_program",
                "on_preview",
            ] {
                if let Some(v) = attr_in_tag(trimmed, key) {
                    attrs.insert(key.to_string(), v);
                }
            }
            Ok(IpVideoMessage::Metadata(IpVideoMetadataCommand {
                tag: other.to_string(),
                attrs,
            }))
        }
        other => Ok(IpVideoMessage::Unknown(other.to_string())),
    }
}

/// Encode an XML message to bytes for the Discovery TCP stream.
pub fn encode_message(message: &str) -> Vec<u8> {
    message.as_bytes().to_vec()
}

/// Decode one UTF-8 Discovery message.
pub fn decode_message(bytes: &[u8]) -> Result<IpVideoMessage, ProtocolError> {
    let text = std::str::from_utf8(bytes)?;
    parse_message(text)
}

// -------------------------------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_and_query_builders() {
        assert_eq!(handshake_compatible(), "<compatible/>");
        assert_eq!(query_receivers(), "<query_receivers/>");
        assert_eq!(
            handshake_listener("abc"),
            "<listener><listener_id>abc</listener_id></listener>"
        );
        assert_eq!(parse_message("<compatible/>").unwrap(), IpVideoMessage::Compatible);
        assert_eq!(
            parse_message("<query_receivers/>").unwrap(),
            IpVideoMessage::QueryReceivers
        );
    }

    #[test]
    fn control_receiver_roundtrip() {
        let xml = control_receiver("recv-uuid", "CAMERA-1 (Main)");
        assert!(xml.contains("<receiver_id>recv-uuid</receiver_id>"));
        assert!(xml.contains("<command>connect</command>"));
        assert!(xml.contains("<arg>CAMERA-1 (Main)</arg>"));
        // The parser treats it as an unknown top-level control document rather than a data event.
        assert!(matches!(
            parse_message(&xml).unwrap(),
            IpVideoMessage::Unknown(_)
        ));
    }

    #[test]
    fn routing_build_and_parse() {
        let xml = ip_video_routing("CAMERA-1 (Main)", "192.168.10.21:5960");
        assert_eq!(
            xml,
            "\x3c\x6e\x64\x69\x5f\x72\x6f\x75\x74\x69\x6e\x67 name=\"CAMERA-1 (Main)\" ip=\"192.168.10.21:5960\"/>"
        );
        match parse_message(&xml).unwrap() {
            IpVideoMessage::Routing(r) => {
                assert_eq!(r.name.as_deref(), Some("CAMERA-1 (Main)"));
                assert_eq!(r.ip.as_deref(), Some("192.168.10.21:5960"));
            }
            other => panic!("unexpected: {other:?}"),
        }
        assert_eq!(
            parse_message(&ip_video_routing_clear()).unwrap(),
            IpVideoMessage::RoutingClear
        );
    }

    #[test]
    fn escapes_attribute_values() {
        let xml = ip_video_routing("PA & \"Stage\"", "192.0.2.1:5960");
        assert!(xml.contains("PA &amp; &quot;Stage&quot;"));
    }

    #[test]
    fn tally_build_and_parse() {
        let xml = tally(true, false);
        assert_eq!(
            parse_message(&xml).unwrap(),
            IpVideoMessage::Tally(IpVideoTally {
                on_program: true,
                on_preview: false
            })
        );
        assert_eq!(
            parse_message(&tally_echo(false, true)).unwrap(),
            IpVideoMessage::TallyEcho(IpVideoTally {
                on_program: false,
                on_preview: true
            })
        );
    }

    #[test]
    fn ptz_commands_are_clamped() {
        assert_eq!(
            ptz_pan_tilt_speed(5.0, -5.0),
            "\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x70\x61\x6e\x5f\x74\x69\x6c\x74\x5f\x73\x70\x65\x65\x64 pan_speed=\"1.000000\" tilt_speed=\"-1.000000\"/>"
        );
        assert_eq!(ptz_zoom(2.0), "\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x7a\x6f\x6f\x6d zoom=\"1.000000\"/>");
        assert_eq!(
            ptz_recall_preset(2, 0.5),
            "\x3c\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x72\x65\x63\x61\x6c\x6c\x5f\x70\x72\x65\x73\x65\x74 index=\"2\" speed=\"0.500000\"/>"
        );
        match parse_message(&ptz_pan_tilt_speed(0.25, -0.25)).unwrap() {
            IpVideoMessage::Metadata(cmd) => {
                assert_eq!(cmd.tag, "\x6e\x74\x6b\x5f\x70\x74\x7a\x5f\x70\x61\x6e\x5f\x74\x69\x6c\x74\x5f\x73\x70\x65\x65\x64");
                assert_eq!(cmd.attrs.get("pan_speed").map(String::as_str), Some("0.250000"));
                assert_eq!(cmd.attrs.get("tilt_speed").map(String::as_str), Some("-0.250000"));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn metadata_only_streams() {
        let xml = enabled_streams_metadata_only();
        assert!(xml.contains("video=\"false\""));
        assert!(xml.contains("audio=\"false\""));
        assert!(xml.contains("text=\"true\""));
    }

    #[test]
    fn parses_source_list() {
        let xml = r#"<sources>
            <source>
                <source>FOH-PC (BROADCAST Output)</source>
                <source_id>uuid-1</source_id>
                <name>FOH-PC (BROADCAST Output)</name>
                <address>192.168.10.52</address>
                <port>5960</port>
                <groups><group>public</group><group>broadcast</group></groups>
            </source>
            <source>
                <source>CAMERA-1 (Main)</source>
                <source_id>uuid-2</source_id>
                <address>192.168.10.21</address>
                <port>5960</port>
            </source>
        </sources>"#;
        match parse_message(xml).unwrap() {
            IpVideoMessage::Sources(sources) => {
                assert_eq!(sources.len(), 2);
                assert_eq!(sources[0].name, "FOH-PC (BROADCAST Output)");
                assert_eq!(sources[0].id, "uuid-1");
                assert_eq!(sources[0].port, 5960);
                assert_eq!(sources[0].groups, vec!["public", "broadcast"]);
                assert_eq!(sources[1].address, "192.168.10.21");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_receiver_and_monitor_events() {
        let receiver = r#"<receiver>
            <receiver_id>recv-1</receiver_id>
            <name>Lobby TV</name>
            <input_id>src-9</input_id>
            <input_name>ONE-RING (Lobby)</input_name>
            <address>192.168.10.90</address>
        </receiver>"#;
        match parse_message(receiver).unwrap() {
            IpVideoMessage::Receivers(r) => {
                assert_eq!(r.len(), 1);
                assert_eq!(r[0].name, "Lobby TV");
                assert_eq!(r[0].input_name.as_deref(), Some("ONE-RING (Lobby)"));
            }
            other => panic!("unexpected: {other:?}"),
        }

        let events = r#"<monitor_events>
            <property><name>tally-on-program</name><value>true</value></property>
            <property><name>connected-receivers</name><value>3</value></property>
        </monitor_events>"#;
        match parse_message(events).unwrap() {
            IpVideoMessage::MonitorEvents(props) => {
                assert_eq!(props.len(), 2);
                assert_eq!(props[0].name, "tally-on-program");
                assert_eq!(props[1].value, "3");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn rejects_empty_and_garbage() {
        assert!(parse_message("").is_err());
        assert!(parse_message("not xml").is_err());
        assert!(matches!(
            parse_message("<something/>").unwrap(),
            IpVideoMessage::Unknown(_)
        ));
    }

    #[test]
    fn receiver_sources_request_is_a_bare_get() {
        let req = receiver_sources_request();
        assert_eq!(req.method, "GET");
        assert_eq!(req.path, "/v1/sources");
        assert_eq!(req.body, None);
        let wire = req.to_http_request("192.0.2.10:8080");
        assert!(wire.starts_with("GET /v1/sources HTTP/1.1\r\n"));
        assert!(wire.contains("Host: 192.0.2.10:8080\r\n"));
        assert!(wire.ends_with("Connection: close\r\n\r\n"));
        assert!(!wire.contains("Content-Length"));
    }

    #[test]
    fn receiver_configuration_request_carries_json_body() {
        let groups = vec!["public".to_string(), "sanctuary".to_string()];
        let req = receiver_configuration_request("Stage Cam \"A\"", &groups, true);
        assert_eq!(req.method, "POST");
        assert_eq!(req.path, "/v1/configuration");

        let body = req.body.as_deref().expect("configuration body");
        let value: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(value["source"], "Stage Cam \"A\"");
        assert_eq!(value["groups"], json!(groups));
        assert_eq!(value["metadata_only"], true);

        let wire = req.to_http_request("receiver.local/");
        assert!(wire.starts_with("POST /v1/configuration HTTP/1.1\r\n"));
        assert!(wire.contains("Host: receiver.local\r\n"));
        assert!(wire.contains("Content-Type: application/json\r\n"));
        assert!(wire.contains(&format!("Content-Length: {}\r\n", body.len())));
        assert!(wire.ends_with(body));
    }

    #[test]
    fn receiver_recording_request_start_and_stop() {
        let start = receiver_recording_request(ReceiverRecordingAction::Start, Some("service.mkv"));
        assert_eq!(start.method, "POST");
        assert_eq!(start.path, "/v1/recording");
        let value: serde_json::Value =
            serde_json::from_str(start.body.as_deref().unwrap()).unwrap();
        assert_eq!(value["action"], "start");
        assert_eq!(value["filename"], "service.mkv");

        let stop = receiver_recording_request(ReceiverRecordingAction::Stop, None);
        let value: serde_json::Value = serde_json::from_str(stop.body.as_deref().unwrap()).unwrap();
        assert_eq!(value["action"], "stop");
        assert!(value.get("filename").is_none());
        assert_eq!(ReceiverRecordingAction::Start.as_str(), "start");
    }
}
