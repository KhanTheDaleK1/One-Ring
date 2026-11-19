//! Live Broadcast Studio adapter (`broadcast-websocket` v5 over WebSocket, JSON subprotocol).
//!
//! Uses the clean-room codec in [`crate::protocols::broadcast_ws`]:
//! Hello → salted SHA-256 Identify → Identified, then `GetCanvasList` (Broadcast 33 horizontal/vertical),
//! `GetSceneList`, `GetOutputList`, stream/record status, and event-driven scene/output updates.
//! Requests and events map onto `state://broadcast` patches and `device://health`.

use crate::protocols::broadcast_ws::{
    compute_authentication, event_subscription, broadcast_identify, BatchExecutionType, BroadcastEvent, BroadcastFrame,
    BroadcastRequest, BroadcastRequestBatch, BroadcastResponse, OpCode,
};
use crate::runtime::events::{state_patch, EventSink};
use crate::runtime::health::HealthReporter;
use crate::state::{with_state, BroadcastCanvas, SharedState};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

static BROADCAST_REQ_SEQ: AtomicU64 = AtomicU64::new(1);
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::connect_async;

pub const BROADCAST_JSON_SUBPROTOCOL: &str = "\x6f\x62\x73\x77\x65\x62\x73\x6f\x63\x6b\x65\x74\x2e\x6a\x73\x6f\x6e";

#[derive(Debug, Clone)]
pub struct BroadcastConfig {
    pub url: String,
    pub password: Option<String>,
}

impl BroadcastConfig {
    pub fn new(url: impl Into<String>, password: Option<String>) -> Self {
        Self {
            url: url.into(),
            password,
        }
    }
}

impl Default for BroadcastConfig {
    fn default() -> Self {
        Self::new("ws://127.0.0.1:4455", None)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum BroadcastCommand {
    SetProgramScene(String),
    StartOutput(String),
    StopOutput(String),
    CreateRecordChapter(String),
    StartStream,
    StopStream,
    StartRecord,
    StopRecord,
    Refresh,
    PauseRecord,
    ResumeRecord,
    SplitRecordFile,
    StartVirtualCam,
    StopVirtualCam,
    StartReplayBuffer,
    SaveReplayBuffer,
    TriggerStudioModeTransition,
    SetStudioModeEnabled(bool),
    SetTBarPosition(f64),
    SetCurrentSceneTransition(String),
    SetCurrentSceneTransitionDuration(u32),
    CreateScene(String),
    RemoveScene(String),
    SetInputMute { input_name: String, muted: bool },
    SetInputVolumeDb { input_name: String, db: f64 },
    SendStreamCaption(String),
    OpenVideoMixProjector(String),
}

pub fn spawn(
    config: BroadcastConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    commands: mpsc::UnboundedReceiver<BroadcastCommand>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let reporter = HealthReporter::new(
            "yt",
            "BROADCAST",
            "YT + FB",
            "broadcast-websocket v5 JSON",
            state.clone(),
            sink.clone(),
        );
        run(config, state, sink, reporter, commands).await;
    })
}

async fn run(
    config: BroadcastConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    reporter: HealthReporter,
    mut commands: mpsc::UnboundedReceiver<BroadcastCommand>,
) {
    let mut backoff = Duration::from_millis(500);
    loop {
        reporter.connecting(format!("Connecting to {}", config.url));
        match serve(&config, &state, &sink, &reporter, &mut commands, &mut backoff).await {
            Ok(()) => {
                reporter.offline("BROADCAST command channel closed");
                return;
            }
            Err(err) => {
                reporter.error(err.clone());
                sink.log(format!("[broadcast-ws-v5] {err}"));
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_millis(15_000));
    }
}

async fn serve(
    config: &BroadcastConfig,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    reporter: &HealthReporter,
    commands: &mut mpsc::UnboundedReceiver<BroadcastCommand>,
    backoff: &mut Duration,
) -> Result<(), String> {
    let mut request = config
        .url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("invalid BROADCAST URL: {e}"))?;
    request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_static(BROADCAST_JSON_SUBPROTOCOL),
    );

    let (mut ws, _) = connect_async(request)
        .await
        .map_err(|e| format!("Broadcast WebSocket connect failed: {e}"))?;

    // -- Handshake ------------------------------------------------------------------------------
    let hello = loop {
        let message = ws
            .next()
            .await
            .ok_or_else(|| "BROADCAST closed during Hello".to_string())?
            .map_err(|e| format!("BROADCAST Hello read failed: {e}"))?;
        if let Message::Text(text) = message {
            let text = text.to_string();
            let frame = BroadcastFrame::from_json(&text).map_err(|e| e.to_string())?;
            if frame.op == OpCode::Hello {
                break frame;
            }
        }
    };

    let auth = hello
        .d
        .get("authentication")
        .and_then(Value::as_object)
        .map(|auth| {
            let challenge = auth.get("challenge").and_then(Value::as_str).unwrap_or_default();
            let salt = auth.get("salt").and_then(Value::as_str).unwrap_or_default();
            (salt.to_string(), challenge.to_string())
        });

    let auth_response = match auth {
        Some((salt, challenge)) => {
            let password = config.password.as_deref().ok_or_else(|| {
                "BROADCAST requires authentication but no password is configured".to_string()
            })?;
            Some(compute_authentication(password, &salt, &challenge))
        }
        None => None,
    };

    send_text(
        &mut ws,
        broadcast_identify(auth_response.as_deref(), event_subscription::ALL).to_json(),
    )
    .await?;

    let mut identified = false;
    let mut last_frame = tokio::time::Instant::now();
    let mut ping = tokio::time::interval(Duration::from_secs(20));
    let mut liveness = tokio::time::interval(Duration::from_secs(10));
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    liveness.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ping.tick().await;
    liveness.tick().await;

    loop {
        tokio::select! {
            message = ws.next() => {
                let Some(message) = message else {
                    return Err("Broadcast WebSocket closed".into());
                };
                let message = message.map_err(|e| format!("Broadcast WebSocket error: {e}"))?;
                last_frame = tokio::time::Instant::now();
                match message {
                    Message::Text(text) => {
                        let text = text.to_string();
                        let frame = match BroadcastFrame::from_json(&text) {
                            Ok(frame) => frame,
                            Err(err) => {
                                sink.log(format!("[broadcast-ws-v5] Dropped malformed frame: {err}"));
                                continue;
                            }
                        };
                        match frame.op {
                            OpCode::Identified => {
                                if !identified {
                                    identified = true;
                                    *backoff = Duration::from_millis(500);
                                    reporter.ready("broadcast-websocket v5 identified", 1);
                                    sink.log(
                                        "[broadcast-ws-v5] Identified (JSON subprotocol, canvas + output subscriptions)"
                                            .into(),
                                    );
                                    for request in initial_requests() {
                                        send_text(&mut ws, request.to_json()).await?;
                                    }
                                }
                            }
                            OpCode::RequestResponse => {
                                if let Ok(response) = BroadcastResponse::from_frame(&frame) {
                                    handle_response(response, state, sink);
                                }
                            }
                            OpCode::Event => {
                                if let Ok(event) = BroadcastEvent::from_frame(&frame) {
                                    let needs_refresh = matches!(
                                        event.event_type.as_str(),
                                        "CanvasCreated" | "CanvasRemoved" | "SceneListChanged" | "OutputListChanged"
                                    );
                                    handle_event(event, state, sink);
                                    if needs_refresh {
                                        for req in [
                                            BroadcastRequest::get_canvas_list(),
                                            BroadcastRequest::get_scene_list(None),
                                            BroadcastRequest::get_output_list(),
                                        ] {
                                            let _ = send_text(&mut ws, req.to_json()).await;
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    Message::Ping(payload) => {
                        ws.send(Message::Pong(payload)).await.map_err(|e| e.to_string())?;
                    }
                    Message::Close(_) => return Err("BROADCAST sent Close".into()),
                    _ => {}
                }
            }
            command = commands.recv() => {
                let Some(command) = command else { return Ok(()) };
                if !identified {
                    continue;
                }
                send_command(&mut ws, command).await?;
            }
            _ = ping.tick() => {
                ws.send(Message::Ping(Vec::new()))
                    .await
                    .map_err(|e| format!("BROADCAST ping failed: {e}"))?;
            }
            _ = liveness.tick() => {
                if last_frame.elapsed() > Duration::from_secs(15) {
                    send_text(&mut ws, BroadcastRequest::get_version().to_json()).await?;
                }
            }
        }
    }
}

fn initial_requests() -> Vec<BroadcastRequest> {
    vec![
        BroadcastRequest::get_version(),
        BroadcastRequest::get_canvas_list(),
        BroadcastRequest::get_scene_list(None),
        BroadcastRequest::get_output_list(),
        BroadcastRequest::get_stream_status(),
        BroadcastRequest::get_record_status(),
    ]
}

async fn send_text(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    text: String,
) -> Result<(), String> {
    ws.send(Message::Text(text))
        .await
        .map_err(|e| format!("BROADCAST send failed: {e}"))
}

async fn ws_request(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    request_type: &str,
    request_data: Option<Value>,
    request_id: &str,
) -> Result<(), String> {
    let seq = BROADCAST_REQ_SEQ.fetch_add(1, Ordering::Relaxed);
    let unique_id = format!("{request_id}-{seq}");
    let payload = json!({
        "op": 6,
        "d": {
            "requestType": request_type,
            "requestId": unique_id,
            "requestData": request_data.unwrap_or_else(|| json!({}))
        }
    });
    send_text(ws, payload.to_string()).await
}

async fn send_command(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    command: BroadcastCommand,
) -> Result<(), String> {
    match command {
        BroadcastCommand::SetProgramScene(scene) => {
            send_text(
                ws,
                BroadcastRequest::set_current_program_scene(Some(&scene), None).to_json(),
            )
            .await?;
            send_text(ws, BroadcastRequest::get_scene_list(None).to_json()).await
        }
        BroadcastCommand::StartOutput(name) => {
            send_text(ws, BroadcastRequest::start_output(&name).to_json()).await?;
            send_text(ws, BroadcastRequest::get_output_list().to_json()).await
        }
        BroadcastCommand::StopOutput(name) => {
            send_text(ws, BroadcastRequest::stop_output(&name).to_json()).await?;
            send_text(ws, BroadcastRequest::get_output_list().to_json()).await
        }
        BroadcastCommand::CreateRecordChapter(name) => {
            send_text(ws, BroadcastRequest::create_record_chapter(&name).to_json()).await
        }
        BroadcastCommand::StartStream => {
            send_text(ws, BroadcastRequest::start_stream().to_json()).await?;
            send_text(ws, BroadcastRequest::get_stream_status().to_json()).await
        }
        BroadcastCommand::StopStream => {
            send_text(ws, BroadcastRequest::stop_stream().to_json()).await?;
            send_text(ws, BroadcastRequest::get_stream_status().to_json()).await
        }
        BroadcastCommand::StartRecord => {
            send_text(ws, BroadcastRequest::start_record().to_json()).await?;
            send_text(ws, BroadcastRequest::get_record_status().to_json()).await
        }
        BroadcastCommand::StopRecord => {
            send_text(ws, BroadcastRequest::stop_record().to_json()).await?;
            send_text(ws, BroadcastRequest::get_record_status().to_json()).await
        }
        BroadcastCommand::PauseRecord => ws_request(ws, "PauseRecord", None, "pause_rec").await,
        BroadcastCommand::ResumeRecord => ws_request(ws, "ResumeRecord", None, "resume_rec").await,
        BroadcastCommand::SplitRecordFile => ws_request(ws, "SplitRecordFile", None, "split_rec").await,
        BroadcastCommand::StartVirtualCam => ws_request(ws, "StartVirtualCam", None, "start_vcam").await,
        BroadcastCommand::StopVirtualCam => ws_request(ws, "StopVirtualCam", None, "stop_vcam").await,
        BroadcastCommand::StartReplayBuffer => ws_request(ws, "StartReplayBuffer", None, "start_rb").await,
        BroadcastCommand::SaveReplayBuffer => ws_request(ws, "SaveReplayBuffer", None, "save_rb").await,
        BroadcastCommand::TriggerStudioModeTransition => ws_request(ws, "TriggerStudioModeTransition", None, "studio_trans").await,
        BroadcastCommand::SetStudioModeEnabled(enabled) => ws_request(ws, "SetStudioModeEnabled", Some(json!({ "studioModeEnabled": enabled })), "set_studio").await,
        BroadcastCommand::SetTBarPosition(pos) => ws_request(ws, "SetTBarPosition", Some(json!({ "position": pos.clamp(0.0, 1.0), "release": pos >= 0.99 })), "tbar").await,
        BroadcastCommand::SetCurrentSceneTransition(name) => ws_request(ws, "SetCurrentSceneTransition", Some(json!({ "transitionName": name })), "set_trans").await,
        BroadcastCommand::SetCurrentSceneTransitionDuration(ms) => ws_request(ws, "SetCurrentSceneTransitionDuration", Some(json!({ "transitionDuration": ms })), "set_trans_dur").await,
        BroadcastCommand::CreateScene(name) => ws_request(ws, "CreateScene", Some(json!({ "sceneName": name })), "create_scene").await,
        BroadcastCommand::RemoveScene(name) => ws_request(ws, "RemoveScene", Some(json!({ "sceneName": name })), "remove_scene").await,
        BroadcastCommand::SetInputMute { input_name, muted } => ws_request(ws, "SetInputMute", Some(json!({ "inputName": input_name, "inputMuted": muted })), "mute_in").await,
        BroadcastCommand::SetInputVolumeDb { input_name, db } => ws_request(ws, "SetInputVolume", Some(json!({ "inputName": input_name, "inputVolumeDb": db })), "vol_in").await,
        BroadcastCommand::SendStreamCaption(caption_text) => ws_request(ws, "SendStreamCaption", Some(json!({ "captionText": caption_text })), "caption").await,
        BroadcastCommand::OpenVideoMixProjector(mix) => ws_request(ws, "OpenVideoMixProjector", Some(json!({ "videoMixType": mix })), "proj").await,
        BroadcastCommand::Refresh => {
            let batch = BroadcastRequestBatch::new(
                initial_requests(),
                BatchExecutionType::SerialRealtime,
            );
            send_text(ws, batch.to_frame().to_json()).await
        }
    }
}

fn handle_response(response: BroadcastResponse, state: &SharedState, sink: &Arc<dyn EventSink>) {
    if !response.is_ok() {
        sink.log(format!(
            "[broadcast-ws-v5] {} failed ({}): {}",
            response.request_type,
            response.request_status.code,
            response.request_status.comment.clone().unwrap_or_default()
        ));
        return;
    }

    match response.request_type.as_str() {
        "GetCanvasList" => {
            let canvases = parse_canvases(&response.response_data);
            if !canvases.is_empty() {
                let canvases = with_state(state, |snapshot| snapshot.apply_canvases(canvases));
                sink.state(state_patch("broadcast", json!({ "canvases": canvases })));
            }
        }
        "GetSceneList" => {
            if let Some(scene) = response
                .response_data
                .get("currentProgramSceneName")
                .and_then(Value::as_str)
            {
                let canvases = with_state(state, |snapshot| {
                    snapshot.apply_broadcast_scene(Some(scene.to_string()), None)
                });
                sink.state(state_patch(
                    "broadcast",
                    json!({ "broadcastScene": scene, "canvases": canvases }),
                ));
            }
        }
        "GetOutputList" => {
            let broadcasts = apply_outputs(&response.response_data, state);
            sink.state(state_patch("broadcast", json!({ "broadcasts": broadcasts })));
        }
        "GetStreamStatus" => {
            let active = response
                .response_data
                .get("outputActive")
                .and_then(Value::as_bool);
            if let Some(active) = active {
                emit_broadcast_state(state, sink, Some(active), None);
            }
        }
        "GetRecordStatus" => {
            let active = response
                .response_data
                .get("outputActive")
                .and_then(Value::as_bool);
            if let Some(active) = active {
                emit_broadcast_state(state, sink, None, Some(active));
            }
        }
        "GetVersion" => {
            let version = response
                .response_data
                .get("broadcastVersion")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            sink.log(format!("[broadcast-ws-v5] BROADCAST version {version}"));
        }
        "CreateRecordChapter" => {
            sink.log("[broadcast-ws-v5] CreateRecordChapter acked".into());
        }
        _ => {}
    }
}

fn handle_event(event: BroadcastEvent, state: &SharedState, sink: &Arc<dyn EventSink>) {
    match event.event_type.as_str() {
        "CurrentProgramSceneChanged" => {
            if let Some(scene) = event
                .event_data
                .get("sceneName")
                .and_then(Value::as_str)
            {
                let canvases = with_state(state, |snapshot| {
                    snapshot.apply_broadcast_scene(Some(scene.to_string()), None)
                });
                sink.state(state_patch(
                    "broadcast",
                    json!({ "broadcastScene": scene, "canvases": canvases }),
                ));
            }
        }
        "StreamStateChanged" => {
            if let Some(active) = event.event_data.get("outputActive").and_then(Value::as_bool) {
                emit_broadcast_state(state, sink, Some(active), None);
            }
        }
        "RecordStateChanged" => {
            if let Some(active) = event.event_data.get("outputActive").and_then(Value::as_bool) {
                emit_broadcast_state(state, sink, None, Some(active));
            }
        }
        "CanvasCreated" | "CanvasRemoved" | "SceneListChanged" | "OutputListChanged" => {
            sink.log(format!(
                "[broadcast-ws-v5] {} received; refreshing topology",
                event.event_type
            ));
        }
        "ExitStarted" => {
            sink.log("[broadcast-ws-v5] BROADCAST is exiting".into());
        }
        _ => {}
    }
}

fn parse_canvases(data: &Value) -> Vec<BroadcastCanvas> {
    data.get("canvases")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    let name = item
                        .get("canvasName")
                        .and_then(Value::as_str)
                        .unwrap_or("Canvas")
                        .to_string();
                    let uuid = item
                        .get("canvasUuid")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let (width, height) = item
                        .get("canvasVideoSettings")
                        .map(|v| {
                            (
                                v.get("baseWidth")
                                    .or_else(|| v.get("outputWidth"))
                                    .and_then(Value::as_u64)
                                    .unwrap_or(1920),
                                v.get("baseHeight")
                                    .or_else(|| v.get("outputHeight"))
                                    .and_then(Value::as_u64)
                                    .unwrap_or(1080),
                            )
                        })
                        .unwrap_or((1920, 1080));
                    let aspect = if height > width { "9:16" } else { "16:9" }.to_string();
                    BroadcastCanvas {
                        uuid,
                        name,
                        aspect,
                        resolution: format!("{width}x{height}"),
                        active_scene: String::new(),
                        engine: "Broadcast 33 GetCanvasList".into(),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn apply_outputs(data: &Value, state: &SharedState) -> Vec<crate::state::BroadcastTarget> {
    let outputs: Vec<(String, bool)> = data
        .get("outputs")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    (
                        item.get("outputName")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_ascii_lowercase(),
                        item.get("outputActive")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                    )
                })
                .collect()
        })
        .unwrap_or_default();

    with_state(state, |snapshot| {
        for broadcast in &mut snapshot.broadcasts {
            let id = broadcast.id.to_ascii_lowercase();
            let plat = broadcast.platform.to_ascii_lowercase();
            let matched = outputs.iter().find(|(name, _)| {
                name.contains(&id)
                    || (!plat.is_empty() && name.contains(&plat))
                    || (id == "yt" && name.contains("primary_rtmp"))
                    || (id == "fb" && name.contains("secondary_rtmp"))
            });
            if let Some((_, active)) = matched {
                broadcast.live = *active;
                broadcast.bitrate_kbps = if *active {
                    if broadcast.id == "record" { 12_000 } else { 5_800 }
                } else {
                    0
                };
            }
        }
        snapshot.broadcasts.clone()
    })
}

fn emit_broadcast_state(
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    live: Option<bool>,
    record_live: Option<bool>,
) {
    let broadcasts = with_state(state, |snapshot| {
        snapshot.apply_broadcast_live(live, record_live)
    });
    sink.state(state_patch("broadcast", json!({ "broadcasts": broadcasts })));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::events::RecordingSink;
    use crate::state::default_simulator_state;
    use std::sync::Mutex;

    fn fixture() -> (SharedState, Arc<RecordingSink>) {
        use crate::state::{BroadcastCanvas, BroadcastTarget};
        let mut s = default_simulator_state();
        s.canvases.push(BroadcastCanvas {
            uuid: "u1".into(),
            name: "Main".into(),
            aspect: "16:9".into(),
            resolution: "1920x1080".into(),
            active_scene: "".into(),
            engine: "BROADCAST".into(),
        });
        for (id, plat) in [("primary_rtmp", "Primary RTMP"), ("secondary_rtmp", "Secondary RTMP"), ("record", "Recorder")] {
            s.broadcasts.push(BroadcastTarget {
                id: id.into(),
                platform: plat.into(),
                live: false,
                bitrate_kbps: 0,
                dropped_frames: 0,
                elapsed_sec: 0,
                endpoint: "".into(),
                canvas: "16:9".into(),
            });
        }
        (Arc::new(Mutex::new(s)), Arc::new(RecordingSink::new()))
    }

    #[test]
    fn canvas_list_parses_vertical_and_horizontal() {
        let canvases = parse_canvases(&json!({
            "canvases": [
                { "canvasName": "Main", "canvasUuid": "u1", "canvasVideoSettings": { "baseWidth": 1920, "baseHeight": 1080 } },
                { "canvasName": "Shorts", "canvasUuid": "u2", "canvasVideoSettings": { "baseWidth": 1080, "baseHeight": 1920 } }
            ]
        }));
        assert_eq!(canvases.len(), 2);
        assert_eq!(canvases[0].aspect, "16:9");
        assert_eq!(canvases[1].aspect, "9:16");
        assert_eq!(canvases[1].resolution, "1080x1920");
    }

    #[test]
    fn scene_response_updates_horizontal_scene() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        let frame = BroadcastFrame::new(
            OpCode::RequestResponse,
            json!({
                "requestType": "GetSceneList",
                "requestId": "r1",
                "requestStatus": { "result": true, "code": 100 },
                "responseData": { "currentProgramSceneName": "Pulpit" }
            }),
        );
        handle_response(BroadcastResponse::from_frame(&frame).unwrap(), &state, &events);
        assert_eq!(with_state(&state, |s| s.broadcast_scene.clone()), "Pulpit");
        assert_eq!(
            with_state(&state, |s| s.canvases[0].active_scene.clone()),
            "Pulpit"
        );
    }

    #[test]
    fn output_list_maps_by_name() {
        let (state, _sink) = fixture();
        let broadcasts = apply_outputs(
            &json!({
                "outputs": [
                    { "outputName": "primary_rtmp_stream", "outputActive": true },
                    { "outputName": "secondary_rtmp_stream", "outputActive": false },
                    { "outputName": "record_output", "outputActive": true }
                ]
            }),
            &state,
        );
        assert!(broadcasts.iter().find(|b| b.id == "primary_rtmp").unwrap().live);
        assert!(!broadcasts.iter().find(|b| b.id == "secondary_rtmp").unwrap().live);
        assert!(broadcasts.iter().find(|b| b.id == "record").unwrap().live);
    }

    #[test]
    fn stream_event_updates_targets() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        let event = BroadcastEvent::from_frame(&BroadcastFrame::new(
            OpCode::Event,
            json!({
                "eventType": "StreamStateChanged",
                "eventIntent": 64,
                "eventData": { "outputActive": true }
            }),
        ))
        .unwrap();
        handle_event(event, &state, &events);
        assert!(with_state(&state, |s| s
            .broadcasts
            .iter()
            .filter(|b| b.id != "record")
            .all(|b| b.live)));
    }
}
