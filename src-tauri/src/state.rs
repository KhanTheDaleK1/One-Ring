
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneSourceItem {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub enabled: bool,
    pub locked: bool,
    pub volume_db: Option<f32>,
    pub muted: Option<bool>,
    #[serde(default)]
    pub color_tag: Option<String>,
    #[serde(default)]
    pub hide_in_mixer: Option<bool>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub filters: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub transform: Option<serde_json::Value>,
    pub settings: serde_json::Value,
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CanvasId {
    Mixing,
    Video,
    Slides,
    Broadcast,
    Master,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasTabConfig {
    pub id: CanvasId,
    pub label: String,
    pub enabled: bool,
}

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub type SharedState = Arc<Mutex<AppStateSnapshot>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainHealth {
    pub id: String,
    pub label: String,
    pub status: String, // "ok" | "warn" | "error"
    pub detail: String,
    pub protocol: String,
    pub latency_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightCheck {
    pub id: String,
    pub domain: String,
    pub title: String,
    pub status: String, // "pass" | "warn" | "fail"
    pub detail: String,
    pub evidence: String,
    pub fix_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyIssue {
    pub id: String,
    pub cue_id: String,
    pub severity: String, // "warn" | "error"
    pub domain: String,
    pub message: String,
    pub auto_fixable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DcaChannel {
    pub id: String,
    pub number: u8,
    pub name: String,
    pub muted: bool,
    pub level_db: f32,
    pub min_db: f32,
    pub max_db: f32,
    pub guard_mute: bool,
    pub signal_db: f32,
    pub signal_present: bool,
    pub aoip_tx_channel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraPreset {
    pub id: String,
    pub camera_id: String,
    pub name: String,
    pub preset_index: u8,
    pub protocol: String, // "IP_VIDEO Metadata PTZ" | "PTZ_IP-over-IP :52381"
    pub tally: String,    // "program" | "preview" | "idle"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastTarget {
    pub id: String, // "primary_rtmp" | "secondary_rtmp" | "record"
    pub platform: String,
    pub live: bool,
    pub bitrate_kbps: u32,
    pub dropped_frames: u32,
    pub elapsed_sec: u32,
    pub endpoint: String,
    pub canvas: String, // "Horizontal 16:9" | "Vertical 9:16"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastCanvas {
    pub uuid: String,
    pub name: String,
    pub aspect: String,
    pub resolution: String,
    pub active_scene: String,
    pub engine: String, // "Broadcast 33 Multi-Canvas" | "DualStream DualOutputService"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AoipRoute {
    pub id: String,
    pub rx_device: String,
    pub rx_channel: String,
    pub tx_device: String,
    pub tx_channel: String,
    pub rx_status: String, // "UNICAST" | "MULTICAST" | "PREPARING" | "UNRESOLVED"
    pub signal_dbfs: i32,
    pub identify_flashing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpVideoReceiver {
    pub id: String,
    pub receiver_name: String,
    pub ip: String,
    pub subscribed_source: String,
    pub expected_source: String,
    pub status: String, // "CONNECTED" | "DRIFT" | "OFFLINE"
    pub tally_program: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlideCue {
    pub id: String,
    pub number: u32,
    pub section: String,
    pub title: String,
    pub text: String,
    /// "title" | "lyrics" | "scripture" | "media" | "blank"
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PresentationTimer {
    pub id: String,
    pub name: String,
    pub state: String,
    pub time: f64,
    pub formatted: String,
    pub countdown: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScreenOutput {
    pub id: String,
    pub name: String,
    pub screen_type: String,
    pub width: u32,
    pub height: u32,
    pub enabled: bool,
}

/// SlideTcp output flags reported by `status`. These are observed state, not remote actions:
/// the documented TCP action catalog has no black/clear/logo toggle.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenFlags {
    pub black: bool,
    pub clear: bool,
    pub logo: bool,
}

/// Metadata for a cached JPEG preview. Raw bytes stay in a bounded runtime cache, keyed by `key`,
/// so the typed snapshot never copies image payloads on every state event.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PresentationImage {
    pub key: String,
    pub source: String,
    pub imagehash: String,
    pub rectype: String,
    pub pres_rowid: String,
    pub slide_rowid: String,
    pub revision: String,
    pub size: u32,
    pub updated_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub layer: String,
    pub is_playing: bool,
    pub item_id: String,
    pub name: String,
    pub artist: String,
    pub audio_only: bool,
    pub duration_ms: u64,
    pub position_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSong {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub slides: Vec<SlideCue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlideState {
    pub app: String,
    pub playlist_name: String,
    pub presentation_name: String,
    pub current_slide: u32,
    pub total_slides: u32,
    pub current_text: String,
    pub next_text: String,
    #[serde(default)]
    pub current_notes: String,
    #[serde(default)]
    pub next_notes: String,
    pub cleared: bool,
    pub stage_message: String,
    #[serde(default)]
    pub stage_message_visible: bool,
    #[serde(default)]
    pub stage_message_flash: bool,
    pub transport_layer: String,
    #[serde(default)]
    pub transport_time: f64,
    #[serde(default)]
    pub timers: Vec<PresentationTimer>,
    #[serde(default)]
    pub active_layers: Vec<String>,
    #[serde(default)]
    pub screens: Vec<ScreenOutput>,
    #[serde(default)]
    pub screen: ScreenFlags,
    #[serde(default)]
    pub image: Option<PresentationImage>,
    #[serde(default)]
    pub playback: Option<PlaybackState>,
    #[serde(default)]
    pub connected: bool,
    #[serde(default)]
    pub last_update_ms: u64,
    #[serde(default)]
    pub adapter: String,
    #[serde(default)]
    pub slides: Option<Vec<SlideCue>>,
    #[serde(default)]
    pub songs: Option<Vec<ServiceSong>>,
    #[serde(default)]
    pub active_song_id: Option<String>,
    #[serde(default)]
    pub theme: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceCue {
    pub id: String,
    pub index: u32,
    pub title: String,
    pub actions: Vec<String>,
    pub broadcast_scene: String,
    pub vertical_scene: String,
    pub camera_preset_id: String,
    pub slide_label: String,
    pub unmute_dcas: Vec<String>,
    pub mute_dcas: Vec<String>,
    pub record_chapter: String,
    pub risk_tier: u8, // 1 = safe, 2 = high-impact, 3 = on-air destructive
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CueVerificationStep {
    pub domain: String,
    pub expected: String,
    pub observed: String,
    pub status: String, // "APPLIED" | "REHEARSAL" | "DRIFT"
    pub latency_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CueVerificationReport {
    pub cue_title: String,
    pub rehearsal: bool,
    pub timestamp: String,
    pub steps: Vec<CueVerificationStep>,
}

// ---------------------------------------------------------------------------------------------
// Settings & Device Configuration
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DcaMapping {
    pub dca_id: String,
    pub dca_number: u8,
    pub dca_name: String,
    pub source_channel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleSettings {
    pub ip_address: String,
    pub osc_port: u16,
    pub keepalive_interval_sec: u32,
    pub dca_mappings: Vec<DcaMapping>,
}

impl Default for ConsoleSettings {
    fn default() -> Self {
        Self {
            ip_address: String::new(),
            osc_port: 10023,
            keepalive_interval_sec: 8,
            dca_mappings: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AoipSettings {
    pub subnet_interface: String,
    pub conmon_meter_port: u16,
    pub conmon_control_port: u16,
    pub clock_sync_warn_ms: u32,
    pub clock_sync_error_ms: u32,
}

impl Default for AoipSettings {
    fn default() -> Self {
        Self {
            subnet_interface: "Auto (default route)".into(),
            conmon_meter_port: 8751,
            conmon_control_port: 8700,
            clock_sync_warn_ms: 50,
            clock_sync_error_ms: 150,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RtmpDestination {
    pub id: String,
    pub platform: String,
    pub rtmp_url: String,
    pub stream_key: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastSettings {
    pub destinations: Vec<RtmpDestination>,
    pub recording_path: String,
    pub recording_format: String, // "MKV" | "MP4"
    pub encoder: String,          // "Hardware" | "Hardware" | "Software"
}

impl Default for BroadcastSettings {
    fn default() -> Self {
        Self {
            destinations: Vec::new(),
            recording_path: String::new(),
            recording_format: "MKV".into(),
            encoder: "Software".into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayAssignments {
    pub foh_window: String,
    pub stage_display_window: String,
    pub ip_video_alpha_output: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlidesSettings {
    pub song_library_client_id: String,
    pub song_library_client_secret: String,
    pub display_assignments: DisplayAssignments,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraPresetName {
    pub preset_id: String,
    pub camera_id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpVideoPtzSettings {
    pub discovery_range_start: String,
    pub discovery_range_end: String,
    pub ptz_ip_port: u16,
    pub preset_names: Vec<CameraPresetName>,
}

impl Default for IpVideoPtzSettings {
    fn default() -> Self {
        Self {
            discovery_range_start: String::new(),
            discovery_range_end: String::new(),
            ptz_ip_port: 52381,
            preset_names: Vec::new(),
        }
    }
}

fn default_canvas_title() -> String {
    "Main Sanctuary".into()
}

fn default_canvas_tabs() -> Vec<CanvasTabConfig> {
    vec![
        CanvasTabConfig { id: CanvasId::Mixing, label: "Mixing".into(), enabled: true },
        CanvasTabConfig { id: CanvasId::Video, label: "Video".into(), enabled: true },
        CanvasTabConfig { id: CanvasId::Slides, label: "Slides".into(), enabled: true },
        CanvasTabConfig { id: CanvasId::Broadcast, label: "Broadcast".into(), enabled: true },
        CanvasTabConfig { id: CanvasId::Master, label: "Master".into(), enabled: true },
    ]
}

/// Neutral zoom level. A plain `#[serde(default)]` would yield `0.0`, so the serde fallback
/// is explicit to keep older settings files loadable at the previous visual size.
fn default_ui_scale() -> f32 {
    1.0
}

/// Leaving a page with unsaved edits is confirmed by default; opting out is explicit.
fn default_confirm_unsaved_leave() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    #[serde(default = "default_canvas_title")]
    pub canvas_title: String,
    #[serde(default = "default_canvas_tabs")]
    pub canvas_tabs: Vec<CanvasTabConfig>,
    /// PIN required to unlock Engineer Mode from Volunteer Show Mode.
    #[serde(default)]
    pub engineer_pin: String,
    #[serde(default = "default_ui_scale")]
    pub ui_scale: f32,
    #[serde(default)]
    pub high_contrast: bool,
    #[serde(default = "default_confirm_unsaved_leave")]
    pub confirm_unsaved_leave: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            canvas_title: default_canvas_title(),
            canvas_tabs: default_canvas_tabs(),
            engineer_pin: String::new(),
            ui_scale: default_ui_scale(),
            high_contrast: false,
            confirm_unsaved_leave: default_confirm_unsaved_leave(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationSettings {
    /// "slides" | "audio" | "broadcast" | "director" | "master"
    pub role: String,
    pub station_name: String,
    pub lock_to_role: bool,
}

impl Default for StationSettings {
    fn default() -> Self {
        Self {
            role: "master".into(),
            station_name: String::new(),
            lock_to_role: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    pub lan_discovery_enabled: bool,
    pub hub_address: String,
    pub sync_port: u16,
    pub cloud_sync_enabled: bool,
    pub account_email: String,
    pub profile_name: String,
    pub venue_id: String,
    pub sync_token: String,
    pub auto_sync_on_launch: bool,
    pub last_synced_at: String,
}

impl Default for SyncSettings {
    fn default() -> Self {
        Self {
            lan_discovery_enabled: true,
            hub_address: "ws://0.0.0.0:47800".into(),
            sync_port: 47_800,
            cloud_sync_enabled: false,
            account_email: String::new(),
            profile_name: String::new(),
            venue_id: String::new(),
            sync_token: String::new(),
            auto_sync_on_launch: false,
            last_synced_at: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub console: ConsoleSettings,
    #[serde(default)]
    pub aoip: AoipSettings,
    #[serde(default)]
    pub broadcast: BroadcastSettings,
    #[serde(default)]
    pub slides: SlidesSettings,
    #[serde(default)]
    pub ip_video_ptz: IpVideoPtzSettings,
    #[serde(default)]
    pub general: GeneralSettings,
    #[serde(default)]
    pub station: StationSettings,
    #[serde(default)]
    pub sync: SyncSettings,
}

/// Reset a single settings section while leaving every other section untouched.
/// Returns an error for unknown section names so callers can surface a clear message.
pub fn default_section_settings(settings: &mut AppSettings, section: &str) -> Result<(), String> {
    match section {
        "console" => settings.console = ConsoleSettings::default(),
        "aoip" => settings.aoip = AoipSettings::default(),
        "broadcast" => settings.broadcast = BroadcastSettings::default(),
        "slides" => settings.slides = SlidesSettings::default(),
        "ipVideo" | "ipvideo" | "ip_video" => settings.ip_video_ptz = IpVideoPtzSettings::default(),
        "station" => settings.station = StationSettings::default(),
        "general" => settings.general = GeneralSettings::default(),
        _ => {
            return Err(format!(
                "Unsupported settings section: {section} (expected console, aoip, broadcast, slides, ipVideo, station, or general)"
            ))
        }
    }
    Ok(())
}

/// Another One Ring node discovered on the LAN.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedStation {
    pub id: String,
    pub name: String,
    pub role: String,
    pub online: bool,
    pub latency_ms: u32,
}

/// Portable, user-authored show file (`*.ring.json`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShowFile {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub service_name: String,
    pub cues: Vec<ServiceCue>,
    pub dcas: Vec<DcaChannel>,
    pub cameras: Vec<CameraPreset>,
    pub canvases: Vec<BroadcastCanvas>,
    pub broadcasts: Vec<BroadcastTarget>,
    pub record_chapters: Vec<String>,
    #[serde(default)]
    pub sources: Vec<SceneSourceItem>,
    pub aoip_routes: Vec<AoipRoute>,
    pub ip_video_receivers: Vec<IpVideoReceiver>,
    pub ip_video_sources: Vec<String>,
    pub slides: SlideState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateSnapshot {
    pub mock_mode: bool,
    pub rehearsal_mode: bool,
    pub service_name: String,
    pub active_cue_index: usize,
    pub can_undo: bool,
    pub undo_depth: usize,
    pub last_undo_label: Option<String>,
    pub silent_mic_alert: Option<String>,
    pub beltpack_fault_simulated: bool,
    pub health: Vec<DomainHealth>,
    pub preflight: Vec<PreflightCheck>,
    pub topology_issues: Vec<TopologyIssue>,
    pub dcas: Vec<DcaChannel>,
    pub cameras: Vec<CameraPreset>,
    pub active_camera_preset_id: String,
    pub broadcast_scene: String,
    pub vertical_scene: String,
    pub canvases: Vec<BroadcastCanvas>,
    pub broadcasts: Vec<BroadcastTarget>,
    pub record_chapters: Vec<String>,
    pub sources: Vec<SceneSourceItem>,
    pub aoip_clock: String,
    pub aoip_routes: Vec<AoipRoute>,
    pub ip_video_receivers: Vec<IpVideoReceiver>,
    pub ip_video_sources: Vec<String>,
    pub slides: SlideState,
    pub cues: Vec<ServiceCue>,
    pub last_verification: Option<CueVerificationReport>,
    pub event_log: Vec<String>,
    #[serde(default)]
    pub settings: AppSettings,
    #[serde(default)]
    pub connected_stations: Vec<ConnectedStation>,
    #[serde(default)]
    pub sync_status: String,
}

/// Public name used by settings IPC commands for the serializable application state.
pub type AppState = AppStateSnapshot;

#[derive(Clone)]
pub struct UndoEntry {
    pub label: String,
    pub snapshot: AppStateSnapshot,
}

pub struct ManagedState {
    pub inner: Arc<Mutex<AppStateSnapshot>>,
    pub undo_stack: Arc<Mutex<Vec<UndoEntry>>>,
    /// Live adapter registry, absent in simulator mode.
    pub runtime: Mutex<Option<Arc<crate::runtime::AdapterRegistry>>>,
    /// Where `AppSettings` is persisted. `None` keeps settings in memory only.
    pub settings_path: Mutex<Option<PathBuf>>,
    /// Engineer Mode unlock expiry. `None` means locked.
    pub engineer_unlocked_until: Mutex<Option<Instant>>,
}

impl Default for ManagedState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(default_simulator_state())),
            undo_stack: Arc::new(Mutex::new(Vec::new())),
            runtime: Mutex::new(None),
            settings_path: Mutex::new(None),
            engineer_unlocked_until: Mutex::new(None),
        }
    }
}

impl ManagedState {
    #[allow(dead_code)]
    pub fn snapshot(&self) -> AppStateSnapshot {
        self.inner.lock().unwrap().clone()
    }

    /// Point the managed state at `path` and hydrate settings from disk when present.
    pub fn attach_settings_path(&self, path: PathBuf) {
        if let Some(settings) = read_settings_from_disk(&path) {
            let mut inner = self.inner.lock().unwrap();
            inner.settings = settings;
            inner.push_event_log(format!(
                "[settings] Loaded device configuration from {}",
                path.display()
            ));
        }
        remember_settings_path(&path);
        *self.settings_path.lock().unwrap() = Some(path);
    }

    /// Persist the current settings snapshot. Returns an error string for logging.
    pub fn save_settings(&self) -> Result<(), String> {
        let path = self.settings_path.lock().unwrap().clone();
        let Some(path) = path else {
            return Ok(());
        };
        let settings = self.inner.lock().unwrap().settings.clone();
        write_settings_to_disk(&path, &settings)
    }
}

/// Process-wide settings file location. Settings-focused IPC commands only receive a
/// `SharedState`, so they persist through this remembered path instead of holding a
/// second `ManagedState` reference.
static SETTINGS_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Remember where settings JSON lives. Called when the app attaches its config directory.
pub fn remember_settings_path(path: &Path) {
    *SETTINGS_PATH.lock().unwrap() = Some(path.to_path_buf());
}

/// Persist the settings carried by a snapshot to the remembered settings file.
/// A missing path is valid in memory-only/test scenarios and is treated as success.
pub fn persist_snapshot_settings(snapshot: &AppStateSnapshot) -> Result<(), String> {
    let path = SETTINGS_PATH.lock().unwrap().clone();
    let Some(path) = path else {
        return Ok(());
    };
    write_settings_to_disk(&path, &snapshot.settings)
}

/// Read a persisted `AppSettings` file. Missing/corrupt files fall back to defaults.
pub fn read_settings_from_disk(path: &Path) -> Option<AppSettings> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Atomically-ish write settings to disk, creating parent directories as needed.
pub fn write_settings_to_disk(path: &Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("create settings dir {}: {err}", parent.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                .map_err(|err| format!("set settings dir permissions {}: {err}", parent.display()))?;
        }
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|err| format!("serialize settings: {err}"))?;
    let tmp = path.with_extension("json.tmp");
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|err| format!("write settings tmp {}: {err}", tmp.display()))?;
        file.write_all(json.as_bytes())
            .map_err(|err| format!("write settings tmp {}: {err}", tmp.display()))?;
        file.sync_all()
            .map_err(|err| format!("sync settings tmp {}: {err}", tmp.display()))?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&tmp, json)
            .map_err(|err| format!("write settings tmp {}: {err}", tmp.display()))?;
    }
    std::fs::rename(&tmp, path)
        .map_err(|err| format!("commit settings {}: {err}", path.display()))?;
    Ok(())
}

/// Run `f` against the shared snapshot and return its result. Never held across an `.await`.
pub fn with_state<R>(state: &SharedState, f: impl FnOnce(&mut AppStateSnapshot) -> R) -> R {
    let mut guard = state.lock().unwrap();
    f(&mut guard)
}

fn is_allowed_http_url(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().any(|c| c.is_control()) {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn sanitize_url_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(text) => {
            if !is_allowed_http_url(text) {
                *text = String::new();
            } else {
                *text = text.trim().to_string();
            }
        }
        serde_json::Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                if key.eq_ignore_ascii_case("url") {
                    match child {
                        serde_json::Value::String(text) => {
                            if !is_allowed_http_url(text) {
                                *text = String::new();
                            } else {
                                *text = text.trim().to_string();
                            }
                        }
                        _ => sanitize_url_value(child),
                    }
                } else {
                    sanitize_url_value(child);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                sanitize_url_value(item);
            }
        }
        _ => {}
    }
}

/// Sanitize any `url` setting on a scene source: only trimmed http/https URLs are kept.
pub fn sanitize_source_settings_urls(settings: &mut serde_json::Value) {
    sanitize_url_value(settings);
}

impl AppStateSnapshot {
    /// Create or update the health strip entry for `id`. Returns true if it changed.
    pub fn set_health(
        &mut self,
        id: &str,
        label: &str,
        status: &str,
        detail: &str,
        protocol: &str,
        latency_ms: u32,
    ) -> bool {
        if let Some(entry) = self.health.iter_mut().find(|h| h.id == id) {
            let changed = entry.status != status
                || entry.detail != detail
                || entry.latency_ms != latency_ms;
            entry.label = label.to_string();
            entry.status = status.to_string();
            entry.detail = detail.to_string();
            entry.protocol = protocol.to_string();
            entry.latency_ms = latency_ms;
            changed
        } else {
            self.health.push(DomainHealth {
                id: id.to_string(),
                label: label.to_string(),
                status: status.to_string(),
                detail: detail.to_string(),
                protocol: protocol.to_string(),
                latency_ms,
            });
            true
        }
    }

    pub fn push_event_log(&mut self, line: String) {
        self.event_log.insert(0, line);
        if self.event_log.len() > 200 {
            self.event_log.truncate(200);
        }
    }

    /// Apply a DCA mute/level update. Returns the refreshed DCA array.
    pub fn apply_dca(
        &mut self,
        number: u8,
        muted: Option<bool>,
        level_db: Option<f32>,
    ) -> Vec<DcaChannel> {
        if let Some(dca) = self.dcas.iter_mut().find(|d| d.number == number) {
            if let Some(muted) = muted {
                dca.muted = muted;
            }
            if let Some(level_db) = level_db {
                dca.level_db = level_db.clamp(dca.min_db, dca.max_db);
            }
        }
        self.dcas.clone()
    }

    /// Apply a metered dBFS value to a DCA by number. `None` means silence.
    pub fn apply_dca_meter(&mut self, number: u8, db: Option<f32>) -> Vec<DcaChannel> {
        if let Some(dca) = self.dcas.iter_mut().find(|d| d.number == number) {
            match db {
                Some(db) => {
                    dca.signal_db = db;
                    dca.signal_present = db > -60.0;
                }
                None => {
                    dca.signal_db = -90.0;
                    dca.signal_present = false;
                }
            }
        }
        self.dcas.clone()
    }

    /// Merge partial slide fields and return the refreshed slides state.
    pub fn apply_slides(&mut self, patch: SlidesPatch) -> SlideState {
        let connection_changed = patch.connected.is_some()
            || patch.last_update_ms.is_some()
            || patch.adapter.is_some();
        if let Some(v) = patch.playlist_name {
            self.slides.playlist_name = v;
        }
        if let Some(v) = patch.presentation_name {
            self.slides.presentation_name = v;
        }
        if let Some(v) = patch.current_slide {
            self.slides.current_slide = v;
        }
        if let Some(v) = patch.total_slides {
            self.slides.total_slides = v;
        }
        if let Some(v) = patch.current_text {
            self.slides.current_text = v;
        }
        if let Some(v) = patch.next_text {
            self.slides.next_text = v;
        }
        if let Some(v) = patch.current_notes {
            self.slides.current_notes = v;
        }
        if let Some(v) = patch.next_notes {
            self.slides.next_notes = v;
        }
        if let Some(v) = patch.cleared {
            self.slides.cleared = v;
        }
        if let Some(v) = patch.stage_message {
            self.slides.stage_message = v;
        }
        if let Some(v) = patch.stage_message_visible {
            self.slides.stage_message_visible = v;
        }
        if let Some(v) = patch.stage_message_flash {
            self.slides.stage_message_flash = v;
        }
        if let Some(v) = patch.transport_time {
            self.slides.transport_time = v;
        }
        if let Some(v) = patch.timers {
            self.slides.timers = v;
        }
        if let Some(v) = patch.active_layers {
            self.slides.active_layers = v;
        }
        if let Some(v) = patch.screens {
            self.slides.screens = v;
        }
        if let Some(v) = patch.screen {
            self.slides.screen = v;
        }
        if let Some(v) = patch.image {
            self.slides.image = Some(v);
        }
        if let Some(v) = patch.playback {
            self.slides.playback = Some(v);
        }
        if let Some(v) = patch.slides {
            self.slides.slides = Some(v);
        }
        if let Some(v) = patch.connected {
            self.slides.connected = v;
        }
        if let Some(v) = patch.last_update_ms {
            self.slides.last_update_ms = v;
        }
        if let Some(v) = patch.adapter {
            self.slides.adapter = v;
        }
        if connection_changed {
            self.sync_presentation_preflight();
        }
        self.slides.clone()
    }

    /// Update the live/bitrate state of every broadcast target and return the array.
    pub fn apply_broadcast_live(&mut self, live: Option<bool>, record_live: Option<bool>) -> Vec<BroadcastTarget> {
        for b in &mut self.broadcasts {
            let target = if b.id == "record" { record_live } else { live };
            if let Some(live) = target {
                b.live = live;
                b.bitrate_kbps = if live {
                    if b.id == "record" { 12_000 } else { 5_800 }
                } else {
                    0
                };
                if !live {
                    b.elapsed_sec = 0;
                }
            }
        }
        self.broadcasts.clone()
    }

    /// Set the active BROADCAST program scene (and matching horizontal canvas).
    pub fn apply_broadcast_scene(&mut self, program: Option<String>, vertical: Option<String>) -> Vec<BroadcastCanvas> {
        if let Some(scene) = program {
            self.broadcast_scene = scene;
            if let Some(c) = self.canvases.get_mut(0) {
                c.active_scene = self.broadcast_scene.clone();
            }
        }
        if let Some(scene) = vertical {
            self.vertical_scene = scene;
            if let Some(c) = self.canvases.get_mut(1) {
                c.active_scene = self.vertical_scene.clone();
            }
        }
        self.canvases.clone()
    }

    pub fn apply_canvases(&mut self, canvases: Vec<BroadcastCanvas>) -> Vec<BroadcastCanvas> {
        if !canvases.is_empty() {
            self.canvases = canvases;
        }
        self.canvases.clone()
    }

    /// Extract the portable show content (everything the operator authors).
    pub fn to_show_file(&self) -> ShowFile {
        ShowFile {
            format: "one-ring-show".into(),
            version: 1,
            exported_at: String::new(),
            service_name: self.service_name.clone(),
            cues: self.cues.clone(),
            dcas: self.dcas.clone(),
            cameras: self.cameras.clone(),
            canvases: self.canvases.clone(),
            broadcasts: self.broadcasts.clone(),
            record_chapters: self.record_chapters.clone(),
            sources: self.sources.clone(),
            aoip_routes: self.aoip_routes.clone(),
            ip_video_receivers: self.ip_video_receivers.clone(),
            ip_video_sources: self.ip_video_sources.clone(),
            slides: self.slides.clone(),
        }
    }

    /// Replace all authored show content from a `*.ring.json` payload.
    pub fn apply_show_file(&mut self, mut show: ShowFile) {
        for source in &mut show.sources {
            sanitize_source_settings_urls(&mut source.settings);
        }
        self.service_name = if show.service_name.trim().is_empty() {
            "Untitled Show".into()
        } else {
            show.service_name
        };
        self.cues = show.cues;
        self.dcas = show.dcas;
        self.cameras = show.cameras;
        self.canvases = show.canvases;
        self.broadcasts = show.broadcasts;
        self.record_chapters = show.record_chapters;
        self.sources = show.sources;
        self.aoip_routes = show.aoip_routes;
        self.ip_video_receivers = show.ip_video_receivers;
        self.ip_video_sources = show.ip_video_sources;
        self.slides = show.slides;
        self.active_cue_index = 0;
        self.last_verification = None;
        self.silent_mic_alert = None;
        self.beltpack_fault_simulated = false;
        self.active_camera_preset_id = self
            .cameras
            .first()
            .map(|camera| camera.id.clone())
            .unwrap_or_default();
        self.broadcast_scene = self
            .canvases
            .first()
            .map(|canvas| canvas.active_scene.clone())
            .unwrap_or_default();
        self.vertical_scene = self
            .canvases
            .get(1)
            .map(|canvas| canvas.active_scene.clone())
            .unwrap_or_default();
        self.rebuild_preflight();
        recompute_derived_alerts(self);
        self.push_event_log(format!(
            "[show-file] Loaded '{}' ({} cues, {} DCAs, {} cameras, {} slides)",
            self.service_name,
            self.cues.len(),
            self.dcas.len(),
            self.cameras.len(),
            self.slides.slides.as_ref().map(|s| s.len()).unwrap_or(0)
        ));
    }

    /// Rebuild readiness checks from the current blank/custom show content.
    pub fn rebuild_preflight(&mut self) {
        use PreflightCheck as Check;
        let mut checks = Vec::new();
        let push = |checks: &mut Vec<Check>, ok: bool, id: &str, domain: &str, title: String, detail: String| {
            checks.push(Check {
                id: id.into(),
                domain: domain.into(),
                title,
                status: if ok { "pass".into() } else { "warn".into() },
                detail: detail.clone(),
                evidence: detail,
                fix_label: if ok { None } else { Some("Open Show Builder".into()) },
            });
        };

        push(
            &mut checks,
            !self.cues.is_empty(),
            "chk-cues",
            "Show File",
            "Service cue stack is populated".into(),
            format!("{} cue(s) in the current show file", self.cues.len()),
        );
        push(
            &mut checks,
            !self.dcas.is_empty() && !self.settings.console.ip_address.trim().is_empty(),
            "chk-audio",
            "Audio Mixing",
            "Mixer endpoint and DCA layout are configured".into(),
            if self.settings.console.ip_address.trim().is_empty() {
                "Set the mixer IP address in Settings → Audio Mixing".into()
            } else {
                format!("{} DCA(s) mapped to {}", self.dcas.len(), self.settings.console.ip_address)
            },
        );
        push(
            &mut checks,
            !self.aoip_routes.is_empty(),
            "chk-routing",
            "Audio Network",
            "Audio network routes are defined".into(),
            format!("{} route(s) configured", self.aoip_routes.len()),
        );
        push(
            &mut checks,
            !self.broadcasts.is_empty(),
            "chk-broadcast",
            "Broadcasting",
            "Broadcast and recording outputs are configured".into(),
            format!("{} output(s) configured", self.broadcasts.len()),
        );
        push(
            &mut checks,
            self.slides.slides.as_ref().map(|s| !s.is_empty()).unwrap_or(false),
            "chk-slides",
            "Slides",
            "Slide deck is loaded".into(),
            format!(
                "{} slide(s) in '{}'",
                self.slides.slides.as_ref().map(|s| s.len()).unwrap_or(0),
                self.slides.presentation_name
            ),
        );
        push(
            &mut checks,
            !self.cameras.is_empty(),
            "chk-cameras",
            "Cameras",
            "Camera presets are defined".into(),
            format!("{} preset(s) configured", self.cameras.len()),
        );
        self.preflight = checks;
        self.sync_presentation_preflight();
        self.topology_issues.clear();
    }

    /// Build the live presentation-link readiness row from the actual adapter state.
    fn presentation_preflight_check(&self) -> PreflightCheck {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let age_ms = now_ms.saturating_sub(self.slides.last_update_ms);
        let age_s = age_ms / 1000;
        let deck_len = self.slides.slides.as_ref().map(Vec::len).unwrap_or(0);

        if self.mock_mode {
            return PreflightCheck {
                id: "chk-presentation-link".into(),
                domain: "Slides".into(),
                title: "Presentation source is available".into(),
                status: "pass".into(),
                detail: format!("Local simulator • {deck_len} slide(s) loaded"),
                evidence: format!("Local simulator • {deck_len} slide(s) loaded"),
                fix_label: None,
            };
        }

        let fresh = self.slides.connected && age_ms <= 15_000 && self.slides.adapter != "local";
        let detail = if fresh {
            format!(
                "Live {} link • updated {}s ago • {} slide(s)",
                self.slides.adapter, age_s, deck_len
            )
        } else if !self.slides.connected {
            let setup_hint = match self.slides.adapter.as_str() {
                "slide_tcp" => "set RING_EZW_DISCOVER=1 or RING_EZW_HOST / RING_EZW_PORT",
                _ => "set RING_PP_HOST / RING_PP_PORT (or RING_EZW_DISCOVER=1)",
            };
            format!(
                "No live {} link (state never received) • {setup_hint} and restart",
                if self.slides.adapter.is_empty() || self.slides.adapter == "local" {
                    "presentation"
                } else {
                    &self.slides.adapter
                }
            )
        } else {
            format!(
                "{} link is stale ({}s since last update) — check the presentation network",
                self.slides.adapter, age_s
            )
        };

        PreflightCheck {
            id: "chk-presentation-link".into(),
            domain: "Slides".into(),
            title: "Presentation integration is live".into(),
            status: if fresh { "pass".into() } else { "warn".into() },
            detail: detail.clone(),
            evidence: detail,
            fix_label: if fresh {
                None
            } else {
                Some("Verify presentation network".into())
            },
        }
    }

    /// Refresh the presentation-link row in place without rebuilding unrelated checks.
    pub fn sync_presentation_preflight(&mut self) {
        let check = self.presentation_preflight_check();
        if let Some(existing) = self
            .preflight
            .iter_mut()
            .find(|c| c.id == "chk-presentation-link")
        {
            *existing = check;
        } else {
            self.preflight.push(check);
        }
    }

    /// Rebuild broadcast targets from Settings so user endpoints drive Show Mode.
    pub fn sync_broadcasts_from_settings(&mut self) {
        let mut next: Vec<BroadcastTarget> = self
            .settings
            .broadcast
            .destinations
            .iter()
            .filter(|dest| dest.enabled)
            .map(|dest| BroadcastTarget {
                id: dest.id.clone(),
                platform: dest.platform.clone(),
                live: false,
                bitrate_kbps: 0,
                dropped_frames: 0,
                elapsed_sec: 0,
                endpoint: dest.rtmp_url.clone(),
                canvas: "Program".into(),
            })
            .collect();

        if !self.settings.broadcast.recording_path.trim().is_empty() {
            let ext = self.settings.broadcast.recording_format.to_lowercase();
            let raw = self.settings.broadcast.recording_path.trim().trim_end_matches(['/', '\\', '.']);
            let suffix = format!(".{ext}");
            let endpoint = if raw.to_ascii_lowercase().ends_with(&suffix) {
                raw.to_string()
            } else {
                format!("{raw}/recording.{ext}")
            };
            next.push(BroadcastTarget {
                id: "record".into(),
                platform: format!(
                    "Local Recording ({})",
                    self.settings.broadcast.recording_format
                ),
                live: false,
                bitrate_kbps: 0,
                dropped_frames: 0,
                elapsed_sec: 0,
                endpoint,
                canvas: "Program".into(),
            });
        }

        for target in &mut next {
            if let Some(existing) = self.broadcasts.iter().find(|b| b.id == target.id) {
                target.live = existing.live;
                target.bitrate_kbps = existing.bitrate_kbps;
                target.dropped_frames = existing.dropped_frames;
                target.elapsed_sec = existing.elapsed_sec;
            }
        }
        self.broadcasts = next;
    }
}

/// Partial slide update produced by the SlideHttp status stream.
#[derive(Debug, Clone, Default)]
pub struct SlidesPatch {
    pub playlist_name: Option<String>,
    pub presentation_name: Option<String>,
    pub current_slide: Option<u32>,
    pub total_slides: Option<u32>,
    pub current_text: Option<String>,
    pub next_text: Option<String>,
    pub current_notes: Option<String>,
    pub next_notes: Option<String>,
    pub cleared: Option<bool>,
    pub stage_message: Option<String>,
    pub stage_message_visible: Option<bool>,
    pub stage_message_flash: Option<bool>,
    pub transport_time: Option<f64>,
    pub timers: Option<Vec<PresentationTimer>>,
    pub active_layers: Option<Vec<String>>,
    pub screens: Option<Vec<ScreenOutput>>,
    pub screen: Option<ScreenFlags>,
    pub image: Option<PresentationImage>,
    pub playback: Option<PlaybackState>,
    pub slides: Option<Vec<SlideCue>>,
    pub connected: Option<bool>,
    pub last_update_ms: Option<u64>,
    pub adapter: Option<String>,
}


fn looks_like_pastor(name: &str) -> bool {
    let lowered = name.to_lowercase();
    lowered.contains("pastor") || lowered.contains("speaker") || lowered.contains("preach")
}

pub fn recompute_derived_alerts(state: &mut AppStateSnapshot) {
    // The simulator synthesizes meter values only for the mock backend; live meter
    // events are authoritative. No specific DCA is assumed to exist.
    if state.mock_mode {
        let fault_id = state
            .dcas
            .iter()
            .find(|d| looks_like_pastor(&d.name))
            .or_else(|| state.dcas.first())
            .map(|d| d.id.clone());
        for dca in &mut state.dcas {
            if (Some(&dca.id) == fault_id.as_ref() && state.beltpack_fault_simulated) || dca.muted {
                dca.signal_db = -90.0;
                dca.signal_present = false;
            } else {
                dca.signal_db = if dca.signal_db < -60.0 { -12.0 } else { dca.signal_db };
                dca.signal_present = true;
            }
        }
    }

    let silent = state
        .dcas
        .iter()
        .find(|d| looks_like_pastor(&d.name))
        .filter(|d| !d.muted && !d.signal_present)
        .map(|d| d.name.clone());

    state.silent_mic_alert = silent.map(|name| {
        format!(
            "SILENT INPUT: '{}' is live/unmuted, but the audio meter reports no signal. Check the beltpack, cable, or input patch.",
            name
        )
    });

    // Update camera tallies based on the active preset.
    for cam in &mut state.cameras {
        if cam.id == state.active_camera_preset_id {
            cam.tally = "program".into();
        } else {
            cam.tally = "idle".into();
        }
    }
}

pub fn default_simulator_state() -> AppStateSnapshot {
    let mut state = AppStateSnapshot {
        mock_mode: true,
        rehearsal_mode: false,
        service_name: "Untitled Show".into(),
        active_cue_index: 0,
        can_undo: false,
        undo_depth: 0,
        last_undo_label: None,
        silent_mic_alert: None,
        beltpack_fault_simulated: false,
        health: Vec::new(),
        preflight: Vec::new(),
        topology_issues: Vec::new(),
        dcas: Vec::new(),
        cameras: Vec::new(),
        active_camera_preset_id: String::new(),
        broadcast_scene: String::new(),
        vertical_scene: String::new(),
        canvases: Vec::new(),
        broadcasts: Vec::new(),
        record_chapters: Vec::new(),
        sources: Vec::new(),
        aoip_clock: String::new(),
        aoip_routes: Vec::new(),
        ip_video_receivers: Vec::new(),
        ip_video_sources: Vec::new(),
        slides: SlideState {
            app: "Slides".into(),
            playlist_name: String::new(),
            presentation_name: String::new(),
            current_slide: 0,
            total_slides: 0,
            current_text: String::new(),
            next_text: String::new(),
            current_notes: String::new(),
            next_notes: String::new(),
            cleared: false,
            stage_message: String::new(),
            stage_message_visible: false,
            stage_message_flash: false,
            transport_layer: "local".into(),
            transport_time: 0.0,
            timers: Vec::new(),
            active_layers: Vec::new(),
            screens: Vec::new(),
            screen: ScreenFlags::default(),
            image: None,
            playback: None,
            connected: false,
            last_update_ms: 0,
            adapter: "local".into(),
            slides: Some(Vec::new()),
            songs: None,
            active_song_id: None,
            theme: None,
        },
        cues: Vec::new(),
        last_verification: None,
        settings: AppSettings::default(),
        connected_stations: Vec::new(),
        sync_status: "local".into(),
        event_log: Vec::new(),
    };
    recompute_derived_alerts(&mut state);
    state
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    #[test]
    fn presentation_preflight_reports_local_simulator() {
        let mut state = default_simulator_state();
        state.mock_mode = true;
        state.sync_presentation_preflight();
        let check = state
            .preflight
            .iter()
            .find(|c| c.id == "chk-presentation-link")
            .expect("presentation check exists");
        assert_eq!(check.status, "pass");
        assert!(check.detail.contains("Local simulator"));
    }

    #[test]
    fn presentation_preflight_detects_missing_and_stale_live_links() {
        let mut state = default_simulator_state();
        state.mock_mode = false;
        state.sync_presentation_preflight();
        let check = state
            .preflight
            .iter()
            .find(|c| c.id == "chk-presentation-link")
            .expect("presentation check exists");
        assert_eq!(check.status, "warn");

        state.apply_slides(SlidesPatch {
            connected: Some(true),
            last_update_ms: Some(now_ms()),
            adapter: Some("slide_http".into()),
            ..SlidesPatch::default()
        });
        let check = state
            .preflight
            .iter()
            .find(|c| c.id == "chk-presentation-link")
            .expect("presentation check exists");
        assert_eq!(check.status, "pass");
        assert!(check.detail.contains("slide_http"));

        state.apply_slides(SlidesPatch {
            last_update_ms: Some(now_ms().saturating_sub(60_000)),
            ..SlidesPatch::default()
        });
        let check = state
            .preflight
            .iter()
            .find(|c| c.id == "chk-presentation-link")
            .expect("presentation check exists");
        assert_eq!(check.status, "warn");
        assert!(check.detail.contains("stale"));
    }

    #[test]
    fn apply_slides_maps_slide_tcp_screen_flags_and_image_metadata() {
        let mut state = default_simulator_state();
        let slides = state.apply_slides(SlidesPatch {
            screen: Some(ScreenFlags {
                black: false,
                clear: true,
                logo: true,
            }),
            image: Some(PresentationImage {
                key: "current:hash-1".into(),
                source: "current".into(),
                imagehash: "hash-1".into(),
                size: 2048,
                updated_ms: 42,
                ..PresentationImage::default()
            }),
            ..SlidesPatch::default()
        });
        assert!(slides.screen.clear);
        assert!(slides.screen.logo);
        assert!(!slides.screen.black);
        let image = slides.image.expect("image metadata applied");
        assert_eq!(image.key, "current:hash-1");
        assert_eq!(image.imagehash, "hash-1");
        assert_eq!(image.size, 2048);
    }

    #[test]
    fn general_settings_defaults_keep_legacy_files_loadable() {
        let legacy: GeneralSettings =
            serde_json::from_str(r#"{"canvasTitle":"Legacy Canvas"}"#).expect("legacy settings");
        assert_eq!(legacy.canvas_title, "Legacy Canvas");
        assert_eq!(legacy.ui_scale, 1.0);
        assert!(!legacy.high_contrast);
        assert!(legacy.confirm_unsaved_leave);
    }

    #[test]
    fn default_section_settings_resets_only_the_selected_section() {
        let mut settings = AppSettings::default();
        settings.console.ip_address = "192.0.2.10".into();
        settings.general.ui_scale = 1.5;
        settings.station.station_name = "Stage".into();

        default_section_settings(&mut settings, "console").expect("reset console");
        assert!(settings.console.ip_address.is_empty());
        assert_eq!(settings.general.ui_scale, 1.5);
        assert_eq!(settings.station.station_name, "Stage");

        default_section_settings(&mut settings, "ipVideo").expect("reset camera section");
        assert_eq!(settings.ip_video_ptz.ptz_ip_port, 52381);
        assert!(default_section_settings(&mut settings, "unknown").is_err());
    }

    #[test]
    fn apply_show_file_sanitizes_source_urls() {
        let mut state = default_simulator_state();
        let mut show = state.to_show_file();
        show.sources = vec![SceneSourceItem {
            id: "src-1".into(),
            name: "Browser".into(),
            r#type: "browser".into(),
            enabled: true,
            locked: false,
            volume_db: None,
            muted: None,
            color_tag: None,
            hide_in_mixer: None,
            group_id: None,
            filters: None,
            transform: None,
            settings: serde_json::json!({
                "url": "javascript:alert(1)",
                "nested": { "url": "file:///etc/passwd" },
                "ok": { "url": " https://192.0.2.50/page " }
            }),
        }];
        state.apply_show_file(show);
        let settings = &state.sources[0].settings;
        assert_eq!(settings["url"], serde_json::json!(""));
        assert_eq!(settings["nested"]["url"], serde_json::json!(""));
        assert_eq!(settings["ok"]["url"], serde_json::json!("https://192.0.2.50/page"));
    }
}
