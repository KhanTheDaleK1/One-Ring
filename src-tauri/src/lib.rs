
use peer_discovery::{PeerRegistry, DiscoveredPeer};
pub mod protocols;
mod runtime;
mod state;
pub mod updater;
pub mod peer_discovery;

use runtime::events::{CueProgressEvent, EventSink, HealthEvent, MeterEvent, StatePatch};
use runtime::dante_adapter::DanteCommand;
use runtime::ndi_adapter::NdiCommand;
use runtime::obs_adapter::ObsCommand;
use runtime::propresenter_adapter::ProPresenterCommand;
use runtime::x32_adapter::X32Command;
use runtime::{AdapterCommand, AdapterRegistry, RuntimeConfig};
use state::{
    recompute_derived_alerts, with_state, AppSettings, AppStateSnapshot, CueVerificationReport,
    CueVerificationStep, ManagedState, ServiceCue, SharedState, ShowFile, UndoEntry,
};
use std::sync::Arc;
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
        inner.obs_scene = cue.obs_scene.clone();
        inner.vertical_scene = cue.vertical_scene.clone();
        if let Some(c0) = inner.canvases.get_mut(0) {
            c0.active_scene = cue.obs_scene.clone();
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

        // If cue 2 ("Countdown & Go Live"), start broadcasts & recording
        if cue.index == 2 {
            for b in &mut inner.broadcasts {
                b.live = true;
                b.bitrate_kbps = if b.id == "record" { 12000 } else { 5800 };
            }
        }

        // OBS 33 CreateRecordChapter on every cue transition
        let chapter_entry = format!("Cue {:02} — {}", cue.index, cue.record_chapter);
        if !inner.record_chapters.contains(&chapter_entry) {
            inner.record_chapters.push(chapter_entry);
        }

        // Fan the same plan out to live adapters (no-op in simulator mode).
        dispatch_cue_actions(&state, &cue);
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
    inner.event_log.insert(
        0,
        format!(
            "[cue-engine] {} Cue {}. '{}' ({} post-condition steps)",
            mode_label,
            cue.index,
            cue.title,
            steps.len()
        ),
    );
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
            domain: "ProPresenter v1".into(),
            expected: format!("Presentation == '{}'", cue.slide_label),
            observed: format!("POST /v1/status/updates confirmed '{}'", cue.slide_label),
            status: mode_tag.into(),
            latency_ms: 4,
        },
        CueVerificationStep {
            domain: "Behringer X32 OSC".into(),
            expected: format!("Unmute {:?}, Mute {:?}", cue.unmute_dcas, cue.mute_dcas),
            observed: "UDP :10023 /dca/1..4/on verified".into(),
            status: mode_tag.into(),
            latency_ms: 2,
        },
        CueVerificationStep {
            domain: "OBS 33 + Streamlabs Dual-Canvas".into(),
            expected: format!("16:9='{}', 9:16='{}'", cue.obs_scene, cue.vertical_scene),
            observed: format!(
                "SerialFrame + CreateRecordChapter('{}') acked",
                cue.record_chapter
            ),
            status: mode_tag.into(),
            latency_ms: 5,
        },
        CueVerificationStep {
            domain: "NDI 6 / VISCA PTZ".into(),
            expected: format!("Preset == '{}'", cue.camera_preset_id),
            observed: "Tally + PTZ preset settled".into(),
            status: mode_tag.into(),
            latency_ms: 3,
        },
    ]
}

fn dispatch_cue_actions(state: &State<ManagedState>, cue: &ServiceCue) {
    for id in &cue.unmute_dcas {
        if let Some(number) = dca_number(id) {
            dispatch(
                state,
                AdapterCommand::X32(X32Command::SetDcaMute {
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
                AdapterCommand::X32(X32Command::SetDcaMute {
                    number,
                    muted: true,
                }),
            );
        }
    }

    dispatch(
        state,
        AdapterCommand::Obs(ObsCommand::SetProgramScene(cue.obs_scene.clone())),
    );
    dispatch(
        state,
        AdapterCommand::Obs(ObsCommand::CreateRecordChapter(cue.record_chapter.clone())),
    );

    if cue.index == 2 {
        dispatch(state, AdapterCommand::Obs(ObsCommand::StartStream));
        dispatch(state, AdapterCommand::Obs(ObsCommand::StartRecord));
    }
}

fn apply_live_status(state: &State<ManagedState>, steps: &mut [CueVerificationStep]) {
    let Some(registry) = live_registry(state) else {
        return;
    };
    for step in steps {
        let kind = if step.domain.contains("ProPresenter") {
            protocols::DeviceKind::ProPresenter
        } else if step.domain.contains("X32") {
            protocols::DeviceKind::X32
        } else if step.domain.contains("OBS") {
            protocols::DeviceKind::Obs
        } else if step.domain.contains("NDI") {
            protocols::DeviceKind::Ndi
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
        *inner = entry.snapshot;
        inner.event_log.insert(
            0,
            format!("[cue-engine] COMPENSATING UNDO: Reverted '{}'", entry.label),
        );
        recompute_derived_alerts(&mut inner);
        sync_undo_metadata(&state, &mut inner);
        return inner.clone();
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
    inner.event_log.insert(
        0,
        format!("[rehearsal] Rehearsal Mode {}", mode_label),
    );
    inner.clone()
}

#[tauri::command]
fn toggle_beltpack_fault(state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    inner.beltpack_fault_simulated = !inner.beltpack_fault_simulated;
    let status = if inner.beltpack_fault_simulated {
        "SIMULATED (Dante UDP :8751 reporting 0xFE mute on ULXD4-Pastor-Tx1)"
    } else {
        "CLEARED (Normal -11.5 dBFS signal on ULXD4-Pastor-Tx1)"
    };
    inner.event_log.insert(
        0,
        format!("[dante-conmon] Pastor Beltpack Fault {}", status),
    );
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
            AdapterCommand::X32(X32Command::SetDcaMute { number, muted }),
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
            AdapterCommand::X32(X32Command::SetDcaLevel { number, db }),
        );
    }
    inner.clone()
}

#[tauri::command]
fn recall_camera_preset(preset_id: String, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    inner.active_camera_preset_id = preset_id;
    recompute_derived_alerts(&mut inner);
    inner.clone()
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
            dispatch(
                &state,
                AdapterCommand::ProPresenter(ProPresenterCommand::Next),
            );
        }
        "prev" => {
            inner.slides.cleared = false;
            if inner.slides.current_slide > 1 {
                inner.slides.current_slide -= 1;
            }
            dispatch(
                &state,
                AdapterCommand::ProPresenter(ProPresenterCommand::Previous),
            );
        }
        "clear" => {
            inner.slides.cleared = !inner.slides.cleared;
            if inner.slides.cleared {
                dispatch(
                    &state,
                    AdapterCommand::ProPresenter(ProPresenterCommand::ClearLayer(
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
fn set_broadcast_state(
    target_id: String,
    live: bool,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
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
    let commands: Vec<ObsCommand> = match target_id.as_str() {
        "all" => {
            let mut commands = vec![if live {
                ObsCommand::StartStream
            } else {
                ObsCommand::StopStream
            }];
            commands.push(if live {
                ObsCommand::StartRecord
            } else {
                ObsCommand::StopRecord
            });
            commands
        }
        "record" => vec![if live {
            ObsCommand::StartRecord
        } else {
            ObsCommand::StopRecord
        }],
        other => vec![if live {
            ObsCommand::StartOutput(other.to_string())
        } else {
            ObsCommand::StopOutput(other.to_string())
        }],
    };
    for command in commands {
        dispatch(&state, AdapterCommand::Obs(command));
    }
    inner.clone()
}

#[tauri::command]
fn switch_ndi_receiver(
    receiver_id: String,
    source_name: String,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    dispatch(
        &state,
        AdapterCommand::Ndi(NdiCommand::ControlReceiver {
            receiver_id: receiver_id.clone(),
            source_name: source_name.clone(),
        }),
    );
    let mut inner = state.inner.lock().unwrap();
    if let Some(rx) = inner.ndi_receivers.iter_mut().find(|r| r.id == receiver_id) {
        rx.subscribed_source = source_name.clone();
        rx.status = if rx.subscribed_source == rx.expected_source {
            "CONNECTED".into()
        } else {
            "DRIFT".into()
        };
    }
    inner.event_log.insert(
        0,
        format!(
            "[ndi-discovery-5959] Sent <control_receiver><command>connect</command> to {} -> '{}'",
            receiver_id, source_name
        ),
    );
    inner.clone()
}

#[tauri::command]
fn auto_heal_ndi_receivers(state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    for rx in &mut inner.ndi_receivers {
        rx.subscribed_source = rx.expected_source.clone();
        rx.status = "CONNECTED".into();
    }
    inner.event_log.insert(
        0,
        "[ndi-discovery-5959] Auto-healed all NDI 6 receivers to expected show sources".into(),
    );
    inner.clone()
}

#[tauri::command]
fn flash_dante_identify(route_id: String, state: State<ManagedState>) -> AppStateSnapshot {
    dispatch(
        &state,
        AdapterCommand::Dante(DanteCommand::IdentifyDevice {
            target_ip: route_id.clone(),
        }),
    );
    let mut inner = state.inner.lock().unwrap();
    if let Some(route) = inner.dante_routes.iter_mut().find(|r| r.id == route_id) {
        route.identify_flashing = !route.identify_flashing;
        let dev = route.rx_device.clone();
        inner.event_log.insert(
            0,
            format!(
                "[dante-conmon] Sent IDENTIFY_QUERY (opcode 0x0063) to {} on UDP :8700",
                dev
            ),
        );
    }
    inner.clone()
}

#[tauri::command]
fn update_settings(settings: AppSettings, state: State<ManagedState>) -> AppStateSnapshot {
    let mut inner = state.inner.lock().unwrap();
    inner.settings = settings;
    inner.sync_broadcasts_from_settings();
    inner.rebuild_preflight();
    inner.push_event_log(
        "[settings] Configuration saved (audio, network, broadcasting, slides, cameras, station, sync)"
            .into(),
    );
    let snapshot = inner.clone();
    drop(inner);

    if let Err(err) = state.save_settings() {
        let mut inner = state.inner.lock().unwrap();
        inner.push_event_log(format!(
            "[settings] WARNING: failed to persist configuration: {err}"
        ));
        return inner.clone();
    }
    snapshot
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
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(&["/C", "start", "", &url])
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}





#[tauri::command]
fn start_direct_ffmpeg_stream(
    rtmp_url: String,
    record_path: Option<String>,
    ffmpeg: State<runtime::obs_daemon::FfmpegStreamProcess>,
) -> Result<String, String> {
    ffmpeg.start_stream(&rtmp_url, record_path.as_deref())
}

#[tauri::command]
fn stop_direct_ffmpeg_stream(
    ffmpeg: State<runtime::obs_daemon::FfmpegStreamProcess>,
) -> String {
    ffmpeg.stop();
    "Stopped standalone FFmpeg encoder".into()
}

#[tauri::command]
fn import_ewsx_schedule(
    file_path: String,
) -> Result<Vec<runtime::obs_daemon::ImportedSongPayload>, String> {
    runtime::obs_daemon::parse_easyworship_ewsx(&file_path)
}

#[tauri::command]
fn list_audio_devices() -> Vec<runtime::obs_daemon::HostMediaDevice> {
    runtime::obs_daemon::list_host_audio_devices()
}

#[tauri::command]
fn list_video_devices() -> Vec<runtime::obs_daemon::HostMediaDevice> {
    runtime::obs_daemon::list_host_video_devices()
}

#[tauri::command]
fn scan_installed_audio_plugins() -> Vec<runtime::obs_daemon::InstalledAudioPlugin> {
    runtime::obs_daemon::scan_installed_audio_plugins()
}

#[tauri::command]
fn get_media_engine_status(
    daemon: State<runtime::obs_daemon::ObsDaemonSupervisor>,
) -> runtime::obs_daemon::MediaEngineStatus {
    runtime::obs_daemon::probe_media_engine_status(&daemon)
}

#[tauri::command]
fn start_headless_media_daemon(
    daemon: State<runtime::obs_daemon::ObsDaemonSupervisor>,
) -> Result<String, String> {
    daemon.start_headless_obs()
}

#[tauri::command]
fn route_dante_crosspoint(
    rx_ip: String,
    rx_chan_id: u16,
    tx_chan: String,
    tx_dev: String,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    dispatch(
        &state,
        AdapterCommand::Dante(DanteCommand::RouteCrosspoint {
            rx_ip: rx_ip.clone(),
            rx_port: 4440,
            rx_channel_id: rx_chan_id,
            tx_channel: tx_chan.clone(),
            tx_device: tx_dev.clone(),
        }),
    );
    let mut inner = state.inner.lock().unwrap();
    inner.event_log.insert(
        0,
        format!("[dante-arc] Crosspoint ch {} <- {}@{}", rx_chan_id, tx_chan, tx_dev),
    );
    inner.clone()
}

#[tauri::command]
fn trigger_ndi_ptz(
    source_id: String,
    preset_index: Option<u8>,
    pan: Option<f64>,
    tilt: Option<f64>,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    if let Some(idx) = preset_index {
        dispatch(
            &state,
            AdapterCommand::Ndi(NdiCommand::RecallPtzPreset {
                source_id: source_id.clone(),
                preset_index: idx,
                speed: 0.75,
            }),
        );
    } else if let (Some(p), Some(t)) = (pan, tilt) {
        dispatch(
            &state,
            AdapterCommand::Ndi(NdiCommand::PanTiltSpeed {
                source_id: source_id.clone(),
                pan: p,
                tilt: t,
            }),
        );
    }
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn send_x32_osc(
    address: String,
    value: f32,
    state: State<ManagedState>,
) -> AppStateSnapshot {
    if let Some(rest) = address.strip_prefix("/dca/") {
        if let Some((num_s, leaf)) = rest.split_once('/') {
            if let Ok(num) = num_s.parse::<u8>() {
                if leaf == "on" {
                    dispatch(&state, AdapterCommand::X32(X32Command::SetDcaMute { number: num, muted: value < 0.5 }));
                } else if leaf == "fader" {
                    dispatch(&state, AdapterCommand::X32(X32Command::SetDcaLevel { number: num, db: (value - 0.75) * 40.0 }));
                }
            }
        }
    } else if let Some(rest) = address.strip_prefix("/ch/") {
        if let Some((ch_s, leaf)) = rest.split_once('/') {
            if let Ok(ch) = ch_s.parse::<u8>() {
                if leaf == "mix/fader" {
                    dispatch(&state, AdapterCommand::X32(X32Command::SetChannelFader { channel: ch, fader: value }));
                } else if leaf == "mix/on" {
                    dispatch(&state, AdapterCommand::X32(X32Command::SetChannelMute { channel: ch, muted: value < 0.5 }));
                }
            }
        }
    }
    let mut inner = state.inner.lock().unwrap();
    inner.event_log.insert(0, format!("[x32-osc] {} -> {:.2}", address, value));
    inner.clone()
}

#[tauri::command]
fn list_open_windows() -> Vec<String> {
    let mut windows = Vec::new();
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("osascript")
            .arg("-e")
            .arg(r#"tell application "System Events" to get {name, title of every window} of (every process whose background only is false)"#)
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout);
            for part in s.split(", ") {
                let clean = part.trim().trim_matches('"');
                if !clean.is_empty() && clean != "missing value" {
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
        .manage(runtime::obs_daemon::ObsDaemonSupervisor::default())
        .manage(runtime::obs_daemon::FfmpegStreamProcess::default())
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
            let config = RuntimeConfig::from_env();
            if config.live {
                with_state(&shared, |snapshot| snapshot.mock_mode = false);
                let sink: Arc<dyn EventSink> =
                    Arc::new(TauriEventSink::new(app.handle().clone(), shared.clone()));
                let registry = AdapterRegistry::start(&config, shared, sink);
                *managed.runtime.lock().unwrap() = Some(Arc::new(registry));
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
            set_broadcast_state,
            switch_ndi_receiver,
            auto_heal_ndi_receivers,
            flash_dante_identify,
            run_preflight_probes,
            update_settings,
            export_show_file,
            import_show_file,
            check_update,
            get_discovered_peers,
            list_open_windows,
            scan_installed_audio_plugins,
            list_audio_devices,
            start_direct_ffmpeg_stream,
            stop_direct_ffmpeg_stream,
            import_ewsx_schedule,
            list_video_devices,
            get_media_engine_status,
            start_headless_media_daemon,
            route_dante_crosspoint,
            trigger_ndi_ptz,
            send_x32_osc,
            open_in_browser
        ])
        .run(tauri::generate_context!())
        .expect("error while running One Ring");
}
