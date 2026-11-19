//! Clean-room codecs for Broadcast Studio (`broadcast-websocket` v5) and Dual-Stream Desktop.
//!
//! * **BROADCAST**: OpCodes 0–9, the salted SHA-256 authentication handshake, event-subscription bitmask,
//!   request/batch envelopes, and the Broadcast 33 request builders One Ring needs
//!   (`GetCanvasList`, `CreateRecordChapter`, `StartOutput`, …).
//! * **DualStream**: newline-delimited JSON-RPC 2.0 envelopes for `127.0.0.1:28194` /
//!   `\\.\pipe\dual_stream`, helper/subscription/event/promise payload classification, and the
//!   resource-id addressing scheme.
//!
//! Transport (WebSocket, TCP, or Windows named pipe) is owned by the adapter layer.
//!
//! Specs: `docs/re-findings/broadcast.md`, `docs/re-findings/dual_stream.md`.

use super::ProtocolError;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

// =================================================================================================
// Broadcast WebSocket v5
// =================================================================================================

pub const BROADCAST_DEFAULT_ENDPOINT: &str = "ws://127.0.0.1:4455";
pub const BROADCAST_SUBPROTOCOL_JSON: &str = "\x6f\x62\x73\x77\x65\x62\x73\x6f\x63\x6b\x65\x74\x2e\x6a\x73\x6f\x6e";
pub const BROADCAST_SUBPROTOCOL_MSGPACK: &str = "\x6f\x62\x73\x77\x65\x62\x73\x6f\x63\x6b\x65\x74\x2e\x6d\x73\x67\x70\x61\x63\x6b";
pub const BROADCAST_RPC_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum OpCode {
    Hello = 0,
    Identify = 1,
    Identified = 2,
    Reidentify = 3,
    Event = 5,
    Request = 6,
    RequestResponse = 7,
    RequestBatch = 8,
    RequestBatchResponse = 9,
}

impl OpCode {
    pub fn from_u8(v: u8) -> Option<Self> {
        Some(match v {
            0 => OpCode::Hello,
            1 => OpCode::Identify,
            2 => OpCode::Identified,
            3 => OpCode::Reidentify,
            5 => OpCode::Event,
            6 => OpCode::Request,
            7 => OpCode::RequestResponse,
            8 => OpCode::RequestBatch,
            9 => OpCode::RequestBatchResponse,
            _ => return None,
        })
    }

    pub fn code(self) -> u8 {
        self as u8
    }
}

/// Every `broadcast-websocket` frame is `{"op": <u8>, "d": {...}}`.
#[derive(Debug, Clone, PartialEq)]
pub struct BroadcastFrame {
    pub op: OpCode,
    pub d: Value,
}

impl BroadcastFrame {
    pub fn new(op: OpCode, d: Value) -> Self {
        Self { op, d }
    }

    pub fn to_json(&self) -> String {
        json!({ "op": self.op.code(), "d": self.d }).to_string()
    }

    pub fn from_json(text: &str) -> Result<Self, ProtocolError> {
        let v: Value = serde_json::from_str(text)?;
        let op = v
            .get("op")
            .and_then(Value::as_u64)
            .ok_or_else(|| ProtocolError::malformed("BROADCAST frame missing integer 'op'"))?;
        let op = u8::try_from(op)
            .ok()
            .and_then(OpCode::from_u8)
            .ok_or_else(|| ProtocolError::malformed(format!("unknown BROADCAST OpCode {op}")))?;
        let d = v.get("d").cloned().unwrap_or(Value::Null);
        Ok(Self { op, d })
    }
}

/// Event subscription bitmask values from `broadcast.md` §2.4.
pub mod event_subscription {
    pub const NONE: u32 = 0;
    pub const GENERAL: u32 = 1 << 0;
    pub const CONFIG: u32 = 1 << 1;
    pub const SCENES: u32 = 1 << 2;
    pub const INPUTS: u32 = 1 << 3;
    pub const TRANSITIONS: u32 = 1 << 4;
    pub const FILTERS: u32 = 1 << 5;
    pub const OUTPUTS: u32 = 1 << 6;
    pub const SCENE_ITEMS: u32 = 1 << 7;
    pub const MEDIA_INPUTS: u32 = 1 << 8;
    pub const VENDORS: u32 = 1 << 9;
    pub const UI: u32 = 1 << 10;
    pub const ALL: u32 = (1 << 11) - 1;
    pub const INPUT_VOLUME_METERS: u32 = 1 << 16;
    pub const INPUT_ACTIVE_STATE_CHANGED: u32 = 1 << 17;
    pub const INPUT_SHOW_STATE_CHANGED: u32 = 1 << 18;
    pub const SCENE_ITEM_TRANSFORM_CHANGED: u32 = 1 << 19;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i8)]
pub enum BatchExecutionType {
    None = -1,
    SerialRealtime = 0,
    SerialFrame = 1,
    Parallel = 2,
}

static REQUEST_SEQ: AtomicU64 = AtomicU64::new(1);

fn next_request_id() -> String {
    format!("one-ring-{}", REQUEST_SEQ.fetch_add(1, Ordering::Relaxed))
}

#[derive(Debug, Clone, PartialEq)]
pub struct BroadcastRequest {
    pub request_type: String,
    pub request_id: String,
    pub request_data: Value,
}

impl BroadcastRequest {
    pub fn new(request_type: impl Into<String>, request_data: Value) -> Self {
        Self {
            request_type: request_type.into(),
            request_id: next_request_id(),
            request_data,
        }
    }

    pub fn with_id(
        request_type: impl Into<String>,
        request_id: impl Into<String>,
        request_data: Value,
    ) -> Self {
        Self {
            request_type: request_type.into(),
            request_id: request_id.into(),
            request_data,
        }
    }

    pub fn to_value(&self) -> Value {
        json!({
            "requestType": self.request_type,
            "requestId": self.request_id,
            "requestData": self.request_data,
        })
    }

    pub fn to_frame(&self) -> BroadcastFrame {
        BroadcastFrame::new(OpCode::Request, self.to_value())
    }

    pub fn to_json(&self) -> String {
        self.to_frame().to_json()
    }

    // -- Common requests ----------------------------------------------------------------------

    pub fn get_version() -> Self {
        Self::new("GetVersion", Value::Null)
    }

    pub fn get_stats() -> Self {
        Self::new("GetStats", Value::Null)
    }

    pub fn get_canvas_list() -> Self {
        Self::new("GetCanvasList", Value::Null)
    }

    pub fn get_scene_list(canvas_uuid: Option<&str>) -> Self {
        let data = match canvas_uuid {
            Some(uuid) => json!({ "canvasUuid": uuid }),
            None => Value::Null,
        };
        Self::new("GetSceneList", data)
    }

    pub fn set_current_program_scene(
        scene_name: Option<&str>,
        scene_uuid: Option<&str>,
    ) -> Self {
        let mut data = serde_json::Map::new();
        if let Some(v) = scene_name {
            data.insert("sceneName".into(), Value::String(v.into()));
        }
        if let Some(v) = scene_uuid {
            data.insert("sceneUuid".into(), Value::String(v.into()));
        }
        Self::new("SetCurrentProgramScene", Value::Object(data))
    }

    pub fn set_current_preview_scene(scene_name: Option<&str>, scene_uuid: Option<&str>) -> Self {
        let mut data = serde_json::Map::new();
        if let Some(v) = scene_name {
            data.insert("sceneName".into(), Value::String(v.into()));
        }
        if let Some(v) = scene_uuid {
            data.insert("sceneUuid".into(), Value::String(v.into()));
        }
        Self::new("SetCurrentPreviewScene", Value::Object(data))
    }

    pub fn get_output_list() -> Self {
        Self::new("GetOutputList", Value::Null)
    }

    pub fn get_output_status(output_name: &str) -> Self {
        Self::new("GetOutputStatus", json!({ "outputName": output_name }))
    }

    pub fn start_output(output_name: &str) -> Self {
        Self::new("StartOutput", json!({ "outputName": output_name }))
    }

    pub fn stop_output(output_name: &str) -> Self {
        Self::new("StopOutput", json!({ "outputName": output_name }))
    }

    pub fn toggle_output(output_name: &str) -> Self {
        Self::new("ToggleOutput", json!({ "outputName": output_name }))
    }

    pub fn get_stream_status() -> Self {
        Self::new("GetStreamStatus", Value::Null)
    }

    pub fn start_stream() -> Self {
        Self::new("StartStream", Value::Null)
    }

    pub fn stop_stream() -> Self {
        Self::new("StopStream", Value::Null)
    }

    pub fn send_stream_caption(text: &str) -> Self {
        Self::new("SendStreamCaption", json!({ "captionText": text }))
    }

    pub fn get_record_status() -> Self {
        Self::new("GetRecordStatus", Value::Null)
    }

    pub fn start_record() -> Self {
        Self::new("StartRecord", Value::Null)
    }

    pub fn stop_record() -> Self {
        Self::new("StopRecord", Value::Null)
    }

    pub fn split_record_file() -> Self {
        Self::new("SplitRecordFile", Value::Null)
    }

    pub fn create_record_chapter(chapter_name: &str) -> Self {
        Self::new("CreateRecordChapter", json!({ "chapterName": chapter_name }))
    }

    pub fn get_input_mute(input_name: &str) -> Self {
        Self::new("GetInputMute", json!({ "inputName": input_name }))
    }

    pub fn set_input_mute(input_name: &str, muted: bool) -> Self {
        Self::new(
            "SetInputMute",
            json!({ "inputName": input_name, "inputMuted": muted }),
        )
    }

    pub fn get_input_volume(input_name: &str) -> Self {
        Self::new("GetInputVolume", json!({ "inputName": input_name }))
    }

    pub fn set_input_volume_db(input_name: &str, volume_db: f64) -> Self {
        Self::new(
            "SetInputVolume",
            json!({ "inputName": input_name, "inputVolumeDb": volume_db }),
        )
    }

    pub fn get_source_screenshot(source_name: &str, width: u32, height: u32, quality: u8) -> Self {
        Self::new(
            "GetSourceScreenshot",
            json!({
                "sourceName": source_name,
                "imageFormat": "jpg",
                "imageWidth": width,
                "imageHeight": height,
                "imageCompressionQuality": quality,
            }),
        )
    }
}

/// Batch envelope (`Op 8`). Use [`BatchExecutionType::SerialFrame`] for frame-accurate cue
/// choreography and [`BatchExecutionType::SerialRealtime`] when piping values between requests.
#[derive(Debug, Clone, PartialEq)]
pub struct BroadcastRequestBatch {
    pub requests: Vec<BroadcastRequest>,
    pub execution_type: BatchExecutionType,
    pub halt_on_failure: bool,
}

impl BroadcastRequestBatch {
    pub fn new(requests: Vec<BroadcastRequest>, execution_type: BatchExecutionType) -> Self {
        Self {
            requests,
            execution_type,
            halt_on_failure: true,
        }
    }

    pub fn to_frame(&self) -> BroadcastFrame {
        let requests: Vec<Value> = self.requests.iter().map(BroadcastRequest::to_value).collect();
        BroadcastFrame::new(
            OpCode::RequestBatch,
            json!({
                "requestId": next_request_id(),
                "haltOnFailure": self.halt_on_failure,
                "executionType": self.execution_type as i8,
                "requests": requests,
            }),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BroadcastRequestStatus {
    pub result: bool,
    pub code: i32,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BroadcastResponse {
    pub request_type: String,
    pub request_id: String,
    pub request_status: BroadcastRequestStatus,
    pub response_data: Value,
}

impl BroadcastResponse {
    pub fn from_frame(frame: &BroadcastFrame) -> Result<Self, ProtocolError> {
        if frame.op != OpCode::RequestResponse {
            return Err(ProtocolError::malformed(format!(
                "expected RequestResponse, got {:?}",
                frame.op
            )));
        }
        let request_type = frame
            .d
            .get("requestType")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let request_id = frame
            .d
            .get("requestId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let status = frame
            .d
            .get("requestStatus")
            .ok_or_else(|| ProtocolError::malformed("BROADCAST response missing requestStatus"))?;
        Ok(Self {
            request_type,
            request_id,
            request_status: BroadcastRequestStatus {
                result: status
                    .get("result")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                code: status.get("code").and_then(Value::as_i64).unwrap_or(0) as i32,
                comment: status
                    .get("comment")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            },
            response_data: frame.d.get("responseData").cloned().unwrap_or(Value::Null),
        })
    }

    pub fn is_ok(&self) -> bool {
        self.request_status.result
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct BroadcastEvent {
    pub event_type: String,
    pub event_intent: u32,
    pub event_data: Value,
}

impl BroadcastEvent {
    pub fn from_frame(frame: &BroadcastFrame) -> Result<Self, ProtocolError> {
        if frame.op != OpCode::Event {
            return Err(ProtocolError::malformed(format!(
                "expected Event, got {:?}",
                frame.op
            )));
        }
        Ok(Self {
            event_type: frame
                .d
                .get("eventType")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            event_intent: frame
                .d
                .get("eventIntent")
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32,
            event_data: frame.d.get("eventData").cloned().unwrap_or(Value::Null),
        })
    }
}

/// Build `Op 1 (Identify)` with the optional auth response and subscription bitmask.
pub fn broadcast_identify(auth_response: Option<&str>, event_subscriptions: u32) -> BroadcastFrame {
    let mut d = json!({
        "rpcVersion": BROADCAST_RPC_VERSION,
        "eventSubscriptions": event_subscriptions,
    });
    if let Some(auth) = auth_response {
        d["authentication"] = Value::String(auth.to_string());
    }
    BroadcastFrame::new(OpCode::Identify, d)
}

/// Build `Op 3 (Reidentify)` to change subscriptions on an open session.
pub fn broadcast_reidentify(event_subscriptions: u32) -> BroadcastFrame {
    BroadcastFrame::new(
        OpCode::Reidentify,
        json!({ "eventSubscriptions": event_subscriptions }),
    )
}

// -- BROADCAST authentication ------------------------------------------------------------------------

/// Compute the `Identify.authentication` string.
///
/// `secret = Base64(SHA256(password + salt))`
/// `auth   = Base64(SHA256(secret + challenge))`
pub fn compute_authentication(password: &str, salt: &str, challenge: &str) -> String {
    let secret = base64_encode(&sha256(format!("{password}{salt}").as_bytes()));
    base64_encode(&sha256(format!("{secret}{challenge}").as_bytes()))
}

const SHA256_K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/// Minimal SHA-256 (FIPS 180-4) so the BROADCAST handshake needs no extra crate.
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in chunk.chunks(4).enumerate().take(16) {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7)
                ^ w[i - 15].rotate_right(18)
                ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17)
                ^ w[i - 2].rotate_right(19)
                ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(SHA256_K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(BASE64_ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(BASE64_ALPHABET[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(BASE64_ALPHABET[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(BASE64_ALPHABET[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

// =================================================================================================
// Dual-Stream Desktop (JSON-RPC 2.0 over loopback TCP / named pipe)
// =================================================================================================

pub const DUAL_STREAM_TCP_ENDPOINT: &str = "127.0.0.1:28194";
pub const DUAL_STREAM_NAMED_PIPE_WINDOWS: &str = "\x5c\x5c\x2e\x5c\x70\x69\x70\x65\x5c\x73\x6c\x6f\x62\x73";
pub const DUAL_STREAM_SOCKJS_PORT: u16 = 59650;
pub const DUAL_STREAM_JSONRPC_VERSION: &str = "2.0";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DualStreamTransport {
    /// `127.0.0.1:28194`, always on, auto-authorized.
    LocalTcp,
    /// `\\.\pipe\dual_stream`, auto-authorized.
    NamedPipe,
    /// SockJS/WebSocket on `:59650/api`, token required.
    SockJsWebSocket,
}

impl DualStreamTransport {
    pub fn endpoint(self) -> &'static str {
        match self {
            DualStreamTransport::LocalTcp => DUAL_STREAM_TCP_ENDPOINT,
            DualStreamTransport::NamedPipe => DUAL_STREAM_NAMED_PIPE_WINDOWS,
            DualStreamTransport::SockJsWebSocket => "http://<host>:59650/api",
        }
    }

    pub fn requires_token(self) -> bool {
        matches!(self, DualStreamTransport::SockJsWebSocket)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DualStreamParams {
    pub resource: String,
    pub args: Vec<Value>,
    pub fetch_mutations: bool,
    pub compact_mode: bool,
}

impl DualStreamParams {
    pub fn new(resource: impl Into<String>) -> Self {
        Self {
            resource: resource.into(),
            args: Vec::new(),
            fetch_mutations: false,
            compact_mode: false,
        }
    }

    pub fn with_args(mut self, args: Vec<Value>) -> Self {
        self.args = args;
        self
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DualStreamRequest {
    pub id: Value,
    pub method: String,
    pub params: DualStreamParams,
}

impl DualStreamRequest {
    pub fn new(id: impl Into<Value>, method: impl Into<String>, params: DualStreamParams) -> Self {
        Self {
            id: id.into(),
            method: method.into(),
            params,
        }
    }

    pub fn to_value(&self) -> Value {
        json!({
            "jsonrpc": DUAL_STREAM_JSONRPC_VERSION,
            "id": self.id,
            "method": self.method,
            "params": {
                "resource": self.params.resource,
                "args": self.params.args,
                "fetchMutations": self.params.fetch_mutations,
                "compactMode": self.params.compact_mode,
            },
        })
    }

    /// Encode one newline-delimited frame (the trailing `\n` is part of the transport).
    pub fn to_line(&self) -> String {
        format!("{}\n", self.to_value())
    }

    pub fn auth(id: impl Into<Value>, token: &str) -> Self {
        Self::new(
            id,
            "auth",
            DualStreamParams::new("TcpServerService").with_args(vec![Value::String(token.into())]),
        )
    }

    pub fn get_model(id: impl Into<Value>, resource: &str) -> Self {
        Self::new(id, "getModel", DualStreamParams::new(resource))
    }

    pub fn make_scene_active(id: impl Into<Value>, scene_id: &str) -> Self {
        Self::new(
            id,
            "makeSceneActive",
            DualStreamParams::new("ScenesService").with_args(vec![Value::String(scene_id.into())]),
        )
    }

    pub fn toggle_streaming(id: impl Into<Value>) -> Self {
        Self::new(id, "toggleStreaming", DualStreamParams::new("StreamingService"))
    }

    pub fn toggle_recording(id: impl Into<Value>) -> Self {
        Self::new(id, "toggleRecording", DualStreamParams::new("StreamingService"))
    }

    /// Subscribe to a property getter that returns an RxJS Observables (e.g.
    /// `StreamingService.streamingStatusChange`).
    pub fn subscribe(id: impl Into<Value>, resource: &str, property: &str) -> Self {
        Self::new(id, property, DualStreamParams::new(resource))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DualStreamError {
    pub code: i32,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DualStreamResponse {
    pub jsonrpc: String,
    pub id: Value,
    pub result: Value,
    pub error: Option<DualStreamError>,
}

impl DualStreamResponse {
    pub fn from_line(line: &str) -> Result<Self, ProtocolError> {
        let v: Value = serde_json::from_str(line.trim())?;
        let jsonrpc = v
            .get("jsonrpc")
            .and_then(Value::as_str)
            .unwrap_or(DUAL_STREAM_JSONRPC_VERSION)
            .to_string();
        let id = v.get("id").cloned().unwrap_or(Value::Null);
        let result = v.get("result").cloned().unwrap_or(Value::Null);
        let error = v.get("error").and_then(|e| {
            Some(DualStreamError {
                code: e.get("code").and_then(Value::as_i64).unwrap_or(0) as i32,
                message: e
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            })
        });
        if result.is_null() && error.is_none() {
            return Err(ProtocolError::malformed(
                "DualStream frame has neither result nor error",
            ));
        }
        Ok(Self {
            jsonrpc,
            id,
            result,
            error,
        })
    }

    pub fn payload_kind(&self) -> DualStreamPayloadKind {
        let Some(obj) = self.result.as_object() else {
            return DualStreamPayloadKind::Data;
        };
        let kind = obj.get("_type").and_then(Value::as_str);
        let resource_id = obj
            .get("resourceId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let emitter = obj
            .get("emitter")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        match kind {
            Some("HELPER") => DualStreamPayloadKind::Helper { resource_id },
            Some("SUBSCRIPTION") if emitter == "PROMISE" => DualStreamPayloadKind::Promise { resource_id },
            Some("SUBSCRIPTION") => DualStreamPayloadKind::Subscription {
                resource_id,
                emitter,
            },
            Some("EVENT") => DualStreamPayloadKind::Event {
                resource_id,
                emitter,
                data: obj.get("data").cloned().unwrap_or(Value::Null),
                is_rejected: obj.get("isRejected").and_then(Value::as_bool),
            },
            _ => DualStreamPayloadKind::Data,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum DualStreamPayloadKind {
    /// A primitive/plain data result.
    Data,
    /// A domain object addressed by `resourceId` (e.g. `Scene["id"]`).
    Helper { resource_id: String },
    /// A live event stream (`emitter: "STREAM"`).
    Subscription { resource_id: String, emitter: String },
    /// An asynchronous promise resolution/rejection (`emitter: "PROMISE"`).
    Promise { resource_id: String },
    /// A pushed event frame (`id: null`).
    Event {
        resource_id: String,
        emitter: String,
        data: Value,
        is_rejected: Option<bool>,
    },
}

/// Escape a value for use inside a DualStream `Resource["id"]` address.
fn quote_resource_id(id: &str) -> String {
    id.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn scene_resource(scene_id: &str) -> String {
    format!("Scene[\"{}\"]", quote_resource_id(scene_id))
}

pub fn scene_item_resource(scene_id: &str, scene_item_id: &str, source_id: &str) -> String {
    format!(
        "SceneItem[\"{}\", \"{}\", \"{}\"]",
        quote_resource_id(scene_id),
        quote_resource_id(scene_item_id),
        quote_resource_id(source_id)
    )
}

pub fn audio_source_resource(source_id: &str) -> String {
    format!("AudioSource[\"{}\"]", quote_resource_id(source_id))
}

/// Reassembles newline-delimited JSON-RPC frames from arbitrary TCP/pipe reads.
#[derive(Debug, Default)]
pub struct DualStreamLineDecoder {
    buf: Vec<u8>,
}

impl DualStreamLineDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let mut line = self.buf.drain(..=pos).collect::<Vec<u8>>();
            if line.last() == Some(&b'\n') {
                line.pop();
            }
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if let Ok(text) = String::from_utf8(line) {
                if !text.trim().is_empty() {
                    out.push(text);
                }
            }
        }
        out
    }

    pub fn buffered_len(&self) -> usize {
        self.buf.len()
    }

    pub fn clear(&mut self) {
        self.buf.clear();
    }
}

// =================================================================================================
// Tests
// =================================================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -- BROADCAST -----------------------------------------------------------------------------------

    #[test]
    fn sha256_known_vector() {
        assert_eq!(
            hex(&sha256(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            hex(&sha256(b"")),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn base64_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn broadcast_auth_is_deterministic_and_sized() {
        let a = compute_authentication("password", "salt", "challenge");
        let b = compute_authentication("password", "salt", "challenge");
        assert_eq!(a, b);
        // 32 raw bytes -> 44 base64 chars including one '=' pad.
        assert_eq!(a.len(), 44);
        assert!(a.ends_with('='));
        assert_ne!(a, compute_authentication("password", "salt", "other"));
    }

    #[test]
    fn broadcast_frame_roundtrip() {
        let frame = BroadcastRequest::get_canvas_list().to_frame();
        let encoded = frame.to_json();
        let decoded = BroadcastFrame::from_json(&encoded).unwrap();
        assert_eq!(decoded.op, OpCode::Request);
        assert_eq!(decoded.d["requestType"], "GetCanvasList");
        assert!(BroadcastFrame::from_json("{\"op\":4,\"d\":{}}").is_err());
    }

    #[test]
    fn broadcast_request_builders_carry_expected_data() {
        assert_eq!(
            BroadcastRequest::create_record_chapter("Sermon").request_data["chapterName"],
            "Sermon"
        );
        assert_eq!(
            BroadcastRequest::start_output("primary_rtmp_stream").request_data["outputName"],
            "primary_rtmp_stream"
        );
        assert_eq!(
            BroadcastRequest::send_stream_caption("Welcome").request_data["captionText"],
            "Welcome"
        );
        assert_eq!(
            BroadcastRequest::set_current_program_scene(None, Some("uuid-1")).request_data
                ["sceneUuid"],
            "uuid-1"
        );
    }

    #[test]
    fn broadcast_identify_and_batch() {
        let identify = broadcast_identify(Some("auth"), event_subscription::ALL);
        assert_eq!(identify.op, OpCode::Identify);
        assert_eq!(identify.d["authentication"], "auth");

        let batch = BroadcastRequestBatch::new(
            vec![
                BroadcastRequest::set_input_mute("Pastor", false),
                BroadcastRequest::set_current_program_scene(Some("Pulpit"), None),
            ],
            BatchExecutionType::SerialFrame,
        )
        .to_frame();
        assert_eq!(batch.op, OpCode::RequestBatch);
        assert_eq!(batch.d["executionType"], 1);
        assert_eq!(batch.d["requests"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn broadcast_response_and_event_parse() {
        let response = BroadcastResponse::from_frame(&BroadcastFrame::new(
            OpCode::RequestResponse,
            json!({
                "requestType": "GetOutputList",
                "requestId": "r1",
                "requestStatus": { "result": true, "code": 100 },
                "responseData": { "outputs": [] }
            }),
        ))
        .unwrap();
        assert!(response.is_ok());
        assert_eq!(response.request_status.code, 100);

        let event = BroadcastEvent::from_frame(&BroadcastFrame::new(
            OpCode::Event,
            json!({
                "eventType": "StreamStateChanged",
                "eventIntent": 64,
                "eventData": { "outputActive": true }
            }),
        ))
        .unwrap();
        assert_eq!(event.event_type, "StreamStateChanged");
        assert_eq!(event.event_data["outputActive"], true);
    }

    // -- DualStream ----------------------------------------------------------------------------

    #[test]
    fn dual_stream_request_line_and_parse() {
        let req = DualStreamRequest::make_scene_active(7, "scene_abc");
        let line = req.to_line();
        assert!(line.ends_with('\n'));
        let value: Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(value["jsonrpc"], "2.0");
        assert_eq!(value["method"], "makeSceneActive");
        assert_eq!(value["params"]["resource"], "ScenesService");
        assert_eq!(value["params"]["args"][0], "scene_abc");
    }

    #[test]
    fn dual_stream_helper_and_event_classification() {
        let helper = DualStreamResponse::from_line(
            r#"{"jsonrpc":"2.0","id":1,"result":{"_type":"HELPER","resourceId":"Scene[\"s1\"]","id":"s1","name":"Main"}}"#,
        )
        .unwrap();
        match helper.payload_kind() {
            DualStreamPayloadKind::Helper { resource_id } => {
                assert_eq!(resource_id, "Scene[\"s1\"]")
            }
            other => panic!("unexpected: {other:?}"),
        }

        let event = DualStreamResponse::from_line(
            r#"{"jsonrpc":"2.0","id":null,"result":{"_type":"EVENT","emitter":"STREAM","resourceId":"StreamingService.streamingStatusChange","data":"live"}}"#,
        )
        .unwrap();
        match event.payload_kind() {
            DualStreamPayloadKind::Event { data, emitter, .. } => {
                assert_eq!(emitter, "STREAM");
                assert_eq!(data, "live");
            }
            other => panic!("unexpected: {other:?}"),
        }

        let promise = DualStreamResponse::from_line(
            r#"{"jsonrpc":"2.0","id":3,"result":{"_type":"SUBSCRIPTION","resourceId":"p1","emitter":"PROMISE"}}"#,
        )
        .unwrap();
        assert!(matches!(
            promise.payload_kind(),
            DualStreamPayloadKind::Promise { .. }
        ));
    }

    #[test]
    fn dual_stream_error_and_invalid_frames() {
        let err = DualStreamResponse::from_line(
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}"#,
        )
        .unwrap();
        assert_eq!(err.error.unwrap().code, -32601);
        assert!(DualStreamResponse::from_line("{}").is_err());
        assert!(DualStreamResponse::from_line("not json").is_err());
    }

    #[test]
    fn dual_stream_line_decoder_reassembles_partial_writes() {
        let mut decoder = DualStreamLineDecoder::new();
        assert!(decoder.push(b"{\"jsonrpc\":\"2.0\",").is_empty());
        let lines = decoder.push(b"\"id\":1,\"result\":true}\r\n{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":false}\n");
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("\"id\":1"));
        assert!(lines[1].contains("\"id\":2"));
        assert_eq!(decoder.buffered_len(), 0);
    }

    #[test]
    fn dual_stream_resource_ids_escape_quotes() {
        assert_eq!(scene_resource("s1"), "Scene[\"s1\"]");
        assert_eq!(
            scene_item_resource("s1", "i2", "src3"),
            "SceneItem[\"s1\", \"i2\", \"src3\"]"
        );
        assert_eq!(
            scene_resource("a\"b"),
            "Scene[\"a\\\"b\"]"
        );
    }

    #[test]
    fn dual_stream_transport_requirements() {
        assert!(!DualStreamTransport::LocalTcp.requires_token());
        assert!(!DualStreamTransport::NamedPipe.requires_token());
        assert!(DualStreamTransport::SockJsWebSocket.requires_token());
    }
}
