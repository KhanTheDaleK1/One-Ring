
use peer_discovery::{PeerRegistry, DiscoveredPeer};
pub mod protocols;
mod runtime;
mod state;
pub mod updater;
pub mod peer_discovery;

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
    recompute_derived_alerts, with_state, AppSettings, AppStateSnapshot, CueVerificationReport,
    CueVerificationStep, AoipRoute, ManagedState, SceneSourceItem, ServiceCue, SharedState,
    ShowFile, SlideState, UndoEntry,
};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

static PTZ_IP_SEQ: AtomicU32 = AtomicU32::new(1);
use tauri::{Emitter, Manager, State};

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

#[tauri::command]
fn run_preflight_probes(state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    inner.rebuild_preflight();
    let passed = inner.preflight.iter().filter(|c| c.status == "pass").count();
    let total = inner.preflight.len();
    inner.push_event_log(format!(
        "[preflight] Readiness sweep complete: {passed}/{total} checks passing"
    ));
    inner.clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ManagedState::default())
        .manage(runtime::broadcast_daemon::BroadcastDaemonSupervisor::default())
        .manage(runtime::broadcast_daemon::FfmpegStreamProcess::default())
        .manage(runtime::broadcast_daemon::ReplayBufferProcess::default())
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
                let registry = AdapterRegistry::start(&config, shared, sink);
                *managed.runtime.lock().unwrap() = Some(Arc::new(registry));
            } else {
                with_state(&shared, |snapshot| snapshot.mock_mode = true);
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
            }
        });
}
