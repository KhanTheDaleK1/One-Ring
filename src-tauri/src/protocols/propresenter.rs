//! Clean-room ProPresenter v1 API + ProLink codec.
//!
//! Covers:
//!
//! * The multiplexed status subscription (`POST /v1/status/updates`).
//! * Chunked/chunkless JSON frame reassembly for the long-lived status stream.
//! * The `/v1/ws` request/update envelope.
//! * The ProLink two-step preroll state machine (multicast `224.0.0.90:18514`).
//!
//! Transport (HTTP client / WebSocket / UDP multicast) is owned by the adapter layer.
//!
//! Spec: `docs/re-findings/propresenter.md`.

use super::ProtocolError;
use serde_json::{json, Value};
use std::net::Ipv4Addr;

pub const PROLINK_MULTICAST: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 90);
pub const PROLINK_PORT: u16 = 18514;
pub const STATUS_UPDATES_PATH: &str = "/v1/status/updates";
pub const WS_PATH: &str = "/v1/ws";

/// Frequently used `/v1/*` paths.
pub mod paths {
    pub const VERSION: &str = "/version";
    pub const STATUS_LAYERS: &str = "/v1/status/layers";
    pub const STATUS_SLIDE: &str = "/v1/status/slide";
    pub const STATUS_SCREENS: &str = "/v1/status/screens";
    pub const STATUS_UPDATES: &str = "/v1/status/updates";
    pub const PRESENTATION_ACTIVE: &str = "/v1/presentation/active";
    pub const PRESENTATION_SLIDE_INDEX: &str = "/v1/presentation/slide_index";
    pub const PLAYLIST_ACTIVE: &str = "/v1/playlist/active";
    pub const TIMERS_CURRENT: &str = "/v1/timers/current";
    pub const TRANSPORT_PRESENTATION_TIME: &str = "/v1/transport/presentation/time";
    pub const TRANSPORT_PRESENTATION_CURRENT: &str = "/v1/transport/presentation/current";
    pub const MEDIA_PLAYLISTS: &str = "/v1/media/playlists";
    pub const AUDIO_PLAYLISTS: &str = "/v1/audio/playlists";
    pub const TRIGGER_NEXT: &str = "/v1/trigger/next";
    pub const TRIGGER_PREVIOUS: &str = "/v1/trigger/previous";
    pub const STAGE_MESSAGE: &str = "/v1/stage/message";
    pub const STATUS_AUDIENCE_SCREENS: &str = "/v1/status/audience_screens";
    pub const STATUS_STAGE_SCREENS: &str = "/v1/status/stage_screens";
    pub const LOOKS: &str = "/v1/looks";
    pub const LOOK_CURRENT: &str = "/v1/look/current";
    pub const PROPS: &str = "/v1/props";
    pub const MACROS: &str = "/v1/macros";
    pub const PROP_COLLECTIONS: &str = "/v1/prop_collections";
    pub const MACRO_COLLECTIONS: &str = "/v1/macro_collections";
    pub const CLEAR_GROUPS: &str = "/v1/clear/groups";
    pub const WS: &str = "/v1/ws";
}

/// Trigger a specific slide index in the active presentation.
pub fn goto_slide_path(index: u32) -> String {
    format!("/v1/presentation/active/{index}/trigger")
}

/// Set, update, or clear the stage message. `None` clears it.
pub fn stage_message_path(message: Option<&str>) -> (&'static str, &'static str, Option<String>) {
    match message {
        Some(text) => (paths::STAGE_MESSAGE, "PUT", Some(stage_message_body(text))),
        None => (paths::STAGE_MESSAGE, "DELETE", None),
    }
}

/// JSON body for `PUT /v1/stage/message`.
pub fn stage_message_body(text: &str) -> String {
    json!({ "text": text }).to_string()
}

/// Validate a timer operation against the documented v1 catalog.
pub fn is_timer_operation(operation: &str) -> bool {
    matches!(operation, "start" | "stop" | "reset")
}

/// Timer operations documented by the v1 API.
pub fn timer_operation_path(operation: &str) -> Option<String> {
    match operation {
        "start" | "stop" | "reset" => Some(format!("/v1/timers/{operation}")),
        _ => None,
    }
}

/// Trigger a named clear group.
pub fn clear_group_path(id: &str) -> String {
    format!("/v1/clear/group/{id}/trigger")
}

/// Resource ids are UUID-like tokens from the catalog endpoints. Reject path separators so a
/// malformed id can never escape the documented `/v1/*` route shape.
fn is_safe_resource_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// List catalogs documented in `looks.rs`, `props.rs`, `macros.rs` and `clear.rs`.
pub fn catalog_path(kind: &str) -> Option<&'static str> {
    match kind {
        "looks" => Some(paths::LOOKS),
        "look_current" => Some(paths::LOOK_CURRENT),
        "props" => Some(paths::PROPS),
        "macros" => Some(paths::MACROS),
        "prop_collections" => Some(paths::PROP_COLLECTIONS),
        "macro_collections" => Some(paths::MACRO_COLLECTIONS),
        "clear_groups" => Some(paths::CLEAR_GROUPS),
        _ => None,
    }
}

/// Documented single-resource operations. `operation` is one of `trigger`, `clear`, or
/// `auto_clear/pause` / `auto_clear/resume` for props.
pub fn resource_path(kind: &str, id: &str, operation: Option<&str>) -> Option<String> {
    if !is_safe_resource_id(id) {
        return None;
    }
    match (kind, operation) {
        ("look", None) => Some(format!("/v1/look/{id}")),
        ("look", Some("trigger")) => Some(format!("/v1/look/{id}/trigger")),
        ("prop", None) => Some(format!("/v1/prop/{id}")),
        ("prop", Some("trigger")) => Some(format!("/v1/prop/{id}/trigger")),
        ("prop", Some("clear")) => Some(format!("/v1/prop/{id}/clear")),
        ("prop", Some("auto_clear/pause")) => Some(format!("/v1/prop/{id}/auto_clear/pause")),
        ("prop", Some("auto_clear/resume")) => Some(format!("/v1/prop/{id}/auto_clear/resume")),
        ("macro", None) => Some(format!("/v1/macro/{id}")),
        ("macro", Some("trigger")) => Some(format!("/v1/macro/{id}/trigger")),
        _ => None,
    }
}

/// Trigger next/previous in the active media or audio playlist.
pub fn playlist_trigger_path(kind: &str, direction: &str) -> Option<String> {
    if !matches!(kind, "media" | "audio") || !matches!(direction, "next" | "previous") {
        return None;
    }
    Some(format!("/v1/trigger/{kind}/{direction}"))
}

/// Transport operations documented by `transport.rs`.
pub fn transport_path(layer: &str, operation: &str) -> Option<String> {
    if !matches!(layer, "presentation" | "announcement" | "media" | "audio") {
        return None;
    }
    match operation {
        "play" | "pause" | "go_to_end" => Some(format!("/v1/transport/{layer}/{operation}")),
        _ => None,
    }
}

/// Body for `PUT /v1/transport/{layer}/time`.
pub fn transport_seek_path(layer: &str) -> Option<String> {
    if matches!(layer, "presentation" | "announcement" | "media" | "audio") {
        Some(format!("/v1/transport/{layer}/time"))
    } else {
        None
    }
}

pub fn transport_seek_body(seconds: f64) -> String {
    json!({ "time": seconds }).to_string()
}

/// Normalize a `/v1/*` path into the relative form accepted by `POST /v1/status/updates`
/// (for example `/v1/status/slide` → `status/slide`).
pub fn normalize_relative_path(path: &str) -> String {
    let trimmed = path.trim_start_matches('/');
    trimmed.strip_prefix("v1/").unwrap_or(trimmed).to_string()
}

/// Build the JSON body for `POST /v1/status/updates`.
pub fn status_updates_body(paths: &[&str]) -> String {
    let list: Vec<Value> = paths
        .iter()
        .map(|p| Value::String(normalize_relative_path(p)))
        .collect();
    Value::Array(list).to_string()
}

/// A multiplexed status subscription plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusUpdateSubscription {
    pub paths: Vec<String>,
}

impl StatusUpdateSubscription {
    pub fn new(paths: &[&str]) -> Self {
        Self {
            paths: paths
                .iter()
                .map(|p| normalize_relative_path(p))
                .collect(),
        }
    }

    pub fn church_default() -> Self {
        Self::new(&[
            paths::STATUS_SLIDE,
            paths::TIMERS_CURRENT,
            paths::TRANSPORT_PRESENTATION_TIME,
            paths::PLAYLIST_ACTIVE,
            paths::STATUS_LAYERS,
            paths::STATUS_SCREENS,
            paths::PRESENTATION_SLIDE_INDEX,
            paths::STAGE_MESSAGE,
            paths::TRANSPORT_PRESENTATION_CURRENT,
        ])
    }

    pub fn body(&self) -> String {
        Value::Array(
            self.paths
                .iter()
                .cloned()
                .map(Value::String)
                .collect(),
        )
        .to_string()
    }

    pub fn path(&self) -> &'static str {
        STATUS_UPDATES_PATH
    }
}

/// One `{ "url": "...", "data": {...} }` envelope from the status stream.
#[derive(Debug, Clone, PartialEq)]
pub struct ProPresenterUpdate {
    pub url: String,
    pub data: Value,
}

impl ProPresenterUpdate {
    pub fn from_value(value: Value) -> Result<Self, ProtocolError> {
        let Some(obj) = value.as_object() else {
            return Err(ProtocolError::malformed(
                "ProPresenter update is not a JSON object",
            ));
        };
        let url = obj
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let has_data = obj.contains_key("data");
        let has_error = obj.contains_key("error");
        if url.is_empty() && !has_data && !has_error {
            return Err(ProtocolError::malformed(
                "ProPresenter update has neither url, data, nor error",
            ));
        }
        // Errors and unwrapped payloads are preserved as the update's data.
        let data = obj
            .get("data")
            .cloned()
            .unwrap_or_else(|| value.clone());
        Ok(Self { url, data })
    }

    pub fn is_error(&self) -> bool {
        self.data.get("error").is_some()
    }
}

/// Reassembles `{...}` JSON envelopes from a chunked HTTP body.
///
/// The HTTP client is expected to de-chunk transfer framing; this decoder additionally tolerates
/// raw `\r\n\r\n` delimiters and hex chunk-size lines, and finds balanced braces so pretty-printed
/// JSON is handled correctly.
#[derive(Debug, Default)]
pub struct StatusStreamDecoder {
    buf: Vec<u8>,
}

impl StatusStreamDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<ProPresenterUpdate>, ProtocolError> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();

        loop {
            // Skip whitespace and any chunked-transfer framing until the next object.
            let next_obj = self.buf.iter().position(|&b| b == b'{');
            let Some(start) = next_obj else {
                self.buf.clear();
                break;
            };
            if start > 0 {
                self.buf.drain(..start);
            }

            let mut depth = 0i32;
            let mut in_string = false;
            let mut escaped = false;
            let mut end = None;
            for (i, &b) in self.buf.iter().enumerate() {
                if in_string {
                    if escaped {
                        escaped = false;
                    } else if b == b'\\' {
                        escaped = true;
                    } else if b == b'"' {
                        in_string = false;
                    }
                } else {
                    match b {
                        b'"' => in_string = true,
                        b'{' => depth += 1,
                        b'}' => {
                            depth -= 1;
                            if depth == 0 {
                                end = Some(i);
                                break;
                            }
                        }
                        _ => {}
                    }
                }
            }

            let Some(end) = end else {
                break;
            };

            let text = std::str::from_utf8(&self.buf[..=end])?;
            let value: Value = serde_json::from_str(text)?;
            out.push(ProPresenterUpdate::from_value(value)?);
            self.buf.drain(..=end);
        }

        Ok(out)
    }

    pub fn buffered_len(&self) -> usize {
        self.buf.len()
    }

    pub fn clear(&mut self) {
        self.buf.clear();
    }
}

/// Method for a `/v1/ws` request envelope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WsMethod {
    Get,
    Post,
    Put,
    Delete,
}

impl WsMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            WsMethod::Get => "GET",
            WsMethod::Post => "POST",
            WsMethod::Put => "PUT",
            WsMethod::Delete => "DELETE",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s.to_ascii_uppercase().as_str() {
            "GET" => WsMethod::Get,
            "POST" => WsMethod::Post,
            "PUT" => WsMethod::Put,
            "DELETE" => WsMethod::Delete,
            _ => return None,
        })
    }
}

/// Bidirectional `/v1/ws` request envelope.
#[derive(Debug, Clone, PartialEq)]
pub struct WsRequest {
    pub url: String,
    pub method: WsMethod,
    pub body: Option<Value>,
}

impl WsRequest {
    pub fn new(url: impl Into<String>, method: WsMethod, body: Option<Value>) -> Self {
        Self {
            url: url.into(),
            method,
            body,
        }
    }

    pub fn to_value(&self) -> Value {
        let mut obj = serde_json::Map::new();
        obj.insert("url".into(), Value::String(self.url.clone()));
        obj.insert("method".into(), Value::String(self.method.as_str().into()));
        if let Some(body) = &self.body {
            obj.insert("body".into(), body.clone());
        }
        Value::Object(obj)
    }

    pub fn from_value(value: Value) -> Result<Self, ProtocolError> {
        let url = value
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| ProtocolError::malformed("/v1/ws message missing 'url'"))?
            .to_string();
        let method = value
            .get("method")
            .and_then(Value::as_str)
            .and_then(WsMethod::parse)
            .ok_or_else(|| ProtocolError::malformed("/v1/ws message missing valid 'method'"))?;
        Ok(Self {
            url,
            method,
            body: value.get("body").cloned(),
        })
    }
}

// -------------------------------------------------------------------------------------------------
// ProLink two-step preroll
// -------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrerollPhase {
    Idle,
    Collecting,
    Ready,
    Activated,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrerollMember {
    pub id: String,
    pub name: String,
    pub latency_ms: u32,
    pub render_time: u64,
    pub failed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrerollRequest {
    pub preroll_id: String,
    pub operation: String,
    pub target: Option<String>,
}

impl PrerollRequest {
    pub fn new(preroll_id: impl Into<String>, target: Option<String>) -> Self {
        Self {
            preroll_id: preroll_id.into(),
            operation: "preroll".into(),
            target,
        }
    }

    pub fn to_value(&self) -> Value {
        let mut obj = serde_json::Map::new();
        obj.insert("preroll_id".into(), Value::String(self.preroll_id.clone()));
        obj.insert("operation".into(), Value::String(self.operation.clone()));
        if let Some(target) = &self.target {
            obj.insert("target".into(), Value::String(target.clone()));
        }
        Value::Object(obj)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrerollComplete {
    pub preroll_id: String,
    pub member_id: String,
    pub latency_ms: u32,
    pub render_time: u64,
    pub failed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivatePrerollItem {
    pub preroll_id: String,
    pub operation: String,
    pub render_time: u64,
}

impl ActivatePrerollItem {
    pub fn to_value(&self) -> Value {
        json!({
            "preroll_id": self.preroll_id,
            "operation": self.operation,
            "render_time": self.render_time,
        })
    }
}

/// Coordinates the sponsor side of a ProLink group trigger.
///
/// 1. [`begin`](Self::begin) broadcasts a `PrerollRequest`.
/// 2. Each member replies with [`PrerollComplete`]; record it with
///    [`record_complete`](Self::record_complete).
/// 3. Once every expected member has replied, [`activation`](Self::activation) returns the
///    `ActivatePrerollItem` with a render time at or after the slowest member is ready.
#[derive(Debug, Clone)]
pub struct PrerollCoordinator {
    phase: PrerollPhase,
    preroll_id: Option<String>,
    expected: usize,
    members: Vec<PrerollMember>,
}

impl Default for PrerollCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl PrerollCoordinator {
    pub fn new() -> Self {
        Self {
            phase: PrerollPhase::Idle,
            preroll_id: None,
            expected: 0,
            members: Vec::new(),
        }
    }

    pub fn phase(&self) -> PrerollPhase {
        self.phase
    }

    pub fn members(&self) -> &[PrerollMember] {
        &self.members
    }

    pub fn begin(&mut self, preroll_id: impl Into<String>, expected_members: usize) -> PrerollRequest {
        let id = preroll_id.into();
        self.preroll_id = Some(id.clone());
        self.expected = expected_members;
        self.members.clear();
        self.phase = if expected_members == 0 {
            PrerollPhase::Ready
        } else {
            PrerollPhase::Collecting
        };
        PrerollRequest::new(id, None)
    }

    /// Record a member's preroll result. Returns `false` if it belongs to another preroll.
    pub fn record_complete(&mut self, complete: PrerollComplete) -> bool {
        if self.preroll_id.as_deref() != Some(complete.preroll_id.as_str()) {
            return false;
        }
        self.members.push(PrerollMember {
            id: complete.member_id.clone(),
            name: complete.member_id,
            latency_ms: complete.latency_ms,
            render_time: complete.render_time,
            failed: complete.failed,
        });
        if self.members.len() >= self.expected {
            self.phase = if self.members.iter().all(|m| m.failed) {
                PrerollPhase::Failed
            } else {
                PrerollPhase::Ready
            };
        }
        true
    }

    /// Build the activation message once every member is ready.
    pub fn activation(&mut self) -> Option<ActivatePrerollItem> {
        if self.phase != PrerollPhase::Ready {
            return None;
        }
        let ready: Vec<&PrerollMember> = self.members.iter().filter(|m| !m.failed).collect();
        if ready.is_empty() {
            self.phase = PrerollPhase::Failed;
            return None;
        }
        // Wait for the slowest member to have rendered, then add its reported latency.
        let render_time = ready
            .iter()
            .map(|m| m.render_time.saturating_add(m.latency_ms as u64))
            .max()
            .unwrap_or(0);
        self.phase = PrerollPhase::Activated;
        Some(ActivatePrerollItem {
            preroll_id: self.preroll_id.clone().unwrap_or_default(),
            operation: "activate".into(),
            render_time,
        })
    }

    pub fn fail(&mut self) {
        self.phase = PrerollPhase::Failed;
    }
}

// -------------------------------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_body_uses_relative_paths() {
        let body = status_updates_body(&["/v1/status/slide", "timers/current", "/v1/playlist/active"]);
        let parsed: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(
            parsed,
            json!(["status/slide", "timers/current", "playlist/active"])
        );
    }

    #[test]
    fn church_default_subscription_is_multiplexed() {
        let sub = StatusUpdateSubscription::church_default();
        assert_eq!(sub.path(), "/v1/status/updates");
        assert!(sub.paths.contains(&"status/slide".to_string()));
        assert!(sub.paths.contains(&"timers/current".to_string()));
        assert!(sub.paths.contains(&"status/screens".to_string()));
        assert!(sub.paths.contains(&"presentation/slide_index".to_string()));
        assert!(sub.paths.contains(&"stage/message".to_string()));
        assert!(sub.paths.contains(&"transport/presentation/current".to_string()));
        let body: Value = serde_json::from_str(&sub.body()).unwrap();
        assert_eq!(body.as_array().unwrap().len(), 9);
    }

    #[test]
    fn stage_message_commands_are_typed() {
        let (path, method, body) = stage_message_path(Some("Pastor enters in 2 minutes"));
        assert_eq!(path, "/v1/stage/message");
        assert_eq!(method, "PUT");
        let parsed: Value = serde_json::from_str(&body.unwrap()).unwrap();
        assert_eq!(parsed["text"], "Pastor enters in 2 minutes");

        let (path, method, body) = stage_message_path(None);
        assert_eq!(path, "/v1/stage/message");
        assert_eq!(method, "DELETE");
        assert!(body.is_none());
    }

    #[test]
    fn timer_and_group_paths_match_route_catalog() {
        assert_eq!(timer_operation_path("start").as_deref(), Some("/v1/timers/start"));
        assert_eq!(timer_operation_path("stop").as_deref(), Some("/v1/timers/stop"));
        assert_eq!(timer_operation_path("reset").as_deref(), Some("/v1/timers/reset"));
        assert!(timer_operation_path("pause").is_none());
        assert!(is_timer_operation("reset"));
        assert!(!is_timer_operation("pause"));
        assert_eq!(goto_slide_path(4), "/v1/presentation/active/4/trigger");
        assert_eq!(clear_group_path("all"), "/v1/clear/group/all/trigger");
    }

    #[test]
    fn look_prop_macro_paths_match_route_catalog() {
        assert_eq!(catalog_path("looks"), Some("/v1/looks"));
        assert_eq!(catalog_path("look_current"), Some("/v1/look/current"));
        assert_eq!(catalog_path("props"), Some("/v1/props"));
        assert_eq!(catalog_path("macros"), Some("/v1/macros"));
        assert_eq!(catalog_path("clear_groups"), Some("/v1/clear/groups"));
        assert!(catalog_path("themes").is_none());

        assert_eq!(
            resource_path("look", "abc-123", Some("trigger")).as_deref(),
            Some("/v1/look/abc-123/trigger")
        );
        assert_eq!(
            resource_path("prop", "abc", Some("clear")).as_deref(),
            Some("/v1/prop/abc/clear")
        );
        assert_eq!(
            resource_path("prop", "abc", Some("auto_clear/pause")).as_deref(),
            Some("/v1/prop/abc/auto_clear/pause")
        );
        assert_eq!(
            resource_path("macro", "abc", Some("trigger")).as_deref(),
            Some("/v1/macro/abc/trigger")
        );
        assert!(resource_path("look", "../escape", Some("trigger")).is_none());
        assert!(resource_path("prop", "abc", Some("delete")).is_none());
    }

    #[test]
    fn playlist_transport_and_seek_paths_match_route_catalog() {
        assert_eq!(
            playlist_trigger_path("media", "next").as_deref(),
            Some("/v1/trigger/media/next")
        );
        assert_eq!(
            playlist_trigger_path("audio", "previous").as_deref(),
            Some("/v1/trigger/audio/previous")
        );
        assert!(playlist_trigger_path("slide", "next").is_none());
        assert!(playlist_trigger_path("media", "pause").is_none());

        assert_eq!(
            transport_path("presentation", "play").as_deref(),
            Some("/v1/transport/presentation/play")
        );
        assert_eq!(
            transport_path("media", "pause").as_deref(),
            Some("/v1/transport/media/pause")
        );
        assert!(transport_path("presentation", "stop").is_none());
        assert!(transport_path("video_input", "play").is_none());

        assert_eq!(
            transport_seek_path("announcement").as_deref(),
            Some("/v1/transport/announcement/time")
        );
        assert!(transport_seek_path("unknown").is_none());
        let body: Value = serde_json::from_str(&transport_seek_body(12.5)).unwrap();
        assert_eq!(body["time"], 12.5);
    }

    #[test]
    fn stream_decoder_handles_split_and_pretty_json() {
        let mut decoder = StatusStreamDecoder::new();
        assert!(decoder
            .push(br#"{"url":"status/slide","data":{"cur"#)
            .unwrap()
            .is_empty());
        let updates = decoder
            .push(br#"rent":{"text":"Hello"}}}\r\n\r\n{"url":"timers/current","data":{"time":42}}"#)
            .unwrap();
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0].url, "status/slide");
        assert_eq!(updates[0].data["current"]["text"], "Hello");
        assert_eq!(updates[1].data["time"], 42);
        assert_eq!(decoder.buffered_len(), 0);
    }

    #[test]
    fn stream_decoder_handles_braces_inside_strings() {
        let mut decoder = StatusStreamDecoder::new();
        let updates = decoder
            .push(br#"{"url":"x","data":{"text":"a } b { c"}}"#)
            .unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].data["text"], "a } b { c");
    }

    #[test]
    fn stream_decoder_skips_chunk_size_lines() {
        let mut decoder = StatusStreamDecoder::new();
        let updates = decoder
            .push(b"1a\r\n{\"url\":\"x\",\"data\":1}\r\n0\r\n\r\n")
            .unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].url, "x");
    }

    #[test]
    fn update_rejects_empty_objects() {
        assert!(ProPresenterUpdate::from_value(json!({})).is_err());
        assert!(ProPresenterUpdate::from_value(json!([1, 2])).is_err());
        assert!(ProPresenterUpdate::from_value(json!({"error": "nope"}))
            .unwrap()
            .is_error());
    }

    #[test]
    fn ws_envelope_roundtrip() {
        let req = WsRequest::new(
            "/v1/status/slide",
            WsMethod::Get,
            None,
        );
        let value = req.to_value();
        assert_eq!(value["method"], "GET");
        assert_eq!(WsRequest::from_value(value).unwrap(), req);

        let post = WsRequest::new(
            "/v1/playlist/active",
            WsMethod::Post,
            Some(json!({"x": 1})),
        );
        assert_eq!(WsRequest::from_value(post.to_value()).unwrap(), post);
        assert!(WsRequest::from_value(json!({"url":"x","method":"PATCH"})).is_err());
    }

    #[test]
    fn preroll_happy_path_waits_for_slowest_member() {
        let mut coord = PrerollCoordinator::new();
        let req = coord.begin("pr-1", 2);
        assert_eq!(req.operation, "preroll");
        assert_eq!(coord.phase(), PrerollPhase::Collecting);

        assert!(coord.record_complete(PrerollComplete {
            preroll_id: "pr-1".into(),
            member_id: "imac".into(),
            latency_ms: 20,
            render_time: 1_000,
            failed: false,
        }));
        assert_eq!(coord.phase(), PrerollPhase::Collecting);
        assert!(coord.record_complete(PrerollComplete {
            preroll_id: "pr-1".into(),
            member_id: "mbp".into(),
            latency_ms: 50,
            render_time: 1_100,
            failed: false,
        }));
        assert_eq!(coord.phase(), PrerollPhase::Ready);

        let activation = coord.activation().unwrap();
        assert_eq!(activation.operation, "activate");
        // Slowest member: 1_100 + 50 ms.
        assert_eq!(activation.render_time, 1_150);
        assert_eq!(coord.phase(), PrerollPhase::Activated);
        assert!(coord.activation().is_none());
    }

    #[test]
    fn preroll_failed_member_is_skipped() {
        let mut coord = PrerollCoordinator::new();
        coord.begin("pr-2", 2);
        coord.record_complete(PrerollComplete {
            preroll_id: "pr-2".into(),
            member_id: "lyrics".into(),
            latency_ms: 10,
            render_time: 500,
            failed: false,
        });
        coord.record_complete(PrerollComplete {
            preroll_id: "pr-2".into(),
            member_id: "imag".into(),
            latency_ms: 30,
            render_time: 600,
            failed: true,
        });
        let activation = coord.activation().unwrap();
        assert_eq!(activation.render_time, 510);
    }

    #[test]
    fn preroll_all_failed_and_wrong_id() {
        let mut coord = PrerollCoordinator::new();
        coord.begin("pr-3", 1);
        assert!(!coord.record_complete(PrerollComplete {
            preroll_id: "other".into(),
            member_id: "x".into(),
            latency_ms: 0,
            render_time: 0,
            failed: false,
        }));
        coord.record_complete(PrerollComplete {
            preroll_id: "pr-3".into(),
            member_id: "x".into(),
            latency_ms: 0,
            render_time: 0,
            failed: true,
        });
        assert_eq!(coord.phase(), PrerollPhase::Failed);
        assert!(coord.activation().is_none());
    }
}
