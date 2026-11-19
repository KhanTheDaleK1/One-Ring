use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream as TokioTcpStream;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use futures_util::{SinkExt, StreamExt};

const MAX_CHAT_MESSAGES: usize = 200;
const WS_RECONNECT_DELAY: Duration = Duration::from_secs(2);
const IRC_RECONNECT_DELAY: Duration = Duration::from_secs(3);
const WEBHOOK_POLL_INTERVAL: Duration = Duration::from_secs(10);
const HTTP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamStatsSnapshot {
    pub live: bool,
    pub recording: bool,
    pub source: String,
    pub fps: f64,
    pub bitrate_kbps: u32,
    pub dropped_frames: u32,
    pub total_frames: u32,
    pub dropped_pct: f64,
    pub congestion: f64,
    pub cpu_usage_pct: f64,
    pub render_frame_time_ms: f64,
    pub elapsed_sec: u64,
    pub bytes_sent: u64,
    pub viewer_count: Option<u32>,
    pub peak_viewers: Option<u32>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudienceChatMessage {
    pub id: String,
    pub author: String,
    pub role: String,
    pub text: String,
    pub channel: String,
    pub timestamp_ms: u64,
    pub pinned_on_air: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudienceRelayConfig {
    pub enabled: bool,
    pub mode: String,
    pub endpoint_url: String,
    pub auth_token: String,
    pub channel_name: String,
    pub host_display_name: String,
    pub stats_webhook_url: String,
}

#[derive(Debug, Default)]
struct AudienceInner {
    latest_stats: StreamStatsSnapshot,
    messages: VecDeque<AudienceChatMessage>,
    config: AudienceRelayConfig,
    pinned_message_id: Option<String>,
    outbound: Option<mpsc::UnboundedSender<String>>,
    task: Option<JoinHandle<()>>,
    peak_viewers: u32,
    next_id: u64,
}

#[derive(Clone, Default)]
pub struct AudienceState {
    inner: Arc<Mutex<AudienceInner>>,
}

pub type AudienceEmit = Arc<dyn Fn(&str, Value) + Send + Sync + 'static>;

impl AudienceState {
    pub fn set_stats(&self, mut stats: StreamStatsSnapshot) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(viewers) = stats.viewer_count {
            if viewers > inner.peak_viewers {
                inner.peak_viewers = viewers;
            }
        }
        if stats.peak_viewers.is_none() {
            stats.peak_viewers = Some(inner.peak_viewers);
        } else if let Some(p) = stats.peak_viewers {
            if p > inner.peak_viewers {
                inner.peak_viewers = p;
            }
        }
        inner.latest_stats = stats;
    }

    pub fn get_stats(&self) -> StreamStatsSnapshot {
        self.inner.lock().unwrap().latest_stats.clone()
    }

    pub fn set_config(&self, config: AudienceRelayConfig) {
        self.inner.lock().unwrap().config = config;
    }

    pub fn get_config(&self) -> AudienceRelayConfig {
        self.inner.lock().unwrap().config.clone()
    }

    pub fn push_message(&self, mut msg: AudienceChatMessage) -> AudienceChatMessage {
        let mut inner = self.inner.lock().unwrap();
        if msg.id.trim().is_empty() {
            inner.next_id += 1;
            msg.id = format!("aud-{}-{}", now_ms(), inner.next_id);
        }
        if msg.timestamp_ms == 0 {
            msg.timestamp_ms = now_ms();
        }
        if let Some(pin) = &inner.pinned_message_id {
            msg.pinned_on_air = &msg.id == pin;
        }
        inner.messages.push_back(msg.clone());
        while inner.messages.len() > MAX_CHAT_MESSAGES {
            inner.messages.pop_front();
        }
        msg
    }

    pub fn history(&self) -> Vec<AudienceChatMessage> {
        self.inner.lock().unwrap().messages.iter().cloned().collect()
    }

    pub fn pin_message(&self, message_id: Option<String>) -> Option<AudienceChatMessage> {
        let mut inner = self.inner.lock().unwrap();
        inner.pinned_message_id = message_id.clone();
        for msg in inner.messages.iter_mut() {
            msg.pinned_on_air = message_id.as_ref().map(|id| id == &msg.id).unwrap_or(false);
        }
        if let Some(id) = message_id {
            inner.messages.iter().find(|m| m.id == id).cloned()
        } else {
            None
        }
    }

    pub fn set_outbound(&self, tx: Option<mpsc::UnboundedSender<String>>, task: Option<JoinHandle<()>>) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(old) = inner.task.take() {
            old.abort();
        }
        inner.outbound = tx;
        inner.task = task;
    }

    pub fn try_send_outbound(&self, text: String) -> bool {
        let tx = self.inner.lock().unwrap().outbound.clone();
        if let Some(tx) = tx {
            tx.send(text).is_ok()
        } else {
            false
        }
    }

    pub fn stop(&self) {
        self.set_outbound(None, None);
    }

    pub fn update_viewers(&self, viewers: u32) {
        let mut inner = self.inner.lock().unwrap();
        if viewers > inner.peak_viewers {
            inner.peak_viewers = viewers;
        }
        inner.latest_stats.viewer_count = Some(viewers);
        inner.latest_stats.peak_viewers = Some(inner.peak_viewers);
        inner.latest_stats.updated_at_ms = now_ms();
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedInboundFrame {
    Chat(AudienceChatMessage),
    Viewers(u32),
    None,
}

/// Parse incoming JSON chat/viewer frames:
/// `{ author, text, role?, channel? }` or `{ viewers / viewerCount }`
pub fn parse_inbound_json_frame(text: &str) -> ParsedInboundFrame {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return ParsedInboundFrame::None;
    };
    let viewers = value
        .get("viewers")
        .or_else(|| value.get("viewerCount"))
        .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok())));
    if let Some(count) = viewers {
        return ParsedInboundFrame::Viewers(count.min(u32::MAX as u64) as u32);
    }

    let author = value
        .get("author")
        .or_else(|| value.get("user"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let text_body = value
        .get("text")
        .or_else(|| value.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if author.is_empty() || text_body.is_empty() {
        return ParsedInboundFrame::None;
    }
    let role = value
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("viewer")
        .to_string();
    let channel = value
        .get("channel")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    ParsedInboundFrame::Chat(AudienceChatMessage {
        id: String::new(),
        author,
        role,
        text: text_body,
        channel,
        timestamp_ms: now_ms(),
        pinned_on_air: false,
    })
}

/// Parse an IRC PRIVMSG line into a chat message.
pub fn parse_irc_privmsg(line: &str, expected_channel: &str) -> Option<AudienceChatMessage> {
    let trimmed = line.trim_end_matches(['\r', '\n']);
    let (prefix, rest) = if let Some(stripped) = trimmed.strip_prefix(':') {
        let mut parts = stripped.splitn(2, ' ');
        (parts.next().unwrap_or(""), parts.next().unwrap_or(""))
    } else {
        ("", trimmed)
    };
    let mut parts = rest.splitn(3, ' ');
    let command = parts.next().unwrap_or("");
    if !command.eq_ignore_ascii_case("PRIVMSG") {
        return None;
    }
    let target = parts.next().unwrap_or("");
    let trailing = parts.next().unwrap_or("");
    let text = trailing.strip_prefix(':').unwrap_or(trailing).trim().to_string();
    if text.is_empty() {
        return None;
    }
    if !expected_channel.is_empty() && !target.eq_ignore_ascii_case(expected_channel) {
        return None;
    }
    let author = prefix.split('!').next().unwrap_or(prefix).trim().to_string();
    if author.is_empty() {
        return None;
    }
    Some(AudienceChatMessage {
        id: String::new(),
        author,
        role: "viewer".into(),
        text,
        channel: target.to_string(),
        timestamp_ms: now_ms(),
        pinned_on_air: false,
    })
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct FfmpegProgressSample {
    pub fps: Option<f64>,
    pub bitrate_kbps: Option<u32>,
    pub drop_frames: Option<u32>,
    pub total_frames: Option<u32>,
    pub out_time_ms: Option<u64>,
    pub progress_end: bool,
}

/// Parse one FFmpeg `-progress` key=value line and update a sample.
pub fn parse_ffmpeg_progress_line(line: &str, sample: &mut FfmpegProgressSample) {
    let Some((key, value)) = line.trim().split_once('=') else {
        return;
    };
    let key = key.trim();
    let value = value.trim();
    match key {
        "fps" => {
            if let Ok(v) = value.parse::<f64>() {
                if v.is_finite() && v >= 0.0 {
                    sample.fps = Some(v);
                }
            }
        }
        "bitrate" => {
            if let Some(kbps) = parse_ffmpeg_bitrate_to_kbps(value) {
                sample.bitrate_kbps = Some(kbps);
            }
        }
        "drop_frames" => {
            if let Ok(v) = value.parse::<u32>() {
                sample.drop_frames = Some(v);
            }
        }
        "frame" => {
            if let Ok(v) = value.parse::<u32>() {
                sample.total_frames = Some(v);
            }
        }
        "out_time_ms" => {
            // FFmpeg reports microseconds in this field despite the historic name.
            if let Ok(v) = value.parse::<i64>() {
                if v >= 0 {
                    sample.out_time_ms = Some((v as u64) / 1000);
                }
            }
        }
        "out_time_us" => {
            if let Ok(v) = value.parse::<i64>() {
                if v >= 0 {
                    sample.out_time_ms = Some((v as u64) / 1000);
                }
            }
        }
        "progress" => {
            sample.progress_end = value.eq_ignore_ascii_case("end") || value.eq_ignore_ascii_case("continue");
            if value.eq_ignore_ascii_case("end") {
                sample.progress_end = true;
            }
        }
        _ => {}
    }
}

fn parse_ffmpeg_bitrate_to_kbps(value: &str) -> Option<u32> {
    let v = value.trim().to_ascii_lowercase();
    if v.is_empty() || v == "n/a" {
        return None;
    }
    if let Some(num) = v.strip_suffix("kbits/s") {
        return num.trim().parse::<f64>().ok().map(|n| n.max(0.0).round() as u32);
    }
    if let Some(num) = v.strip_suffix("mbits/s") {
        return num.trim().parse::<f64>().ok().map(|n| (n * 1000.0).max(0.0).round() as u32);
    }
    if let Some(num) = v.strip_suffix("bits/s") {
        return num.trim().parse::<f64>().ok().map(|n| (n / 1000.0).max(0.0).round() as u32);
    }
    // Fallback: treat plain number as kbits/s (common ffmpeg progress form "1234.5kbits/s" handled above)
    value.trim().parse::<f64>().ok().map(|n| n.max(0.0).round() as u32)
}

/// Compute bitrate (kbps) delta from consecutive byte counters and elapsed time.
pub fn compute_bitrate_delta_kbps(prev_bytes: u64, curr_bytes: u64, delta_ms: u64) -> Option<u32> {
    if delta_ms == 0 || curr_bytes < prev_bytes {
        return None;
    }
    let delta_bits = (curr_bytes - prev_bytes) as f64 * 8.0;
    let seconds = delta_ms as f64 / 1000.0;
    if seconds <= 0.0 {
        return None;
    }
    let kbps = (delta_bits / seconds / 1000.0).round();
    if kbps.is_finite() && kbps >= 0.0 {
        Some(kbps as u32)
    } else {
        None
    }
}

pub fn configure_relay(
    state: &AudienceState,
    emit: AudienceEmit,
    config: AudienceRelayConfig,
) -> Result<String, String> {
    state.stop();
    state.set_config(config.clone());
    if !config.enabled {
        return Ok("Audience relay disabled".into());
    }
    let mode = config.mode.trim().to_ascii_lowercase();
    match mode.as_str() {
        "websocket" => {
            let endpoint = config.endpoint_url.trim().to_string();
            if endpoint.is_empty() {
                return Err("WebSocket relay requires endpointUrl".into());
            }
            let (tx, rx) = mpsc::unbounded_channel::<String>();
            let st = state.clone();
            let cfg = config.clone();
            let task = tokio::spawn(async move {
                run_websocket_relay(st, emit, cfg, rx).await;
            });
            state.set_outbound(Some(tx), Some(task));
            Ok("Audience relay connected (websocket)".into())
        }
        "webhook" => {
            validate_http_url(config.endpoint_url.trim())?;
            if !config.stats_webhook_url.trim().is_empty() {
                validate_http_url(config.stats_webhook_url.trim())?;
            }
            let st = state.clone();
            let cfg = config.clone();
            let task = tokio::spawn(async move {
                run_webhook_poller(st, emit, cfg).await;
            });
            state.set_outbound(None, Some(task));
            Ok("Audience relay enabled (webhook)".into())
        }
        "irc" => {
            let endpoint = config.endpoint_url.trim().to_string();
            if endpoint.is_empty() {
                return Err("IRC relay requires endpointUrl (host:port)".into());
            }
            let (tx, rx) = mpsc::unbounded_channel::<String>();
            let st = state.clone();
            let cfg = config.clone();
            let task = tokio::spawn(async move {
                run_irc_relay(st, emit, cfg, rx).await;
            });
            state.set_outbound(Some(tx), Some(task));
            Ok("Audience relay connected (irc)".into())
        }
        other => Err(format!("Unsupported audience relay mode: {other}")),
    }
}

fn validate_http_url(url: &str) -> Result<(), String> {
    if url.starts_with("http://") || url.starts_with("https://") {
        Ok(())
    } else {
        Err("URL must start with http:// or https://".into())
    }
}

async fn run_websocket_relay(
    state: AudienceState,
    emit: AudienceEmit,
    config: AudienceRelayConfig,
    mut outbound: mpsc::UnboundedReceiver<String>,
) {
    loop {
        match connect_async(config.endpoint_url.trim()).await {
            Ok((ws, _)) => {
                let (mut write, mut read) = ws.split();
                loop {
                    tokio::select! {
                        msg = read.next() => {
                            match msg {
                                Some(Ok(Message::Text(text))) => {
                                    handle_inbound_text(&state, &emit, &text.to_string());
                                }
                                Some(Ok(Message::Binary(bin))) => {
                                    if let Ok(text) = String::from_utf8(bin.to_vec()) {
                                        handle_inbound_text(&state, &emit, &text);
                                    }
                                }
                                Some(Ok(Message::Close(_))) | None => break,
                                Some(Ok(_)) => {}
                                Some(Err(_)) => break,
                            }
                        }
                        out = outbound.recv() => {
                            let Some(text) = out else { return; };
                            if write.send(Message::Text(text.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                }
            }
            Err(_) => {}
        }
        tokio::time::sleep(WS_RECONNECT_DELAY).await;
    }
}

fn handle_inbound_text(state: &AudienceState, emit: &AudienceEmit, text: &str) {
    match parse_inbound_json_frame(text) {
        ParsedInboundFrame::Chat(msg) => {
            let stored = state.push_message(msg);
            (emit)("audience://chat", serde_json::to_value(stored).unwrap_or(Value::Null));
        }
        ParsedInboundFrame::Viewers(count) => {
            state.update_viewers(count);
            (emit)(
                "audience://viewers",
                json!({ "viewerCount": count, "updatedAtMs": now_ms() }),
            );
        }
        ParsedInboundFrame::None => {}
    }
}

async fn run_webhook_poller(state: AudienceState, emit: AudienceEmit, config: AudienceRelayConfig) {
    let poll_url = config.stats_webhook_url.trim().to_string();
    if poll_url.is_empty() {
        // Nothing to poll; keep task alive as a no-op owner for this mode.
        futures_util::future::pending::<()>().await;
        return;
    }
    loop {
        if let Ok(body) = http_get_body(&poll_url).await {
            match parse_inbound_json_frame(&body) {
                ParsedInboundFrame::Viewers(count) => {
                    state.update_viewers(count);
                    (emit)(
                        "audience://viewers",
                        json!({ "viewerCount": count, "updatedAtMs": now_ms() }),
                    );
                }
                ParsedInboundFrame::Chat(msg) => {
                    let stored = state.push_message(msg);
                    (emit)("audience://chat", serde_json::to_value(stored).unwrap_or(Value::Null));
                }
                ParsedInboundFrame::None => {}
            }
        }
        tokio::time::sleep(WEBHOOK_POLL_INTERVAL).await;
    }
}

pub fn send_webhook_message(config: &AudienceRelayConfig, author: &str, text: &str, channel: &str) -> Result<(), String> {
    let url = config.endpoint_url.trim();
    validate_http_url(url)?;
    let payload = json!({ "author": author, "text": text, "channel": channel }).to_string();
    if url.starts_with("https://") {
        return http_post_via_curl(url, &payload, config.auth_token.trim());
    }
    http_post_plain(url, &payload, config.auth_token.trim())
}

async fn http_get_body(url: &str) -> Result<String, String> {
    let url = url.to_string();
    tokio::task::spawn_blocking(move || {
        if url.starts_with("https://") {
            let out = std::process::Command::new("curl")
                .args(["-sS", "-m", "5", &url])
                .output()
                .map_err(|e| format!("curl failed: {e}"))?;
            if out.status.success() {
                Ok(String::from_utf8_lossy(&out.stdout).to_string())
            } else {
                Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
            }
        } else {
            http_get_plain(&url)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn http_get_plain(url: &str) -> Result<String, String> {
    let (host, port, path) = parse_http_url(url)?;
    let addr = format!("{host}:{port}");
    let mut stream = TcpStream::connect_timeout(
        &addr.to_socket_addrs().map_err(|e| e.to_string())?.next().ok_or("no addr")?,
        HTTP_TIMEOUT,
    ).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(HTTP_TIMEOUT)).ok();
    stream.set_write_timeout(Some(HTTP_TIMEOUT)).ok();
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nAccept: application/json\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    read_http_body(stream)
}

fn http_post_plain(url: &str, payload: &str, auth_token: &str) -> Result<(), String> {
    let (host, port, path) = parse_http_url(url)?;
    let addr = format!("{host}:{port}");
    let mut stream = TcpStream::connect_timeout(
        &addr.to_socket_addrs().map_err(|e| e.to_string())?.next().ok_or("no addr")?,
        HTTP_TIMEOUT,
    ).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(HTTP_TIMEOUT)).ok();
    stream.set_write_timeout(Some(HTTP_TIMEOUT)).ok();
    let mut headers = format!(
        "POST {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
        payload.as_bytes().len()
    );
    if !auth_token.is_empty() {
        headers.push_str(&format!("Authorization: Bearer {auth_token}\r\n"));
    }
    headers.push_str("\r\n");
    stream.write_all(headers.as_bytes()).map_err(|e| e.to_string())?;
    stream.write_all(payload.as_bytes()).map_err(|e| e.to_string())?;
    let _ = read_http_body(stream);
    Ok(())
}

fn http_post_via_curl(url: &str, payload: &str, auth_token: &str) -> Result<(), String> {
    let mut args = vec![
        "-sS".to_string(),
        "-m".to_string(),
        "5".to_string(),
        "-X".to_string(),
        "POST".to_string(),
        "-H".to_string(),
        "Content-Type: application/json".to_string(),
    ];
    if !auth_token.is_empty() {
        args.push("-H".to_string());
        args.push(format!("Authorization: Bearer {auth_token}"));
    }
    args.push("-d".to_string());
    args.push(payload.to_string());
    args.push(url.to_string());
    let out = std::process::Command::new("curl")
        .args(&args)
        .output()
        .map_err(|e| format!("curl failed: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn read_http_body(mut stream: TcpStream) -> Result<String, String> {
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf).to_string();
    if let Some((_, body)) = text.split_once("\r\n\r\n") {
        Ok(body.to_string())
    } else if let Some((_, body)) = text.split_once("\n\n") {
        Ok(body.to_string())
    } else {
        Ok(text)
    }
}

fn parse_http_url(url: &str) -> Result<(String, u16, String), String> {
    let (scheme, rest) = if let Some(r) = url.strip_prefix("http://") {
        ("http", r)
    } else if let Some(r) = url.strip_prefix("https://") {
        ("https", r)
    } else {
        return Err("URL must start with http:// or https://".into());
    };
    let default_port = if scheme == "https" { 443 } else { 80 };
    let mut parts = rest.splitn(2, '/');
    let authority = parts.next().unwrap_or("");
    let path = format!("/{}", parts.next().unwrap_or(""));
    if authority.is_empty() {
        return Err("Missing host in URL".into());
    }
    if let Some((host, port)) = authority.rsplit_once(':') {
        if let Ok(port) = port.parse::<u16>() {
            return Ok((host.to_string(), port, path));
        }
    }
    Ok((authority.to_string(), default_port, path))
}

use std::net::ToSocketAddrs;

async fn run_irc_relay(
    state: AudienceState,
    emit: AudienceEmit,
    config: AudienceRelayConfig,
    mut outbound: mpsc::UnboundedReceiver<String>,
) {
    loop {
        if let Err(_) = run_irc_once(&state, &emit, &config, &mut outbound).await {
            // reconnect after delay
        }
        tokio::time::sleep(IRC_RECONNECT_DELAY).await;
    }
}

async fn run_irc_once(
    state: &AudienceState,
    emit: &AudienceEmit,
    config: &AudienceRelayConfig,
    outbound: &mut mpsc::UnboundedReceiver<String>,
) -> Result<(), String> {
    let addr = config.endpoint_url.trim();
    let stream = TokioTcpStream::connect(addr).await.map_err(|e| e.to_string())?;
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    let nick = sanitize_irc_token(if config.host_display_name.trim().is_empty() {
        "oneringhost"
    } else {
        config.host_display_name.trim()
    });
    let channel = if config.channel_name.trim().is_empty() {
        "#audience".to_string()
    } else if config.channel_name.trim().starts_with('#') {
        config.channel_name.trim().to_string()
    } else {
        format!("#{}", config.channel_name.trim())
    };

    if !config.auth_token.trim().is_empty() {
        writer
            .write_all(format!("PASS {}\r\n", config.auth_token.trim()).as_bytes())
            .await
            .map_err(|e| e.to_string())?;
    }
    writer
        .write_all(format!("NICK {nick}\r\nUSER {nick} 0 * :{nick}\r\nJOIN {channel}\r\n").as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Some(line) = line.map_err(|e| e.to_string())? else { return Ok(()); };
                if line.starts_with("PING") {
                    let payload = line.strip_prefix("PING").unwrap_or("").trim();
                    let resp = if payload.is_empty() { "PONG :keepalive\r\n".to_string() } else { format!("PONG {payload}\r\n") };
                    writer.write_all(resp.as_bytes()).await.map_err(|e| e.to_string())?;
                    continue;
                }
                if let Some(msg) = parse_irc_privmsg(&line, &channel) {
                    let stored = state.push_message(msg);
                    (emit)("audience://chat", serde_json::to_value(stored).unwrap_or(Value::Null));
                }
            }
            out = outbound.recv() => {
                let Some(text) = out else { return Ok(()); };
                // Outbound payload is preformatted PRIVMSG/RAW line in our relay.
                let line = if text.ends_with("\r\n") { text } else if text.ends_with('\n') { text.replace('\n', "\r\n") } else { format!("{text}\r\n") };
                writer.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
            }
        }
    }
}

fn sanitize_irc_token(input: &str) -> String {
    let mut out: String = input
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if out.is_empty() {
        out.push_str("host");
    }
    out.truncate(24);
    out
}

pub fn format_irc_outbound_privmsg(config: &AudienceRelayConfig, text: &str) -> String {
    let channel = if config.channel_name.trim().is_empty() {
        "#audience".to_string()
    } else if config.channel_name.trim().starts_with('#') {
        config.channel_name.trim().to_string()
    } else {
        format!("#{}", config.channel_name.trim())
    };
    let clean = text.replace(['\r', '\n'], " ").trim().to_string();
    format!("PRIVMSG {channel} :{clean}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;
    use futures_util::{SinkExt, StreamExt};

    #[test]
    fn parse_json_chat_frame() {
        let parsed = parse_inbound_json_frame(r#"{"author":"Alex","text":"Hello","role":"mod","channel":"main"}"#);
        match parsed {
            ParsedInboundFrame::Chat(msg) => {
                assert_eq!(msg.author, "Alex");
                assert_eq!(msg.text, "Hello");
                assert_eq!(msg.role, "mod");
                assert_eq!(msg.channel, "main");
            }
            other => panic!("expected chat frame, got {:?}", other_type_name(&other)),
        }
    }

    #[test]
    fn parse_json_viewer_frame_variants() {
        match parse_inbound_json_frame(r#"{"viewers":42}"#) {
            ParsedInboundFrame::Viewers(n) => assert_eq!(n, 42),
            _ => panic!("expected viewers"),
        }
        match parse_inbound_json_frame(r#"{"viewerCount":"17"}"#) {
            ParsedInboundFrame::Viewers(n) => assert_eq!(n, 17),
            _ => panic!("expected viewerCount"),
        }
    }

    fn other_type_name(v: &ParsedInboundFrame) -> &'static str {
        match v {
            ParsedInboundFrame::Chat(_) => "chat",
            ParsedInboundFrame::Viewers(_) => "viewers",
            ParsedInboundFrame::None => "none",
        }
    }

    #[test]
    fn parse_irc_privmsg_line() {
        let msg = parse_irc_privmsg(":alex!u@192.0.2.10 PRIVMSG #main :Hello there\r\n", "#main")
            .expect("privmsg");
        assert_eq!(msg.author, "alex");
        assert_eq!(msg.text, "Hello there");
        assert_eq!(msg.channel, "#main");
    }

    #[test]
    fn parse_ffmpeg_progress_key_values() {
        let mut sample = FfmpegProgressSample::default();
        parse_ffmpeg_progress_line("fps=29.97", &mut sample);
        parse_ffmpeg_progress_line("bitrate=4500.0kbits/s", &mut sample);
        parse_ffmpeg_progress_line("drop_frames=3", &mut sample);
        parse_ffmpeg_progress_line("frame=120", &mut sample);
        parse_ffmpeg_progress_line("out_time_us=2000000", &mut sample);
        assert_eq!(sample.fps, Some(29.97));
        assert_eq!(sample.bitrate_kbps, Some(4500));
        assert_eq!(sample.drop_frames, Some(3));
        assert_eq!(sample.total_frames, Some(120));
        assert_eq!(sample.out_time_ms, Some(2000));
    }

    #[test]
    fn bitrate_delta_calculation() {
        assert_eq!(compute_bitrate_delta_kbps(0, 125_000, 1000), Some(1000));
        assert_eq!(compute_bitrate_delta_kbps(125_000, 125_000, 1000), Some(0));
        assert_eq!(compute_bitrate_delta_kbps(100, 50, 1000), None);
        assert_eq!(compute_bitrate_delta_kbps(0, 1000, 0), None);
    }

    #[tokio::test]
    async fn websocket_chat_relay_round_trip_loopback() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");

        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept");
            let mut ws = accept_async(stream).await.expect("accept ws");
            // Send inbound chat to client
            ws.send(Message::Text(r#"{"author":"viewer1","text":"hi from loopback"}"#.into()))
                .await
                .expect("send inbound");
            // Receive outbound host message from client
            let msg = ws.next().await.expect("next").expect("ok");
            let text = match msg {
                Message::Text(t) => t.to_string(),
                other => panic!("expected text, got {other:?}"),
            };
            let v: Value = serde_json::from_str(&text).expect("json");
            assert_eq!(v.get("type").and_then(Value::as_str), Some("chat"));
            assert_eq!(v.get("author").and_then(Value::as_str), Some("Host"));
            assert_eq!(v.get("text").and_then(Value::as_str), Some("hello back"));
        });

        let state = AudienceState::default();
        let emit: AudienceEmit = Arc::new(|_channel: &str, _payload: Value| {});
        let config = AudienceRelayConfig {
            enabled: true,
            mode: "websocket".into(),
            endpoint_url: format!("ws://{}", addr),
            auth_token: String::new(),
            channel_name: String::new(),
            host_display_name: "Host".into(),
            stats_webhook_url: String::new(),
        };

        configure_relay(&state, emit, config).expect("configure");
        // Wait for inbound message to arrive and be stored
        let mut seen = false;
        for _ in 0..50 {
            if state.history().iter().any(|m| m.text == "hi from loopback") {
                seen = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(seen, "expected inbound chat to be stored");

        // Send outbound
        let outbound = json!({"type":"chat","author":"Host","text":"hello back","channel":"main"}).to_string();
        assert!(state.try_send_outbound(outbound), "outbound queued");

        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .expect("server timeout")
            .expect("server join");
        state.stop();
    }
}
