//! Live Streamlabs Desktop adapter (newline-delimited JSON-RPC 2.0).
//!
//! Defaults to the auto-authorized loopback TCP endpoint `127.0.0.1:28194` (the Windows named
//! pipe is owned by the transport layer on Windows). Implements the subscription/event model from
//! `docs/re-findings/streamlabs.md`: `HELPER`, `SUBSCRIPTION`, `PROMISE`, and pushed `EVENT`
//! frames, with `StreamingService` / `RecordingService` state mapped onto the broadcast strip.

use crate::protocols::obs_streamlabs::{
    SlobsLineDecoder, SlobsPayloadKind, SlobsRequest, SlobsResponse, SLOBS_TCP_ENDPOINT,
};
use crate::runtime::events::{state_patch, EventSink};
use crate::runtime::health::HealthReporter;
use crate::state::{with_state, SharedState};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

#[derive(Debug, Clone)]
pub struct StreamlabsConfig {
    pub endpoint: String,
}

impl StreamlabsConfig {
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
        }
    }
}

impl Default for StreamlabsConfig {
    fn default() -> Self {
        Self::new(SLOBS_TCP_ENDPOINT)
    }
}

/// Streamlabs control surface. Variants unused by the current cue set are retained for parity
/// with the JSON-RPC capability table.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub enum StreamlabsCommand {
    ToggleStreaming,
    ToggleRecording,
    MakeSceneActive(String),
    Refresh,
}

pub fn spawn(
    config: StreamlabsConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    commands: mpsc::UnboundedReceiver<StreamlabsCommand>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let reporter = HealthReporter::new(
            "yt",
            "Streamlabs",
            "YT + FB",
            "Streamlabs JSON-RPC 2.0",
            state.clone(),
            sink.clone(),
        );
        run(config, state, sink, reporter, commands).await;
    })
}

async fn run(
    config: StreamlabsConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    reporter: HealthReporter,
    mut commands: mpsc::UnboundedReceiver<StreamlabsCommand>,
) {
    let mut backoff = Duration::from_millis(500);
    loop {
        reporter.connecting(format!("Connecting to {}", config.endpoint));
        match serve(&config, &state, &sink, &reporter, &mut commands).await {
            Ok(()) => {
                reporter.offline("Streamlabs command channel closed");
                return;
            }
            Err(err) => {
                reporter.error(err.clone());
                sink.log(format!("[streamlabs] {err}"));
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_millis(15_000));
    }
}

async fn serve(
    config: &StreamlabsConfig,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    reporter: &HealthReporter,
    commands: &mut mpsc::UnboundedReceiver<StreamlabsCommand>,
) -> Result<(), String> {
    let mut stream = TcpStream::connect(&config.endpoint)
        .await
        .map_err(|e| format!("connect {} failed: {e}", config.endpoint))?;

    for (id, resource) in [
        (1, "StreamingService"),
        (2, "ScenesService"),
        (3, "DualOutputService"),
    ] {
        let request = SlobsRequest::get_model(json!(id), resource);
        stream
            .write_all(request.to_line().as_bytes())
            .await
            .map_err(|e| format!("handshake write failed: {e}"))?;
    }

    let mut decoder = SlobsLineDecoder::new();
    let mut buf = [0u8; 8192];
    let mut ready = false;

    loop {
        tokio::select! {
            read = stream.read(&mut buf) => {
                let n = read.map_err(|e| format!("read failed: {e}"))?;
                if n == 0 {
                    return Err("Streamlabs closed the connection".into());
                }
                for line in decoder.push(&buf[..n]) {
                    match SlobsResponse::from_line(&line) {
                        Ok(response) => {
                            if !ready {
                                ready = true;
                                reporter.ready(
                                    format!("JSON-RPC live on {}", config.endpoint),
                                    1,
                                );
                                sink.log(
                                    "[streamlabs] Auto-authorized on loopback JSON-RPC; DualOutputService subscribed"
                                        .into(),
                                );
                            }
                            handle_response(response, state, sink);
                        }
                        Err(err) => {
                            if !line.trim().is_empty() {
                                sink.log(format!("[streamlabs] Dropped malformed frame: {err}"));
                            }
                        }
                    }
                }
            }
            command = commands.recv() => {
                let Some(command) = command else { return Ok(()) };
                let requests = build_requests(command);
                for request in requests {
                    stream
                        .write_all(request.to_line().as_bytes())
                        .await
                        .map_err(|e| format!("command write failed: {e}"))?;
                }
            }
        }
    }
}

fn build_requests(command: StreamlabsCommand) -> Vec<SlobsRequest> {
    match command {
        StreamlabsCommand::ToggleStreaming => vec![SlobsRequest::toggle_streaming(json!(101))],
        StreamlabsCommand::ToggleRecording => vec![SlobsRequest::toggle_recording(json!(102))],
        StreamlabsCommand::MakeSceneActive(scene) => {
            vec![SlobsRequest::make_scene_active(json!(103), &scene)]
        }
        StreamlabsCommand::Refresh => vec![
            SlobsRequest::get_model(json!(104), "StreamingService"),
            SlobsRequest::get_model(json!(105), "DualOutputService"),
        ],
    }
}

fn handle_response(response: SlobsResponse, state: &SharedState, sink: &Arc<dyn EventSink>) {
    if let Some(err) = &response.error {
        sink.log(format!(
            "[streamlabs] JSON-RPC error {}: {}",
            err.code, err.message
        ));
        return;
    }

    match response.payload_kind() {
        SlobsPayloadKind::Event {
            resource_id, data, ..
        } => {
            if resource_id.contains("streamingStatus") {
                if let Some(status) = status_text(&data) {
                    emit_broadcast_state(state, sink, Some(status == "live"), None);
                }
            } else if resource_id.contains("recordingStatus") {
                if let Some(status) = status_text(&data) {
                    emit_broadcast_state(state, sink, None, Some(status == "recording" || status == "live"));
                }
            } else {
                sink.state(state_patch(
                    "streamlabs",
                    json!({ "lastEvent": { "resource": resource_id, "data": data } }),
                ));
            }
        }
        SlobsPayloadKind::Helper { resource_id } => {
            sink.state(state_patch(
                "streamlabs",
                json!({ "service": resource_id, "ready": true }),
            ));
        }
        SlobsPayloadKind::Data => {
            emit_from_model(&response.result, state, sink);
        }
        SlobsPayloadKind::Promise { .. } | SlobsPayloadKind::Subscription { .. } => {}
    }
}

fn emit_from_model(model: &Value, state: &SharedState, sink: &Arc<dyn EventSink>) {
    let streaming = model
        .get("streamingStatus")
        .and_then(status_text_ref)
        .or_else(|| model.get("streaming_status").and_then(status_text_ref));
    let recording = model
        .get("recordingStatus")
        .and_then(status_text_ref)
        .or_else(|| model.get("recording_status").and_then(status_text_ref));
    if streaming.is_some() || recording.is_some() {
        emit_broadcast_state(
            state,
            sink,
            streaming.map(|s| s == "live"),
            recording.map(|s| s == "recording" || s == "live"),
        );
    }
    if let Some(scene) = model
        .get("activeScene")
        .and_then(|v| v.get("name"))
        .and_then(Value::as_str)
    {
        sink.state(state_patch(
            "obs",
            json!({ "obsScene": scene, "source": "streamlabs" }),
        ));
    }
}

fn emit_broadcast_state(
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    live: Option<bool>,
    record_live: Option<bool>,
) {
    if live.is_none() && record_live.is_none() {
        return;
    }
    let broadcasts = with_state(state, |snapshot| {
        snapshot.apply_broadcast_live(live, record_live)
    });
    sink.state(state_patch("obs", json!({ "broadcasts": broadcasts })));
    sink.log(format!(
        "[streamlabs] Broadcast state streaming={:?} recording={:?}",
        live, record_live
    ));
}

fn status_text(value: &Value) -> Option<String> {
    status_text_ref(value)
}

fn status_text_ref(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.to_ascii_lowercase()),
        Value::Object(_) => value
            .get("status")
            .and_then(Value::as_str)
            .map(str::to_ascii_lowercase),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::events::RecordingSink;
    use crate::state::default_simulator_state;
    use std::sync::Mutex;

    fn fixture() -> (SharedState, Arc<RecordingSink>) {
        (
            Arc::new(Mutex::new(default_simulator_state())),
            Arc::new(RecordingSink::new()),
        )
    }

    #[test]
    fn streaming_event_marks_targets_live() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        let response = SlobsResponse::from_line(
            r#"{"jsonrpc":"2.0","id":null,"result":{"_type":"EVENT","emitter":"STREAM","resourceId":"StreamingService.streamingStatusChange","data":"live"}}"#,
        )
        .unwrap();
        handle_response(response, &state, &events);
        let broadcasts = with_state(&state, |s| s.broadcasts.clone());
        assert!(broadcasts.iter().filter(|b| b.id != "record").all(|b| b.live));
        assert!(!broadcasts.iter().find(|b| b.id == "record").unwrap().live);
    }

    #[test]
    fn model_status_is_applied() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        let response = SlobsResponse::from_line(
            r#"{"jsonrpc":"2.0","id":1,"result":{"streamingStatus":"offline","recordingStatus":"recording"}}"#,
        )
        .unwrap();
        handle_response(response, &state, &events);
        let broadcasts = with_state(&state, |s| s.broadcasts.clone());
        assert!(broadcasts.iter().all(|b| !b.live || b.id == "record"));
        assert!(broadcasts.iter().find(|b| b.id == "record").unwrap().live);
    }

    #[test]
    fn rpc_errors_are_logged_not_fatal() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        let response = SlobsResponse::from_line(
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}"#,
        )
        .unwrap();
        handle_response(response, &state, &events);
        assert!(sink.snapshot().logs.iter().any(|l| l.contains("-32601")));
    }
}
