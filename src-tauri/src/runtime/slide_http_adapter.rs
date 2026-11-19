//! Live SlideHttp adapter: aggregated multiplexed status stream + one-shot control calls.
//!
//! Phase 2 requires killing polling. This adapter opens a single
//! `POST /v1/status/updates` request, subscribes to the church-default topics, and turns each
//! `{ "url", "data" }` envelope into a `state://slides` patch. Control actions (`next`, `previous`,
//! clear layer) use short-lived sibling HTTP connections so the stream is never interrupted.
//!
//! Spec: `docs/re-findings/slide_http.md`; codec: [`crate::protocols::slide_http`].

use crate::protocols::slide_http::{
    catalog_path, clear_group_path, goto_slide_path, playlist_trigger_path, resource_path,
    stage_message_path, timer_operation_path, transport_path, transport_seek_body,
    transport_seek_path, SlideHttpUpdate, StatusStreamDecoder, StatusUpdateSubscription,
    WS_PATH,
};
use crate::runtime::events::{state_patch, EventSink};
use crate::runtime::health::HealthReporter;
use crate::state::{
    with_state, PlaybackState, PresentationTimer, ScreenOutput, SharedState, SlidesPatch,
};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

#[derive(Debug, Clone)]
pub struct SlideHttpConfig {
    pub host: String,
    pub port: u16,
}

impl SlideHttpConfig {
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: host.into(),
            port,
        }
    }

    pub fn endpoint(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SlideHttpCommand {
    Next,
    Previous,
    ClearLayer(String),
    GoToSlide(u32),
    SetStageMessage(String),
    ClearStageMessage,
    TimerAction { operation: String },
    ClearGroup(String),
    MediaNext,
    MediaPrevious,
    AudioNext,
    AudioPrevious,
    Transport { layer: String, operation: String },
    TransportSeek { layer: String, seconds: f64 },
    RefreshCatalog(String),
    TriggerLook(String),
    TriggerProp(String),
    ClearProp(String),
    PropAutoClear { id: String, action: String },
    TriggerMacro(String),
}

pub fn spawn(
    config: SlideHttpConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    commands: mpsc::UnboundedReceiver<SlideHttpCommand>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let reporter = HealthReporter::new(
            "slides",
            "SlideHttp",
            "SlideHttp",
            "SlideHttp v1 HTTP",
            state.clone(),
            sink.clone(),
        );
        run(config, state, sink, reporter, commands).await;
    })
}

async fn run(
    config: SlideHttpConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    reporter: HealthReporter,
    mut commands: mpsc::UnboundedReceiver<SlideHttpCommand>,
) {
    let mut backoff = Duration::from_millis(500);
    loop {
        reporter.connecting(format!("Connecting to {}", config.endpoint()));
        match stream_status(&config, &state, &sink, &reporter, &mut commands, &mut backoff).await {
            Ok(()) => {
                reporter.offline("SlideHttp command channel closed");
                return;
            }
            Err(err) => {
                mark_connection(&state, &sink, false, &err);
                reporter.error(err.clone());
                sink.log(format!("[slides] {err}"));
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_millis(15_000));
    }
}

async fn stream_status(
    config: &SlideHttpConfig,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    reporter: &HealthReporter,
    commands: &mut mpsc::UnboundedReceiver<SlideHttpCommand>,
    backoff: &mut Duration,
) -> Result<(), String> {
    let subscription = StatusUpdateSubscription::church_default();
    let body = subscription.body();
    let request = format!(
        "POST {} HTTP/1.1\r\nHost: {}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n{}",
        subscription.path(),
        config.endpoint(),
        body.len(),
        body
    );

    let mut stream = TcpStream::connect(config.endpoint())
        .await
        .map_err(|e| format!("connect {} failed: {e}", config.endpoint()))?;
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("status request failed: {e}"))?;

    let mut decoder = StatusStreamDecoder::new();
    let mut header_buf = Vec::with_capacity(1024);
    let mut headers_done = false;
    let mut buf = [0u8; 8192];
    let mut last_update = tokio::time::Instant::now();
    let mut liveness_tick = tokio::time::interval(Duration::from_secs(15));
    liveness_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    liveness_tick.tick().await;

    loop {
        tokio::select! {
            read = stream.read(&mut buf) => {
                let n = read.map_err(|e| format!("status stream read failed: {e}"))?;
                if n == 0 {
                    return Err("status stream closed by SlideHttp".into());
                }
                if !headers_done {
                    header_buf.extend_from_slice(&buf[..n]);
                    if header_buf.len() > 32 * 1024 {
                        return Err("SlideHttp HTTP header exceeded 32 KiB limit".into());
                    }
                    if let Some(end) = find_header_end(&header_buf) {
                        let head = String::from_utf8_lossy(&header_buf[..end]).to_string();
                        if !head.starts_with("HTTP/1.1 200") && !head.starts_with("HTTP/1.0 200") {
                            let status = head.lines().next().unwrap_or("unknown status");
                            return Err(format!("status stream rejected: {status}"));
                        }
                        reporter.ready(
                            format!("POST {} stream active", subscription.path()),
                            1,
                        );
                        sink.log(
                            "[slides] Multiplexed SlideHttp status stream active (5 topics)"
                                .into(),
                        );
                        headers_done = true;
                        *backoff = Duration::from_millis(500);
                        mark_connected(state, sink);
                        let rest = header_buf[end + 4..].to_vec();
                        if !rest.is_empty() {
                            process_bytes(&rest, &mut decoder, state, sink)?;
                        }
                        header_buf.clear();
                    }
                } else {
                    process_bytes(&buf[..n], &mut decoder, state, sink)?;
                }
                last_update = tokio::time::Instant::now();
            }
            command = commands.recv() => {
                let Some(command) = command else { return Ok(()) };
                match send_command(config, command).await {
                    Ok(Some(body)) => sink.log(format!("[slide_http] catalog response: {body}")),
                    Ok(None) => {}
                    Err(err) => {
                        sink.log(format!("[slides] Control call failed: {err}"));
                        reporter.degraded(err);
                    }
                }
            }
            _ = liveness_tick.tick() => {
                // A healthy SlideHttp stream can be quiet for long periods. Probe /version
                // out-of-band so a dead hub is detected without touching the subscription.
                if last_update.elapsed() > Duration::from_secs(30) {
                    match one_shot(config, "GET", "/version", None).await {
                        Ok(_) => {}
                        Err(err) => return Err(format!("SlideHttp liveness probe failed: {err}")),
                    }
                }
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn mark_connected(state: &SharedState, sink: &Arc<dyn EventSink>) {
    let slides = with_state(state, |snapshot| {
        snapshot.apply_slides(SlidesPatch {
            connected: Some(true),
            last_update_ms: Some(now_ms()),
            adapter: Some("slide_http".into()),
            ..SlidesPatch::default()
        })
    });
    sink.state(state_patch("slides", json!({ "slides": slides })));
}

fn mark_connection(
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    connected: bool,
    reason: &str,
) {
    let slides = with_state(state, |snapshot| {
        snapshot.apply_slides(SlidesPatch {
            connected: Some(connected),
            last_update_ms: Some(now_ms()),
            adapter: Some("slide_http".into()),
            ..SlidesPatch::default()
        })
    });
    sink.state(state_patch(
        "slides",
        json!({ "slides": slides, "slideConnectionError": reason }),
    ));
}

fn process_bytes(
    bytes: &[u8],
    decoder: &mut StatusStreamDecoder,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
) -> Result<(), String> {
    let updates = decoder
        .push(bytes)
        .map_err(|e| format!("status stream frame error: {e}"))?;
    for update in updates {
        apply_update(update, state, sink);
    }
    Ok(())
}

fn apply_update(update: SlideHttpUpdate, state: &SharedState, sink: &Arc<dyn EventSink>) {
    let url = normalize_url(&update.url);
    let data = &update.data;
    let mut patch = SlidesPatch {
        last_update_ms: Some(now_ms()),
        ..SlidesPatch::default()
    };

    match url.as_str() {
        "status/slide" => {
            let current = &data["current"];
            let next = &data["next"];
            let current_text = text_of(&current["text"]);
            let next_text = text_of(&next["text"]);
            if let Some(notes) = text_of(&current["notes"]) {
                patch.current_notes = Some(notes);
            }
            if let Some(notes) = text_of(&next["notes"]) {
                patch.next_notes = Some(notes);
            }
            if let Some(index) = current["index"].as_u64() {
                patch.current_slide = Some(index as u32 + 1);
            }
            if let Some(text) = &current_text {
                patch.cleared = Some(text.trim().is_empty());
            }
            patch.current_text = current_text;
            patch.next_text = next_text;
        }
        "presentation/slide_index" => {
            if let Some(index) = data["presentation_index"]["index"].as_u64() {
                patch.current_slide = Some(index as u32 + 1);
            }
            if let Some(id) = data["presentation_index"]["presentation_id"].as_str() {
                if !id.is_empty() {
                    patch.adapter = Some("slide_http".into());
                }
            }
        }
        "playlist/active" => {
            patch.playlist_name = data
                .get("presentation")
                .and_then(|p| p.get("name"))
                .and_then(Value::as_str)
                .or_else(|| data.get("name").and_then(Value::as_str))
                .map(str::to_string);
            if let Some(total) = data
                .get("presentation")
                .and_then(|p| p.get("total_slides"))
                .and_then(Value::as_u64)
                .or_else(|| data.get("total_slides").and_then(Value::as_u64))
            {
                patch.total_slides = Some(total as u32);
            }
        }
        "timers/current" => {
            patch.timers = Some(timers_of(data));
        }
        "transport/presentation/time" => {
            patch.transport_time = number_of(data.get("time").unwrap_or(data));
        }
        "transport/presentation/current" => {
            patch.playback = Some(playback_of(data, "presentation"));
        }
        "status/layers" => {
            patch.active_layers = Some(layers_of(data));
        }
        "status/screens" => {
            patch.screens = Some(screens_of(data));
        }
        "stage/message" => {
            let message = data
                .get("text")
                .or_else(|| data.get("message"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            patch.stage_message = Some(message.clone());
            patch.stage_message_visible = Some(!message.trim().is_empty());
        }
        other => {
            sink.state(state_patch(
                "slides",
                json!({ "lastUpdate": { "url": other, "data": data } }),
            ));
        }
    }

    let slides = with_state(state, |snapshot| snapshot.apply_slides(patch));
    sink.state(state_patch("slides", json!({ "slides": slides })));
}

fn number_of(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
}

fn text_of(value: &Value) -> Option<String> {
    value.as_str().map(str::to_string)
}

/// Map the documented `GET /v1/transport/{layer}/current` response onto the shared playback model.
fn playback_of(value: &Value, layer: &str) -> PlaybackState {
    let item = value.get("current").unwrap_or(value);
    let duration = item
        .get("duration")
        .and_then(number_of)
        .unwrap_or(0.0);
    let position = item
        .get("position")
        .or_else(|| item.get("time"))
        .and_then(number_of)
        .unwrap_or(0.0);
    PlaybackState {
        layer: item
            .get("layer")
            .and_then(Value::as_str)
            .unwrap_or(layer)
            .to_string(),
        is_playing: item
            .get("is_playing")
            .or_else(|| item.get("isPlaying"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        item_id: item
            .get("uuid")
            .or_else(|| item.get("id"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        name: item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        artist: item
            .get("artist")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        audio_only: item
            .get("audio_only")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        duration_ms: (duration * 1000.0).max(0.0) as u64,
        position_ms: (position * 1000.0).max(0.0) as u64,
    }
}

fn timers_of(value: &Value) -> Vec<PresentationTimer> {
    let list = value
        .as_array()
        .or_else(|| value.get("timers").and_then(Value::as_array))
        .or_else(|| value.get("current").and_then(Value::as_array));

    match list {
        Some(items) => items
            .iter()
            .enumerate()
            .filter(|(_, item)| item.is_object())
            .map(|(index, item)| timer_of(item, index))
            .collect(),
        None if value.is_object() && (value.get("time").is_some() || value.get("id").is_some()) => {
            vec![timer_of(value, 0)]
        }
        None => Vec::new(),
    }
}

fn timer_of(value: &Value, index: usize) -> PresentationTimer {
    let id = value
        .get("id")
        .or_else(|| value.get("uuid"))
        .or_else(|| value.get("timer_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("timer-{index}"));
    let name = value
        .get("name")
        .or_else(|| value.get("title"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("Timer {}", index + 1));
    let time = value
        .get("time")
        .or_else(|| value.get("current_time"))
        .or_else(|| value.get("seconds"))
        .and_then(number_of)
        .unwrap_or(0.0);
    let state = value
        .get("state")
        .or_else(|| value.get("status"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            if value.get("is_running").and_then(Value::as_bool).unwrap_or(false) {
                "running".into()
            } else {
                "stopped".into()
            }
        });
    let formatted = value
        .get("formatted")
        .or_else(|| value.get("display"))
        .or_else(|| value.get("text"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format_timer(time));
    let countdown = value
        .get("countdown")
        .and_then(Value::as_bool)
        .or_else(|| {
            value
                .get("direction")
                .and_then(Value::as_str)
                .map(|direction| direction.eq_ignore_ascii_case("down"))
        })
        .unwrap_or(false);

    PresentationTimer {
        id,
        name,
        state,
        time,
        formatted,
        countdown,
    }
}

fn format_timer(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let secs = total % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{secs:02}")
    } else {
        format!("{minutes:02}:{secs:02}")
    }
}

fn layers_of(value: &Value) -> Vec<String> {
    if let Some(items) = value.as_array() {
        return items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
    }
    let object = value.get("layers").unwrap_or(value);
    let Some(map) = object.as_object() else {
        return Vec::new();
    };
    map.iter()
        .filter(|(_, enabled)| enabled.as_bool().unwrap_or(false))
        .map(|(name, _)| name.clone())
        .collect()
}

fn screens_of(value: &Value) -> Vec<ScreenOutput> {
    let list = value
        .as_array()
        .or_else(|| value.get("screens").and_then(Value::as_array));
    let Some(items) = list else {
        return Vec::new();
    };
    items
        .iter()
        .enumerate()
        .filter(|(_, item)| item.is_object())
        .map(|(index, item)| {
            let width = item
                .get("size")
                .and_then(|size| size.get("width"))
                .or_else(|| item.get("width"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let height = item
                .get("size")
                .and_then(|size| size.get("height"))
                .or_else(|| item.get("height"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            ScreenOutput {
                id: item
                    .get("id")
                    .or_else(|| item.get("uuid"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("screen-{index}")),
                name: item
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("Screen {}", index + 1)),
                screen_type: item
                    .get("screen_type")
                    .or_else(|| item.get("screenType"))
                    .or_else(|| item.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("audience")
                    .to_string(),
                width,
                height,
                enabled: item.get("enabled").and_then(Value::as_bool).unwrap_or(true),
            }
        })
        .collect()
}

async fn send_command(
    config: &SlideHttpConfig,
    command: SlideHttpCommand,
) -> Result<Option<String>, String> {
    let is_catalog = matches!(&command, SlideHttpCommand::RefreshCatalog(_));
    let response = match command {
        SlideHttpCommand::Next => one_shot(config, "GET", "/v1/trigger/next", None).await?,
        SlideHttpCommand::Previous => {
            one_shot(config, "GET", "/v1/trigger/previous", None).await?
        }
        SlideHttpCommand::ClearLayer(layer) => {
            let allowed = [
                "audio",
                "props",
                "messages",
                "announcements",
                "slide",
                "media",
                "video_input",
            ];
            if !allowed.contains(&layer.as_str()) {
                return Err(format!("unknown SlideHttp layer {layer:?}"));
            }
            one_shot(config, "GET", &format!("/v1/clear/layer/{layer}"), None).await?
        }
        SlideHttpCommand::GoToSlide(index) => {
            let path = goto_slide_path(index);
            one_shot(config, "GET", &path, None).await?
        }
        SlideHttpCommand::SetStageMessage(message) => {
            let (path, method, body) = stage_message_path(Some(&message));
            one_shot(config, method, path, body.as_deref()).await?
        }
        SlideHttpCommand::ClearStageMessage => {
            let (path, method, body) = stage_message_path(None);
            one_shot(config, method, path, body.as_deref()).await?
        }
        SlideHttpCommand::TimerAction { operation } => {
            let path = timer_operation_path(&operation)
                .ok_or_else(|| format!("unknown SlideHttp timer operation {operation:?}"))?;
            one_shot(config, "GET", &path, None).await?
        }
        SlideHttpCommand::ClearGroup(id) => {
            let path = clear_group_path(&id);
            one_shot(config, "GET", &path, None).await?
        }
        SlideHttpCommand::MediaNext => {
            let path = playlist_trigger_path("media", "next").unwrap();
            one_shot(config, "GET", &path, None).await?
        }
        SlideHttpCommand::MediaPrevious => {
            let path = playlist_trigger_path("media", "previous").unwrap();
            one_shot(config, "GET", &path, None).await?
        }
        SlideHttpCommand::AudioNext => {
            let path = playlist_trigger_path("audio", "next").unwrap();
            one_shot(config, "GET", &path, None).await?
        }
        SlideHttpCommand::AudioPrevious => {
            let path = playlist_trigger_path("audio", "previous").unwrap();
            one_shot(config, "GET", &path, None).await?
        }
        SlideHttpCommand::Transport { layer, operation } => {
            let path = transport_path(&layer, &operation)
                .ok_or_else(|| format!("unknown transport operation {layer}/{operation}"))?;
            one_shot(config, "GET", &path, None).await?
        }
        SlideHttpCommand::TransportSeek { layer, seconds } => {
            let path = transport_seek_path(&layer)
                .ok_or_else(|| format!("unknown transport layer {layer:?}"))?;
            one_shot(config, "PUT", &path, Some(&transport_seek_body(seconds))).await?
        }
        SlideHttpCommand::RefreshCatalog(kind) => {
            let path = catalog_path(&kind)
                .ok_or_else(|| format!("unknown SlideHttp catalog {kind:?}"))?;
            one_shot(config, "GET", path, None).await?
        }
        SlideHttpCommand::TriggerLook(id) => {
            let path = resource_path("look", &id, Some("trigger"))
                .ok_or_else(|| format!("invalid look id {id:?}"))?;
            one_shot(config, "GET", &path, None).await?
        }
        SlideHttpCommand::TriggerProp(id) => {
            let path = resource_path("prop", &id, Some("trigger"))
                .ok_or_else(|| format!("invalid prop id {id:?}"))?;
            one_shot(config, "GET", &path, None).await?
        }
        SlideHttpCommand::ClearProp(id) => {
            let path = resource_path("prop", &id, Some("clear"))
                .ok_or_else(|| format!("invalid prop id {id:?}"))?;
            one_shot(config, "GET", &path, None).await?
        }
        SlideHttpCommand::PropAutoClear { id, action } => {
            let operation = match action.as_str() {
                "pause" => "auto_clear/pause",
                "resume" => "auto_clear/resume",
                _ => return Err(format!("unknown prop auto-clear action {action:?}")),
            };
            let path = resource_path("prop", &id, Some(operation))
                .ok_or_else(|| format!("invalid prop id {id:?}"))?;
            one_shot(config, "GET", &path, None).await?
        }
        SlideHttpCommand::TriggerMacro(id) => {
            let path = resource_path("macro", &id, Some("trigger"))
                .ok_or_else(|| format!("invalid macro id {id:?}"))?;
            one_shot(config, "GET", &path, None).await?
        }
    };
    if is_catalog {
        Ok(catalog_response_body(&response))
    } else {
        Ok(None)
    }
}

/// Catalog responses have no documented schema in the REA findings. Return the raw JSON body so
/// the caller can surface it honestly instead of inventing typed fields.
fn catalog_response_body(response: &str) -> Option<String> {
    let (_head, body) = response.split_once("\r\n\r\n")?;
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(4000).collect())
}

async fn one_shot(
    config: &SlideHttpConfig,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let mut stream = tokio::time::timeout(
        Duration::from_secs(2),
        TcpStream::connect(config.endpoint()),
    )
    .await
    .map_err(|_| "control connection timed out".to_string())?
    .map_err(|e| format!("control connect failed: {e}"))?;

    let content_type_hdr = if body.is_some() {
        "Content-Type: application/json\r\n"
    } else {
        ""
    };
    let body = body.unwrap_or("");
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {}\r\nAccept: application/json\r\n{content_type_hdr}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        config.endpoint(),
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("control write failed: {e}"))?;

    const MAX_RESPONSE_BYTES: usize = 256 * 1024;
    let mut response = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let read_all = async {
        loop {
            let n = stream
                .read(&mut chunk)
                .await
                .map_err(|e| format!("control read failed: {e}"))?;
            if n == 0 {
                break;
            }
            let remaining = MAX_RESPONSE_BYTES.saturating_sub(response.len());
            response.extend_from_slice(&chunk[..n.min(remaining)]);
            if response.len() >= MAX_RESPONSE_BYTES {
                break;
            }
        }
        Ok::<(), String>(())
    };
    tokio::time::timeout(Duration::from_secs(3), read_all)
        .await
        .map_err(|_| "control response timed out".to_string())??;
    let head = String::from_utf8_lossy(&response).to_string();
    if head.starts_with("HTTP/1.1 2") || head.starts_with("HTTP/1.0 2") {
        Ok(head)
    } else {
        Err(head.lines().next().unwrap_or("non-2xx control response").to_string())
    }
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|w| w == b"\r\n\r\n")
}

fn normalize_url(url: &str) -> String {
    let trimmed = url.trim_start_matches('/');
    trimmed.strip_prefix("v1/").unwrap_or(trimmed).to_string()
}

/// The `/v1/ws` path is exported for the next phase (bidirectional control bridge); keeping it
/// referenced here documents the intended endpoint without inventing a second transport yet.
pub const WS_CONTROL_PATH: &str = WS_PATH;

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
    fn header_end_is_found() {
        assert_eq!(find_header_end(b"HTTP/1.1 200 OK\r\nA: b\r\n\r\nbody"), Some(21));
        assert!(find_header_end(b"HTTP/1.1 200 OK\r\n").is_none());
    }

    #[test]
    fn catalog_response_body_extracts_raw_json() {
        let response = "HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n[{\"uuid\":\"a\"}]";
        assert_eq!(
            catalog_response_body(response).as_deref(),
            Some("[{\"uuid\":\"a\"}]")
        );
        assert!(catalog_response_body("HTTP/1.1 204 No Content\r\n\r\n").is_none());
    }

    #[test]
    fn slide_update_patches_text_and_clear_flag() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        apply_update(
            SlideHttpUpdate {
                url: "status/slide".into(),
                data: json!({
                    "current": {
                        "text": "Hope Anchored — 1 Peter 1",
                        "notes": "Slow down; let the room sing.",
                        "uuid": "a",
                        "index": 4
                    },
                    "next": { "text": "Application", "notes": "Pastor enters", "uuid": "b" }
                }),
            },
            &state,
            &events,
        );
        let slides = with_state(&state, |s| s.slides.clone());
        assert_eq!(slides.current_text, "Hope Anchored — 1 Peter 1");
        assert_eq!(slides.next_text, "Application");
        assert_eq!(slides.current_notes, "Slow down; let the room sing.");
        assert_eq!(slides.next_notes, "Pastor enters");
        assert_eq!(slides.current_slide, 5);
        assert!(!slides.cleared);
        assert!(slides.last_update_ms > 0);
        assert_eq!(sink.snapshot().states.last().unwrap().domain, "slides");
    }

    #[test]
    fn timers_layers_and_screens_are_typed() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        apply_update(
            SlideHttpUpdate {
                url: "timers/current".into(),
                data: json!({
                    "timers": [
                        { "id": "svc", "name": "Service", "time": 305, "is_running": true },
                        { "id": "walk", "name": "Walk-in", "time": 42, "direction": "down" }
                    ]
                }),
            },
            &state,
            &events,
        );
        apply_update(
            SlideHttpUpdate {
                url: "status/layers".into(),
                data: json!({ "slide": true, "media": false, "messages": true }),
            },
            &state,
            &events,
        );
        apply_update(
            SlideHttpUpdate {
                url: "status/screens".into(),
                data: json!([
                    { "id": "aud", "name": "Audience", "screen_type": "audience", "size": { "width": 1920, "height": 1080 } },
                    { "id": "stage", "name": "Stage", "screen_type": "stage", "width": 1280, "height": 720, "enabled": false }
                ]),
            },
            &state,
            &events,
        );
        let slides = with_state(&state, |s| s.slides.clone());
        assert_eq!(slides.timers.len(), 2);
        assert_eq!(slides.timers[0].formatted, "05:05");
        assert_eq!(slides.timers[0].state, "running");
        assert!(slides.timers[1].countdown);
        assert_eq!(slides.active_layers, vec!["messages", "slide"]);
        assert_eq!(slides.screens.len(), 2);
        assert_eq!(slides.screens[0].width, 1920);
        assert!(!slides.screens[1].enabled);
    }

    #[test]
    fn transport_current_update_is_typed() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        apply_update(
            SlideHttpUpdate {
                url: "transport/presentation/current".into(),
                data: json!({
                    "is_playing": true,
                    "uuid": "media-42",
                    "name": "Welcome Video",
                    "artist": "Production Team",
                    "audio_only": false,
                    "duration": 120.5,
                    "position": 12.25
                }),
            },
            &state,
            &events,
        );
        let slides = with_state(&state, |s| s.slides.clone());
        let playback = slides.playback.expect("playback state exists");
        assert!(playback.is_playing);
        assert_eq!(playback.item_id, "media-42");
        assert_eq!(playback.name, "Welcome Video");
        assert_eq!(playback.duration_ms, 120_500);
        assert_eq!(playback.position_ms, 12_250);
        assert_eq!(playback.layer, "presentation");
    }

    #[test]
    fn stage_message_update_sets_visibility() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        apply_update(
            SlideHttpUpdate {
                url: "stage/message".into(),
                data: json!({ "text": "Walk with me" }),
            },
            &state,
            &events,
        );
        let slides = with_state(&state, |s| s.slides.clone());
        assert_eq!(slides.stage_message, "Walk with me");
        assert!(slides.stage_message_visible);

        apply_update(
            SlideHttpUpdate {
                url: "stage/message".into(),
                data: json!({ "text": "" }),
            },
            &state,
            &events,
        );
        let slides = with_state(&state, |s| s.slides.clone());
        assert!(slides.stage_message.is_empty());
        assert!(!slides.stage_message_visible);
    }

    #[test]
    fn empty_slide_marks_cleared() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        apply_update(
            SlideHttpUpdate {
                url: "/v1/status/slide".into(),
                data: json!({ "current": { "text": "" }, "next": { "text": "x" } }),
            },
            &state,
            &events,
        );
        assert!(with_state(&state, |s| s.slides.cleared));
    }

    #[test]
    fn playlist_update_sets_name() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        apply_update(
            SlideHttpUpdate {
                url: "playlist/active".into(),
                data: json!({ "presentation": { "name": "Sunday 10:30 AM" } }),
            },
            &state,
            &events,
        );
        assert_eq!(
            with_state(&state, |s| s.slides.playlist_name.clone()),
            "Sunday 10:30 AM"
        );
    }
}
