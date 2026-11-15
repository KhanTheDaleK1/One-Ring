//! Live ProPresenter adapter: aggregated multiplexed status stream + one-shot control calls.
//!
//! Phase 2 requires killing polling. This adapter opens a single
//! `POST /v1/status/updates` request, subscribes to the church-default topics, and turns each
//! `{ "url", "data" }` envelope into a `state://slides` patch. Control actions (`next`, `previous`,
//! clear layer) use short-lived sibling HTTP connections so the stream is never interrupted.
//!
//! Spec: `docs/re-findings/propresenter.md`; codec: [`crate::protocols::propresenter`].

use crate::protocols::propresenter::{
    ProPresenterUpdate, StatusStreamDecoder, StatusUpdateSubscription, WS_PATH,
};
use crate::runtime::events::{state_patch, EventSink};
use crate::runtime::health::HealthReporter;
use crate::state::{with_state, SharedState, SlidesPatch};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

#[derive(Debug, Clone)]
pub struct ProPresenterConfig {
    pub host: String,
    pub port: u16,
}

impl ProPresenterConfig {
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
pub enum ProPresenterCommand {
    Next,
    Previous,
    ClearLayer(String),
}

pub fn spawn(
    config: ProPresenterConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    commands: mpsc::UnboundedReceiver<ProPresenterCommand>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let reporter = HealthReporter::new(
            "slides",
            "ProPresenter",
            "ProPresenter",
            "ProPresenter v1 HTTP",
            state.clone(),
            sink.clone(),
        );
        run(config, state, sink, reporter, commands).await;
    })
}

async fn run(
    config: ProPresenterConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    reporter: HealthReporter,
    mut commands: mpsc::UnboundedReceiver<ProPresenterCommand>,
) {
    let mut backoff = Duration::from_millis(500);
    loop {
        reporter.connecting(format!("Connecting to {}", config.endpoint()));
        match stream_status(&config, &state, &sink, &reporter, &mut commands).await {
            Ok(()) => {
                reporter.offline("ProPresenter command channel closed");
                return;
            }
            Err(err) => {
                reporter.error(err.clone());
                sink.log(format!("[slides] {err}"));
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_millis(15_000));
    }
}

async fn stream_status(
    config: &ProPresenterConfig,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    reporter: &HealthReporter,
    commands: &mut mpsc::UnboundedReceiver<ProPresenterCommand>,
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

    loop {
        tokio::select! {
            read = stream.read(&mut buf) => {
                let n = read.map_err(|e| format!("status stream read failed: {e}"))?;
                if n == 0 {
                    return Err("status stream closed by ProPresenter".into());
                }
                if !headers_done {
                    header_buf.extend_from_slice(&buf[..n]);
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
                            "[slides] Multiplexed ProPresenter status stream active (5 topics)"
                                .into(),
                        );
                        headers_done = true;
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
                if let Err(err) = send_command(config, command).await {
                    sink.log(format!("[slides] Control call failed: {err}"));
                    reporter.degraded(err);
                }
            }
            _ = tokio::time::sleep(Duration::from_secs(20)) => {
                // A healthy ProPresenter stream can be quiet for long periods. Probe /version
                // out-of-band so a dead hub is detected without touching the subscription.
                if last_update.elapsed() > Duration::from_secs(30) {
                    match one_shot(config, "GET", "/version", None).await {
                        Ok(_) => {}
                        Err(err) => return Err(format!("ProPresenter liveness probe failed: {err}")),
                    }
                }
            }
        }
    }
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

fn apply_update(update: ProPresenterUpdate, state: &SharedState, sink: &Arc<dyn EventSink>) {
    let url = normalize_url(&update.url);
    let data = &update.data;

    match url.as_str() {
        "status/slide" => {
            let current_text = text_of(&data["current"]["text"]);
            let next_text = text_of(&data["next"]["text"]);
            let cleared = current_text
                .as_deref()
                .map(|t| t.trim().is_empty())
                .unwrap_or(false);
            let slides = with_state(state, |snapshot| {
                snapshot.apply_slides(SlidesPatch {
                    current_text,
                    next_text,
                    cleared: Some(cleared),
                    ..SlidesPatch::default()
                })
            });
            sink.state(state_patch(
                "slides",
                json!({ "slides": slides, "slideCleared": cleared }),
            ));
        }
        "playlist/active" => {
            let playlist_name = data
                .get("presentation")
                .and_then(|p| p.get("name"))
                .and_then(Value::as_str)
                .or_else(|| data.get("name").and_then(Value::as_str))
                .map(str::to_string);
            if playlist_name.is_some() {
                let slides = with_state(state, |snapshot| {
                    snapshot.apply_slides(SlidesPatch {
                        playlist_name,
                        ..SlidesPatch::default()
                    })
                });
                sink.state(state_patch("slides", json!({ "slides": slides })));
            }
        }
        "timers/current" => {
            sink.state(state_patch("slides", json!({ "timer": data })));
        }
        "transport/presentation/time" => {
            sink.state(state_patch("slides", json!({ "transportTime": data })));
        }
        "status/layers" => {
            sink.state(state_patch("slides", json!({ "layers": data })));
        }
        other => {
            sink.state(state_patch(
                "slides",
                json!({ "lastUpdate": { "url": other, "data": data } }),
            ));
        }
    }
}

async fn send_command(config: &ProPresenterConfig, command: ProPresenterCommand) -> Result<(), String> {
    match command {
        ProPresenterCommand::Next => one_shot(config, "GET", "/v1/trigger/next", None)
            .await
            .map(|_| ()),
        ProPresenterCommand::Previous => one_shot(config, "GET", "/v1/trigger/previous", None)
            .await
            .map(|_| ()),
        ProPresenterCommand::ClearLayer(layer) => {
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
                return Err(format!("unknown ProPresenter layer {layer:?}"));
            }
            one_shot(config, "GET", &format!("/v1/clear/layer/{layer}"), None)
                .await
                .map(|_| ())
        }
    }
}

async fn one_shot(
    config: &ProPresenterConfig,
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

    let body = body.unwrap_or("");
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {}\r\nAccept: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        config.endpoint(),
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("control write failed: {e}"))?;

    let mut buf = vec![0u8; 4096];
    let n = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut buf))
        .await
        .map_err(|_| "control response timed out".to_string())?
        .map_err(|e| format!("control read failed: {e}"))?;
    let head = String::from_utf8_lossy(&buf[..n]).to_string();
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

fn text_of(value: &Value) -> Option<String> {
    value.as_str().map(str::to_string)
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
    fn slide_update_patches_text_and_clear_flag() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        apply_update(
            ProPresenterUpdate {
                url: "status/slide".into(),
                data: json!({
                    "current": { "text": "Hope Anchored — 1 Peter 1", "uuid": "a" },
                    "next": { "text": "Application", "uuid": "b" }
                }),
            },
            &state,
            &events,
        );
        let slides = with_state(&state, |s| s.slides.clone());
        assert_eq!(slides.current_text, "Hope Anchored — 1 Peter 1");
        assert_eq!(slides.next_text, "Application");
        assert!(!slides.cleared);
        assert_eq!(sink.snapshot().states.last().unwrap().domain, "slides");
    }

    #[test]
    fn empty_slide_marks_cleared() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        apply_update(
            ProPresenterUpdate {
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
            ProPresenterUpdate {
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
