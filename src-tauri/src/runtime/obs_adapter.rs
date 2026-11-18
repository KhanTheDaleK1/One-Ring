//! Live OBS Studio adapter (`obs-websocket` v5 over WebSocket, JSON subprotocol).
//!
//! Uses the clean-room codec in [`crate::protocols::obs_streamlabs`]:
//! Hello → salted SHA-256 Identify → Identified, then `GetCanvasList` (OBS 33 horizontal/vertical),
//! `GetSceneList`, `GetOutputList`, stream/record status, and event-driven scene/output updates.
//! Requests and events map onto `state://obs` patches and `device://health`.

use crate::protocols::obs_streamlabs::{
    compute_authentication, event_subscription, obs_identify, BatchExecutionType, ObsEvent, ObsFrame,
    ObsRequest, ObsRequestBatch, ObsResponse, OpCode,
};
use crate::runtime::events::{state_patch, EventSink};
use crate::runtime::health::HealthReporter;
use crate::state::{with_state, BroadcastCanvas, SharedState};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::connect_async;

pub const OBS_JSON_SUBPROTOCOL: &str = "obswebsocket.json";

#[derive(Debug, Clone)]
pub struct ObsConfig {
    pub url: String,
    pub password: Option<String>,
}

impl ObsConfig {
    pub fn new(url: impl Into<String>, password: Option<String>) -> Self {
        Self {
            url: url.into(),
            password,
        }
    }
}

impl Default for ObsConfig {
    fn default() -> Self {
        Self::new("ws://127.0.0.1:4455", None)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ObsCommand {
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
    config: ObsConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    commands: mpsc::UnboundedReceiver<ObsCommand>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let reporter = HealthReporter::new(
            "yt",
            "OBS",
            "YT + FB",
            "obs-websocket v5 JSON",
            state.clone(),
            sink.clone(),
        );
        run(config, state, sink, reporter, commands).await;
    })
}

async fn run(
    config: ObsConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    reporter: HealthReporter,
    mut commands: mpsc::UnboundedReceiver<ObsCommand>,
) {
    let mut backoff = Duration::from_millis(500);
    loop {
        reporter.connecting(format!("Connecting to {}", config.url));
        match serve(&config, &state, &sink, &reporter, &mut commands).await {
            Ok(()) => {
                reporter.offline("OBS command channel closed");
                return;
            }
            Err(err) => {
                reporter.error(err.clone());
                sink.log(format!("[obs-ws-v5] {err}"));
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_millis(15_000));
    }
}

async fn serve(
    config: &ObsConfig,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    reporter: &HealthReporter,
    commands: &mut mpsc::UnboundedReceiver<ObsCommand>,
) -> Result<(), String> {
    let mut request = config
        .url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("invalid OBS URL: {e}"))?;
    request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_static(OBS_JSON_SUBPROTOCOL),
    );

    let (mut ws, _) = connect_async(request)
        .await
        .map_err(|e| format!("OBS WebSocket connect failed: {e}"))?;

    // -- Handshake ------------------------------------------------------------------------------
    let hello = loop {
        let message = ws
            .next()
            .await
            .ok_or_else(|| "OBS closed during Hello".to_string())?
            .map_err(|e| format!("OBS Hello read failed: {e}"))?;
        if let Message::Text(text) = message {
            let text = text.to_string();
            let frame = ObsFrame::from_json(&text).map_err(|e| e.to_string())?;
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
                "OBS requires authentication but no password is configured".to_string()
            })?;
            Some(compute_authentication(password, &salt, &challenge))
        }
        None => None,
    };

    send_text(
        &mut ws,
        obs_identify(auth_response.as_deref(), event_subscription::ALL).to_json(),
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
                    return Err("OBS WebSocket closed".into());
                };
                let message = message.map_err(|e| format!("OBS WebSocket error: {e}"))?;
                last_frame = tokio::time::Instant::now();
                match message {
                    Message::Text(text) => {
                        let text = text.to_string();
                        let frame = match ObsFrame::from_json(&text) {
                            Ok(frame) => frame,
                            Err(err) => {
                                sink.log(format!("[obs-ws-v5] Dropped malformed frame: {err}"));
                                continue;
                            }
                        };
                        match frame.op {
                            OpCode::Identified => {
                                if !identified {
                                    identified = true;
                                    reporter.ready("obs-websocket v5 identified", 1);
                                    sink.log(
                                        "[obs-ws-v5] Identified (JSON subprotocol, canvas + output subscriptions)"
                                            .into(),
                                    );
                                    for request in initial_requests() {
                                        send_text(&mut ws, request.to_json()).await?;
                                    }
                                }
                            }
                            OpCode::RequestResponse => {
                                if let Ok(response) = ObsResponse::from_frame(&frame) {
                                    handle_response(response, state, sink);
                                }
                            }
                            OpCode::Event => {
                                if let Ok(event) = ObsEvent::from_frame(&frame) {
                                    handle_event(event, state, sink);
                                }
                            }
                            _ => {}
                        }
                    }
                    Message::Ping(payload) => {
                        ws.send(Message::Pong(payload)).await.map_err(|e| e.to_string())?;
                    }
                    Message::Close(_) => return Err("OBS sent Close".into()),
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
                ws.send(Message::Ping(Vec::new().into()))
                    .await
                    .map_err(|e| format!("OBS ping failed: {e}"))?;
            }
            _ = liveness.tick() => {
                if last_frame.elapsed() > Duration::from_secs(15) {
                    send_text(&mut ws, ObsRequest::get_version().to_json()).await?;
                }
            }
        }
    }
}

fn initial_requests() -> Vec<ObsRequest> {
    vec![
        ObsRequest::get_version(),
        ObsRequest::get_canvas_list(),
        ObsRequest::get_scene_list(None),
        ObsRequest::get_output_list(),
        ObsRequest::get_stream_status(),
        ObsRequest::get_record_status(),
    ]
}

async fn send_text(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    text: String,
) -> Result<(), String> {
    ws.send(Message::Text(text.into()))
        .await
        .map_err(|e| format!("OBS send failed: {e}"))
}

async fn ws_request(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    request_type: &str,
    request_data: Option<Value>,
    request_id: &str,
) -> Result<(), String> {
    let payload = json!({
        "op": 6,
        "d": {
            "requestType": request_type,
            "requestId": request_id,
            "requestData": request_data.unwrap_or_else(|| json!({}))
        }
    });
    send_text(ws, payload.to_string()).await
}

async fn send_command(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    command: ObsCommand,
) -> Result<(), String> {
    match command {
        ObsCommand::SetProgramScene(scene) => {
            send_text(
                ws,
                ObsRequest::set_current_program_scene(Some(&scene), None).to_json(),
            )
            .await?;
            send_text(ws, ObsRequest::get_scene_list(None).to_json()).await
        }
        ObsCommand::StartOutput(name) => {
            send_text(ws, ObsRequest::start_output(&name).to_json()).await?;
            send_text(ws, ObsRequest::get_output_list().to_json()).await
        }
        ObsCommand::StopOutput(name) => {
            send_text(ws, ObsRequest::stop_output(&name).to_json()).await?;
            send_text(ws, ObsRequest::get_output_list().to_json()).await
        }
        ObsCommand::CreateRecordChapter(name) => {
            send_text(ws, ObsRequest::create_record_chapter(&name).to_json()).await
        }
        ObsCommand::StartStream => {
            send_text(ws, ObsRequest::start_stream().to_json()).await?;
            send_text(ws, ObsRequest::get_stream_status().to_json()).await
        }
        ObsCommand::StopStream => {
            send_text(ws, ObsRequest::stop_stream().to_json()).await?;
            send_text(ws, ObsRequest::get_stream_status().to_json()).await
        }
        ObsCommand::StartRecord => {
            send_text(ws, ObsRequest::start_record().to_json()).await?;
            send_text(ws, ObsRequest::get_record_status().to_json()).await
        }
        ObsCommand::StopRecord => {
            send_text(ws, ObsRequest::stop_record().to_json()).await?;
            send_text(ws, ObsRequest::get_record_status().to_json()).await
        }
        ObsCommand::PauseRecord => ws_request(ws, "PauseRecord", None, "pause_rec").await,
        ObsCommand::ResumeRecord => ws_request(ws, "ResumeRecord", None, "resume_rec").await,
        ObsCommand::StartVirtualCam => ws_request(ws, "StartVirtualCam", None, "start_vcam").await,
        ObsCommand::StopVirtualCam => ws_request(ws, "StopVirtualCam", None, "stop_vcam").await,
        ObsCommand::StartReplayBuffer => ws_request(ws, "StartReplayBuffer", None, "start_rb").await,
        ObsCommand::SaveReplayBuffer => ws_request(ws, "SaveReplayBuffer", None, "save_rb").await,
        ObsCommand::TriggerStudioModeTransition => ws_request(ws, "TriggerStudioModeTransition", None, "studio_trans").await,
        ObsCommand::SetStudioModeEnabled(enabled) => ws_request(ws, "SetStudioModeEnabled", Some(json!({ "studioModeEnabled": enabled })), "set_studio").await,
        ObsCommand::SetTBarPosition(pos) => ws_request(ws, "SetTBarPosition", Some(json!({ "position": pos, "release": false })), "tbar").await,
        ObsCommand::SetCurrentSceneTransition(name) => ws_request(ws, "SetCurrentSceneTransition", Some(json!({ "transitionName": name })), "set_trans").await,
        ObsCommand::SetCurrentSceneTransitionDuration(ms) => ws_request(ws, "SetCurrentSceneTransitionDuration", Some(json!({ "transitionDuration": ms })), "set_trans_dur").await,
        ObsCommand::CreateScene(name) => ws_request(ws, "CreateScene", Some(json!({ "sceneName": name })), "create_scene").await,
        ObsCommand::RemoveScene(name) => ws_request(ws, "RemoveScene", Some(json!({ "sceneName": name })), "remove_scene").await,
        ObsCommand::SetInputMute { input_name, muted } => ws_request(ws, "SetInputMute", Some(json!({ "inputName": input_name, "inputMuted": muted })), "mute_in").await,
        ObsCommand::SetInputVolumeDb { input_name, db } => ws_request(ws, "SetInputVolume", Some(json!({ "inputName": input_name, "inputVolumeDb": db })), "vol_in").await,
        ObsCommand::SendStreamCaption(caption_text) => ws_request(ws, "SendStreamCaption", Some(json!({ "captionText": caption_text })), "caption").await,
        ObsCommand::OpenVideoMixProjector(mix) => ws_request(ws, "OpenVideoMixProjector", Some(json!({ "videoMixType": mix })), "proj").await,
        ObsCommand::Refresh => {
            let batch = ObsRequestBatch::new(
                initial_requests(),
                BatchExecutionType::SerialRealtime,
            );
            send_text(ws, batch.to_frame().to_json()).await
        }
    }
}

fn handle_response(response: ObsResponse, state: &SharedState, sink: &Arc<dyn EventSink>) {
    if !response.is_ok() {
        sink.log(format!(
            "[obs-ws-v5] {} failed ({}): {}",
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
                sink.state(state_patch("obs", json!({ "canvases": canvases })));
            }
        }
        "GetSceneList" => {
            if let Some(scene) = response
                .response_data
                .get("currentProgramSceneName")
                .and_then(Value::as_str)
            {
                let canvases = with_state(state, |snapshot| {
                    snapshot.apply_obs_scene(Some(scene.to_string()), None)
                });
                sink.state(state_patch(
                    "obs",
                    json!({ "obsScene": scene, "canvases": canvases }),
                ));
            }
        }
        "GetOutputList" => {
            let broadcasts = apply_outputs(&response.response_data, state);
            sink.state(state_patch("obs", json!({ "broadcasts": broadcasts })));
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
                .get("obsVersion")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            sink.log(format!("[obs-ws-v5] OBS version {version}"));
        }
        "CreateRecordChapter" => {
            sink.log("[obs-ws-v5] CreateRecordChapter acked".into());
        }
        _ => {}
    }
}

fn handle_event(event: ObsEvent, state: &SharedState, sink: &Arc<dyn EventSink>) {
    match event.event_type.as_str() {
        "CurrentProgramSceneChanged" => {
            if let Some(scene) = event
                .event_data
                .get("sceneName")
                .and_then(Value::as_str)
            {
                let canvases = with_state(state, |snapshot| {
                    snapshot.apply_obs_scene(Some(scene.to_string()), None)
                });
                sink.state(state_patch(
                    "obs",
                    json!({ "obsScene": scene, "canvases": canvases }),
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
                "[obs-ws-v5] {} received; refreshing topology",
                event.event_type
            ));
        }
        "ExitStarted" => {
            sink.log("[obs-ws-v5] OBS is exiting".into());
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
                        engine: "OBS 33 GetCanvasList".into(),
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
            if let Some((_, active)) = outputs.iter().find(|(name, _)| name.contains(&id)) {
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
    sink.state(state_patch("obs", json!({ "broadcasts": broadcasts })));
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
            engine: "OBS".into(),
        });
        for (id, plat) in [("youtube", "YouTube"), ("facebook", "Facebook"), ("record", "Recorder")] {
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
        let frame = ObsFrame::new(
            OpCode::RequestResponse,
            json!({
                "requestType": "GetSceneList",
                "requestId": "r1",
                "requestStatus": { "result": true, "code": 100 },
                "responseData": { "currentProgramSceneName": "Pulpit" }
            }),
        );
        handle_response(ObsResponse::from_frame(&frame).unwrap(), &state, &events);
        assert_eq!(with_state(&state, |s| s.obs_scene.clone()), "Pulpit");
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
                    { "outputName": "youtube_stream", "outputActive": true },
                    { "outputName": "facebook_stream", "outputActive": false },
                    { "outputName": "record_output", "outputActive": true }
                ]
            }),
            &state,
        );
        assert!(broadcasts.iter().find(|b| b.id == "youtube").unwrap().live);
        assert!(!broadcasts.iter().find(|b| b.id == "facebook").unwrap().live);
        assert!(broadcasts.iter().find(|b| b.id == "record").unwrap().live);
    }

    #[test]
    fn stream_event_updates_targets() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        let event = ObsEvent::from_frame(&ObsFrame::new(
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
