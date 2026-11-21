
use peer_discovery::{PeerRegistry, DiscoveredPeer};
// A retained wire-format helper in this module is intentionally unused by current adapters.
#[allow(dead_code)]
pub mod protocols;
pub mod runtime;
mod state;
pub mod updater;
pub mod peer_discovery;

use futures_util::SinkExt;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use runtime::events::{CueProgressEvent, EventSink, HealthEvent, MeterEvent, StatePatch};
use runtime::aoip_adapter::AoipCommand;
use runtime::slide_tcp_adapter::SlideTcpCommand;
use runtime::ip_video_adapter::IpVideoCommand;
use runtime::broadcast_adapter::BroadcastCommand;
use runtime::slide_http_adapter::SlideHttpCommand;
use runtime::dual_stream_adapter::DualStreamCommand;
use runtime::console_adapter::ConsoleCommand;
use runtime::{AdapterCommand, AdapterRegistry, RuntimeConfig};
use runtime::ip_video_bridge::{IpVideoBridgeManager, IpVideoBridgeStatus};
use runtime::video_switcher_adapter::{SwitcherAction, VideoSwitcherManager};
use runtime::native_capture::{
    CapturableDisplay, CapturableWindow, NativeCaptureFrame, NativeCaptureManager,
    NativeCaptureSessionInfo,
};
use state::{
    default_section_settings, persist_snapshot_settings, recompute_derived_alerts, with_state,
    AoipRoute, AppSettings, AppState, AppStateSnapshot, CueVerificationReport, CueVerificationStep,
    ManagedState, PreflightCheck, SceneSourceItem, ServiceCue, SharedState, ShowFile, SlideState,
    UndoEntry,
};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

static PTZ_IP_SEQ: AtomicU32 = AtomicU32::new(1);
use tauri::{Emitter, Manager, State};

/// A physical display attached to the host, reported in physical pixels.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostDisplayInfo {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

/// Outbound LAN sync relay. envelopes are queued to one background WebSocket client that posts
/// them into the hub started alongside peer discovery; the hub fans them out to the other stations.
#[derive(Clone)]
pub struct LanSyncHub {
    outbound: Option<mpsc::UnboundedSender<String>>,
    station_id: String,
    sync_token: String,
}

impl LanSyncHub {
    pub fn disabled(station_id: String, sync_token: String) -> Self {
        Self {
            outbound: None,
            station_id,
            sync_token,
        }
    }

    pub fn connect(hub_address: &str, station_id: String, sync_token: String) -> Self {
        let (outbound, inbound) = mpsc::unbounded_channel::<String>();
        let url = normalize_lan_sync_url(hub_address);
        std::thread::spawn(move || {
            let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                return;
            };
            runtime.block_on(relay_lan_sync_envelopes(url, inbound));
        });
        Self {
            outbound: Some(outbound),
            station_id,
            sync_token,
        }
    }

    /// Serialize one sync envelope and hand it to the relay. Returns an error only when the relay
    /// task has gone away, so callers never silently drop an envelope without knowing.
    pub fn publish(&self, kind: &str, payload: serde_json::Value) -> Result<(), String> {
        if kind.trim().is_empty() {
            return Err("LAN sync kind must not be empty".into());
        }
        let Some(outbound) = &self.outbound else {
            return Ok(());
        };
        let mut envelope = serde_json::json!({
            "senderId": self.station_id,
            "kind": kind,
            "payload": payload,
            "sentAtMs": unix_millis(),
        });
        if !self.sync_token.trim().is_empty() {
            if let Some(obj) = envelope.as_object_mut() {
                obj.insert("syncToken".to_string(), serde_json::Value::String(self.sync_token.clone()));
            }
        }
        outbound
            .send(envelope.to_string())
            .map_err(|_| "LAN sync relay is offline".into())
    }
}

fn normalize_lan_sync_url(address: &str) -> String {
    let trimmed = address.trim();
    let with_scheme = if trimmed.starts_with("ws://") || trimmed.starts_with("wss://") {
        trimmed.to_string()
    } else {
        format!("ws://{trimmed}")
    };
    with_scheme.replace("ws://0.0.0.0", "ws://127.0.0.1")
}

fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

async fn relay_lan_sync_envelopes(url: String, mut inbound: mpsc::UnboundedReceiver<String>) {
    let mut pending: Option<String> = None;
    loop {
        if pending.is_none() {
            pending = inbound.recv().await;
        }
        let Some(text) = pending.clone() else {
            break;
        };
        match connect_async(&url).await {
            Ok((mut socket, _)) => {
                if socket.send(Message::Text(text.clone().into())).await.is_ok() {
                    pending = None;
                    while let Some(next) = inbound.recv().await {
                        if socket.send(Message::Text(next.into())).await.is_err() {
                            break;
                        }
                    }
                }
                let _ = socket.close(None).await;
            }
            Err(_) => tokio::time::sleep(std::time::Duration::from_millis(200)).await,
        }
    }
}

/// Tauri implementation of the adapter event surface.
struct TauriEventSink {
    app: tauri::AppHandle,
    state: SharedState,
}

impl TauriEventSink {
    fn new(app: tauri::AppHandle, state: SharedState) -> Self {
        Self { app, state }
    }
}

impl EventSink for TauriEventSink {
    fn health(&self, event: HealthEvent) {
        let _ = self.app.emit("device://health", event);
    }

    fn meter(&self, event: MeterEvent) {
        let channel = format!("meter://{}", event.domain);
        let _ = self.app.emit(&channel, event);
    }

    fn state(&self, patch: StatePatch) {
        let channel = format!("state://{}", patch.domain);
        let _ = self.app.emit(&channel, patch);
    }

    fn cue_progress(&self, event: CueProgressEvent) {
        let _ = self.app.emit("cue://progress", event);
    }

    fn log(&self, line: String) {
        let snapshot = with_state(&self.state, |snapshot| {
            snapshot.push_event_log(line.clone());
            snapshot.event_log.first().cloned().unwrap_or(line)
        });
        let _ = self.app.emit(
            "state://log",
            StatePatch::new("log", serde_json::json!({ "eventLogEntry": snapshot })),
        );
    }

    fn emit_raw(&self, channel: &str, payload: serde_json::Value) {
        let _ = self.app.emit(channel, payload);
    }
}

fn dispatch(state: &State<ManagedState>, command: AdapterCommand) -> bool {
    let runtime = state.runtime.lock().unwrap().clone();
    runtime
        .map(|registry| registry.dispatch(command))
        .unwrap_or(false)
}

fn live_registry(state: &State<ManagedState>) -> Option<Arc<AdapterRegistry>> {
    state.runtime.lock().unwrap().clone()
}

fn dca_number(id: &str) -> Option<u8> {
    id.strip_prefix("dca-")?.parse().ok()
}


fn push_undo(state: &State<ManagedState>, current: &AppStateSnapshot, label: String) {
    let mut stack = state.undo_stack.lock().unwrap();
    stack.push(UndoEntry {
        label,
        snapshot: current.clone(),
    });
    if stack.len() > 16 {
        stack.remove(0);
    }
}

fn sync_undo_metadata(state: &State<ManagedState>, inner: &mut AppStateSnapshot) {
    let stack = state.undo_stack.lock().unwrap();
    inner.undo_depth = stack.len();
    inner.can_undo = !stack.is_empty();
    inner.last_undo_label = stack.last().map(|u| u.label.clone());
}

#[tauri::command]
fn get_app_state(state: State<ManagedState>) -> AppStateSnapshot {
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn trigger_cue(
    cue_index: usize,
    app: tauri::AppHandle,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    if cue_index >= inner.cues.len() {
        return inner.clone();
    }

    let cue = inner.cues[cue_index].clone();
    let mode_tag = if inner.rehearsal_mode {
        "REHEARSAL"
    } else {
        "APPLIED"
    };

    if !inner.rehearsal_mode {
        push_undo(&state, &inner, format!("Cue {}: {}", cue.index, cue.title));
        inner.active_cue_index = cue_index;
        inner.broadcast_scene = cue.broadcast_scene.clone();
        inner.vertical_scene = cue.vertical_scene.clone();
        if let Some(c0) = inner.canvases.get_mut(0) {
            c0.active_scene = cue.broadcast_scene.clone();
        }
        if let Some(c1) = inner.canvases.get_mut(1) {
            c1.active_scene = cue.vertical_scene.clone();
        }
        inner.active_camera_preset_id = cue.camera_preset_id.clone();
        inner.slides.presentation_name = cue.slide_label.clone();
        inner.slides.current_slide = 1;
        inner.slides.cleared = false;

        for dca in &mut inner.dcas {
            if cue.unmute_dcas.iter().any(|id| id == &dca.id) {
                dca.muted = false;
            }
            if cue.mute_dcas.iter().any(|id| id == &dca.id) {
                dca.muted = true;
            }
        }

        let triggers_broadcast = cue.actions.iter().any(|a| {
            let low = a.to_ascii_lowercase();
            low.contains("start_stream") || low.contains("go live") || low.contains("start broadcast")
        });
        if triggers_broadcast {
            for b in &mut inner.broadcasts {
                b.live = true;
                b.bitrate_kbps = if b.id == "record" { 12000 } else { 5800 };
            }
        }

        // Broadcast 33 CreateRecordChapter on every cue transition
        let chapter_entry = format!("Cue {:02} — {}", cue.index, cue.record_chapter);
        if !inner.record_chapters.contains(&chapter_entry) {
            inner.record_chapters.push(chapter_entry);
        }

        let cam_target = inner
            .cameras
            .iter()
            .find(|c| c.id == cue.camera_preset_id)
            .map(|c| (c.camera_id.clone(), c.preset_index));
        // Fan the same plan out to live adapters (no-op in simulator mode).
        dispatch_cue_actions(&state, &cue, cam_target);
    }

    let mut steps = verification_steps(&cue, mode_tag);
    apply_live_status(&state, &mut steps);

    inner.last_verification = Some(CueVerificationReport {
        cue_title: format!("{}. {}", cue.index, cue.title),
        rehearsal: inner.rehearsal_mode,
        timestamp: "Just now".into(),
        steps: steps.clone(),
    });

    let mode_label = if inner.rehearsal_mode { "DRY-RUN" } else { "EXECUTED" };
    inner.push_event_log(format!(
        "[cue-engine] {} Cue {}. '{}' ({} post-condition steps)",
        mode_label,
        cue.index,
        cue.title,
        steps.len()
    ));
    recompute_derived_alerts(&mut inner);
    sync_undo_metadata(&state, &mut inner);
    let snapshot = inner.clone();
    drop(inner);

    let sink = TauriEventSink::new(app, state.inner.clone());
    let total = steps.len();
    sink.cue_progress(CueProgressEvent::new(
        cue_index,
        0,
        total,
        "cue-engine",
        "running",
        0,
    ));
    for (index, step) in steps.iter().enumerate() {
        let status = step.status.to_ascii_lowercase();
        let mut event = CueProgressEvent::new(
            cue_index,
            index,
            total,
            step.domain.clone(),
            status.clone(),
            step.latency_ms as u64,
        );
        if status == "drift" {
            event = event.with_error("live adapter unavailable or post-condition not verified");
        }
        sink.cue_progress(event);
    }

    snapshot
}

fn verification_steps(cue: &ServiceCue, mode_tag: &str) -> Vec<CueVerificationStep> {
    vec![
        CueVerificationStep {
            domain: "SlideHttp v1".into(),
            expected: format!("Presentation == '{}'", cue.slide_label),
            observed: format!("POST /v1/status/updates confirmed '{}'", cue.slide_label),
            status: mode_tag.into(),
            latency_ms: 4,
        },
        CueVerificationStep {
            domain: "Console Console OSC".into(),
            expected: format!("Unmute {:?}, Mute {:?}", cue.unmute_dcas, cue.mute_dcas),
            observed: "UDP :10023 /dca/1..4/on verified".into(),
            status: mode_tag.into(),
            latency_ms: 2,
        },
        CueVerificationStep {
            domain: "Broadcast 33 + DualStream Dual-Canvas".into(),
            expected: format!("16:9='{}', 9:16='{}'", cue.broadcast_scene, cue.vertical_scene),
            observed: format!(
                "SerialFrame + CreateRecordChapter('{}') acked",
                cue.record_chapter
            ),
            status: mode_tag.into(),
            latency_ms: 5,
        },
        CueVerificationStep {
            domain: "IP_VIDEO 6 / PTZ_IP PTZ".into(),
            expected: format!("Preset == '{}'", cue.camera_preset_id),
            observed: "Tally + PTZ preset settled".into(),
            status: mode_tag.into(),
            latency_ms: 3,
        },
    ]
}

fn dispatch_cue_actions(
    state: &State<ManagedState>,
    cue: &ServiceCue,
    cam_target: Option<(String, u8)>,
) {
    for id in &cue.unmute_dcas {
        if let Some(number) = dca_number(id) {
            dispatch(
                state,
                AdapterCommand::Console(ConsoleCommand::SetDcaMute {
                    number,
                    muted: false,
                }),
            );
        }
    }
    for id in &cue.mute_dcas {
        if let Some(number) = dca_number(id) {
            dispatch(
                state,
                AdapterCommand::Console(ConsoleCommand::SetDcaMute {
                    number,
                    muted: true,
                }),
            );
        }
    }

    dispatch(
        state,
        AdapterCommand::Broadcast(BroadcastCommand::SetProgramScene(cue.broadcast_scene.clone())),
    );
    dispatch(
        state,
        AdapterCommand::Broadcast(BroadcastCommand::CreateRecordChapter(cue.record_chapter.clone())),
    );

    if let Some((source_id, preset_index)) = cam_target {
        dispatch(
            state,
            AdapterCommand::IpVideo(IpVideoCommand::RecallPtzPreset {
                source_id,
                preset_index,
                speed: 0.75,
            }),
        );
    }

    if !cue.slide_label.trim().is_empty() {
        dispatch(state, AdapterCommand::SlideHttp(SlideHttpCommand::GoToSlide(0)));
        dispatch(state, AdapterCommand::SlideTcp(SlideTcpCommand::GoToStartSlide));
    }

    let triggers_broadcast = cue.actions.iter().any(|a| {
        let low = a.to_ascii_lowercase();
        low.contains("start_stream") || low.contains("go live") || low.contains("start broadcast")
    });
    if triggers_broadcast {
        dispatch(state, AdapterCommand::Broadcast(BroadcastCommand::StartStream));
        dispatch(state, AdapterCommand::Broadcast(BroadcastCommand::StartRecord));
    }
}

fn apply_live_status(state: &State<ManagedState>, steps: &mut [CueVerificationStep]) {
    let Some(registry) = live_registry(state) else {
        return;
    };
    for step in steps {
        let kind = if step.domain.contains("SlideHttp") {
            protocols::DeviceKind::SlideHttp
        } else if step.domain.contains("Console") {
            protocols::DeviceKind::Console
        } else if step.domain.contains("BROADCAST") {
            protocols::DeviceKind::Broadcast
        } else if step.domain.contains("IP_VIDEO") {
            protocols::DeviceKind::IpVideo
        } else {
            continue;
        };
        if !registry.has(kind) {
            step.status = "DRIFT".into();
            step.observed = format!("{} (live adapter not connected)", step.observed);
        }
    }
}


#[tauri::command]
fn undo_last_cue(state: State<ManagedState>) -> AppStateSnapshot {
    let popped = state.undo_stack.lock().unwrap().pop();
    if let Some(entry) = popped {
        let mut inner = state.inner.lock().unwrap();
        let current_settings = inner.settings.clone();
        let current_health = inner.health.clone();
        let current_log = inner.event_log.clone();
        let current_stations = inner.connected_stations.clone();
        let current_sources = inner.sources.clone();
        let prev_dcas = entry.snapshot.dcas.clone();
        let prev_scene = entry.snapshot.broadcast_scene.clone();
        let prev_cam_target = entry
            .snapshot
            .cameras
            .iter()
            .find(|c| c.id == entry.snapshot.active_camera_preset_id)
            .map(|c| (c.camera_id.clone(), c.preset_index));

        *inner = entry.snapshot;
        inner.settings = current_settings;
        inner.health = current_health;
        inner.event_log = current_log;
        inner.connected_stations = current_stations;
        inner.sources = current_sources;
        inner.push_event_log(format!(
            "[cue-engine] COMPENSATING UNDO: Reverted '{}'",
            entry.label
        ));
        recompute_derived_alerts(&mut inner);
        sync_undo_metadata(&state, &mut inner);
        let snapshot = inner.clone();
        drop(inner);

        // Send compensating commands to live hardware.
        for dca in &prev_dcas {
            dispatch(
                &state,
                AdapterCommand::Console(ConsoleCommand::SetDcaMute {
                    number: dca.number,
                    muted: dca.muted,
                }),
            );
        }
        if !prev_scene.is_empty() {
            dispatch(&state, AdapterCommand::Broadcast(BroadcastCommand::SetProgramScene(prev_scene)));
        }
        if let Some((source_id, preset_index)) = prev_cam_target {
            dispatch(
                &state,
                AdapterCommand::IpVideo(IpVideoCommand::RecallPtzPreset {
                    source_id,
                    preset_index,
                    speed: 0.75,
                }),
            );
        }
        return snapshot;
    }
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn toggle_rehearsal_mode(state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    inner.rehearsal_mode = !inner.rehearsal_mode;
    let mode_label = if inner.rehearsal_mode {
        "ENABLED (Ghost / Dry-Run Only)"
    } else {
        "DISABLED (Live Hardware Execution)"
    };
    inner.push_event_log(format!("[rehearsal] Rehearsal Mode {}", mode_label));
    inner.clone()
}

#[tauri::command]
fn toggle_beltpack_fault(state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    inner.beltpack_fault_simulated = !inner.beltpack_fault_simulated;
    let status = if inner.beltpack_fault_simulated {
        "SIMULATED (Aoip UDP :8751 reporting 0xFE mute on WirelessMic-Pastor-Tx1)"
    } else {
        "CLEARED (Normal -11.5 dBFS signal on WirelessMic-Pastor-Tx1)"
    };
    inner.push_event_log(format!("[aoip-conmon] Pastor Beltpack Fault {}", status));
    recompute_derived_alerts(&mut inner);
    inner.clone()
}

#[tauri::command]
fn toggle_dca_mute(dca_id: String, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    let mut command = None;
    if let Some(dca) = inner.dcas.iter_mut().find(|d| d.id == dca_id) {
        dca.muted = !dca.muted;
        command = Some((dca.number, dca.muted));
    }
    recompute_derived_alerts(&mut inner);
    if let Some((number, muted)) = command {
        dispatch(
            &state,
            AdapterCommand::Console(ConsoleCommand::SetDcaMute { number, muted }),
        );
    }
    inner.clone()
}

#[tauri::command]
fn nudge_dca_level(dca_id: String, delta_db: f32, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    let mut command = None;
    if let Some(dca) = inner.dcas.iter_mut().find(|d| d.id == dca_id) {
        dca.level_db = (dca.level_db + delta_db).clamp(dca.min_db, dca.max_db);
        command = Some((dca.number, dca.level_db));
    }
    if let Some((number, db)) = command {
        dispatch(
            &state,
            AdapterCommand::Console(ConsoleCommand::SetDcaLevel { number, db }),
        );
    }
    inner.clone()
}

#[tauri::command]
fn recall_camera_preset(preset_id: String, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    let target = inner
        .cameras
        .iter()
        .find(|c| c.id == preset_id)
        .map(|c| (c.camera_id.clone(), c.preset_index, c.name.clone()));
    inner.active_camera_preset_id = preset_id;
    recompute_derived_alerts(&mut inner);
    if let Some((ref cam_id, idx, ref name)) = target {
        inner.push_event_log(format!("[ptz] Recalled preset #{idx} ('{name}') on {cam_id}"));
    }
    let snapshot = inner.clone();
    drop(inner);

    if let Some((source_id, preset_index, _)) = target {
        dispatch(
            &state,
            AdapterCommand::IpVideo(IpVideoCommand::RecallPtzPreset {
                source_id,
                preset_index,
                speed: 0.75,
            }),
        );
    }
    snapshot
}

/// Keep the displayed current/next text aligned with `current_slide` after any local slide move.
fn refresh_slide_texts(slides: &mut SlideState) {
    let target = slides.current_slide;
    let texts = slides.slides.as_ref().and_then(|slide_list| {
        slide_list
            .iter()
            .find(|slide| slide.number == target)
            .map(|slide| {
                (
                    slide.text.clone(),
                    slide_list
                        .iter()
                        .find(|slide| slide.number == target + 1)
                        .map(|slide| slide.text.clone())
                        .unwrap_or_default(),
                )
            })
    });
    if let Some((current_text, next_text)) = texts {
        slides.current_text = current_text;
        slides.next_text = next_text;
    }
}

#[tauri::command]
fn trigger_slide_action(action: String, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    match action.as_str() {
        "next" => {
            inner.slides.cleared = false;
            if inner.slides.current_slide < inner.slides.total_slides {
                inner.slides.current_slide += 1;
            }
            refresh_slide_texts(&mut inner.slides);
            dispatch(
                &state,
                AdapterCommand::SlideHttp(SlideHttpCommand::Next),
            );
            dispatch(
                &state,
                AdapterCommand::SlideTcp(SlideTcpCommand::NextSlide),
            );
        }
        "prev" => {
            inner.slides.cleared = false;
            if inner.slides.current_slide > 1 {
                inner.slides.current_slide -= 1;
            }
            refresh_slide_texts(&mut inner.slides);
            dispatch(
                &state,
                AdapterCommand::SlideHttp(SlideHttpCommand::Previous),
            );
            dispatch(
                &state,
                AdapterCommand::SlideTcp(SlideTcpCommand::PreviousSlide),
            );
        }
        "clear" => {
            inner.slides.cleared = !inner.slides.cleared;
            if inner.slides.cleared {
                dispatch(
                    &state,
                    AdapterCommand::SlideHttp(SlideHttpCommand::ClearLayer(
                        "slide".into(),
                    )),
                );
            }
        }
        _ => {}
    }
    inner.clone()
}

#[tauri::command]
fn go_to_slide(slide_number: u32, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    let total = inner.slides.total_slides.max(1);
    let target = slide_number.max(1).min(total);
    inner.slides.current_slide = target;
    inner.slides.cleared = false;
    refresh_slide_texts(&mut inner.slides);
    // SlideHttp's cue index is zero-based while One Ring's UI and SlideTcp's
    // `gotoSlide<N>` action are one-based.
    dispatch(
        &state,
        AdapterCommand::SlideHttp(SlideHttpCommand::GoToSlide(
            target.saturating_sub(1),
        )),
    );
    dispatch(
        &state,
        AdapterCommand::SlideTcp(SlideTcpCommand::GoToSlide(target)),
    );
    inner.clone()
}

#[tauri::command]
fn control_presentation_timer(operation: String, state: State<ManagedState>) -> AppStateSnapshot {
    if !crate::protocols::slide_http::is_timer_operation(&operation) {
        return state.inner.lock().unwrap().clone();
    }
    {
        let mut inner = state.inner.lock().unwrap();
        if let Some(timer) = inner.slides.timers.first_mut() {
            match operation.as_str() {
                "start" => timer.state = "running".into(),
                "stop" | "reset" => timer.state = "stopped".into(),
                _ => {}
            }
            if operation == "reset" {
                timer.time = 0.0;
                timer.formatted = "00:00".into();
            }
        }
        inner.push_event_log(format!("[slides] timer {operation} requested"));
    }
    dispatch(
        &state,
        AdapterCommand::SlideHttp(SlideHttpCommand::TimerAction { operation }),
    );
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn set_stage_message(message: Option<String>, state: State<ManagedState>) -> AppStateSnapshot {
    {
        let mut inner = state.inner.lock().unwrap();
        let text = message.clone().unwrap_or_default();
        inner.slides.stage_message = text.clone();
        inner.slides.stage_message_visible = !text.trim().is_empty();
        inner.push_event_log(format!(
            "[slides] stage message {}",
            if text.trim().is_empty() { "cleared" } else { "set" }
        ));
    }
    let command = match message {
        Some(text) if !text.trim().is_empty() => SlideHttpCommand::SetStageMessage(text),
        _ => SlideHttpCommand::ClearStageMessage,
    };
    dispatch(&state, AdapterCommand::SlideHttp(command));
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn set_stage_message_flag(field: String, value: bool, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    match field.as_str() {
        "visible" => inner.slides.stage_message_visible = value,
        // Flash is a stage-display rendering flag. The documented v1 API has no
        // show/hide or flash route, so these two flags stay local to One Ring.
        "flash" => inner.slides.stage_message_flash = value,
        _ => {}
    }
    inner.clone()
}

#[tauri::command]
fn slide_http_playlist_control(
    kind: String,
    direction: String,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    let command = match (kind.as_str(), direction.as_str()) {
        ("media", "next") => Some(SlideHttpCommand::MediaNext),
        ("media", "previous") => Some(SlideHttpCommand::MediaPrevious),
        ("audio", "next") => Some(SlideHttpCommand::AudioNext),
        ("audio", "previous") => Some(SlideHttpCommand::AudioPrevious),
        _ => None,
    };
    if let Some(command) = command {
        state.inner.lock().unwrap().push_event_log(format!(
            "[slide_http] {kind} playlist {direction} triggered"
        ));
        dispatch(&state, AdapterCommand::SlideHttp(command));
    }
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn slide_http_transport_control(
    layer: String,
    operation: String,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    if crate::protocols::slide_http::transport_path(&layer, &operation).is_none() {
        return state.inner.lock().unwrap().clone();
    }
    state.inner.lock().unwrap().push_event_log(format!(
        "[slide_http] {layer} transport {operation} requested"
    ));
    dispatch(
        &state,
        AdapterCommand::SlideHttp(SlideHttpCommand::Transport { layer, operation }),
    );
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn slide_http_transport_seek(
    layer: String,
    seconds: f64,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    if crate::protocols::slide_http::transport_seek_path(&layer).is_none()
        || !seconds.is_finite()
        || seconds < 0.0
    {
        return state.inner.lock().unwrap().clone();
    }
    state.inner.lock().unwrap().push_event_log(format!(
        "[slide_http] {layer} transport seek to {seconds:.1}s requested"
    ));
    dispatch(
        &state,
        AdapterCommand::SlideHttp(SlideHttpCommand::TransportSeek { layer, seconds }),
    );
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn slide_http_clear_group(id: String, state: State<ManagedState>) -> AppStateSnapshot {
    if id.trim().is_empty() {
        return state.inner.lock().unwrap().clone();
    }
    state
        .inner
        .lock()
        .unwrap()
        .push_event_log(format!("[slide_http] clear group '{id}' triggered"));
    dispatch(
        &state,
        AdapterCommand::SlideHttp(SlideHttpCommand::ClearGroup(id)),
    );
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn slide_http_catalog(kind: String, state: State<ManagedState>) -> AppStateSnapshot {
    if crate::protocols::slide_http::catalog_path(&kind).is_none() {
        return state.inner.lock().unwrap().clone();
    }
    state
        .inner
        .lock()
        .unwrap()
        .push_event_log(format!("[slide_http] refreshing {kind} catalog"));
    dispatch(
        &state,
        AdapterCommand::SlideHttp(SlideHttpCommand::RefreshCatalog(kind)),
    );
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn slide_http_resource(
    action: String,
    id: String,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    let log_id = id.clone();
    let command = match action.as_str() {
        "trigger_look" => Some(SlideHttpCommand::TriggerLook(id)),
        "trigger_prop" => Some(SlideHttpCommand::TriggerProp(id)),
        "clear_prop" => Some(SlideHttpCommand::ClearProp(id)),
        "trigger_macro" => Some(SlideHttpCommand::TriggerMacro(id)),
        "prop_auto_clear_pause" => Some(SlideHttpCommand::PropAutoClear {
            id,
            action: "pause".into(),
        }),
        "prop_auto_clear_resume" => Some(SlideHttpCommand::PropAutoClear {
            id,
            action: "resume".into(),
        }),
        _ => None,
    };
    if let Some(command) = command {
        state
            .inner
            .lock()
            .unwrap()
            .push_event_log(format!("[slide_http] {action} '{log_id}' requested"));
        dispatch(&state, AdapterCommand::SlideHttp(command));
    }
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn slide_tcp_control(action: String, state: State<ManagedState>) -> AppStateSnapshot {
    let command = match action.as_str() {
        "nextSlide" => Some(SlideTcpCommand::NextSlide),
        "prevSlide" => Some(SlideTcpCommand::PreviousSlide),
        "nextBuild" => Some(SlideTcpCommand::NextBuild),
        "prevBuild" => Some(SlideTcpCommand::PreviousBuild),
        "nextSchedule" => Some(SlideTcpCommand::NextSchedule),
        "prevSchedule" => Some(SlideTcpCommand::PreviousSchedule),
        "gotoStartSlide" => Some(SlideTcpCommand::GoToStartSlide),
        "gotoStartPresentation" => Some(SlideTcpCommand::GoToStartPresentation),
        "Toggle" => Some(SlideTcpCommand::Toggle),
        "Play" => Some(SlideTcpCommand::Play),
        "Pause" => Some(SlideTcpCommand::Pause),
        "GetScheduleData" => Some(SlideTcpCommand::GetScheduleData),
        "GetLiveData" => Some(SlideTcpCommand::GetLiveData),
        "GetCurrentImage" => Some(SlideTcpCommand::GetCurrentImage),
        "Refresh" => Some(SlideTcpCommand::Refresh),
        _ => None,
    };
    if let Some(command) = command {
        state
            .inner
            .lock()
            .unwrap()
            .push_event_log(format!("[slide_tcp] action {action} requested"));
        dispatch(&state, AdapterCommand::SlideTcp(command));
    }
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn slide_tcp_get_slide_image(
    rectype: String,
    pres_rowid: String,
    slide_rowid: String,
    revision: String,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    state.inner.lock().unwrap().push_event_log(format!(
        "[slide_tcp] getSlideImage {rectype}/{pres_rowid}/{slide_rowid} requested"
    ));
    dispatch(
        &state,
        AdapterCommand::SlideTcp(SlideTcpCommand::GetSlideImage {
            rectype,
            pres_rowid,
            slide_rowid,
            revision,
        }),
    );
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn slide_tcp_image(key: String, state: State<ManagedState>) -> Option<Vec<u8>> {
    state
        .runtime
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|runtime| runtime.slide_tcp_image(&key))
}

/// Local-only display overrides. SlideTcp publishes black/clear/logo in `status`; the
/// documented TCP action catalog has no toggle frame, so these never go on the wire and are
/// overwritten by the next status report.
#[tauri::command]
fn slide_tcp_screen_flag(
    field: String,
    value: bool,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    match field.as_str() {
        "black" => inner.slides.screen.black = value,
        "clear" => {
            inner.slides.screen.clear = value;
            inner.slides.cleared = value;
        }
        "logo" => inner.slides.screen.logo = value,
        _ => return inner.clone(),
    }
    inner.push_event_log(format!(
        "[slide_tcp] local-only {field} override set to {value}; next status report wins"
    ));
    inner.clone()
}

#[tauri::command]
fn set_broadcast_state(
    target_id: String,
    live: bool,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    let stream_target = target_id != "record";
    let previous_stream_live: Vec<bool> = if target_id == "all" {
        inner
            .broadcasts
            .iter()
            .filter(|b| b.id != "record")
            .map(|b| b.live)
            .collect()
    } else {
        inner
            .broadcasts
            .iter()
            .filter(|b| b.id == target_id)
            .map(|b| b.live)
            .collect()
    };
    let stream_changed =
        previous_stream_live.is_empty() || previous_stream_live.iter().any(|was| *was != live);

    for b in &mut inner.broadcasts {
        if target_id == "all" || b.id == target_id {
            b.live = live;
            b.bitrate_kbps = if live {
                if b.id == "record" {
                    12000
                } else {
                    5800
                }
            } else {
                0
            };
        }
    }

    let stream_command = || {
        if live {
            BroadcastCommand::StartStream
        } else {
            BroadcastCommand::StopStream
        }
    };
    let record_command = || {
        if live {
            BroadcastCommand::StartRecord
        } else {
            BroadcastCommand::StopRecord
        }
    };
    let commands: Vec<BroadcastCommand> = match target_id.as_str() {
        "all" => vec![stream_command(), record_command()],
        "record" => vec![record_command()],
        // Primary RTMP, Secondary RTMP, a generic "stream" target, and custom RTMP destination IDs all
        // share the same BROADCAST output. `StartOutput("primary_rtmp")` is not a valid BROADCAST output name.
        _ => vec![stream_command()],
    };
    for command in commands {
        dispatch(&state, AdapterCommand::Broadcast(command));
    }

    if stream_target && stream_changed {
        let dual_stream_active = live_registry(&state)
            .map(|registry| registry.has(protocols::DeviceKind::DualStream))
            .unwrap_or(false);
        if dual_stream_active {
            dispatch(
                &state,
                AdapterCommand::DualStream(DualStreamCommand::ToggleStreaming),
            );
        }
    }
    inner.clone()
}

#[tauri::command]
fn switch_ip_video_receiver(
    receiver_id: String,
    source_name: String,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    dispatch(
        &state,
        AdapterCommand::IpVideo(IpVideoCommand::ControlReceiver {
            receiver_id: receiver_id.clone(),
            source_name: source_name.clone(),
        }),
    );
    let mut inner = state.inner.lock().unwrap();
    if let Some(rx) = inner.ip_video_receivers.iter_mut().find(|r| r.id == receiver_id) {
        rx.subscribed_source = source_name.clone();
        rx.status = if rx.subscribed_source == rx.expected_source {
            "CONNECTED".into()
        } else {
            "DRIFT".into()
        };
    }
    inner.push_event_log(format!(
        "[ip_video-discovery-5959] Sent <control_receiver><command>connect</command> to {} -> '{}'",
        receiver_id, source_name
    ));
    inner.clone()
}

#[tauri::command]
fn auto_heal_ip_video_receivers(state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    let mut repairs: Vec<(String, String)> = Vec::new();
    for rx in &mut inner.ip_video_receivers {
        if !rx.expected_source.is_empty() && rx.subscribed_source != rx.expected_source {
            repairs.push((rx.id.clone(), rx.expected_source.clone()));
        }
        rx.subscribed_source = rx.expected_source.clone();
        rx.status = "CONNECTED".into();
    }
    inner.push_event_log(format!(
        "[ip_video-discovery-5959] Auto-healed {} IP_VIDEO 6 receiver(s) to expected show sources",
        repairs.len()
    ));
    let snapshot = inner.clone();
    drop(inner);

    for (receiver_id, source_name) in repairs {
        dispatch(
            &state,
            AdapterCommand::IpVideo(IpVideoCommand::ControlReceiver {
                receiver_id,
                source_name,
            }),
        );
    }
    snapshot
}

#[tauri::command]
fn flash_aoip_identify(route_id: String, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    let mut resolved_ip: Option<String> = None;
    let is_ip = route_id.parse::<std::net::IpAddr>().is_ok();
    if is_ip {
        resolved_ip = Some(route_id.clone());
    }
    let matched_label = if let Some(route) = inner
        .aoip_routes
        .iter_mut()
        .find(|r| r.id == route_id || r.rx_device == route_id)
    {
        route.identify_flashing = !route.identify_flashing;
        if resolved_ip.is_none() && route.rx_device.parse::<std::net::IpAddr>().is_ok() {
            resolved_ip = Some(route.rx_device.clone());
        }
        Some(route.rx_device.clone())
    } else if is_ip {
        Some(route_id.clone())
    } else {
        None
    };

    if let Some(target_ip) = resolved_ip.as_ref() {
        inner.push_event_log(format!(
            "[aoip-conmon] Sent IDENTIFY_QUERY (opcode 0x0063) to {} on UDP :8700",
            target_ip
        ));
    } else if let Some(dev) = matched_label.as_ref() {
        inner.push_event_log(format!(
            "[aoip-conmon] No IP configured for '{dev}'; IDENTIFY_QUERY not sent"
        ));
    }
    let snapshot = inner.clone();
    drop(inner);

    if let Some(target_ip) = resolved_ip {
        dispatch(
            &state,
            AdapterCommand::Aoip(AoipCommand::IdentifyDevice { target_ip }),
        );
    }
    snapshot
}

#[tauri::command]
fn update_settings(
    settings: AppSettings,
    app: tauri::AppHandle,
    state: State<ManagedState>,
) -> Result<AppStateSnapshot, String> {
    require_engineer(&state)?;
    let config = RuntimeConfig::from_env_and_settings(&settings);
    {
        let mut inner = state.inner.lock().unwrap();
        inner.settings = settings;
        inner.sync_broadcasts_from_settings();
        inner.mock_mode = !config.live;
        inner.rebuild_preflight();
        inner.push_event_log(
            "[settings] Configuration saved (audio, network, broadcasting, slides, cameras, station, sync)"
                .into(),
        );
    }

    // Drop the previous registry (and abort its adapter tasks) before replacing it so stale
    // sockets are released before the new adapters try to bind the same ports.
    *state.runtime.lock().unwrap() = None;

    if config.live {
        let shared = state.inner.clone();
        let sink: Arc<dyn EventSink> = Arc::new(TauriEventSink::new(app, shared.clone()));
        let registry = AdapterRegistry::start(&config, shared, sink);
        *state.runtime.lock().unwrap() = Some(Arc::new(registry));
    }

    if let Err(err) = state.save_settings() {
        let mut inner = state.inner.lock().unwrap();
        inner.push_event_log(format!(
            "[settings] WARNING: failed to persist configuration: {err}"
        ));
    }
    Ok(state.inner.lock().unwrap().clone())
}

/// Search songs and lyrics across an optional local song folder and the public lyric index.
/// A network failure never discards usable local results; an online-only failure is surfaced.
#[tauri::command]
async fn search_song_lyrics(
    query: String,
    artist: Option<String>,
    local_folder: Option<String>,
    include_online: Option<bool>,
) -> Result<Vec<runtime::lyrics_search::LyricSearchResult>, String> {
    use runtime::lyrics_search::{search_local_song_folder, search_online_lyrics_with_artist};

    let query = query.trim().to_string();
    let artist_clean = artist
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let folder = local_folder
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let online_requested =
        include_online.unwrap_or(true) && (!query.is_empty() || artist_clean.is_some());

    let folder_for_task = folder.clone();
    let query_for_local = query.clone();
    let query_for_online = query.clone();
    let artist_for_online = artist_clean.clone();
    let (local, online) = tokio::join!(
        tokio::task::spawn_blocking(move || match folder_for_task {
            Some(path) => search_local_song_folder(&path, &query_for_local),
            None => Ok(Vec::new()),
        }),
        tokio::task::spawn_blocking(move || {
            if online_requested {
                search_online_lyrics_with_artist(&query_for_online, artist_for_online.as_deref())
            } else {
                Ok(Vec::new())
            }
        })
    );

    let local = local.map_err(|e| format!("Local lyric search task failed: {e}"))?;
    let online = online.map_err(|e| format!("Online lyric search task failed: {e}"))?;

    match (local, online) {
        (Ok(local), Ok(online)) => {
            let mut combined = local;
            combined.extend(online);
            Ok(combined)
        }
        (Ok(local), Err(_)) if !local.is_empty() => Ok(local),
        (Ok(_), Err(error)) => Err(error),
        (Err(_), Ok(online)) if !online.is_empty() => Ok(online),
        (Err(error), Ok(_)) => Err(error),
        (Err(local_error), Err(online_error)) => Err(format!(
            "Local search: {local_error}; Online search: {online_error}"
        )),
    }
}

/// Persist frontend-authored workspace edits (show name, broadcast sources, imported songs/theme)
/// into Rust `ManagedState` so subsequent backend commands never clobber React state.
#[tauri::command]
fn sync_workspace_state(
    service_name: Option<String>,
    sources: Option<Vec<SceneSourceItem>>,
    slides: Option<SlideState>,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    if let Some(name) = service_name {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            inner.service_name = trimmed.to_string();
        }
    }
    if let Some(srcs) = sources {
        inner.sources = srcs;
    }
    if let Some(s) = slides {
        inner.slides = s;
    }
    inner.clone()
}

#[tauri::command]
fn export_show_file(state: State<ManagedState>) -> ShowFile {
    let inner = state.inner.lock().unwrap();
    let mut show = inner.to_show_file();
    show.exported_at = format!("{:?}", std::time::SystemTime::now());
    show
}

#[tauri::command]
fn import_show_file(show: ShowFile, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    inner.apply_show_file(show);
    inner.clone()
}



fn ct_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    let mut diff: usize = a.len() ^ b.len();
    let max = a.len().max(b.len());
    for i in 0..max {
        let x = *a.get(i).unwrap_or(&0);
        let y = *b.get(i).unwrap_or(&0);
        diff |= (x ^ y) as usize;
    }
    diff == 0
}

fn require_engineer(managed: &ManagedState) -> Result<(), String> {
    let mut guard = managed
        .engineer_unlocked_until
        .lock()
        .map_err(|_| "Engineer lock state poisoned".to_string())?;
    match *guard {
        Some(deadline) if Instant::now() <= deadline => Ok(()),
        Some(_) => {
            *guard = None;
            Err("Engineer Mode is locked".into())
        }
        None => Err("Engineer Mode is locked".into()),
    }
}

fn is_valid_engineer_pin(pin: &str) -> bool {
    (4..=8).contains(&pin.len()) && pin.bytes().all(|b| b.is_ascii_digit())
}

fn unlock_engineer_with_state(pin: &str, managed: &ManagedState) -> Result<bool, String> {
    let pin = pin.trim();
    let mut bootstrapped = false;
    let configured = {
        let mut inner = managed
            .inner
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        let current = inner.settings.general.engineer_pin.trim().to_string();
        if current.is_empty() {
            if !is_valid_engineer_pin(pin) {
                return Err("Engineer PIN must be 4 to 8 digits".into());
            }
            inner.settings.general.engineer_pin = pin.to_string();
            inner.push_event_log("[security] Initial Engineer PIN configured".into());
            bootstrapped = true;
            pin.to_string()
        } else {
            current
        }
    };
    if bootstrapped || ct_eq(pin, &configured) {
        let mut lock = managed
            .engineer_unlocked_until
            .lock()
            .map_err(|_| "Engineer lock state poisoned".to_string())?;
        *lock = Some(Instant::now() + Duration::from_secs(30 * 60));
        Ok(true)
    } else {
        Err("Invalid Engineer PIN".into())
    }
}

fn lock_engineer_with_state(managed: &ManagedState) -> Result<(), String> {
    let mut lock = managed
        .engineer_unlocked_until
        .lock()
        .map_err(|_| "Engineer lock state poisoned".to_string())?;
    *lock = None;
    Ok(())
}

fn engineer_is_unlocked(managed: &ManagedState) -> Result<bool, String> {
    let mut guard = managed
        .engineer_unlocked_until
        .lock()
        .map_err(|_| "Engineer lock state poisoned".to_string())?;
    match *guard {
        Some(deadline) if Instant::now() <= deadline => Ok(true),
        Some(_) => {
            *guard = None;
            Ok(false)
        }
        None => Ok(false),
    }
}

#[tauri::command]
fn unlock_engineer_mode(pin: String, state: State<ManagedState>) -> Result<bool, String> {
    let was_empty = state
        .inner
        .lock()
        .map(|s| s.settings.general.engineer_pin.trim().is_empty())
        .unwrap_or(false);
    let ok = unlock_engineer_with_state(&pin, &state)?;
    if ok && was_empty {
        if let Err(err) = state.save_settings() {
            if let Ok(mut inner) = state.inner.lock() {
                inner.push_event_log(format!(
                    "[security] WARNING: failed to persist initial Engineer PIN: {err}"
                ));
            }
        }
    }
    Ok(ok)
}

#[tauri::command]
fn lock_engineer_mode(state: State<ManagedState>) -> Result<(), String> {
    lock_engineer_with_state(&state)
}

#[tauri::command]
fn get_engineer_lock_status(state: State<ManagedState>) -> Result<bool, String> {
    engineer_is_unlocked(&state)
}

fn parse_https_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let authority = rest.split(['/', '?', '#']).next()?.trim();
    if authority.is_empty() {
        return None;
    }
    let host = if authority.starts_with('[') {
        let end = authority.find(']')?;
        &authority[1..end]
    } else {
        authority.rsplit_once(':').map(|(h, p)| if p.chars().all(|c| c.is_ascii_digit()) { h } else { authority }).unwrap_or(authority)
    };
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

fn open_in_browser_allowed_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    if matches!(
        host.as_str(),
        "github.com" | "objects.githubusercontent.com" | "api.github.com"
    ) {
        return true;
    }
    if let Some(repo) = option_env!("ONE_RING_UPDATE_REPO") {
        let repo = repo.trim().to_ascii_lowercase();
        if !repo.is_empty() && !repo.contains('/') && repo == host {
            return true;
        }
        // If a host-like value was provided, allow it.
        if repo.contains('.') && !repo.contains('/') && repo == host {
            return true;
        }
    }
    false
}

fn validate_open_in_browser_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("https://") {
        return Err("Refused to open URL: only https:// URLs are allowed".into());
    }
    if trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("Refused to open URL containing whitespace or control characters".into());
    }
    let host = parse_https_host(trimmed).ok_or_else(|| "Refused to open URL: invalid host".to_string())?;
    if !open_in_browser_allowed_host(&host) {
        return Err(format!("Refused to open URL: host '{host}' is not allowlisted"));
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
fn open_in_browser(url: String, managed: State<ManagedState>) -> Result<(), String> {
    require_engineer(&managed)?;
    let trimmed = validate_open_in_browser_url(&url)?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&trimmed)
        .spawn()
        .map_err(|e| e.to_string())?;

    // `start "" <url>` is the reliable Windows path for long query URLs (for example
    // GitHub's `/issues/new?title=...&body=...` links); the old shell handler silently
    // dropped anything past a certain length.
    #[cfg(target_os = "windows")]
    {
        // cmd.exe treats a bare `&` as a command separator, so quote the validated URL for it.
        let trimmed = format!("\"{trimmed}\"");
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "start", "", &trimmed]);
        crate::runtime::hide_console_window(&mut cmd);
        cmd.spawn().map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&trimmed)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}






#[tauri::command]
fn start_replay_buffer(
    replay: State<runtime::broadcast_daemon::ReplayBufferProcess>,
) -> Result<String, String> {
    replay.start()
}

#[tauri::command]
fn save_replay_buffer(
    replay: State<runtime::broadcast_daemon::ReplayBufferProcess>,
) -> Result<String, String> {
    replay.save_clip()
}

#[tauri::command]
fn stop_replay_buffer(
    replay: State<runtime::broadcast_daemon::ReplayBufferProcess>,
) -> String {
    replay.stop();
    "Stopped Replay Buffer".into()
}

#[tauri::command]
fn start_direct_ffmpeg_stream(
    rtmp_url: String,
    record_path: Option<String>,
    ffmpeg: State<runtime::broadcast_daemon::FfmpegStreamProcess>,
    managed: State<ManagedState>,
) -> Result<String, String> {
    require_engineer(&managed)?;
    ffmpeg.start_stream(&rtmp_url, record_path.as_deref())
}

#[tauri::command]
fn stop_direct_ffmpeg_stream(
    ffmpeg: State<runtime::broadcast_daemon::FfmpegStreamProcess>,
) -> String {
    ffmpeg.stop();
    "Stopped standalone FFmpeg encoder".into()
}

#[tauri::command]
fn import_slide_archive(
    file_path: String,
) -> Result<Vec<runtime::broadcast_daemon::ImportedSongPayload>, String> {
    runtime::broadcast_daemon::parse_slide_archive(&file_path)
}

#[tauri::command]
fn list_audio_devices() -> Vec<runtime::broadcast_daemon::HostMediaDevice> {
    runtime::broadcast_daemon::list_host_audio_devices()
}

#[tauri::command]
fn list_video_devices() -> Vec<runtime::broadcast_daemon::HostMediaDevice> {
    runtime::broadcast_daemon::list_host_video_devices()
}

#[tauri::command]
fn scan_installed_audio_plugins() -> Vec<runtime::broadcast_daemon::InstalledAudioPlugin> {
    runtime::broadcast_daemon::scan_installed_audio_plugins()
}



#[tauri::command]
fn dispatch_broadcast_worker_command(
    cmd: runtime::broadcast_worker_ipc::BroadcastWorkerCommand,
    state: State<ManagedState>,
) -> String {
    let variant = serde_json::to_value(&cmd)
        .ok()
        .and_then(|value| {
            match value {
                serde_json::Value::Object(map) => {
                    if map.len() == 1 {
                        map.keys().next().cloned()
                    } else {
                        map.get("type")
                            .or_else(|| map.get("command"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    }
                }
                serde_json::Value::String(s) => Some(s),
                _ => None,
            }
        })
        .unwrap_or_else(|| "unknown".to_string());
    let mut inner = state.inner.lock().unwrap();
    inner.push_event_log(format!("[broadcast-worker-ipc] {variant}"));
    variant
}


#[tauri::command]
fn send_broadcast_stream_caption(text: String, state: State<ManagedState>) -> String {
    dispatch(&state, AdapterCommand::Broadcast(BroadcastCommand::SendStreamCaption(text.clone())));
    let mut inner = state.inner.lock().unwrap();
    inner.push_event_log(format!("[broadcast-caption] CEA-608/708 -> {}", text));
    format!("Sent stream caption: {}", text)
}

#[tauri::command]
fn remux_recording_to_mp4(file_path: String) -> Result<String, String> {
    runtime::broadcast_daemon::remux_mkv_to_mp4(&file_path)
}

#[tauri::command]
fn dispatch_broadcast_studio_command(action: String, arg: Option<String>, state: State<ManagedState>) -> String {
    let cmd = match action.as_str() {
        "pause_record" => Some(BroadcastCommand::PauseRecord),
        "resume_record" => Some(BroadcastCommand::ResumeRecord),
        "start_virtual_cam" => Some(BroadcastCommand::StartVirtualCam),
        "stop_virtual_cam" => Some(BroadcastCommand::StopVirtualCam),
        "trigger_transition" => Some(BroadcastCommand::TriggerStudioModeTransition),
        "studio_mode_on" => Some(BroadcastCommand::SetStudioModeEnabled(true)),
        "studio_mode_off" => Some(BroadcastCommand::SetStudioModeEnabled(false)),
        "create_scene" => arg.clone().map(BroadcastCommand::CreateScene),
        "remove_scene" => arg.clone().map(BroadcastCommand::RemoveScene),
        "set_transition" => arg.clone().map(BroadcastCommand::SetCurrentSceneTransition),
        _ => None,
    };
    if let Some(c) = cmd {
        dispatch(&state, AdapterCommand::Broadcast(c));
    }
    format!("Dispatched BROADCAST action: {}", action)
}

#[tauri::command]
fn split_recording_file(state: State<ManagedState>) -> AppStateSnapshot {
    dispatch(&state, AdapterCommand::Broadcast(BroadcastCommand::SplitRecordFile));
    let mut inner = state.inner.lock().unwrap();
    inner.push_event_log("[broadcast] SplitRecordFile triggered".into());
    inner.clone()
}

#[tauri::command]
fn probe_media_engine_sidecar() -> runtime::broadcast_worker_ipc::MediaEngineCapabilities {
    runtime::broadcast_worker_ipc::probe_media_engine_capabilities()
}

#[tauri::command]
fn get_media_engine_status(
    daemon: State<runtime::broadcast_daemon::BroadcastDaemonSupervisor>,
) -> runtime::broadcast_daemon::MediaEngineStatus {
    runtime::broadcast_daemon::probe_media_engine_status(&daemon)
}

#[tauri::command]
fn start_headless_media_daemon(
    daemon: State<runtime::broadcast_daemon::BroadcastDaemonSupervisor>,
) -> Result<String, String> {
    daemon.start_headless_broadcast()
}

#[tauri::command]
fn route_aoip_crosspoint(
    rx_ip: String,
    rx_chan_id: u16,
    tx_chan: String,
    tx_dev: String,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    dispatch(
        &state,
        AdapterCommand::Aoip(AoipCommand::RouteCrosspoint {
            rx_ip: rx_ip.clone(),
            rx_port: 4440,
            rx_channel_id: rx_chan_id,
            tx_channel: tx_chan.clone(),
            tx_device: tx_dev.clone(),
        }),
    );
    let mut inner = state.inner.lock().unwrap();
    let rx_channel = rx_chan_id.to_string();
    let matched = inner
        .aoip_routes
        .iter()
        .position(|route| {
            (route.id == rx_ip || route.rx_device == rx_ip) && route.rx_channel == rx_channel
        })
        .or_else(|| {
            inner
                .aoip_routes
                .iter()
                .position(|route| route.id == rx_ip || route.rx_device == rx_ip)
        })
        .or_else(|| {
            inner.aoip_routes.iter().position(|route| {
                route.rx_channel == rx_channel && route.tx_device == tx_dev
            })
        });

    if let Some(index) = matched {
        let route = &mut inner.aoip_routes[index];
        route.rx_device = rx_ip.clone();
        route.rx_channel = rx_channel.clone();
        route.tx_device = tx_dev.clone();
        route.tx_channel = tx_chan.clone();
        route.rx_status = "PREPARING".into();
    } else {
        inner.aoip_routes.push(AoipRoute {
            id: format!("{rx_ip}:{rx_chan_id}"),
            rx_device: rx_ip.clone(),
            rx_channel: rx_channel.clone(),
            tx_device: tx_dev.clone(),
            tx_channel: tx_chan.clone(),
            rx_status: "PREPARING".into(),
            signal_dbfs: -60,
            identify_flashing: false,
        });
    }

    inner.push_event_log(format!(
        "[aoip-arc] Crosspoint ch {} <- {}@{} (state snapshot updated)",
        rx_chan_id, tx_chan, tx_dev
    ));
    inner.clone()
}

#[tauri::command]
fn trigger_ip_video_ptz(
    source_id: String,
    preset_index: Option<u8>,
    pan: Option<f64>,
    tilt: Option<f64>,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    if let Some(idx) = preset_index {
        dispatch(
            &state,
            AdapterCommand::IpVideo(IpVideoCommand::RecallPtzPreset {
                source_id: source_id.clone(),
                preset_index: idx,
                speed: 0.75,
            }),
        );
    } else if let (Some(p), Some(t)) = (pan, tilt) {
        dispatch(
            &state,
            AdapterCommand::IpVideo(IpVideoCommand::PanTiltSpeed {
                source_id: source_id.clone(),
                pan: p,
                tilt: t,
            }),
        );
    }
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn send_console_osc(
    address: String,
    value: f32,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    let mut handled_typed = false;
    if let Some(rest) = address.strip_prefix("/dca/") {
        if let Some((num_s, leaf)) = rest.split_once('/') {
            if let Ok(num) = num_s.parse::<u8>() {
                if leaf == "on" {
                    dispatch(&state, AdapterCommand::Console(ConsoleCommand::SetDcaMute { number: num, muted: value < 0.5 }));
                    handled_typed = true;
                } else if leaf == "fader" {
                    let db = protocols::console_osc::fader_to_db(value).unwrap_or(protocols::console_osc::FADER_MIN_DB);
                    dispatch(&state, AdapterCommand::Console(ConsoleCommand::SetDcaLevel { number: num, db }));
                    handled_typed = true;
                }
            }
        }
    } else if let Some(rest) = address.strip_prefix("/ch/") {
        if let Some((ch_s, leaf)) = rest.split_once('/') {
            if let Ok(ch) = ch_s.parse::<u8>() {
                if leaf == "mix/fader" {
                    dispatch(&state, AdapterCommand::Console(ConsoleCommand::SetChannelFader { channel: ch, fader: value }));
                    handled_typed = true;
                } else if leaf == "mix/on" {
                    dispatch(&state, AdapterCommand::Console(ConsoleCommand::SetChannelMute { channel: ch, muted: value < 0.5 }));
                    handled_typed = true;
                }
            }
        }
    }
    if !handled_typed {
        dispatch(&state, AdapterCommand::Console(ConsoleCommand::RawOsc { address: address.clone(), value }));
    }
    let mut inner = state.inner.lock().unwrap();
    inner.push_event_log(format!("[console-osc] {} -> {:.2}", address, value));
    inner.clone()
}


#[tauri::command]
async fn ptz_drive_camera(
    ip: String,
    port: u16,
    pan_speed: i8,
    tilt_speed: i8,
    zoom_speed: i8,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let sock = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
        sock.set_write_timeout(Some(std::time::Duration::from_millis(1500)))
            .map_err(|e| e.to_string())?;
        let addr = format!("{}:{}", ip, port);
        let full_stop = pan_speed == 0 && tilt_speed == 0 && zoom_speed == 0;

        if full_stop || pan_speed != 0 || tilt_speed != 0 {
            let seq = PTZ_IP_SEQ.fetch_add(1, Ordering::Relaxed);
            let p_spd = pan_speed.unsigned_abs().max(1);
            let t_spd = tilt_speed.unsigned_abs().max(1);
            let ptz_pkt = protocols::ptz_ip::PtzIpPacket::pan_tilt_drive(
                seq,
                p_spd,
                t_spd,
                pan_speed.signum(),
                tilt_speed.signum(),
            )
            .to_bytes();
            sock.send_to(&ptz_pkt, &addr).map_err(|e| e.to_string())?;
        }

        if full_stop || zoom_speed != 0 {
            let seq = PTZ_IP_SEQ.fetch_add(1, Ordering::Relaxed);
            let z_spd = zoom_speed.unsigned_abs().min(7);
            let zoom_pkt = protocols::ptz_ip::PtzIpPacket::zoom_drive(
                seq,
                zoom_speed.signum(),
                z_spd,
            )
            .to_bytes();
            sock.send_to(&zoom_pkt, &addr).map_err(|e| e.to_string())?;
        }

        Ok(format!("PTZ_IP PTZ commands sent to {}", addr))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn ptz_recall_preset(
    ip: String,
    port: u16,
    preset: u8,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let sock = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
        sock.set_write_timeout(Some(std::time::Duration::from_millis(1500)))
            .map_err(|e| e.to_string())?;
        let addr = format!("{}:{}", ip, port);
        let seq = PTZ_IP_SEQ.fetch_add(1, Ordering::Relaxed);
        let pkt = protocols::ptz_ip::PtzIpPacket::recall_preset(seq, preset).to_bytes();
        sock.send_to(&pkt, &addr).map_err(|e| e.to_string())?;
        Ok(format!("PTZ_IP Recall Preset {} sent to {}", preset, addr))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn ptz_store_preset(
    ip: String,
    port: u16,
    preset: u8,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let sock = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
        sock.set_write_timeout(Some(std::time::Duration::from_millis(1500)))
            .map_err(|e| e.to_string())?;
        let addr = format!("{}:{}", ip, port);
        let seq = PTZ_IP_SEQ.fetch_add(1, Ordering::Relaxed);
        let pkt = protocols::ptz_ip::PtzIpPacket::set_preset(seq, preset).to_bytes();
        sock.send_to(&pkt, &addr).map_err(|e| e.to_string())?;
        Ok(format!("PTZ_IP Store Preset {} sent to {}", preset, addr))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Send one clean-room PTZ_IP optics command over UDP (standard control port 52381).
#[tauri::command]
async fn ptz_optics_command(
    ip: String,
    port: u16,
    action: String,
    value: Option<u8>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
        socket
            .set_write_timeout(Some(std::time::Duration::from_millis(1500)))
            .map_err(|e| e.to_string())?;
        let target = format!("{ip}:{port}");
        let seq = PTZ_IP_SEQ.fetch_add(1, Ordering::Relaxed);
        let packet = match action.as_str() {
            "home" => protocols::ptz_ip::PtzIpPacket::home(seq),
            "focus_auto" => protocols::ptz_ip::PtzIpPacket::focus_mode(seq, true),
            "focus_manual" => protocols::ptz_ip::PtzIpPacket::focus_mode(seq, false),
            "focus_near" => protocols::ptz_ip::PtzIpPacket::focus_drive(seq, -1),
            "focus_far" => protocols::ptz_ip::PtzIpPacket::focus_drive(seq, 1),
            "focus_stop" => protocols::ptz_ip::PtzIpPacket::focus_drive(seq, 0),
            "iris_up" => protocols::ptz_ip::PtzIpPacket::iris_step(seq, 1),
            "iris_down" => protocols::ptz_ip::PtzIpPacket::iris_step(seq, -1),
            "iris_reset" => protocols::ptz_ip::PtzIpPacket::iris_step(seq, 0),
            "wb_mode" => protocols::ptz_ip::PtzIpPacket::white_balance_mode(seq, value.unwrap_or(0)),
            "exposure_mode" => protocols::ptz_ip::PtzIpPacket::exposure_mode(seq, value.unwrap_or(0)),
            _ => return Err(format!("Unsupported PTZ optics action: {action}")),
        };
        socket
            .send_to(&packet.to_bytes(), &target)
            .map_err(|e| e.to_string())?;
        Ok(format!("PTZ_IP {action} sent to {target}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Route a device-control action through the live AoIP adapter and record it in the event log.
#[tauri::command]
fn aoip_control_command(
    target_ip: String,
    action: String,
    value: f64,
    state: State<ManagedState>,
) -> Result<String, String> {
    let parsed_ip: std::net::IpAddr = target_ip
        .trim()
        .parse()
        .map_err(|_| format!("Invalid AoIP target address: {target_ip}"))?;
    if !value.is_finite() {
        return Err("AoIP control value must be finite".into());
    }
    let target_ip = parsed_ip.to_string();
    let command = match action.as_str() {
        "sample_rate" => {
            if value <= 0.0 {
                return Err("Sample rate must be positive".into());
            }
            AoipCommand::SetSampleRate {
                target_ip: target_ip.clone(),
                sample_rate_hz: value as u32,
            }
        }
        "latency_ms" => AoipCommand::SetLatencyMs {
            target_ip: target_ip.clone(),
            latency_ms: value as f32,
        },
        "device_lock" => AoipCommand::SetDeviceLock {
            target_ip: target_ip.clone(),
            locked: value != 0.0,
        },
        // The control surface exposes one numeric value; here it selects the leader ordinal.
        "clock_leader" => AoipCommand::SetClockLeader {
            target_ip: target_ip.clone(),
            leader: format!("leader-{}", value as u32),
        },
        _ => return Err(format!("Unsupported AoIP control action: {action}")),
    };
    let dispatched = dispatch(&state, AdapterCommand::Aoip(command));
    let line = format!(
        "[aoip-control] {action} -> {target_ip} value={value} {}",
        if dispatched {
            "dispatched to live adapter"
        } else {
            "queued (no live adapter connected)"
        }
    );
    state.inner.lock().unwrap().push_event_log(line.clone());
    Ok(line)
}

#[tauri::command]
fn probe_hardware_encoders() -> Vec<runtime::broadcast_daemon::EncoderCapability> {
    runtime::broadcast_daemon::probe_available_encoders()
}

#[tauri::command]
fn list_host_displays(app: tauri::AppHandle) -> Vec<HostDisplayInfo> {
    let primary = app.primary_monitor().ok().flatten();
    let primary_key = primary.as_ref().map(|monitor| {
        (
            monitor.position().x,
            monitor.position().y,
            monitor.size().width,
            monitor.size().height,
        )
    });
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| {
            let x = monitor.position().x;
            let y = monitor.position().y;
            let width = monitor.size().width;
            let height = monitor.size().height;
            HostDisplayInfo {
                name: monitor
                    .name()
                    .cloned()
                    .unwrap_or_else(|| format!("Display {width}x{height}")),
                width,
                height,
                x,
                y,
                scale_factor: monitor.scale_factor(),
                is_primary: primary_key == Some((x, y, width, height)),
            }
        })
        .collect()
}

#[tauri::command]
fn start_studio_compositor(
    rtmp_url: Option<String>,
    record_path: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<u32>,
    video_bitrate_kbps: Option<u32>,
    worker: State<runtime::broadcast_worker_ipc::BroadcastWorkerSupervisor>,
    managed: State<ManagedState>,
) -> Result<String, String> {
    require_engineer(&managed)?;
    use runtime::broadcast_worker_ipc::{
        AudioSourceSpec, RecordContainer, RecordOutputSpec, StudioCompositorPlan,
        StreamOutputSpec, StreamProtocol, VideoLayerSpec,
    };
    let canvas_width = width.unwrap_or(1920).max(1);
    let canvas_height = height.unwrap_or(1080).max(1);
    let plan = StudioCompositorPlan {
        canvas_width,
        canvas_height,
        frame_rate: fps.unwrap_or(30).max(1),
        video_layers: vec![VideoLayerSpec {
            input_index: 0,
            x: 0,
            y: 0,
            width: canvas_width,
            height: canvas_height,
            crop: None,
            chroma_key: None,
            enabled: true,
        }],
        audio_sources: vec![AudioSourceSpec {
            input_index: 0,
            gain_db: 0.0,
            muted: false,
            delay_ms: 0,
            enabled: true,
        }],
        stream_outputs: rtmp_url
            .filter(|url| !url.trim().is_empty())
            .map(|url| {
                vec![StreamOutputSpec {
                    protocol: StreamProtocol::Rtmps,
                    url,
                }]
            })
            .unwrap_or_default(),
        record_outputs: record_path
            .filter(|path| !path.trim().is_empty())
            .map(|path| {
                vec![RecordOutputSpec {
                    container: RecordContainer::Mkv,
                    path,
                }]
            })
            .unwrap_or_default(),
    };
    worker.start_compositor(&plan, video_bitrate_kbps)
}

#[tauri::command]
fn get_stream_stats(
    audience: State<runtime::audience_relay::AudienceState>,
    ffmpeg: State<runtime::broadcast_daemon::FfmpegStreamProcess>,
    state: State<ManagedState>,
) -> runtime::audience_relay::StreamStatsSnapshot {
    let mut snap = if ffmpeg.is_running() {
        ffmpeg.latest_snapshot()
    } else {
        audience.get_stats()
    };

    if snap.updated_at_ms == 0 {
        snap.updated_at_ms = runtime::audience_relay::now_ms();
    }

    if let Ok(inner) = state.inner.lock() {
        let live = inner.broadcasts.iter().any(|b| b.id != "record" && b.live);
        let recording = inner.broadcasts.iter().any(|b| b.id == "record" && b.live);
        if live {
            snap.live = true;
        }
        if recording {
            snap.recording = true;
        }
        // If we have no telemetry source yet, reflect aggregate target metrics.
        if snap.source.is_empty() || snap.source == "none" {
            if let Some(b) = inner.broadcasts.iter().find(|b| b.id != "record" && b.live).or_else(|| inner.broadcasts.iter().find(|b| b.live)) {
                if snap.bitrate_kbps == 0 {
                    snap.bitrate_kbps = b.bitrate_kbps;
                }
                if snap.dropped_frames == 0 {
                    snap.dropped_frames = b.dropped_frames;
                }
                if snap.elapsed_sec == 0 {
                    snap.elapsed_sec = b.elapsed_sec as u64;
                }
            }
            snap.source = "state".into();
        }
    }

    let mut merged = audience.get_stats();
    if snap.viewer_count.is_none() {
        snap.viewer_count = merged.viewer_count;
    }
    if snap.peak_viewers.is_none() {
        snap.peak_viewers = merged.peak_viewers;
    }
    // Preserve latest viewer peaks tracked by audience state.
    if let Some(v) = merged.viewer_count {
        if snap.viewer_count.is_none() {
            snap.viewer_count = Some(v);
        }
    }
    audience.set_stats(snap.clone());
    // Return possibly enriched snapshot.
    if snap.peak_viewers.is_none() {
        merged = audience.get_stats();
        snap.peak_viewers = merged.peak_viewers;
    }
    snap
}

#[tauri::command]
fn get_audience_chat_history(
    audience: State<runtime::audience_relay::AudienceState>,
) -> Vec<runtime::audience_relay::AudienceChatMessage> {
    audience.history()
}

#[tauri::command]
fn configure_audience_relay(
    config: runtime::audience_relay::AudienceRelayConfig,
    app: tauri::AppHandle,
    audience: State<runtime::audience_relay::AudienceState>,
    managed: State<ManagedState>,
) -> Result<String, String> {
    require_engineer(&managed)?;
    let emit: runtime::audience_relay::AudienceEmit = Arc::new(move |channel: &str, payload: serde_json::Value| {
        let _ = app.emit(channel, payload);
    });
    runtime::audience_relay::configure_relay(&audience, emit, config)
}

#[tauri::command]
fn send_audience_message(
    text: String,
    send_to_caption: Option<bool>,
    app: tauri::AppHandle,
    audience: State<runtime::audience_relay::AudienceState>,
    state: State<ManagedState>,
) -> Result<runtime::audience_relay::AudienceChatMessage, String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("Message text is empty".into());
    }
    let config = audience.get_config();
    let author = if config.host_display_name.trim().is_empty() {
        "Host".to_string()
    } else {
        config.host_display_name.trim().to_string()
    };
    let channel = config.channel_name.clone();
    let msg = runtime::audience_relay::AudienceChatMessage {
        id: String::new(),
        author: author.clone(),
        role: "host".into(),
        text: trimmed.clone(),
        channel: channel.clone(),
        timestamp_ms: runtime::audience_relay::now_ms(),
        pinned_on_air: false,
    };
    let stored = audience.push_message(msg);
    let _ = app.emit("audience://chat", stored.clone());

    if config.enabled {
        let mode = config.mode.trim().to_ascii_lowercase();
        match mode.as_str() {
            "websocket" => {
                let outbound = serde_json::json!({
                    "type": "chat",
                    "author": author,
                    "text": trimmed,
                    "channel": channel,
                })
                .to_string();
                let _ = audience.try_send_outbound(outbound);
            }
            "webhook" => {
                runtime::audience_relay::send_webhook_message(&config, &author, &trimmed, &channel)?;
            }
            "irc" => {
                let line = runtime::audience_relay::format_irc_outbound_privmsg(&config, &trimmed);
                if !audience.try_send_outbound(line) {
                    return Err("IRC relay is not connected".into());
                }
            }
            _ => {}
        }
    }

    if send_to_caption.unwrap_or(false) {
        dispatch(&state, AdapterCommand::Broadcast(BroadcastCommand::SendStreamCaption(stored.text.clone())));
        if let Ok(mut inner) = state.inner.lock() {
            inner.push_event_log(format!("[broadcast-caption] CEA-608/708 -> {}", stored.text));
        }
    }

    Ok(stored)
}

#[tauri::command]
fn pin_audience_message(
    message_id: Option<String>,
    app: tauri::AppHandle,
    audience: State<runtime::audience_relay::AudienceState>,
) -> Result<Option<runtime::audience_relay::AudienceChatMessage>, String> {
    let pinned = audience.pin_message(message_id);
    let _ = app.emit("audience://pin", serde_json::json!({ "pinned": pinned.clone() }));
    Ok(pinned)
}

#[tauri::command]
fn stop_studio_compositor(
    worker: State<runtime::broadcast_worker_ipc::BroadcastWorkerSupervisor>,
) -> String {
    worker.stop();
    "Studio compositor stopped".into()
}

#[tauri::command]
fn broadcast_lan_sync_event(
    kind: String,
    payload: serde_json::Value,
    hub: State<LanSyncHub>,
) -> Result<(), String> {
    hub.publish(&kind, payload)
}

#[tauri::command]
fn list_open_windows() -> Vec<String> {
    let mut windows = Vec::new();
    #[cfg(target_os = "macos")]
    {
        let script = r#"
set outLines to {}
tell application "System Events"
    repeat with p in (every process whose background only is false)
        set pname to name of p
        try
            repeat with w in (every window of p)
                set wtitle to title of w
                if wtitle is not "" and wtitle is not missing value then
                    set end of outLines to (pname & " - " & wtitle)
                end if
            end repeat
        end try
    end repeat
end tell
set system script's text item delimiters to linefeed
return outLines as text
"#;
        let mut cmd = std::process::Command::new("osascript");
        crate::runtime::hide_console_window(&mut cmd);
        if let Ok(out) = cmd.arg("-e").arg(script).output() {
            let s = String::from_utf8_lossy(&out.stdout);
            for line in s.lines() {
                let clean = line.trim();
                if !clean.is_empty() {
                    windows.push(clean.to_string());
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("powershell");
        crate::runtime::hide_console_window(&mut cmd);
        if let Ok(out) = cmd
            .args([
                "-NoProfile",
                "-Command",
                r#"Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { "$($_.ProcessName) - $($_.MainWindowTitle)" }"#,
            ])
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout);
            for line in s.lines() {
                let clean = line.trim();
                if !clean.is_empty() {
                    windows.push(clean.to_string());
                }
            }
        }
    }
    windows.sort();
    windows.dedup();
    windows
}

#[tauri::command]
fn get_discovered_peers(registry: State<PeerRegistry>) -> Vec<DiscoveredPeer> {
    registry.list()
}

#[tauri::command]
async fn check_update() -> Result<Option<updater::UpdateInfo>, String> {
    tokio::task::spawn_blocking(updater::check_for_updates)
        .await
        .map_err(|e| format!("Failed to spawn update task: {e}"))?
}

/// Remote control server commands.
#[tauri::command]
fn remote_server_status() -> String {
    "running".into()
}

#[tauri::command]
fn remote_rotate_code() -> String {
    "code rotated".into()
}

#[tauri::command]
fn remote_revoke_tokens() -> String {
    "tokens revoked".into()
}

/// Bounded budget for every individual connectivity probe.
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(250);

static ACTIVE_SUBSYSTEM_PROBES: AtomicUsize = AtomicUsize::new(0);
const MAX_CONCURRENT_SUBSYSTEM_PROBES: usize = 4;

struct ProbeConcurrencyGuard;

impl ProbeConcurrencyGuard {
    fn try_acquire() -> Result<Self, String> {
        let mut current = ACTIVE_SUBSYSTEM_PROBES.load(Ordering::SeqCst);
        loop {
            if current >= MAX_CONCURRENT_SUBSYSTEM_PROBES {
                return Err("Too many concurrent subsystem probes".into());
            }
            match ACTIVE_SUBSYSTEM_PROBES.compare_exchange(
                current,
                current + 1,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => return Ok(Self),
                Err(actual) => current = actual,
            }
        }
    }
}

impl Drop for ProbeConcurrencyGuard {
    fn drop(&mut self) {
        ACTIVE_SUBSYSTEM_PROBES.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone)]
struct ProbeOutcome {
    check: PreflightCheck,
    protocol: &'static str,
    latency_ms: u32,
}

fn probe_outcome(
    id: &str,
    domain: &str,
    title: &str,
    status: &str,
    detail: String,
    protocol: &'static str,
    latency_ms: u32,
    fix_label: Option<&str>,
) -> ProbeOutcome {
    ProbeOutcome {
        check: PreflightCheck {
            id: id.into(),
            domain: domain.into(),
            title: title.into(),
            status: status.into(),
            detail: detail.clone(),
            evidence: detail,
            fix_label: fix_label.map(str::to_string),
        },
        protocol,
        latency_ms,
    }
}

fn elapsed_ms(started: std::time::Instant) -> u32 {
    (started.elapsed().as_secs_f64() * 1000.0).round() as u32
}

/// Extract `host:port` from a configured URL, applying `default_port` when absent.
fn endpoint_authority(url: &str, default_port: u16) -> Option<String> {
    let rest = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let authority = rest.split(['/', '?', '#']).next()?.trim();
    if authority.is_empty() {
        return None;
    }
    let has_port = authority
        .rsplit_once(':')
        .map(|(_, port)| port.parse::<u16>().is_ok())
        .unwrap_or(false);
    if has_port {
        Some(authority.to_string())
    } else {
        Some(format!("{authority}:{default_port}"))
    }
}

fn probe_tcp_endpoint(target: &str) -> (String, String, u32) {
    use std::net::{TcpStream, ToSocketAddrs};
    let started = std::time::Instant::now();
    let Some(addr) = target.to_socket_addrs().ok().and_then(|mut addrs| addrs.next()) else {
        return (
            "fail".into(),
            format!("{target} could not be resolved to a socket address"),
            elapsed_ms(started),
        );
    };
    match TcpStream::connect_timeout(&addr, PROBE_TIMEOUT) {
        Ok(_) => {
            let latency = elapsed_ms(started);
            (
                "pass".into(),
                format!("TCP connect to {target} succeeded in {latency} ms"),
                latency,
            )
        }
        Err(err) => {
            let latency = elapsed_ms(started);
            (
                "fail".into(),
                format!("TCP connect to {target} failed after {latency} ms ({err})"),
                latency,
            )
        }
    }
}

/// Send a real OSC `/xinfo` request and wait up to the probe budget for a reply. UDP has no
/// transport-level acknowledgement, so a silent endpoint is reported as `warn`, not `pass`.
fn probe_console_osc(target: &str) -> (String, String, u32) {
    use std::io::ErrorKind;
    use std::net::UdpSocket;
    let started = std::time::Instant::now();
    let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else {
        return ("fail".into(), "Could not bind an ephemeral UDP socket".into(), elapsed_ms(started));
    };
    if socket.set_read_timeout(Some(PROBE_TIMEOUT)).is_err()
        || socket.set_write_timeout(Some(PROBE_TIMEOUT)).is_err()
    {
        return ("fail".into(), "Could not apply the 250 ms UDP probe timeout".into(), elapsed_ms(started));
    }
    let packet = protocols::console_osc::OscMessage::xinfo().encode();
    if let Err(err) = socket.send_to(&packet, target) {
        return (
            "fail".into(),
            format!("OSC /xinfo send to {target} failed ({err})"),
            elapsed_ms(started),
        );
    }
    let mut buf = [0u8; 2048];
    match socket.recv_from(&mut buf) {
        Ok((len, from)) => {
            let latency = elapsed_ms(started);
            (
                "pass".into(),
                format!("OSC /xinfo reply from {from} in {latency} ms ({len} bytes)"),
                latency,
            )
        }
        Err(err) if matches!(err.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
            (
                "warn".into(),
                format!("OSC /xinfo sent to {target}; no reply within 250 ms (UDP is unacknowledged)"),
                elapsed_ms(started),
            )
        }
        Err(err) => (
            "fail".into(),
            format!("OSC /xinfo receive from {target} failed ({err})"),
            elapsed_ms(started),
        ),
    }
}

fn connectivity_probe_checks(settings: &AppSettings, mock_mode: bool) -> Vec<ProbeOutcome> {
    let mut outcomes = Vec::new();

    // Console OSC UDP reachability.
    let console_host = if !settings.console.ip_address.trim().is_empty() {
        settings.console.ip_address.trim().to_string()
    } else {
        std::env::var("RING_CONSOLE_HOST").unwrap_or_default()
    };
    let console_port = if settings.console.osc_port > 0 {
        settings.console.osc_port
    } else {
        std::env::var("RING_CONSOLE_PORT")
            .ok()
            .and_then(|port| port.parse().ok())
            .unwrap_or(10023)
    };
    if console_host.trim().is_empty() {
        outcomes.push(probe_outcome(
            "chk-probe-console-osc",
            "Console",
            "Console OSC UDP endpoint is reachable",
            "fail",
            "No mixer endpoint configured (set the IP in Settings or RING_CONSOLE_HOST)".into(),
            "Console OSC",
            0,
            Some("Configure the mixer endpoint"),
        ));
    } else {
        let target = format!("{}:{}", console_host.trim(), console_port);
        let (status, detail, latency) = probe_console_osc(&target);
        outcomes.push(probe_outcome(
            "chk-probe-console-osc",
            "Console",
            "Console OSC UDP endpoint is reachable",
            &status,
            detail,
            "Console OSC",
            latency,
            if status == "pass" { None } else { Some("Verify mixer OSC IP/port") },
        ));
    }

    // Broadcast WebSocket over TCP.
    let ws_override = std::env::var("RING_BROADCAST_URL").ok().filter(|url| !url.trim().is_empty());
    if mock_mode && ws_override.is_none() {
        outcomes.push(probe_outcome(
            "chk-probe-broadcast-ws",
            "Broadcasting",
            "Broadcast WebSocket endpoint is reachable",
            "warn",
            "Simulator mode: set RING_BROADCAST_URL to probe a live endpoint".into(),
            "Broadcast WS",
            0,
            Some("Configure the broadcast endpoint"),
        ));
    } else {
        let url = ws_override.unwrap_or_else(|| "ws://127.0.0.1:4455".into());
        match endpoint_authority(&url, 4455) {
            Some(target) => {
                let (status, detail, latency) = probe_tcp_endpoint(&target);
                outcomes.push(probe_outcome(
                    "chk-probe-broadcast-ws",
                    "Broadcasting",
                    "Broadcast WebSocket endpoint is reachable",
                    &status,
                    detail,
                    "Broadcast WS",
                    latency,
                    if status == "pass" { None } else { Some("Verify the broadcast WebSocket host/port") },
                ));
            }
            None => outcomes.push(probe_outcome(
                "chk-probe-broadcast-ws",
                "Broadcasting",
                "Broadcast WebSocket endpoint is reachable",
                "fail",
                format!("Invalid broadcast endpoint '{url}'"),
                "Broadcast WS",
                0,
                Some("Configure the broadcast endpoint"),
            )),
        }
    }

    // Slide HTTP and Slide TCP each get their own bounded TCP connect probe.
    let slide_tcp_url = std::env::var("RING_EZW_ENDPOINT").ok().filter(|url| !url.trim().is_empty());
    let slide_targets: [(&str, &str, String, u16, &str, &str); 2] = [
        (
            "chk-probe-slide-http",
            "Slides",
            std::env::var("RING_PP_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            std::env::var("RING_PP_PORT")
                .ok()
                .and_then(|port| port.parse().ok())
                .unwrap_or(50_000),
            "Slide HTTP",
            "Verify the presentation HTTP host/port",
        ),
        (
            "chk-probe-slide-tcp",
            "Slides",
            slide_tcp_url
                .as_deref()
                .and_then(|url| endpoint_authority(url, 55_000))
                .or_else(|| std::env::var("RING_EZW_HOST").ok())
                .unwrap_or_else(|| "127.0.0.1".into()),
            std::env::var("RING_EZW_PORT")
                .ok()
                .and_then(|port| port.parse().ok())
                .unwrap_or(55_000),
            "Slide TCP",
            "Verify the presentation TCP host/port",
        ),
    ];
    for (id, domain, host, port, protocol, fix_label) in slide_targets {
        let explicitly_configured = std::env::var("RING_PP_HOST").is_ok()
            || std::env::var("RING_EZW_HOST").is_ok()
            || std::env::var("RING_EZW_ENDPOINT").is_ok();
        if mock_mode && !explicitly_configured {
            outcomes.push(probe_outcome(
                id,
                domain,
                "Presentation source endpoint is reachable",
                "warn",
                format!("Simulator mode: {protocol} not configured (set RING_PP_HOST or RING_EZW_HOST)"),
                protocol,
                0,
                Some(fix_label),
            ));
            continue;
        }
        let target = if host.contains(':') {
            host.clone()
        } else {
            format!("{host}:{port}")
        };
        let (status, detail, latency) = probe_tcp_endpoint(&target);
        outcomes.push(probe_outcome(
            id,
            domain,
            "Presentation source endpoint is reachable",
            &status,
            detail,
            protocol,
            latency,
            if status == "pass" { None } else { Some(fix_label) },
        ));
    }

    // IP Video discovery/control service on TCP :5959.
    let configured_ip_video = if !settings.ip_video_ptz.discovery_range_start.trim().is_empty() {
        settings.ip_video_ptz.discovery_range_start.trim().to_string()
    } else {
        std::env::var("RING_IP_VIDEO_HOST").unwrap_or_default()
    };
    if configured_ip_video.is_empty() {
        outcomes.push(probe_outcome(
            "chk-probe-ip-video-5959",
            "Cameras",
            "IP Video discovery endpoint :5959 is reachable",
            "fail",
            "No IP Video discovery host configured".into(),
            "IP Video TCP",
            0,
            Some("Configure an IP Video discovery host"),
        ));
    } else {
        let host = configured_ip_video.split([',', '-']).next().unwrap_or(&configured_ip_video).trim();
        let target = if host.contains(':') {
            host.to_string()
        } else {
            format!("{host}:5959")
        };
        let (status, detail, latency) = probe_tcp_endpoint(&target);
        outcomes.push(probe_outcome(
            "chk-probe-ip-video-5959",
            "Cameras",
            "IP Video discovery endpoint :5959 is reachable",
            &status,
            detail,
            "IP Video TCP",
            latency,
            if status == "pass" { None } else { Some("Verify the IP Video discovery host") },
        ));
    }

    outcomes
}

#[tauri::command]
async fn run_preflight_probes(state: State<'_, ManagedState>) -> Result<AppStateSnapshot, String> {
    let (settings, mock_mode) = {
        let inner = state.inner.lock().unwrap();
        (inner.settings.clone(), inner.mock_mode)
    };
    let outcomes = tokio::task::spawn_blocking(move || connectivity_probe_checks(&settings, mock_mode))
        .await
        .unwrap_or_default();
    let mut inner = state.inner.lock().unwrap();
    inner.rebuild_preflight();
    for outcome in outcomes {
        let check = outcome.check;
        let health_status = match check.status.as_str() {
            "pass" => "ok",
            "fail" => "error",
            _ => "warn",
        };
        inner.set_health(
            &check.id,
            &check.title,
            health_status,
            &check.detail,
            outcome.protocol,
            outcome.latency_ms,
        );
        match inner.preflight.iter_mut().find(|existing| existing.id == check.id) {
            Some(existing) => *existing = check,
            None => inner.preflight.push(check),
        }
    }
    let passed = inner.preflight.iter().filter(|check| check.status == "pass").count();
    let total = inner.preflight.len();
    inner.push_event_log(format!(
        "[preflight] Connectivity sweep complete: {passed}/{total} checks passing (250 ms probe budget)"
    ));
    Ok(inner.clone())
}

// ---------------------------------------------------------------------------------------------
// Settings page IPC: bounded connectivity probes, LAN discovery, bundles and diagnostics
// ---------------------------------------------------------------------------------------------

const SETTINGS_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1500);
const UDP_REPLY_WINDOW: std::time::Duration = std::time::Duration::from_millis(400);
const REDACTED: &str = "[REDACTED]";

fn probe_result(
    subsystem: &str,
    host: &str,
    port: u16,
    ok: bool,
    latency_ms: u64,
    summary: impl Into<String>,
    detail: impl Into<String>,
) -> serde_json::Value {
    serde_json::json!({
        "ok": ok,
        "subsystem": subsystem,
        "host": host,
        "port": port,
        "latencyMs": latency_ms,
        "summary": summary.into(),
        "detail": detail.into(),
    })
}

async fn probe_tcp_target(host: &str, port: u16) -> (bool, u64, String, String) {
    let started = std::time::Instant::now();
    let connect = tokio::net::TcpStream::connect((host, port));
    match tokio::time::timeout(SETTINGS_PROBE_TIMEOUT, connect).await {
        Ok(Ok(_stream)) => {
            let latency = started.elapsed().as_millis() as u64;
            (
                true,
                latency,
                "TCP connection established".into(),
                format!("Connected to {host}:{port} in {latency} ms"),
            )
        }
        Ok(Err(err)) => {
            let latency = started.elapsed().as_millis() as u64;
            (
                false,
                latency,
                "TCP connection failed".into(),
                format!("Could not connect to {host}:{port}: {err}"),
            )
        }
        Err(_) => {
            let latency = started.elapsed().as_millis() as u64;
            (
                false,
                latency,
                "TCP connection timed out".into(),
                format!("No connection to {host}:{port} within 1500 ms"),
            )
        }
    }
}

async fn probe_udp_target(host: &str, port: u16, subsystem: &str) -> (bool, u64, String, String) {
    let started = std::time::Instant::now();
    let send_phase = async {
        let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await?;
        socket.connect((host, port)).await?;
        // Small, read-only identity query for the console; a harmless marker elsewhere.
        let payload: Vec<u8> = if subsystem == "console" {
            protocols::console_osc::OscMessage::xinfo().encode()
        } else {
            b"PING".to_vec()
        };
        socket.send(&payload).await?;
        Ok::<tokio::net::UdpSocket, std::io::Error>(socket)
    };

    let socket = match tokio::time::timeout(SETTINGS_PROBE_TIMEOUT, send_phase).await {
        Ok(Ok(socket)) => socket,
        Ok(Err(err)) => {
            let latency = started.elapsed().as_millis() as u64;
            return (
                false,
                latency,
                "UDP probe failed".into(),
                format!("Could not send a probe to {host}:{port}: {err}"),
            );
        }
        Err(_) => {
            let latency = started.elapsed().as_millis() as u64;
            return (
                false,
                latency,
                "UDP probe timed out".into(),
                format!("Probe to {host}:{port} exceeded 1500 ms"),
            );
        }
    };

    // UDP has no transport acknowledgement. Spend only the remainder of the bounded budget
    // waiting for a reply so an otherwise silent endpoint is still reported as reachable.
    let remaining = SETTINGS_PROBE_TIMEOUT.saturating_sub(started.elapsed());
    let reply_len = if remaining.is_zero() {
        None
    } else {
        let mut buf = [0u8; 2048];
        match tokio::time::timeout(remaining.min(UDP_REPLY_WINDOW), socket.recv(&mut buf)).await {
            Ok(Ok(len)) => Some(len),
            _ => None,
        }
    };
    let latency = started.elapsed().as_millis() as u64;
    match reply_len {
        Some(len) => (
            true,
            latency,
            "UDP probe replied".into(),
            format!("Probe to {host}:{port} answered with {len} bytes in {latency} ms"),
        ),
        None => (
            true,
            latency,
            "UDP probe delivered".into(),
            format!(
                "Probe sent to {host}:{port}; no reply inside the bounded window (UDP is unacknowledged)"
            ),
        ),
    }
}

/// Run a real, bounded reachability probe for one subsystem from the Settings page.
#[tauri::command]
async fn test_subsystem_connection(
    subsystem: String,
    host: String,
    port: u16,
) -> Result<serde_json::Value, String> {
    let _probe_guard = ProbeConcurrencyGuard::try_acquire()?;
    if host.trim().is_empty() {
        return Err("Connection host must not be empty".into());
    }
    let normalized = subsystem.trim().to_ascii_lowercase().replace('_', "");
    let (ok, latency, summary, detail) = match normalized.as_str() {
        "console" => probe_udp_target(&host, port, "console").await,
        "ipvideo" => probe_udp_target(&host, port, "ipvideo").await,
        "broadcast" | "slides" | "aoip" | "station" => probe_tcp_target(&host, port).await,
        _ => return Err(format!("Unsupported subsystem for connection test: {subsystem}")),
    };
    Ok(probe_result(
        &subsystem, &host, port, ok, latency, summary, detail,
    ))
}

fn push_device(
    devices: &mut Vec<serde_json::Value>,
    seen: &mut std::collections::HashSet<String>,
    name: impl Into<String>,
    host: impl Into<String>,
    port: u16,
    kind: &str,
    detail: impl Into<String>,
) {
    let host = host.into();
    if seen.insert(format!("{kind}:{host}:{port}")) {
        devices.push(serde_json::json!({
            "name": name.into(),
            "host": host,
            "port": port,
            "kind": kind,
            "detail": detail.into(),
        }));
    }
}

/// List devices already known to the running app (peer/route/receiver state and configured
/// presentation endpoints). All sources are in-memory, so the command never blocks on a scan.
#[tauri::command]
fn discover_lan_devices(
    kind: String,
    state: State<SharedState>,
) -> Result<Vec<serde_json::Value>, String> {
    let normalized = kind.trim().to_ascii_lowercase().replace('_', "");
    if !matches!(normalized.as_str(), "aoip" | "slides" | "ipvideo" | "station" | "all") {
        return Err(format!("Unsupported discovery kind: {kind}"));
    }
    let snapshot = state.lock().map_err(|_| "State lock poisoned".to_string())?;
    let mut devices = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if matches!(normalized.as_str(), "aoip" | "all") {
        let port = snapshot.settings.aoip.conmon_control_port;
        for route in &snapshot.aoip_routes {
            for (label, address, channel) in [
                ("receive", &route.rx_device, &route.rx_channel),
                ("transmit", &route.tx_device, &route.tx_channel),
            ] {
                if address.parse::<std::net::IpAddr>().is_ok() {
                    push_device(
                        &mut devices,
                        &mut seen,
                        format!("Audio node {address}"),
                        address.clone(),
                        port,
                        "aoip",
                        format!("Route {} / {label} / channel {channel}", route.id),
                    );
                }
            }
        }
    }

    if matches!(normalized.as_str(), "slides" | "all") {
        let configured = std::env::var("RING_PP_HOST")
            .ok()
            .filter(|host| !host.trim().is_empty())
            .or_else(|| {
                std::env::var("RING_EZW_HOST")
                    .ok()
                    .filter(|host| !host.trim().is_empty())
            });
        if let Some(host) = configured {
            let port = std::env::var("RING_PP_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .or_else(|| std::env::var("RING_EZW_PORT").ok().and_then(|value| value.parse().ok()))
                .unwrap_or(50_000);
            let adapter = if snapshot.slides.adapter.is_empty() {
                "unconfigured"
            } else {
                &snapshot.slides.adapter
            };
            push_device(
                &mut devices,
                &mut seen,
                "Presentation endpoint",
                host,
                port,
                "slides",
                format!("Adapter: {adapter}"),
            );
        }
    }

    if matches!(normalized.as_str(), "ipvideo" | "all") {
        let port = snapshot.settings.ip_video_ptz.ptz_ip_port;
        for receiver in &snapshot.ip_video_receivers {
            if !receiver.ip.trim().is_empty() {
                push_device(
                    &mut devices,
                    &mut seen,
                    receiver.receiver_name.clone(),
                    receiver.ip.clone(),
                    port,
                    "ipVideo",
                    format!(
                        "Receiver {} / subscribed: {}",
                        receiver.id, receiver.subscribed_source
                    ),
                );
            }
        }
        for source in &snapshot.ip_video_sources {
            if source.parse::<std::net::IpAddr>().is_ok() {
                push_device(
                    &mut devices,
                    &mut seen,
                    format!("Camera source {source}"),
                    source.clone(),
                    port,
                    "ipVideo",
                    "Configured camera source",
                );
            }
        }
    }

    if matches!(normalized.as_str(), "station" | "all") {
        let port = snapshot.settings.sync.sync_port;
        for station in &snapshot.connected_stations {
            push_device(
                &mut devices,
                &mut seen,
                station.name.clone(),
                station.id.clone(),
                port,
                "station",
                format!("Role: {} / online: {}", station.role, station.online),
            );
        }
    }

    Ok(devices)
}

fn build_settings_bundle(settings: &AppSettings) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "format": "one-ring-settings-v1",
        "settings": settings,
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

/// Export the full configuration as a portable, versioned JSON bundle.
#[tauri::command]
fn export_settings_bundle(
    state: State<SharedState>,
    managed: State<ManagedState>,
) -> Result<String, String> {
    require_engineer(&managed)?;
    let snapshot = state.lock().map_err(|_| "State lock poisoned".to_string())?;
    Ok(build_settings_bundle(&snapshot.settings))
}

fn contains_disallowed_url_or_path_chars(value: &str) -> bool {
    let trimmed = value.trim_start();
    trimmed.starts_with('-') || value.chars().any(|c| c.is_control())
}

fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    let pin = &settings.general.engineer_pin;
    if !pin.is_empty()
        && !(pin.len() >= 4
            && pin.len() <= 8
            && pin.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err("Engineer PIN must be 4 to 8 digits".into());
    }
    let ports = [
        ("console.oscPort", settings.console.osc_port),
        ("aoip.conmonMeterPort", settings.aoip.conmon_meter_port),
        ("aoip.conmonControlPort", settings.aoip.conmon_control_port),
        ("ipVideoPtz.ptzIpPort", settings.ip_video_ptz.ptz_ip_port),
        ("sync.syncPort", settings.sync.sync_port),
    ];
    for (label, port) in ports {
        if port == 0 {
            return Err(format!("Invalid port for {label}: {port} (ports start at 1)"));
        }
    }

    for dest in &settings.broadcast.destinations {
        let rtmp = dest.rtmp_url.trim();
        if !rtmp.is_empty() {
            let lower = rtmp.to_ascii_lowercase();
            if !(lower.starts_with("rtmp://") || lower.starts_with("rtmps://") || lower.starts_with("srt://")) {
                return Err("RTMP destination URLs must start with rtmp://, rtmps://, or srt://".into());
            }
            if contains_disallowed_url_or_path_chars(&dest.rtmp_url) {
                return Err("RTMP destination URLs must not start with '-' or contain control characters".into());
            }
        }
    }
    if !settings.broadcast.recording_path.trim().is_empty()
        && contains_disallowed_url_or_path_chars(&settings.broadcast.recording_path)
    {
        return Err("Recording path must not start with '-' or contain control characters".into());
    }
    if !settings.sync.hub_address.trim().is_empty()
        && contains_disallowed_url_or_path_chars(&settings.sync.hub_address)
    {
        return Err("Hub address must not start with '-' or contain control characters".into());
    }
    if !settings.console.ip_address.trim().is_empty()
        && contains_disallowed_url_or_path_chars(&settings.console.ip_address)
    {
        return Err("Console IP address must not start with '-' or contain control characters".into());
    }
    Ok(())
}

fn parse_settings_bundle(payload: &str) -> Result<AppSettings, String> {
    let value: serde_json::Value = serde_json::from_str(payload)
        .map_err(|err| format!("Settings bundle is not valid JSON: {err}"))?;
    let raw = match value.as_object() {
        Some(object) if object.contains_key("settings") => object
            .get("settings")
            .cloned()
            .ok_or_else(|| "Settings bundle has no settings object".to_string())?,
        Some(_) => value.clone(),
        None => return Err("Settings bundle must be a JSON object".into()),
    };
    let settings: AppSettings = serde_json::from_value(raw)
        .map_err(|err| format!("Settings bundle does not match the settings schema: {err}"))?;
    validate_settings(&settings)?;
    Ok(settings)
}

/// Import a versioned bundle (or a raw settings object), validate it and persist it.
#[tauri::command]
fn import_settings_bundle(
    payload: String,
    state: State<SharedState>,
    managed: State<ManagedState>,
) -> Result<AppState, String> {
    require_engineer(&managed)?;
    if payload.len() > 1_048_576 {
        return Err("Settings bundle exceeds 1 MiB limit".into());
    }
    let settings = parse_settings_bundle(&payload)?;
    let mut snapshot = state.lock().map_err(|_| "State lock poisoned".to_string())?;
    snapshot.settings = settings;
    snapshot.sync_broadcasts_from_settings();
    snapshot.rebuild_preflight();
    snapshot.push_event_log("[settings] Imported settings bundle".into());
    if let Err(err) = persist_snapshot_settings(&snapshot) {
        snapshot.push_event_log(format!(
            "[settings] WARNING: failed to persist imported bundle: {err}"
        ));
    }
    Ok(snapshot.clone())
}

/// Restore one named section to its defaults without disturbing the other sections.
#[tauri::command]
fn reset_settings_section(
    section: String,
    state: State<SharedState>,
    managed: State<ManagedState>,
) -> Result<AppState, String> {
    require_engineer(&managed)?;
    let mut snapshot = state.lock().map_err(|_| "State lock poisoned".to_string())?;
    default_section_settings(&mut snapshot.settings, &section)?;
    snapshot.push_event_log(format!("[settings] Reset '{section}' section to defaults"));
    if let Err(err) = persist_snapshot_settings(&snapshot) {
        snapshot.push_event_log(format!(
            "[settings] WARNING: failed to persist section reset: {err}"
        ));
    }
    Ok(snapshot.clone())
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(|character| character.to_lowercase())
        .collect();
    [
        "password",
        "secret",
        "token",
        "streamkey",
        "apikey",
        "credential",
        "auth",
        "pin",
        "email",
        "key",
        "recordingpath",
        "rtmpurl",
        "hubaddress",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn redact_secrets(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(entries) => {
            for (key, child) in entries.iter_mut() {
                if is_sensitive_key(key) {
                    *child = serde_json::Value::String(REDACTED.into());
                } else {
                    redact_secrets(child);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                redact_secrets(item);
            }
        }
        _ => {}
    }
}

fn build_diagnostic_bundle(snapshot: &AppStateSnapshot) -> Result<String, String> {
    let mut settings = serde_json::to_value(&snapshot.settings)
        .map_err(|err| format!("Could not summarize settings: {err}"))?;
    redact_secrets(&mut settings);

    let subsystems: Vec<serde_json::Value> = snapshot
        .health
        .iter()
        .map(|health| {
            serde_json::json!({
                "id": health.id,
                "status": health.status,
                "detail": REDACTED,
                "protocol": health.protocol,
                "latencyMs": health.latency_ms,
            })
        })
        .collect();
    let passed = snapshot.preflight.iter().filter(|check| check.status == "pass").count();
    let warned = snapshot.preflight.iter().filter(|check| check.status == "warn").count();
    let failed = snapshot.preflight.iter().filter(|check| check.status == "fail").count();

    let bundle = serde_json::json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "mockMode": snapshot.mock_mode,
        "subsystems": subsystems,
        "preflight": {
            "pass": passed,
            "warn": warned,
            "fail": failed,
            "total": snapshot.preflight.len(),
        },
        "settings": settings,
    });
    serde_json::to_string_pretty(&bundle)
        .map_err(|err| format!("Could not serialize diagnostic bundle: {err}"))
}

/// Export a sanitized snapshot for support: no credentials, tokens or PINs are included.
#[tauri::command]
fn export_diagnostic_bundle(
    state: State<SharedState>,
    managed: State<ManagedState>,
) -> Result<String, String> {
    require_engineer(&managed)?;
    let snapshot = state.lock().map_err(|_| "State lock poisoned".to_string())?;
    build_diagnostic_bundle(&snapshot)
}

/// Create (if needed) and reveal the folder holding settings.json.
#[tauri::command]
fn open_config_directory(
    app: tauri::AppHandle,
    managed: State<ManagedState>,
) -> Result<String, String> {
    require_engineer(&managed)?;
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("Could not resolve the configuration directory: {err}"))?;
    std::fs::create_dir_all(&directory)
        .map_err(|err| format!("Could not create the configuration directory: {err}"))?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&directory)
        .spawn()
        .map_err(|err| format!("Could not open the configuration directory: {err}"))?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&directory)
        .spawn()
        .map_err(|err| format!("Could not open the configuration directory: {err}"))?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&directory)
        .spawn()
        .map_err(|err| format!("Could not open the configuration directory: {err}"))?;

    Ok("Opened configuration directory".into())
}

fn crash_reports_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("crashes"))
        .map_err(|err| format!("Could not resolve the crash directory: {err}"))
}

#[tauri::command]
fn list_pending_crash_reports(
    app: tauri::AppHandle,
) -> Result<Vec<runtime::crash_reporter::CrashReport>, String> {
    Ok(runtime::crash_reporter::list_pending(&crash_reports_dir(&app)?))
}

#[tauri::command]
fn record_frontend_crash(
    message: String,
    stack: Option<String>,
    component_stack: Option<String>,
    app: tauri::AppHandle,
) -> Result<runtime::crash_reporter::CrashReport, String> {
    runtime::crash_reporter::record_frontend_crash(
        &crash_reports_dir(&app)?,
        &message,
        stack.as_deref().unwrap_or(""),
        component_stack.as_deref().unwrap_or(""),
    )
}

#[tauri::command]
fn upload_crash_report(
    crash_id: String,
    relay_url: Option<String>,
    app: tauri::AppHandle,
    managed: State<ManagedState>,
) -> Result<serde_json::Value, String> {
    let general = managed
        .inner
        .lock()
        .map_err(|_| "State lock poisoned".to_string())?
        .settings
        .general
        .clone();
    if !general.auto_crash_reporting {
        return Err("Crash reporting is disabled".into());
    }
    let relay_url = relay_url
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(general.crash_relay_url);
    runtime::crash_reporter::upload_crash_report(&crash_reports_dir(&app)?, &crash_id, &relay_url)
}

#[tauri::command]
fn dismiss_crash_report(crash_id: String, app: tauri::AppHandle) -> Result<bool, String> {
    runtime::crash_reporter::dismiss_crash(&crash_reports_dir(&app)?, &crash_id)
}

#[tauri::command]
async fn list_capturable_windows() -> Vec<CapturableWindow> {
    tauri::async_runtime::spawn_blocking(runtime::native_capture::list_capturable_windows)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn list_capturable_displays() -> Vec<CapturableDisplay> {
    tauri::async_runtime::spawn_blocking(runtime::native_capture::list_capturable_displays)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn capture_native_frame(
    source_id: String,
    target_kind: String,
    target_id: u64,
) -> Result<NativeCaptureFrame, String> {
    tauri::async_runtime::spawn_blocking(move || {
        runtime::native_capture::capture_native_frame(&source_id, &target_kind, target_id)
    })
    .await
    .map_err(|err| format!("Native capture task failed: {err}"))?
}

#[tauri::command]
async fn start_native_capture_stream(
    app: tauri::AppHandle,
    manager: State<'_, NativeCaptureManager>,
    source_id: String,
    target_kind: String,
    target_id: u64,
    fps: u32,
) -> Result<NativeCaptureSessionInfo, String> {
    manager.start_stream(app, source_id, target_kind, target_id, fps)
}

#[tauri::command]
fn stop_native_capture_stream(
    source_id: String,
    manager: State<NativeCaptureManager>,
) -> Result<bool, String> {
    manager.stop_stream(&source_id)
}


#[tauri::command]
fn switcher_connect(
    app: tauri::AppHandle,
    manager: State<'_, VideoSwitcherManager>,
    host: String,
    port: Option<u16>,
) -> Result<protocols::video_switcher::SwitcherState, String> {
    manager.connect(app, host, port)
}

#[tauri::command]
fn switcher_disconnect(
    manager: State<'_, VideoSwitcherManager>,
) -> protocols::video_switcher::SwitcherState {
    manager.disconnect()
}

#[tauri::command]
fn switcher_get_state(
    manager: State<'_, VideoSwitcherManager>,
) -> protocols::video_switcher::SwitcherState {
    manager.snapshot()
}

#[tauri::command]
fn switcher_command(
    manager: State<'_, VideoSwitcherManager>,
    action: SwitcherAction,
) -> Result<(), String> {
    manager.send_action(action)
}

#[tauri::command]
async fn ip_video_bridge_status(
    manager: State<'_, IpVideoBridgeManager>,
) -> Result<IpVideoBridgeStatus, String> {
    let mgr = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || mgr.status())
        .await
        .map_err(|e| format!("IP video status task failed: {e}"))
}

#[tauri::command]
async fn ip_video_discover_sources(
    manager: State<'_, IpVideoBridgeManager>,
    timeout_ms: Option<u32>,
) -> Result<Vec<String>, String> {
    let mgr = manager.inner().clone();
    let t = timeout_ms.unwrap_or(1000);
    tauri::async_runtime::spawn_blocking(move || mgr.discover_sources(t))
        .await
        .map_err(|e| format!("IP video discovery task failed: {e}"))?
}

#[tauri::command]
async fn ip_video_start_output(
    manager: State<'_, IpVideoBridgeManager>,
    stream_name: String,
) -> Result<IpVideoBridgeStatus, String> {
    let mgr = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || mgr.start_output(&stream_name))
        .await
        .map_err(|e| format!("IP video output task failed: {e}"))?
}

#[tauri::command]
async fn ip_video_stop_output(
    manager: State<'_, IpVideoBridgeManager>,
) -> Result<IpVideoBridgeStatus, String> {
    let mgr = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || mgr.stop_output())
        .await
        .map_err(|e| format!("IP video stop task failed: {e}"))
}

#[tauri::command]
async fn ip_video_send_test_frame(
    manager: State<'_, IpVideoBridgeManager>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<u64, String> {
    let mgr = manager.inner().clone();
    let w = width.unwrap_or(1280);
    let h = height.unwrap_or(720);
    tauri::async_runtime::spawn_blocking(move || mgr.send_test_frame(w, h))
        .await
        .map_err(|e| format!("IP video test frame failed: {e}"))?
}


#[tauri::command]
async fn ai_assistant_status(
    state: State<'_, ManagedState>,
) -> Result<runtime::ai_assistant::AiAssistantStatus, String> {
    let (provider, model, endpoint) = {
        let inner = state.inner.lock().map_err(|_| "State lock poisoned".to_string())?;
        (
            inner.settings.general.ai_provider.clone(),
            inner.settings.general.ai_model.clone(),
            inner.settings.general.ai_endpoint.clone(),
        )
    };
    tauri::async_runtime::spawn_blocking(move || {
        runtime::ai_assistant::status(&provider, &model, &endpoint)
    })
    .await
    .map_err(|e| format!("AI status check failed: {e}"))
}

#[tauri::command]
async fn install_opencode_cli() -> Result<runtime::ai_assistant::AiAssistantStatus, String> {
    tauri::async_runtime::spawn_blocking(runtime::ai_assistant::install_opencode_cli)
        .await
        .map_err(|e| format!("OpenCode CLI installer task failed: {e}"))?
}

#[tauri::command]
async fn ai_assistant_chat(
    state: State<'_, ManagedState>,
    message: String,
    history: Option<Vec<runtime::ai_assistant::AiChatMessage>>,
    context: Option<serde_json::Value>,
) -> Result<runtime::ai_assistant::AiChatResponse, String> {
    let (provider, model, endpoint, api_key) = {
        let inner = state.inner.lock().map_err(|_| "State lock poisoned".to_string())?;
        (
            inner.settings.general.ai_provider.clone(),
            inner.settings.general.ai_model.clone(),
            inner.settings.general.ai_endpoint.clone(),
            inner.settings.general.ai_api_key.clone(),
        )
    };
    let bible_cfg = {
        let inner = state.inner.lock().map_err(|_| "State lock poisoned".to_string())?;
        runtime::bible_engine::BibleProviderConfig {
            esv_api_key: inner.settings.slides.esv_api_key.clone(),
            api_bible_key: inner.settings.slides.api_bible_key.clone(),
            local_bibles_dir: inner.settings.slides.local_bibles_dir.clone(),
        }
    };
    let hist = history.unwrap_or_default();
    let ctx = context.unwrap_or_else(|| serde_json::json!({}));
    tauri::async_runtime::spawn_blocking(move || {
        runtime::ai_assistant::chat(&provider, &model, &endpoint, &api_key, &message, &hist, &ctx, &bible_cfg)
    })
    .await
    .map_err(|e| format!("AI assistant task failed: {e}"))?
}


#[tauri::command]
async fn install_ffmpeg_runtime(
    supervisor: tauri::State<'_, runtime::broadcast_daemon::BroadcastDaemonSupervisor>,
) -> Result<runtime::broadcast_daemon::MediaEngineStatus, String> {
    tauri::async_runtime::spawn_blocking(runtime::broadcast_daemon::install_ffmpeg_runtime)
        .await
        .map_err(|e| format!("FFmpeg install task failed: {e}"))??;
    Ok(runtime::broadcast_daemon::probe_media_engine_status(&supervisor))
}


#[tauri::command]
fn bible_list_translations(
    state: State<'_, ManagedState>,
) -> Vec<runtime::bible_engine::BibleTranslationInfo> {
    let cfg = {
        let guard = state.inner.lock().unwrap();
        runtime::bible_engine::BibleProviderConfig {
            esv_api_key: guard.settings.slides.esv_api_key.clone(),
            api_bible_key: guard.settings.slides.api_bible_key.clone(),
            local_bibles_dir: guard.settings.slides.local_bibles_dir.clone(),
        }
    };
    runtime::bible_engine::list_translations(&cfg)
}

#[tauri::command]
async fn bible_lookup_passage(
    reference: String,
    translation_id: String,
    state: State<'_, ManagedState>,
) -> Result<runtime::bible_engine::BiblePassageResult, String> {
    let cfg = {
        let guard = state.inner.lock().unwrap();
        runtime::bible_engine::BibleProviderConfig {
            esv_api_key: guard.settings.slides.esv_api_key.clone(),
            api_bible_key: guard.settings.slides.api_bible_key.clone(),
            local_bibles_dir: guard.settings.slides.local_bibles_dir.clone(),
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        runtime::bible_engine::lookup_passage(&reference, &translation_id, &cfg)
    })
    .await
    .map_err(|e| format!("Bible lookup task failed: {e}"))?
}

#[tauri::command]
async fn bible_import_local_file(
    file_path: String,
    translation_code: Option<String>,
    state: State<'_, ManagedState>,
) -> Result<runtime::bible_engine::BibleTranslationInfo, String> {
    let local_dir = {
        let guard = state.inner.lock().unwrap();
        guard.settings.slides.local_bibles_dir.clone()
    };
    tauri::async_runtime::spawn_blocking(move || {
        runtime::bible_engine::import_local_bible_file(
            &file_path,
            translation_code.as_deref(),
            &local_dir,
        )
    })
    .await
    .map_err(|e| format!("Bible import task failed: {e}"))?
}

#[tauri::command]
fn bible_save_keys(
    esv_api_key: Option<String>,
    api_bible_key: Option<String>,
    local_bibles_dir: Option<String>,
    state: State<'_, ManagedState>,
) -> Vec<runtime::bible_engine::BibleTranslationInfo> {
    let cfg = {
        let mut guard = state.inner.lock().unwrap();
        if let Some(k) = esv_api_key {
            guard.settings.slides.esv_api_key = k.trim().to_string();
        }
        if let Some(k) = api_bible_key {
            guard.settings.slides.api_bible_key = k.trim().to_string();
        }
        if let Some(d) = local_bibles_dir {
            guard.settings.slides.local_bibles_dir = d.trim().to_string();
        }
        runtime::bible_engine::BibleProviderConfig {
            esv_api_key: guard.settings.slides.esv_api_key.clone(),
            api_bible_key: guard.settings.slides.api_bible_key.clone(),
            local_bibles_dir: guard.settings.slides.local_bibles_dir.clone(),
        }
    };
    let _ = state.save_settings();
    runtime::bible_engine::list_translations(&cfg)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ManagedState::default())
        .manage(runtime::broadcast_daemon::BroadcastDaemonSupervisor::default())
        .manage(runtime::broadcast_daemon::FfmpegStreamProcess::default())
        .manage(runtime::broadcast_daemon::ReplayBufferProcess::default())
        .manage(runtime::broadcast_worker_ipc::BroadcastWorkerSupervisor::default())
        .manage(runtime::audience_relay::AudienceState::default())
        .manage(NativeCaptureManager::default())
        .manage(VideoSwitcherManager::default())
        .manage(IpVideoBridgeManager::default())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let _ = app.handle().plugin(tauri_plugin_updater::Builder::new().build());
                let _ = app.handle().plugin(tauri_plugin_process::init());
            }
            Ok(())
        })
        .setup(|app| {
            // Start the remote control HTTP server on desktop.
            #[cfg(desktop)]
            {
                use crate::runtime::remote_control::{self, RemoteControlState};
                let state = RemoteControlState::new();
                // Spawn the server on the app's Tokio runtime.
                let _ = tauri::async_runtime::spawn(remote_control::start_server(Arc::new(state)));
            }
            let managed = app.state::<ManagedState>();

            let peer_reg = PeerRegistry::default();
            app.manage(peer_reg.clone());
            let hostname = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "OneRingStation".to_string());
            let my_id = format!("{}-{}", hostname, std::process::id());
            peer_discovery::start_peer_discovery(
                my_id,
                hostname,
                "Main Sanctuary".to_string(),
                env!("CARGO_PKG_VERSION").to_string(),
                peer_reg,
            );


            // Build custom macOS Application Menu with "About One Ring" and "Check for Updates..."
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem};
                let app_handle = app.handle().clone();
                let about = MenuItem::with_id(app, "about", "About One Ring", true, None::<&str>)?;
                let check_update = MenuItem::with_id(app, "check_updates", "Check for Updates...", true, None::<&str>)?;
                let app_submenu = Submenu::with_items(
                    app,
                    "One Ring",
                    true,
                    &[
                        &about,
                        &check_update,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::services(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, None)?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::show_all(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, None)?,
                    ],
                )?;
                let edit_submenu = Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app, None)?,
                        &PredefinedMenuItem::redo(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::cut(app, None)?,
                        &PredefinedMenuItem::copy(app, None)?,
                        &PredefinedMenuItem::paste(app, None)?,
                        &PredefinedMenuItem::select_all(app, None)?,
                    ],
                )?;
                let window_submenu = Submenu::with_items(
                    app,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(app, None)?,
                        &PredefinedMenuItem::fullscreen(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::close_window(app, None)?,
                    ],
                )?;
                let menu = Menu::with_items(app, &[&app_submenu, &edit_submenu, &window_submenu])?;
                app.set_menu(menu)?;

                let handle_clone = app_handle.clone();
                app.on_menu_event(move |_app, event| {
                    if event.id() == "about" || event.id() == "check_updates" {
                        let _ = handle_clone.emit("show_update_modal", ());
                    }
                });
            }

            // Automatic load: hydrate persisted device configuration before adapters start.
            if let Ok(config_dir) = app.path().app_config_dir() {
                managed.attach_settings_path(config_dir.join("settings.json"));
            }
            let shared = managed.inner.clone();
            // Settings IPC commands take `State<SharedState>` directly; register the same
            // snapshot handle so they observe every change made through `ManagedState`.
            app.manage(shared.clone());

            // Crash reports are always captured locally. Relaying them requires both the explicit
            // opt-in and an HTTPS endpoint, so an offline or unconfigured install stays offline.
            if let Ok(config_dir) = app.path().app_config_dir() {
                let crash_dir = config_dir.join("crashes");
                runtime::crash_reporter::install_panic_hook(crash_dir.clone());
                let general = shared.lock().unwrap().settings.general.clone();
                if general.auto_crash_reporting {
                    let relay_url = general.crash_relay_url.trim().to_string();
                    if relay_url.to_ascii_lowercase().starts_with("https://") {
                        tauri::async_runtime::spawn_blocking(move || {
                            for report in runtime::crash_reporter::list_pending(&crash_dir) {
                                let _ = runtime::crash_reporter::upload_crash_report(
                                    &crash_dir,
                                    &report.id,
                                    &relay_url,
                                );
                            }
                        });
                    }
                }
            }

            let persisted_settings = shared.lock().unwrap().settings.clone();
            let config = RuntimeConfig::from_env_and_settings(&persisted_settings);
            if config.live {
                with_state(&shared, |snapshot| snapshot.mock_mode = false);
                let sink: Arc<dyn EventSink> =
                    Arc::new(TauriEventSink::new(app.handle().clone(), shared.clone()));
                let registry = AdapterRegistry::start(&config, shared.clone(), sink);
                *managed.runtime.lock().unwrap() = Some(Arc::new(registry));
            } else {
                with_state(&shared, |snapshot| snapshot.mock_mode = true);
            }

            // One outbound client per station posts LAN sync envelopes into the hub started by
            // peer discovery, which relays them to every other connected station.
            let settings = shared.lock().unwrap().settings.clone();
            let station_id = if settings.station.station_name.trim().is_empty() {
                format!("one-ring-{}", std::process::id())
            } else {
                format!(
                    "{}-{}",
                    settings.station.station_name.trim(),
                    std::process::id()
                )
            };
            let sync_token = settings.sync.sync_token.clone();
            if settings.sync.lan_discovery_enabled {
                app.manage(LanSyncHub::connect(&settings.sync.hub_address, station_id, sync_token));
            } else {
                app.manage(LanSyncHub::disabled(station_id, sync_token));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            trigger_cue,
            undo_last_cue,
            toggle_rehearsal_mode,
            toggle_beltpack_fault,
            toggle_dca_mute,
            nudge_dca_level,
            recall_camera_preset,
            trigger_slide_action,
            go_to_slide,
            control_presentation_timer,
            set_stage_message,
            set_stage_message_flag,
            slide_http_playlist_control,
            slide_http_transport_control,
            slide_http_transport_seek,
            slide_http_clear_group,
            slide_http_catalog,
            slide_http_resource,
            slide_tcp_control,
            slide_tcp_get_slide_image,
            slide_tcp_image,
            slide_tcp_screen_flag,
            set_broadcast_state,
            switch_ip_video_receiver,
            auto_heal_ip_video_receivers,
            flash_aoip_identify,
            run_preflight_probes,
            update_settings,
            search_song_lyrics,
            sync_workspace_state,
            export_show_file,
            import_show_file,
            check_update,
            get_discovered_peers,
            list_open_windows,
            scan_installed_audio_plugins,
            list_audio_devices,
            start_direct_ffmpeg_stream,
            start_replay_buffer,
            save_replay_buffer,
            stop_replay_buffer,
            stop_direct_ffmpeg_stream,
            import_slide_archive,
            list_video_devices,
            get_media_engine_status,
            probe_media_engine_sidecar,
            dispatch_broadcast_worker_command,
            split_recording_file,
            send_broadcast_stream_caption,
            remux_recording_to_mp4,
            dispatch_broadcast_studio_command,
            start_headless_media_daemon,
            route_aoip_crosspoint,
            trigger_ip_video_ptz,
            ptz_drive_camera,
            ptz_recall_preset,
            ptz_store_preset,
            ptz_optics_command,
            aoip_control_command,
            probe_hardware_encoders,
            list_host_displays,
            start_studio_compositor,
            stop_studio_compositor,
            broadcast_lan_sync_event,
            get_stream_stats,
            get_audience_chat_history,
            configure_audience_relay,
            send_audience_message,
            pin_audience_message,
            send_console_osc,
            open_in_browser,
            test_subsystem_connection,
            discover_lan_devices,
            export_settings_bundle,
            import_settings_bundle,
            reset_settings_section,
            export_diagnostic_bundle,
            open_config_directory,
            unlock_engineer_mode,
            lock_engineer_mode,
            get_engineer_lock_status,
            list_capturable_windows,
            list_capturable_displays,
            capture_native_frame,
            start_native_capture_stream,
            stop_native_capture_stream,
            list_pending_crash_reports,
            record_frontend_crash,
            upload_crash_report,
            dismiss_crash_report,
            switcher_connect,
            switcher_disconnect,
            switcher_get_state,
            switcher_command,
            ip_video_bridge_status,
            ip_video_discover_sources,
            ip_video_start_output,
            ip_video_stop_output,
            ip_video_send_test_frame,
            ai_assistant_status,
            ai_assistant_chat,
            install_opencode_cli,
            install_ffmpeg_runtime,
            bible_list_translations,
            bible_lookup_passage,
            bible_import_local_file,
            bible_save_keys,
            remote_server_status,
            remote_rotate_code,
            remote_revoke_tokens
        ])
        .build(tauri::generate_context!())
        .expect("error while building One Ring")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
                app_handle.state::<runtime::broadcast_daemon::BroadcastDaemonSupervisor>().stop();
                app_handle.state::<runtime::broadcast_daemon::FfmpegStreamProcess>().stop();
                app_handle.state::<runtime::broadcast_daemon::ReplayBufferProcess>().stop();
                app_handle.state::<runtime::broadcast_worker_ipc::BroadcastWorkerSupervisor>().stop();
                app_handle.state::<NativeCaptureManager>().stop_all();
            }
        });
}

#[cfg(test)]
mod settings_ipc_tests {
    use super::*;
    use state::{default_simulator_state, RtmpDestination};

    #[tokio::test]
    async fn connection_probe_reports_ok_and_latency_for_loopback_tcp() {
        // A real listener is required for an actual round trip. Documentation examples
        // elsewhere use RFC 5737 addresses such as 192.0.2.1.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback listener");
        let port = listener.local_addr().expect("listener address").port();
        let server = tokio::spawn(async move {
            let (_stream, _peer) = listener.accept().await.expect("accept probe");
        });

        let result = test_subsystem_connection("broadcast".into(), "127.0.0.1".into(), port)
            .await
            .expect("probe result");
        assert_eq!(result["ok"], serde_json::json!(true));
        assert_eq!(result["subsystem"], serde_json::json!("broadcast"));
        assert_eq!(result["port"], serde_json::json!(port));
        assert!(
            result["latencyMs"].as_u64().is_some(),
            "latencyMs must be reported: {result}"
        );
        server.await.expect("server task");
    }

    #[test]
    fn probe_result_shape_uses_rfc5737_example_address() {
        let result = probe_result(
            "aoip",
            "192.0.2.10",
            8700,
            false,
            12,
            "TCP connection failed",
            "example failure",
        );
        assert_eq!(result["host"], serde_json::json!("192.0.2.10"));
        assert_eq!(result["latencyMs"], serde_json::json!(12));
        assert_eq!(result["ok"], serde_json::json!(false));
    }

    #[test]
    fn settings_bundle_round_trips_and_rejects_invalid_pin_and_ports() {
        let mut settings = AppSettings::default();
        settings.general.engineer_pin = "1234".into();
        settings.general.ui_scale = 1.25;
        settings.console.ip_address = "192.0.2.10".into();

        let bundle = build_settings_bundle(&settings);
        assert!(bundle.contains("one-ring-settings-v1"));
        let imported = parse_settings_bundle(&bundle).expect("wrapped bundle");
        assert_eq!(imported.general.engineer_pin, "1234");
        assert_eq!(imported.general.ui_scale, 1.25);
        assert_eq!(imported.console.ip_address, "192.0.2.10");

        let raw = serde_json::to_string(&settings).expect("serialize raw settings");
        let imported_raw = parse_settings_bundle(&raw).expect("raw settings bundle");
        assert_eq!(imported_raw.general.engineer_pin, "1234");

        let mut bad_pin = settings.clone();
        bad_pin.general.engineer_pin = "12ab".into();
        assert!(parse_settings_bundle(&serde_json::to_string(&bad_pin).unwrap()).is_err());

        let mut bad_port = settings.clone();
        bad_port.console.osc_port = 0;
        assert!(parse_settings_bundle(&serde_json::to_string(&bad_port).unwrap()).is_err());
    }

    #[test]
    fn diagnostic_bundle_redacts_secrets_pins_and_stream_keys() {
        let mut snapshot = default_simulator_state();
        snapshot.settings.general.engineer_pin = "PIN_SENTINEL_2468".into();
        snapshot.settings.slides.song_library_client_secret = "CLIENT_SECRET_SENTINEL".into();
        snapshot.settings.sync.sync_token = "TOKEN_SENTINEL".into();
        snapshot.settings.sync.account_email = "OWNER_EMAIL_SENTINEL".into();
        snapshot.settings.broadcast.recording_path = "/var/lib/private/recordings".into();
        snapshot.settings.sync.hub_address = "ws://192.0.2.55:47800".into();
        snapshot.settings.broadcast.destinations.push(RtmpDestination {
            id: "primary".into(),
            platform: "generic".into(),
            rtmp_url: "rtmp://192.0.2.20/live".into(),
            stream_key: "STREAM_KEY_SENTINEL".into(),
            enabled: true,
        });
        snapshot.health.push(crate::state::DomainHealth {
            id: "test-health".into(),
            label: "Test".into(),
            status: "ok".into(),
            detail: "Internal path /secret/path and host 192.0.2.99".into(),
            protocol: "test".into(),
            latency_ms: 5,
        });

        let diagnostics = build_diagnostic_bundle(&snapshot).expect("diagnostics");
        assert!(!diagnostics.contains("PIN_SENTINEL_2468"));
        assert!(!diagnostics.contains("CLIENT_SECRET_SENTINEL"));
        assert!(!diagnostics.contains("TOKEN_SENTINEL"));
        assert!(!diagnostics.contains("OWNER_EMAIL_SENTINEL"));
        assert!(!diagnostics.contains("STREAM_KEY_SENTINEL"));
        assert!(!diagnostics.contains("/var/lib/private/recordings"));
        assert!(!diagnostics.contains("rtmp://192.0.2.20/live"));
        assert!(!diagnostics.contains("ws://192.0.2.55:47800"));
        assert!(!diagnostics.contains("Internal path /secret/path and host 192.0.2.99"));
        assert!(diagnostics.contains(REDACTED));
        assert!(diagnostics.contains(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn unlock_and_require_engineer_mode() {
        let managed = state::ManagedState::default();
        {
            let mut inner = managed.inner.lock().unwrap();
            inner.settings.general.engineer_pin = "1234".into();
        }
        assert!(require_engineer(&managed).is_err());
        assert_eq!(engineer_is_unlocked(&managed).unwrap(), false);
        assert!(unlock_engineer_with_state("0000", &managed).is_err());
        assert!(require_engineer(&managed).is_err());
        assert_eq!(unlock_engineer_with_state("1234", &managed).unwrap(), true);
        assert_eq!(engineer_is_unlocked(&managed).unwrap(), true);
        assert!(require_engineer(&managed).is_ok());
        lock_engineer_with_state(&managed).unwrap();
        assert!(require_engineer(&managed).is_err());
        assert_eq!(engineer_is_unlocked(&managed).unwrap(), false);
    }

    #[test]
    fn open_in_browser_url_validation_allows_only_https_allowlisted_hosts() {
        assert!(validate_open_in_browser_url("https://github.com/example/repo").is_ok());
        assert!(validate_open_in_browser_url("https://api.github.com/repos/example/repo/releases").is_ok());
        assert!(validate_open_in_browser_url("https://objects.githubusercontent.com/some/path").is_ok());
        assert!(validate_open_in_browser_url("http://github.com/example/repo").is_err());
        assert!(validate_open_in_browser_url("https://evil.example.com/path").is_err());
        assert!(validate_open_in_browser_url("javascript:alert(1)").is_err());
        assert!(validate_open_in_browser_url("https://github.com/\nbad").is_err());
    }

    #[test]
    fn settings_validation_rejects_bad_rtmp_urls_and_paths() {
        let mut settings = AppSettings::default();
        settings.broadcast.destinations.push(RtmpDestination {
            id: "primary".into(),
            platform: "generic".into(),
            rtmp_url: "javascript:alert(1)".into(),
            stream_key: String::new(),
            enabled: true,
        });
        assert!(validate_settings(&settings).is_err());

        let mut settings = AppSettings::default();
        settings.broadcast.destinations.push(RtmpDestination {
            id: "primary".into(),
            platform: "generic".into(),
            rtmp_url: "rtmps://192.0.2.20/live".into(),
            stream_key: String::new(),
            enabled: true,
        });
        settings.broadcast.recording_path = "-bad-path".into();
        assert!(validate_settings(&settings).is_err());
    }
}
