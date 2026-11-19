//! Live EasyWorship 7 adapter: `_ezwremote._tcp` discovery + TCP JSON-lines remote session.
//!
//! Implements the E0 transport from `docs/re-findings/easyworship.md` §3: mDNS service discovery,
//! the `connect` handshake and pairing check, 2 s client heartbeats, 6 s receive-timeout
//! detection, binary-header byte consumption, typed `status`/`slideInfo` state patches, slide and
//! schedule navigation, and exponential-backoff reconnect.
//!
//! Codecs: [`easyworship`](crate::protocols::easyworship) and
//! [`easyworship_discovery`](crate::protocols::easyworship_discovery).

use crate::protocols::easyworship::{
    action_frame, connect_frame, get_current_image_frame, get_slide_image_frame,
    get_slide_info_frame_with_revision, goto_schedule_frame, goto_slide_frame, heartbeat_frame,
    is_jpeg_payload, parse_index_payload, parse_server_line, screen_from_status, BinaryMeta,
    EasyWorshipSlideInfo, EasyWorshipStatus, ServerMessage,
};
use crate::protocols::easyworship_discovery::{
    parse_response, ptr_query, DiscoveredService, MDNS_GROUP, MDNS_PORT,
};
use crate::runtime::events::{state_patch, EventSink};
use crate::runtime::health::HealthReporter;
use crate::state::{with_state, PresentationImage, SharedState, SlidesPatch};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::mpsc;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(2);
const RECEIVE_TIMEOUT: Duration = Duration::from_secs(6);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_BINARY_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;
const MAX_IMAGE_CACHE_BYTES: usize = 32 * 1024 * 1024;

/// Bounded raw-JPEG cache. Metadata lives in `SlideState.image`; bytes are fetched by key from
/// Tauri so state snapshots never copy image payloads.
#[derive(Debug, Default)]
pub struct EasyWorshipImageCache {
    images: HashMap<String, Vec<u8>>,
    order: Vec<String>,
    bytes: usize,
}

impl EasyWorshipImageCache {
    pub fn insert(&mut self, key: String, bytes: Vec<u8>) -> Result<(), String> {
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(format!(
                "EasyWorship image exceeds {} bytes",
                MAX_IMAGE_BYTES
            ));
        }
        if let Some(old) = self.images.remove(&key) {
            self.bytes = self.bytes.saturating_sub(old.len());
            self.order.retain(|item| item != &key);
        }
        while self.bytes + bytes.len() > MAX_IMAGE_CACHE_BYTES {
            let Some(oldest) = self.order.first().cloned() else {
                break;
            };
            if let Some(removed) = self.images.remove(&oldest) {
                self.bytes = self.bytes.saturating_sub(removed.len());
            }
            self.order.remove(0);
        }
        self.bytes += bytes.len();
        self.order.push(key.clone());
        self.images.insert(key, bytes);
        Ok(())
    }

    pub fn get(&self, key: &str) -> Option<Vec<u8>> {
        self.images.get(key).cloned()
    }
}

/// `None` endpoint means "resolve via mDNS on each connect attempt".
#[derive(Debug, Clone)]
pub struct EasyWorshipConfig {
    pub endpoint: Option<String>,
    pub uid: String,
    pub device_name: String,
}

impl EasyWorshipConfig {
    /// Static host:port override (from `RING_EZW_HOST` / `RING_EZW_PORT`).
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: Some(endpoint.into()),
            uid: "one-ring-controller".into(),
            device_name: "One Ring".into(),
        }
    }

    /// Discover the ephemeral listener each time the session is (re)established.
    pub fn discovered() -> Self {
        Self {
            endpoint: None,
            uid: "one-ring-controller".into(),
            device_name: "One Ring".into(),
        }
    }

    pub fn endpoint_label(&self) -> &str {
        self.endpoint.as_deref().unwrap_or("_ezwremote._tcp (mDNS)")
    }
}

/// Remote-control commands mapped 1:1 to the documented action catalog.
#[derive(Debug, Clone, PartialEq)]
pub enum EasyWorshipCommand {
    NextSlide,
    PreviousSlide,
    NextBuild,
    PreviousBuild,
    NextSchedule,
    PreviousSchedule,
    GoToSlide(u32),
    GoToSchedule(u32),
    GoToStartSlide,
    GoToStartPresentation,
    Refresh,
    Toggle,
    Play,
    Pause,
    GetScheduleData,
    GetLiveData,
    GetSlideInfo {
        rectype: String,
        pres_rowid: String,
        slide_rowid: String,
        requestrev: String,
    },
    GetSlideImage {
        rectype: String,
        pres_rowid: String,
        slide_rowid: String,
        revision: String,
    },
    GetCurrentImage,
}

/// Per-connection bookkeeping for revision-driven follow-up requests.
#[derive(Debug, Default)]
struct SessionState {
    last_slide_key: Option<(String, String, String)>,
    last_slide_image_key: Option<(String, String, String, String)>,
    last_imagehash: Option<String>,
    last_schedule_revision: Option<String>,
    last_live_revision: Option<String>,
    last_index_error: Option<String>,
}

pub fn spawn(
    config: EasyWorshipConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    images: Arc<Mutex<EasyWorshipImageCache>>,
    commands: mpsc::UnboundedReceiver<EasyWorshipCommand>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let reporter = HealthReporter::new(
            "slides-ew",
            "EasyWorship",
            "EasyWorship",
            "EasyWorship _ezwremote TCP",
            state.clone(),
            sink.clone(),
        );
        run(config, state, sink, reporter, images, commands).await;
    })
}

async fn run(
    config: EasyWorshipConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    reporter: HealthReporter,
    images: Arc<Mutex<EasyWorshipImageCache>>,
    mut commands: mpsc::UnboundedReceiver<EasyWorshipCommand>,
) {
    let mut backoff = Duration::from_millis(500);
    loop {
        reporter.connecting(format!("Connecting to EasyWorship ({})", config.endpoint_label()));
        match serve(&config, &state, &sink, &reporter, &images, &mut commands, &mut backoff).await {
            Ok(()) => {
                reporter.offline("EasyWorship command channel closed");
                return;
            }
            Err(err) => {
                mark_connection(&state, &sink, false, &err);
                reporter.error(err.clone());
                sink.log(format!("[easyworship] {err}"));
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_millis(15_000));
    }
}

/// Resolve a dialable endpoint from config or mDNS discovery.
pub async fn resolve_endpoint(config: &EasyWorshipConfig) -> Result<String, String> {
    if let Some(endpoint) = &config.endpoint {
        return Ok(endpoint.clone());
    }
    let service = discover_service(DISCOVERY_TIMEOUT).await?;
    Ok(service.endpoint())
}

/// Send one legacy-unicast mDNS PTR query and collect the first matching SRV/A answer set.
pub async fn discover_service(timeout: Duration) -> Result<DiscoveredService, String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("mDNS bind failed: {e}"))?;
    socket
        .send_to(&ptr_query(), (MDNS_GROUP, MDNS_PORT))
        .await
        .map_err(|e| format!("mDNS query send failed: {e}"))?;

    let collect = async {
        let mut buf = [0u8; 9000];
        loop {
            let (n, _) = socket
                .recv_from(&mut buf)
                .await
                .map_err(|e| format!("mDNS read failed: {e}"))?;
            if let Ok(services) = parse_response(&buf[..n]) {
                if let Some(service) = services.into_iter().next() {
                    return Ok(service);
                }
            }
        }
    };

    tokio::time::timeout(timeout, collect)
        .await
        .map_err(|_| "_ezwremote._tcp discovery timed out".to_string())?
}

async fn serve(
    config: &EasyWorshipConfig,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    reporter: &HealthReporter,
    images: &Arc<Mutex<EasyWorshipImageCache>>,
    commands: &mut mpsc::UnboundedReceiver<EasyWorshipCommand>,
    backoff: &mut Duration,
) -> Result<(), String> {
    let endpoint = resolve_endpoint(config).await?;
    let mut stream = TcpStream::connect(&endpoint)
        .await
        .map_err(|e| format!("connect {endpoint} failed: {e}"))?;

    stream
        .write_all(connect_frame(&config.uid, &config.device_name).as_bytes())
        .await
        .map_err(|e| format!("connect handshake write failed: {e}"))?;
    stream
        .write_all(action_frame("status").as_bytes())
        .await
        .map_err(|e| format!("status request write failed: {e}"))?;

    let mut line_buf = Vec::with_capacity(4096);
    let mut read_buf = [0u8; 8192];
    let mut paired = false;
    let mut session = SessionState::default();
    let mut followups: Vec<String> = Vec::new();
    let mut last_receive = tokio::time::Instant::now();
    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    heartbeat.tick().await; // consume the immediate first tick

    loop {
        tokio::select! {
            read = stream.read(&mut read_buf) => {
                let n = read.map_err(|e| format!("EasyWorship read failed: {e}"))?;
                if n == 0 {
                    return Err("EasyWorship closed the connection".into());
                }
                last_receive = tokio::time::Instant::now();
                *backoff = Duration::from_millis(500);
                line_buf.extend_from_slice(&read_buf[..n]);
                while let Some(line) = take_line(&mut line_buf) {
                    let message = parse_server_line(&line)
                        .map_err(|e| format!("invalid EasyWorship frame: {e}"))?;
                    if let ServerMessage::BinaryHeader { action, size, meta } = message {
                        let payload = consume_binary(&mut stream, &mut line_buf, size).await?;
                        match action.as_str() {
                            "ScheduleData" | "LiveData" => {
                                apply_index_payload(&action, &payload, state, sink, &mut session);
                            }
                            "slideImage" | "currentImage" => {
                                apply_image_payload(
                                    &action, &meta, &payload, state, sink, images,
                                );
                            }
                            _ => sink.log(format!(
                                "[easyworship] consumed {action} payload ({size} bytes)"
                            )),
                        }
                        continue;
                    }
                    handle_message(
                        message,
                        state,
                        sink,
                        reporter,
                        images,
                        &mut paired,
                        &endpoint,
                        &mut session,
                        &mut followups,
                    )?;
                    if !followups.is_empty() {
                        for frame in followups.drain(..) {
                            stream
                                .write_all(frame.as_bytes())
                                .await
                                .map_err(|e| format!("follow-up request write failed: {e}"))?;
                        }
                    }
                }
            }
            command = commands.recv() => {
                let Some(command) = command else { return Ok(()) };
                for frame in command_frames(command) {
                    stream
                        .write_all(frame.as_bytes())
                        .await
                        .map_err(|e| format!("command write failed: {e}"))?;
                }
            }
            _ = heartbeat.tick() => {
                stream
                    .write_all(heartbeat_frame().as_bytes())
                    .await
                    .map_err(|e| format!("heartbeat write failed: {e}"))?;
                if last_receive.elapsed() > RECEIVE_TIMEOUT {
                    return Err(format!(
                        "no EasyWorship response for {}s",
                        RECEIVE_TIMEOUT.as_secs()
                    ));
                }
            }
        }
    }
}

/// Pull the next non-empty `\n`-terminated line from the accumulator, skipping blank lines.
fn take_line(buffer: &mut Vec<u8>) -> Option<String> {
    loop {
        let pos = buffer.iter().position(|b| *b == b'\n')?;
        let line: Vec<u8> = buffer.drain(..=pos).collect();
        let text = String::from_utf8_lossy(&line).trim_end_matches('\r').trim().to_string();
        if !text.is_empty() {
            return Some(text);
        }
    }
}

async fn consume_binary<R: AsyncRead + Unpin>(
    stream: &mut R,
    line_buf: &mut Vec<u8>,
    size: usize,
) -> Result<Vec<u8>, String> {
    if size > MAX_BINARY_PAYLOAD_BYTES {
        return Err(format!(
            "EasyWorship binary payload ({size} bytes) exceeds {MAX_BINARY_PAYLOAD_BYTES}-byte limit"
        ));
    }
    let mut remaining = size;
    let mut payload = Vec::with_capacity(size.min(64 * 1024));
    // A single TCP read can contain the header, the whole binary body, and subsequent frames.
    // Drain whatever is already buffered before touching the socket again.
    if !line_buf.is_empty() {
        let n = remaining.min(line_buf.len());
        payload.extend(line_buf.drain(..n));
        remaining -= n;
    }
    let mut scratch = [0u8; 8192];
    while remaining > 0 {
        let want = remaining.min(scratch.len());
        let n = tokio::time::timeout(
            Duration::from_secs(10),
            stream.read(&mut scratch[..want]),
        )
        .await
        .map_err(|_| "timed out reading binary payload".to_string())?
        .map_err(|e| format!("binary payload read failed: {e}"))?;
        if n == 0 {
            return Err("EasyWorship closed during binary payload".into());
        }
        payload.extend_from_slice(&scratch[..n]);
        remaining -= n;
    }
    Ok(payload)
}

fn handle_message(
    message: ServerMessage,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    reporter: &HealthReporter,
    _images: &Arc<Mutex<EasyWorshipImageCache>>,
    paired: &mut bool,
    endpoint: &str,
    session: &mut SessionState,
    followups: &mut Vec<String>,
) -> Result<(), String> {
    match message {
        ServerMessage::Paired => {
            *paired = true;
            mark_connected(state, sink);
            reporter.ready(format!("Paired on {endpoint}"), 1);
            sink.log("[easyworship] Remote control paired; status stream live".into());
        }
        ServerMessage::NotPaired => {
            *paired = false;
            reporter.degraded("EasyWorship remote is not paired — approve it in the Remote popup");
            return Err("EasyWorship remote is not paired".into());
        }
        ServerMessage::Heartbeat => {
            // Server keepalive; receiving it already refreshed `last_receive` in the read loop.
        }
        ServerMessage::Status(status) => {
            request_index_and_slide_info(&status, session, followups);
            request_current_image(&status, session, followups);
            apply_status(status, state, sink);
            if *paired {
                reporter.ready(format!("Live status on {endpoint}"), 1);
            }
        }
        ServerMessage::SlideInfo(info) => {
            request_slide_image_from_info(&info, session, followups);
            apply_slide_info(info, state, sink);
        }
        ServerMessage::BinaryHeader { .. } => unreachable!("binary headers are consumed earlier"),
        ServerMessage::Other(value) => {
            let action = value["action"].as_str().unwrap_or("unknown");
            sink.log(format!("[easyworship] ignored action: {action}"));
        }
    }
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Emit the documented revision-driven follow-up requests when the live status changes.
/// Slide text is only requested when the `(rectype, pres_rowid, slide_rowid)` key changes, and
/// index payloads are only requested when their advertised revisions change.
fn request_index_and_slide_info(
    status: &crate::protocols::easyworship::EasyWorshipStatus,
    session: &mut SessionState,
    followups: &mut Vec<String>,
) {
    let key = (
        status.rectype.clone(),
        status.pres_rowid.clone(),
        status.slide_rowid.clone(),
    );
    let has_key = key.0.parse::<i64>().is_ok()
        && key.1.parse::<i64>().is_ok()
        && key.2.parse::<i64>().is_ok();
    if has_key && session.last_slide_key.as_ref() != Some(&key) {
        followups.push(get_slide_info_frame_with_revision(
            &key.0,
            &key.1,
            &key.2,
            "",
        ));
        session.last_slide_key = Some(key);
    }
    if !status.schedulerev.is_empty()
        && session.last_schedule_revision.as_deref() != Some(status.schedulerev.as_str())
    {
        followups.push(action_frame("GetScheduleData"));
        session.last_schedule_revision = Some(status.schedulerev.clone());
    }
    if !status.liverev.is_empty()
        && session.last_live_revision.as_deref() != Some(status.liverev.as_str())
    {
        followups.push(action_frame("GetLiveData"));
        session.last_live_revision = Some(status.liverev.clone());
    }
}

/// `status.imagehash` identifies the rendered live output. Request a fresh snapshot only when it
/// changes so we never poll undocumented image endpoints at every heartbeat.
fn request_current_image(
    status: &EasyWorshipStatus,
    session: &mut SessionState,
    followups: &mut Vec<String>,
) {
    if status.imagehash.is_empty()
        || session.last_imagehash.as_deref() == Some(status.imagehash.as_str())
    {
        return;
    }
    followups.push(get_current_image_frame());
    session.last_imagehash = Some(status.imagehash.clone());
}

/// `slideInfo.revision` is the documented cache hint for `getSlideImage`.
fn request_slide_image_from_info(
    info: &EasyWorshipSlideInfo,
    session: &mut SessionState,
    followups: &mut Vec<String>,
) {
    if info.slide_rowid.is_empty() {
        return;
    }
    let key = (
        info.rectype.clone(),
        info.pres_rowid.clone(),
        info.slide_rowid.clone(),
        info.revision.clone(),
    );
    if session.last_slide_image_key.as_ref() == Some(&key) {
        return;
    }
    followups.push(get_slide_image_frame(&key.0, &key.1, &key.2, &key.3));
    session.last_slide_image_key = Some(key);
}

/// Cache one documented raw JPEG body and publish only its metadata to the shared snapshot.
fn apply_image_payload(
    action: &str,
    meta: &BinaryMeta,
    payload: &[u8],
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    images: &Arc<Mutex<EasyWorshipImageCache>>,
) {
    if !is_jpeg_payload(payload) {
        sink.log(format!(
            "[easyworship] ignored {action}: payload is not a JPEG"
        ));
        return;
    }
    let source = if action == "currentImage" {
        "current"
    } else {
        "slide"
    };
    let hash = if meta.imagehash.is_empty() {
        "latest"
    } else {
        meta.imagehash.as_str()
    };
    let key = if source == "current" {
        format!("current:{hash}")
    } else {
        format!(
            "slide:{}:{}",
            if meta.slide_rowid.is_empty() {
                "unknown"
            } else {
                meta.slide_rowid.as_str()
            },
            hash
        )
    };
    if let Err(err) = images
        .lock()
        .unwrap()
        .insert(key.clone(), payload.to_vec())
    {
        sink.log(format!("[easyworship] could not cache {action}: {err}"));
        return;
    }
    let updated = now_ms();
    let slides = with_state(state, |snapshot| {
        snapshot.apply_slides(SlidesPatch {
            image: Some(PresentationImage {
                key: key.clone(),
                source: source.into(),
                imagehash: meta.imagehash.clone(),
                rectype: meta.rectype.clone(),
                pres_rowid: meta.pres_rowid.clone(),
                slide_rowid: meta.slide_rowid.clone(),
                revision: meta.revision.clone(),
                size: payload.len() as u32,
                updated_ms: updated,
            }),
            last_update_ms: Some(updated),
            adapter: Some("easyworship".into()),
            ..SlidesPatch::default()
        })
    });
    sink.state(state_patch("slides", json!({ "slides": slides })));
    sink.log(format!(
        "[easyworship] cached {source} JPEG '{key}' ({} bytes)",
        payload.len()
    ));
}

/// Apply a decoded `ScheduleData`/`LiveData` body to the shared typed slide deck.
/// Only `LiveData` owns the visible deck; `ScheduleData` is kept as a revisioned count in the
/// event log so operators can see that the service schedule synced without fabricating text.
fn apply_index_payload(
    action: &str,
    bytes: &[u8],
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    session: &mut SessionState,
) {
    match parse_index_payload(bytes) {
        Ok(payload) => {
            let item_count = payload.items.len();
            let slide_count: usize = payload.items.iter().map(|i| i.slides.len()).sum();
            if action == "LiveData" {
                let mut deck = Vec::new();
                for item in payload.items {
                    for slide in item.slides {
                        let number = (deck.len() + 1) as u32;
                        deck.push(crate::state::SlideCue {
                            id: format!("ew-slide-{}", slide.rowid),
                            number,
                            section: String::new(),
                            title: String::new(),
                            text: String::new(),
                            kind: "lyrics".into(),
                        });
                    }
                }
                let total = deck.len() as u32;
                let slides = with_state(state, |snapshot| {
                    snapshot.apply_slides(SlidesPatch {
                        slides: Some(deck),
                        total_slides: Some(total),
                        last_update_ms: Some(now_ms()),
                        adapter: Some("easyworship".into()),
                        ..SlidesPatch::default()
                    })
                });
                sink.state(state_patch("slides", json!({ "slides": slides })));
            }
            sink.log(format!(
                "[easyworship] {action} synced: {item_count} items, container rev {}, {} slides",
                payload.container_revision,
                slide_count
            ));
            session.last_index_error = None;
        }
        Err(err) => {
            let detail = format!("[easyworship] {action} index parse failed: {err}");
            session.last_index_error = Some(detail.clone());
            sink.log(detail);
        }
    }
}

fn mark_connected(state: &SharedState, sink: &Arc<dyn EventSink>) {
    let slides = with_state(state, |snapshot| {
        snapshot.apply_slides(SlidesPatch {
            connected: Some(true),
            last_update_ms: Some(now_ms()),
            adapter: Some("easyworship".into()),
            ..SlidesPatch::default()
        })
    });
    sink.state(state_patch("slides", json!({ "slides": slides })));
}

fn mark_connection(state: &SharedState, sink: &Arc<dyn EventSink>, connected: bool, reason: &str) {
    let slides = with_state(state, |snapshot| {
        snapshot.apply_slides(SlidesPatch {
            connected: Some(connected),
            last_update_ms: Some(now_ms()),
            adapter: Some("easyworship".into()),
            ..SlidesPatch::default()
        })
    });
    sink.state(state_patch(
        "slides",
        json!({ "slides": slides, "slideConnectionError": reason }),
    ));
}

fn apply_status(
    status: EasyWorshipStatus,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
) {
    let mut layers = Vec::new();
    if status.logo {
        layers.push("logo".into());
    }
    if status.black {
        layers.push("black".into());
    }
    if status.clear {
        layers.push("clear".into());
    }

    let mut patch = SlidesPatch {
        current_slide: if status.slide_no > 0 {
            Some(status.slide_no)
        } else {
            None
        },
        cleared: Some(status.clear),
        active_layers: Some(layers),
        screen: Some({
            let flags = screen_from_status(&status);
            crate::state::ScreenFlags {
                black: flags.black,
                clear: flags.clear,
                logo: flags.logo,
            }
        }),
        connected: Some(true),
        last_update_ms: Some(now_ms()),
        adapter: Some("easyworship".into()),
        ..SlidesPatch::default()
    };
    // A logical live presentation is always "playing" from the remote's point of view; the
    // detailed media transport state is E1. Keep the layer name honest.
    patch.playback = Some(crate::state::PlaybackState {
        layer: "live".into(),
        is_playing: !status.black && !status.clear,
        ..crate::state::PlaybackState::default()
    });

    let slides = with_state(state, |snapshot| snapshot.apply_slides(patch));
    sink.state(state_patch("slides", json!({ "slides": slides })));
}

fn apply_slide_info(
    info: EasyWorshipSlideInfo,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
) {
    let mut patch = SlidesPatch {
        last_update_ms: Some(now_ms()),
        adapter: Some("easyworship".into()),
        ..SlidesPatch::default()
    };
    if !info.title.is_empty() {
        patch.presentation_name = Some(info.title);
    }
    if !info.content.is_empty() {
        patch.current_text = Some(info.content);
    }
    if !info.notes.is_empty() {
        patch.current_notes = Some(info.notes);
    }
    let slides = with_state(state, |snapshot| snapshot.apply_slides(patch));
    sink.state(state_patch("slides", json!({ "slides": slides })));
}

fn command_frames(command: EasyWorshipCommand) -> Vec<String> {
    let status_refresh = action_frame("status");
    match command {
        EasyWorshipCommand::NextSlide => vec![action_frame("nextSlide"), status_refresh],
        EasyWorshipCommand::PreviousSlide => vec![action_frame("prevSlide"), status_refresh],
        EasyWorshipCommand::NextBuild => vec![action_frame("nextBuild"), status_refresh],
        EasyWorshipCommand::PreviousBuild => vec![action_frame("prevBuild"), status_refresh],
        EasyWorshipCommand::NextSchedule => vec![action_frame("nextSchedule"), status_refresh],
        EasyWorshipCommand::PreviousSchedule => vec![action_frame("prevSchedule"), status_refresh],
        EasyWorshipCommand::GoToSlide(index) => match goto_slide_frame(index) {
            Some(frame) => vec![frame, status_refresh],
            None => vec![],
        },
        EasyWorshipCommand::GoToSchedule(index) => match goto_schedule_frame(index) {
            Some(frame) => vec![frame, status_refresh],
            None => vec![],
        },
        EasyWorshipCommand::GoToStartSlide => {
            vec![action_frame("gotoStartSlide"), status_refresh]
        }
        EasyWorshipCommand::GoToStartPresentation => {
            vec![action_frame("gotoStartPresentation"), status_refresh]
        }
        EasyWorshipCommand::Refresh => vec![status_refresh],
        EasyWorshipCommand::Toggle => vec![action_frame("Toggle"), status_refresh],
        EasyWorshipCommand::Play => vec![action_frame("Play"), status_refresh],
        EasyWorshipCommand::Pause => vec![action_frame("Pause"), status_refresh],
        EasyWorshipCommand::GetScheduleData => vec![action_frame("GetScheduleData")],
        EasyWorshipCommand::GetLiveData => vec![action_frame("GetLiveData")],
        EasyWorshipCommand::GetSlideInfo {
            rectype,
            pres_rowid,
            slide_rowid,
            requestrev,
        } => vec![get_slide_info_frame_with_revision(
            &rectype,
            &pres_rowid,
            &slide_rowid,
            &requestrev,
        )],
        EasyWorshipCommand::GetSlideImage {
            rectype,
            pres_rowid,
            slide_rowid,
            revision,
        } => vec![get_slide_image_frame(
            &rectype,
            &pres_rowid,
            &slide_rowid,
            &revision,
        )],
        EasyWorshipCommand::GetCurrentImage => vec![get_current_image_frame()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocols::easyworship::DEVICE_TYPE_COMPANION;
    use crate::runtime::events::RecordingSink;
    use crate::state::default_simulator_state;
    use std::sync::Mutex;

    fn fixture() -> (SharedState, Arc<RecordingSink>) {
        (
            Arc::new(Mutex::new(default_simulator_state())),
            Arc::new(RecordingSink::new()),
        )
    }

    fn image_store() -> Arc<Mutex<EasyWorshipImageCache>> {
        Arc::new(Mutex::new(EasyWorshipImageCache::default()))
    }

    #[test]
    fn take_line_handles_crlf_and_partial_buffers() {
        let mut buffer = Vec::new();
        assert!(take_line(&mut buffer).is_none());
        buffer.extend_from_slice(b"{\"action\":\"paired\"}\r");
        assert!(take_line(&mut buffer).is_none());
        buffer.push(b'\n');
        assert_eq!(take_line(&mut buffer).as_deref(), Some("{\"action\":\"paired\"}"));
        assert!(buffer.is_empty());
    }

    #[test]
    fn command_frames_include_status_refresh() {
        let frames = command_frames(EasyWorshipCommand::NextSlide);
        assert_eq!(frames[0], "{\"action\":\"nextSlide\"}\n");
        assert_eq!(frames[1], "{\"action\":\"status\"}\n");

        let frames = command_frames(EasyWorshipCommand::GoToSchedule(5));
        assert_eq!(frames[0], "{\"action\":\"gotoSchedule5\"}\n");
        assert_eq!(frames.len(), 2);

        assert!(command_frames(EasyWorshipCommand::GoToSlide(0)).is_empty());

        let frames = command_frames(EasyWorshipCommand::GetCurrentImage);
        assert_eq!(frames, vec!["{\"action\":\"getCurrentImage\"}\n"]);
        let frames = command_frames(EasyWorshipCommand::GetSlideImage {
            rectype: "0".into(),
            pres_rowid: "12".into(),
            slide_rowid: "3".into(),
            revision: "rev-1".into(),
        });
        assert!(frames[0].contains("\"action\":\"getSlideImage\""));
        assert!(frames[0].contains("\"revision\":\"rev-1\""));
    }

    #[test]
    fn image_followups_only_fire_when_hashes_or_revisions_change() {
        let mut session = SessionState::default();
        let mut followups = Vec::new();
        let status = EasyWorshipStatus {
            imagehash: "hash-1".into(),
            ..EasyWorshipStatus::default()
        };
        request_current_image(&status, &mut session, &mut followups);
        assert_eq!(followups, vec!["{\"action\":\"getCurrentImage\"}\n"]);
        followups.clear();
        request_current_image(&status, &mut session, &mut followups);
        assert!(followups.is_empty());

        let info = EasyWorshipSlideInfo {
            rectype: "0".into(),
            pres_rowid: "12".into(),
            slide_rowid: "3".into(),
            revision: "rev-1".into(),
            ..EasyWorshipSlideInfo::default()
        };
        request_slide_image_from_info(&info, &mut session, &mut followups);
        assert!(followups[0].contains("\"revision\":\"rev-1\""));
        followups.clear();
        request_slide_image_from_info(&info, &mut session, &mut followups);
        assert!(followups.is_empty());
    }

    #[test]
    fn image_cache_is_bounded_and_replaces_the_same_key() {
        let mut cache = EasyWorshipImageCache::default();
        cache.insert("a".into(), vec![0xff, 0xd8, 0xff, 1]).unwrap();
        cache.insert("b".into(), vec![0xff, 0xd8, 0xff, 2]).unwrap();
        cache.insert("a".into(), vec![0xff, 0xd8, 0xff, 3]).unwrap();
        assert_eq!(cache.get("a"), Some(vec![0xff, 0xd8, 0xff, 3]));
        assert_eq!(cache.order, vec!["b".to_string(), "a".to_string()]);

        let oversized = vec![0u8; MAX_IMAGE_BYTES + 1];
        assert!(cache.insert("big".into(), oversized).is_err());
        assert!(cache.get("big").is_none());
    }

    #[test]
    fn image_payload_updates_typed_metadata_and_cache() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        let images = image_store();
        let jpeg = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9];
        let meta = BinaryMeta {
            imagehash: "hash-1".into(),
            slide_rowid: "3".into(),
            ..BinaryMeta::default()
        };
        apply_image_payload("currentImage", &meta, &jpeg, &state, &events, &images);

        let slides = with_state(&state, |s| s.slides.clone());
        let image = slides.image.expect("image metadata published");
        assert_eq!(image.source, "current");
        assert_eq!(image.key, "current:hash-1");
        assert_eq!(image.size, jpeg.len() as u32);
        assert_eq!(images.lock().unwrap().get(&image.key), Some(jpeg.to_vec()));

        apply_image_payload("currentImage", &meta, b"not jpeg", &state, &events, &images);
        let slides = with_state(&state, |s| s.slides.clone());
        assert_eq!(slides.image.expect("image").key, "current:hash-1");
    }

    #[test]
    fn config_resolves_static_endpoint_without_discovery() {
        let config = EasyWorshipConfig::new("10.1.24.25:55123");
        let endpoint = tokio_test_runtime().block_on(resolve_endpoint(&config)).unwrap();
        assert_eq!(endpoint, "10.1.24.25:55123");
        assert_eq!(config.endpoint_label(), "10.1.24.25:55123");
    }

    fn tokio_test_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn paired_and_status_patch_slide_state() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        let reporter = HealthReporter::new(
            "slides-ew-test",
            "EasyWorship",
            "EasyWorship",
            "test",
            state.clone(),
            events.clone(),
        );
        let mut paired = false;
        let mut session = SessionState::default();
        let mut followups = Vec::new();
        handle_message(
            ServerMessage::Paired,
            &state,
            &events,
            &reporter,
            &image_store(),
            &mut paired,
            "127.0.0.1:55123",
            &mut session,
            &mut followups,
        )
        .unwrap();
        assert!(paired);

        let status = crate::protocols::easyworship::EasyWorshipStatus {
            black: false,
            clear: false,
            logo: true,
            slide_no: 7,
            ..crate::protocols::easyworship::EasyWorshipStatus::default()
        };
        handle_message(
            ServerMessage::Status(status),
            &state,
            &events,
            &reporter,
            &image_store(),
            &mut paired,
            "127.0.0.1:55123",
            &mut session,
            &mut followups,
        )
        .unwrap();

        let slides = with_state(&state, |s| s.slides.clone());
        assert_eq!(slides.current_slide, 7);
        assert_eq!(slides.adapter, "easyworship");
        assert!(slides.connected);
        assert!(slides.active_layers.contains(&"logo".to_string()));
        assert!(slides.screen.logo);
        assert!(!slides.screen.black);
        assert!(!slides.screen.clear);
    }

    #[tokio::test]
    async fn not_paired_is_a_reconnectable_error() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        let reporter = HealthReporter::new(
            "slides-ew-test-2",
            "EasyWorship",
            "EasyWorship",
            "test",
            state.clone(),
            events.clone(),
        );
        let mut paired = true;
        let mut session = SessionState::default();
        let mut followups = Vec::new();
        let err = handle_message(
            ServerMessage::NotPaired,
            &state,
            &events,
            &reporter,
            &image_store(),
            &mut paired,
            "127.0.0.1:55123",
            &mut session,
            &mut followups,
        )
        .unwrap_err();
        assert!(err.contains("not paired"));
        assert!(!paired);
    }

    #[tokio::test]
    async fn binary_payload_is_consumed_before_next_frame() {
        let (mut server, client) = tokio::io::duplex(8192);
        let mut stream = client;
        let writer = tokio::spawn(async move {
            server.write_all(b"{\"action\":\"ScheduleData\",\"size\":4}\r\n").await.unwrap();
            server.write_all(&[1, 2, 3, 4]).await.unwrap();
            server.write_all(b"{\"action\":\"paired\"}\r\n").await.unwrap();
        });

        let mut line_buf = Vec::new();
        let mut read_buf = [0u8; 64];
        let mut saw_paired = false;
        for _ in 0..8 {
            let n = stream.read(&mut read_buf).await.unwrap();
            if n == 0 {
                break;
            }
            line_buf.extend_from_slice(&read_buf[..n]);
            while let Some(line) = take_line(&mut line_buf) {
                match parse_server_line(&line).unwrap() {
                    ServerMessage::BinaryHeader { size, .. } => {
                        consume_binary(&mut stream, &mut line_buf, size).await.unwrap();
                    }
                    ServerMessage::Paired => saw_paired = true,
                    _ => {}
                }
            }
            if saw_paired {
                break;
            }
        }
        writer.await.unwrap();
        assert!(saw_paired);
        assert_eq!(DEVICE_TYPE_COMPANION, 8);
    }

    #[test]
    fn status_changes_request_index_and_slide_info_once() {
        let mut session = SessionState::default();
        let mut followups = Vec::new();
        let status = crate::protocols::easyworship::EasyWorshipStatus {
            rectype: "0".into(),
            pres_rowid: "12".into(),
            slide_rowid: "3".into(),
            schedulerev: "45".into(),
            liverev: "108".into(),
            slide_no: 2,
            ..Default::default()
        };
        request_index_and_slide_info(&status, &mut session, &mut followups);
        assert_eq!(followups.len(), 3);
        assert!(followups[0].contains("getSlideInfo"));
        assert!(followups[1].contains("GetScheduleData"));
        assert!(followups[2].contains("GetLiveData"));

        followups.clear();
        request_index_and_slide_info(&status, &mut session, &mut followups);
        assert!(followups.is_empty());

        let mut changed = status.clone();
        changed.slide_rowid = "4".into();
        request_index_and_slide_info(&changed, &mut session, &mut followups);
        assert_eq!(followups.len(), 1);
        assert!(followups[0].contains("\"slide_rowid\":\"4\""));
    }

    #[test]
    fn live_index_payload_populates_typed_deck() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        let mut session = SessionState::default();
        let mut bytes = 1i32.to_le_bytes().to_vec();
        bytes.extend(46i64.to_le_bytes());
        bytes.extend(20i64.to_le_bytes());
        bytes.extend(3i64.to_le_bytes());
        bytes.push(1);
        bytes.extend(2i32.to_le_bytes());
        bytes.extend(101i64.to_le_bytes());
        bytes.extend(6i64.to_le_bytes());
        bytes.extend(2i64.to_le_bytes());
        bytes.extend(7i64.to_le_bytes());
        bytes.extend(9i64.to_le_bytes());

        apply_index_payload("LiveData", &bytes, &state, &events, &mut session);
        let slides = with_state(&state, |s| s.slides.clone());
        assert_eq!(slides.total_slides, 2);
        let deck = slides.slides.expect("typed deck exists");
        assert_eq!(deck.len(), 2);
        assert_eq!(deck[0].id, "ew-slide-6");
        assert_eq!(deck[1].number, 2);
        assert_eq!(deck[0].kind, "lyrics");
        assert!(session.last_index_error.is_none());
    }

    #[test]
    fn command_frames_cover_transport_and_index_actions() {
        let frames = command_frames(EasyWorshipCommand::GoToStartSlide);
        assert_eq!(frames[0], "{\"action\":\"gotoStartSlide\"}\n");
        let frames = command_frames(EasyWorshipCommand::GoToStartPresentation);
        assert_eq!(frames[0], "{\"action\":\"gotoStartPresentation\"}\n");
        for (command, action) in [
            (EasyWorshipCommand::Toggle, "Toggle"),
            (EasyWorshipCommand::Play, "Play"),
            (EasyWorshipCommand::Pause, "Pause"),
            (EasyWorshipCommand::GetScheduleData, "GetScheduleData"),
            (EasyWorshipCommand::GetLiveData, "GetLiveData"),
        ] {
            assert_eq!(command_frames(command)[0], action_frame(action));
        }
        let frames = command_frames(EasyWorshipCommand::GetSlideInfo {
            rectype: "0".into(),
            pres_rowid: "12".into(),
            slide_rowid: "3".into(),
            requestrev: "5".into(),
        });
        assert!(frames[0].contains("\"requestrev\":\"5\""));
    }
}
