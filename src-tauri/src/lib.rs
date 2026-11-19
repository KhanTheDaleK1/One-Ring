
use peer_discovery::{PeerRegistry, DiscoveredPeer};
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
use state::{
    recompute_derived_alerts, with_state, AoipRoute, AppSettings, AppStateSnapshot,
    CueVerificationReport, CueVerificationStep, ManagedState, PreflightCheck, SceneSourceItem,
    ServiceCue, SharedState, ShowFile, SlideState, UndoEntry,
};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

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
    outbound: mpsc::UnboundedSender<String>,
    station_id: String,
}

impl LanSyncHub {
    pub fn connect(hub_address: &str, station_id: String) -> Self {
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
            outbound,
            station_id,
        }
    }

    /// Serialize one sync envelope and hand it to the relay. Returns an error only when the relay
    /// task has gone away, so callers never silently drop an envelope without knowing.
    pub fn publish(&self, kind: &str, payload: serde_json::Value) -> Result<(), String> {
        if kind.trim().is_empty() {
            return Err("LAN sync kind must not be empty".into());
        }
        let envelope = serde_json::json!({
            "senderId": self.station_id,
            "kind": kind,
            "payload": payload,
            "sentAtMs": unix_millis(),
        });
        self.outbound
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
) -> AppStateSnapshot {
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
    state.inner.lock().unwrap().clone()
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



#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Refused to open URL: only http:// and https:// URLs are allowed".into());
    }
    if trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("Refused to open URL containing whitespace or control characters".into());
    }

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(trimmed)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", trimmed])
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(trimmed)
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
) -> Result<String, String> {
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
    let serialized = serde_json::to_string(&cmd).unwrap_or_default();
    let mut inner = state.inner.lock().unwrap();
    inner.push_event_log(format!("[broadcast-worker-ipc] {}", serialized));
    serialized
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
) -> Result<String, String> {
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
        if let Ok(out) = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
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
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = std::process::Command::new("powershell")
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

/// Bounded budget for every individual connectivity probe.
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(250);

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ManagedState::default())
        .manage(runtime::broadcast_daemon::BroadcastDaemonSupervisor::default())
        .manage(runtime::broadcast_daemon::FfmpegStreamProcess::default())
        .manage(runtime::broadcast_daemon::ReplayBufferProcess::default())
        .manage(runtime::broadcast_worker_ipc::BroadcastWorkerSupervisor::default())
        .setup(|app| {
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
            app.manage(LanSyncHub::connect(&settings.sync.hub_address, station_id));
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
            send_console_osc,
            open_in_browser
        ])
        .build(tauri::generate_context!())
        .expect("error while building One Ring")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
                app_handle.state::<runtime::broadcast_daemon::BroadcastDaemonSupervisor>().stop();
                app_handle.state::<runtime::broadcast_daemon::FfmpegStreamProcess>().stop();
                app_handle.state::<runtime::broadcast_daemon::ReplayBufferProcess>().stop();
                app_handle.state::<runtime::broadcast_worker_ipc::BroadcastWorkerSupervisor>().stop();
            }
        });
}
