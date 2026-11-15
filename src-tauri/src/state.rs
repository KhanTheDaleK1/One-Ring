use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

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
    pub dante_tx_channel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraPreset {
    pub id: String,
    pub camera_id: String,
    pub name: String,
    pub preset_index: u8,
    pub protocol: String, // "NDI Metadata PTZ" | "VISCA-over-IP :52381"
    pub tally: String,    // "program" | "preview" | "idle"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastTarget {
    pub id: String, // "youtube" | "facebook" | "record"
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
    pub engine: String, // "OBS 33 Multi-Canvas" | "Streamlabs DualOutputService"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DanteRoute {
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
pub struct NdiReceiver {
    pub id: String,
    pub receiver_name: String,
    pub ip: String,
    pub subscribed_source: String,
    pub expected_source: String,
    pub status: String, // "CONNECTED" | "DRIFT" | "OFFLINE"
    pub tally_program: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideState {
    pub app: String,
    pub playlist_name: String,
    pub presentation_name: String,
    pub current_slide: u32,
    pub total_slides: u32,
    pub current_text: String,
    pub next_text: String,
    pub cleared: bool,
    pub stage_message: String,
    pub transport_layer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceCue {
    pub id: String,
    pub index: u32,
    pub title: String,
    pub actions: Vec<String>,
    pub obs_scene: String,
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
    pub obs_scene: String,
    pub vertical_scene: String,
    pub canvases: Vec<BroadcastCanvas>,
    pub broadcasts: Vec<BroadcastTarget>,
    pub record_chapters: Vec<String>,
    pub dante_clock: String,
    pub dante_routes: Vec<DanteRoute>,
    pub ndi_receivers: Vec<NdiReceiver>,
    pub ndi_sources: Vec<String>,
    pub slides: SlideState,
    pub cues: Vec<ServiceCue>,
    pub last_verification: Option<CueVerificationReport>,
    pub event_log: Vec<String>,
}

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
}

impl Default for ManagedState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(default_simulator_state())),
            undo_stack: Arc::new(Mutex::new(Vec::new())),
            runtime: Mutex::new(None),
        }
    }
}

impl ManagedState {
    #[allow(dead_code)]
    pub fn snapshot(&self) -> AppStateSnapshot {
        self.inner.lock().unwrap().clone()
    }
}

/// Run `f` against the shared snapshot and return its result. Never held across an `.await`.
pub fn with_state<R>(state: &SharedState, f: impl FnOnce(&mut AppStateSnapshot) -> R) -> R {
    let mut guard = state.lock().unwrap();
    f(&mut guard)
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
        if let Some(v) = patch.cleared {
            self.slides.cleared = v;
        }
        if let Some(v) = patch.stage_message {
            self.slides.stage_message = v;
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

    /// Set the active OBS program scene (and matching horizontal canvas).
    pub fn apply_obs_scene(&mut self, program: Option<String>, vertical: Option<String>) -> Vec<BroadcastCanvas> {
        if let Some(scene) = program {
            self.obs_scene = scene;
            if let Some(c) = self.canvases.get_mut(0) {
                c.active_scene = self.obs_scene.clone();
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
}

/// Partial slide update produced by the ProPresenter status stream.
#[derive(Debug, Clone, Default)]
pub struct SlidesPatch {
    pub playlist_name: Option<String>,
    pub presentation_name: Option<String>,
    pub current_slide: Option<u32>,
    pub total_slides: Option<u32>,
    pub current_text: Option<String>,
    pub next_text: Option<String>,
    pub cleared: Option<bool>,
    pub stage_message: Option<String>,
}


pub fn recompute_derived_alerts(state: &mut AppStateSnapshot) {
    // Check "Silent Pastor Mic" condition: Pastor DCA (dca-1) is unmuted during Sermon/Welcome,
    // but Dante Conmon UDP 8751 metering shows 0xFE (<-90 dBFS) due to beltpack mute/power fault.
    if let Some(pastor) = state.dcas.iter_mut().find(|d| d.id == "dca-1") {
        // In live mode the signal values come from real X32/Dante meter events; only the
        // simulator synthesizes them.
        if state.mock_mode {
            if state.beltpack_fault_simulated {
                pastor.signal_db = -90.0;
                pastor.signal_present = false;
            } else if !pastor.muted {
                pastor.signal_db = -11.5;
                pastor.signal_present = true;
            } else {
                pastor.signal_db = -58.0;
                pastor.signal_present = false;
            }
        }
    }

    let pastor_unmuted_but_silent = state
        .dcas
        .iter()
        .find(|d| d.id == "dca-1")
        .map(|d| !d.muted && !d.signal_present)
        .unwrap_or(false);

    if pastor_unmuted_but_silent {
        state.silent_mic_alert = Some(
            "SILENT PASTOR MIC: DCA 1 (Pastor) is LIVE/UNMUTED, but Dante Conmon UDP :8751 reports 0xFE (<-90 dBFS) on ULXD4-Pastor-Tx1. Check beltpack power/mute switch!"
                .into(),
        );
    } else {
        state.silent_mic_alert = None;
    }

    // Update camera tallies based on active preset
    for cam in &mut state.cameras {
        if cam.id == state.active_camera_preset_id {
            cam.tally = "program".into();
        } else {
            cam.tally = "idle".into();
        }
    }
}

pub fn default_simulator_state() -> AppStateSnapshot {
    let mut s = AppStateSnapshot {
        mock_mode: true,
        rehearsal_mode: false,
        service_name: "Sunday 10:30 AM Service".into(),
        active_cue_index: 0,
        can_undo: false,
        undo_depth: 0,
        last_undo_label: None,
        silent_mic_alert: None,
        beltpack_fault_simulated: false,
        dante_clock: "48 kHz / 24-bit • PTP Grandmaster Locked (X32-Dante 00:1D:C1:8A:44:10) • Conmon UDP :8751 Metering Active".into(),
        health: vec![
            DomainHealth {
                id: "x32".into(),
                label: "X32".into(),
                status: "ok".into(),
                detail: "OSC 10.1.24.50:10023 (/xremote 8s)".into(),
                protocol: "X32 OSC UDP :10023".into(),
                latency_ms: 2,
            },
            DomainHealth {
                id: "dante".into(),
                label: "Dante".into(),
                status: "ok".into(),
                detail: "ARC + Conmon :8700/:8751 Locked".into(),
                protocol: "Audinate ARC/Conmon UDP".into(),
                latency_ms: 1,
            },
            DomainHealth {
                id: "yt".into(),
                label: "YT + FB".into(),
                status: "ok".into(),
                detail: "OBS v5 :4455 + SLOBS :28194 Ready".into(),
                protocol: "obswebsocket.msgpack + JSON-RPC".into(),
                latency_ms: 3,
            },
            DomainHealth {
                id: "slides".into(),
                label: "ProPresenter".into(),
                status: "ok".into(),
                detail: "POST /v1/status/updates Stream Active".into(),
                protocol: "ProPresenter 22 control-tower v1".into(),
                latency_ms: 4,
            },
            DomainHealth {
                id: "cams".into(),
                label: "NDI 6 / PTZ".into(),
                status: "ok".into(),
                detail: "Discovery :5959 (4 Rx, 3 PTZ)".into(),
                protocol: "NDI 6 Discovery :5959 + VISCA :52381".into(),
                latency_ms: 3,
            },
        ],
        preflight: vec![
            PreflightCheck {
                id: "chk-topology".into(),
                domain: "Show-File vs. Live Topology".into(),
                title: "All 6 service cues verified against live OBS canvases, PTZ presets, Dante Rx & ProPresenter playlist".into(),
                status: "pass".into(),
                detail: "0 missing scenes, 0 missing crosspoints, 0 orphan presets".into(),
                evidence: "6/6 cues validated against live capability graph".into(),
                fix_label: None,
            },
            PreflightCheck {
                id: "chk-x32".into(),
                domain: "Behringer X32".into(),
                title: "OSC reachable on UDP :10023, /xremote subscription active, Main LR unmuted".into(),
                status: "pass".into(),
                detail: "X32 Producer (FW 4.09) • 4 DCAs mapped • /meters/1 streaming".into(),
                evidence: "RTT 1.8 ms • Scene 01 'Pre-Service'".into(),
                fix_label: Some("Re-Sync X32 Scene".into()),
            },
            PreflightCheck {
                id: "chk-dante".into(),
                domain: "Dante Network".into(),
                title: "Single PTP Grandmaster (48 kHz), 4/4 ARC crosspoints UNICAST, Conmon UDP :8751 metering active".into(),
                status: "pass".into(),
                detail: "X32-Dante ↔ DVS-Broadcast ↔ ULXD4-Wireless all RXSTATUS=UNICAST".into(),
                evidence: "0 clock sync errors • Multicast 224.0.0.232:8751".into(),
                fix_label: Some("Re-Verify Crosspoints".into()),
            },
            PreflightCheck {
                id: "chk-stream".into(),
                domain: "OBS 33 / Streamlabs Dual-Canvas".into(),
                title: "Horizontal (16:9) + Vertical (9:16) canvases verified; YouTube + Facebook RTMPS outputs ready".into(),
                status: "pass".into(),
                detail: "OBS v5 (:4455) + Streamlabs Local TCP (127.0.0.1:28194 auto-auth)".into(),
                evidence: "CPU 8.4% • GPU Headroom 84% • Disk 7.9 TB free".into(),
                fix_label: Some("Test Output Handshake".into()),
            },
            PreflightCheck {
                id: "chk-slides".into(),
                domain: "ProPresenter 22.0.1".into(),
                title: "Multiplexed chunked stream (POST /v1/status/updates) active; Stage Display & ProLink ready".into(),
                status: "pass".into(),
                detail: "Playlist 'Sunday 10:30 AM' loaded • _proapiv1._tcp advertised".into(),
                evidence: "Chunked stream 0 drops • ProLink 224.0.0.90:18514 synced".into(),
                fix_label: Some("Focus Active Playlist".into()),
            },
            PreflightCheck {
                id: "chk-ndi".into(),
                domain: "NDI 6 & PTZ Cameras".into(),
                title: "NDI 6 Discovery (:5959) receiver_listener active; all 3 building displays on intended sources".into(),
                status: "pass".into(),
                detail: "Lobby TV, Stage Confidence & Broadcast Key verified via <query_receivers/>".into(),
                evidence: "Metadata-only PTZ (<ndi_enabled_streams video=false text=true/>)".into(),
                fix_label: Some("Auto-Heal NDI Displays".into()),
            },
        ],
        topology_issues: vec![],
        dcas: vec![
            DcaChannel {
                id: "dca-1".into(),
                number: 1,
                name: "Pastor Wireless".into(),
                muted: true,
                level_db: 0.0,
                min_db: -6.0,
                max_db: 6.0,
                guard_mute: false,
                signal_db: -58.0,
                signal_present: false,
                dante_tx_channel: "ULXD4-Pastor-Tx1".into(),
            },
            DcaChannel {
                id: "dca-2".into(),
                number: 2,
                name: "Worship Band".into(),
                muted: true,
                level_db: -2.0,
                min_db: -9.0,
                max_db: 3.0,
                guard_mute: false,
                signal_db: -18.0,
                signal_present: true,
                dante_tx_channel: "X32-Band-Stem".into(),
            },
            DcaChannel {
                id: "dca-3".into(),
                number: 3,
                name: "Media / ProPresenter".into(),
                muted: false,
                level_db: 0.0,
                min_db: -12.0,
                max_db: 3.0,
                guard_mute: false,
                signal_db: -14.2,
                signal_present: true,
                dante_tx_channel: "DVS-ProPresenter-L/R".into(),
            },
            DcaChannel {
                id: "dca-4".into(),
                number: 4,
                name: "Main FOH LR".into(),
                muted: false,
                level_db: 0.0,
                min_db: -3.0,
                max_db: 0.0,
                guard_mute: true,
                signal_db: -12.8,
                signal_present: true,
                dante_tx_channel: "X32-Main-LR".into(),
            },
        ],
        cameras: vec![
            CameraPreset {
                id: "cam-wide".into(),
                camera_id: "cam1".into(),
                name: "1: Stage Wide".into(),
                preset_index: 1,
                protocol: "NDI Metadata PTZ".into(),
                tally: "program".into(),
            },
            CameraPreset {
                id: "cam-pulpit".into(),
                camera_id: "cam1".into(),
                name: "2: Pulpit Tight".into(),
                preset_index: 2,
                protocol: "NDI Metadata PTZ".into(),
                tally: "idle".into(),
            },
            CameraPreset {
                id: "cam-worship".into(),
                camera_id: "cam2".into(),
                name: "3: Worship Center".into(),
                preset_index: 1,
                protocol: "VISCA-over-IP :52381".into(),
                tally: "idle".into(),
            },
            CameraPreset {
                id: "cam-crowd".into(),
                camera_id: "cam3".into(),
                name: "4: Crowd / Keys".into(),
                preset_index: 1,
                protocol: "VISCA-over-IP :52381".into(),
                tally: "idle".into(),
            },
        ],
        active_camera_preset_id: "cam-wide".into(),
        obs_scene: "Pre-Service Loop".into(),
        vertical_scene: "Vertical: Pre-Service Reels".into(),
        canvases: vec![
            BroadcastCanvas {
                uuid: "canvas-main-16x9".into(),
                name: "Primary Broadcast (Horizontal)".into(),
                aspect: "16:9".into(),
                resolution: "1920x1080 @ 60fps".into(),
                active_scene: "Pre-Service Loop".into(),
                engine: "OBS 33 GetCanvasList (MAIN | ACTIVATE | MIX_AUDIO)".into(),
            },
            BroadcastCanvas {
                uuid: "canvas-vert-9x16".into(),
                name: "Social / Shorts Feed (Vertical)".into(),
                aspect: "9:16".into(),
                resolution: "1080x1920 @ 60fps".into(),
                active_scene: "Vertical: Pre-Service Reels".into(),
                engine: "Streamlabs DualOutputService + OBS 33 Canvas".into(),
            },
        ],
        broadcasts: vec![
            BroadcastTarget {
                id: "youtube".into(),
                platform: "YouTube Live (16:9)".into(),
                live: false,
                bitrate_kbps: 0,
                dropped_frames: 0,
                elapsed_sec: 0,
                endpoint: "rtmps://a.rtmp.youtube.com/live2".into(),
                canvas: "Horizontal 16:9".into(),
            },
            BroadcastTarget {
                id: "facebook".into(),
                platform: "Facebook + Vertical Simulcast".into(),
                live: false,
                bitrate_kbps: 0,
                dropped_frames: 0,
                elapsed_sec: 0,
                endpoint: "rtmps://live-api-s.facebook.com:443/rtmp".into(),
                canvas: "Horizontal 16:9 + Vertical 9:16".into(),
            },
            BroadcastTarget {
                id: "record".into(),
                platform: "Local Multi-Chapter MKV".into(),
                live: false,
                bitrate_kbps: 0,
                dropped_frames: 0,
                elapsed_sec: 0,
                endpoint: "/mnt/BCloud/Recordings/Sunday.mkv".into(),
                canvas: "Horizontal 16:9".into(),
            },
        ],
        record_chapters: vec!["00:00 — Pre-Service Loop (Ready)".into()],
        dante_routes: vec![
            DanteRoute {
                id: "dr-1".into(),
                rx_device: "X32-FOH-Dante".into(),
                rx_channel: "Rx 01 (Pastor Mic)".into(),
                tx_device: "ULXD4-Rack-A".into(),
                tx_channel: "ULXD4-Pastor-Tx1".into(),
                rx_status: "UNICAST".into(),
                signal_dbfs: -12,
                identify_flashing: false,
            },
            DanteRoute {
                id: "dr-2".into(),
                rx_device: "X32-FOH-Dante".into(),
                rx_channel: "Rx 17-18 (ProPresenter)".into(),
                tx_device: "MacStudio-FOH (DVS)".into(),
                tx_channel: "DVS-ProPresenter-L/R".into(),
                rx_status: "UNICAST".into(),
                signal_dbfs: -14,
                identify_flashing: false,
            },
            DanteRoute {
                id: "dr-3".into(),
                rx_device: "Broadcast-OBS (Dante Studio)".into(),
                rx_channel: "Rx 01-02 (Broadcast Mix)".into(),
                tx_device: "X32-FOH-Dante".into(),
                tx_channel: "Matrix 1-2 (Stream Bus)".into(),
                rx_status: "MULTICAST".into(),
                signal_dbfs: -9,
                identify_flashing: false,
            },
            DanteRoute {
                id: "dr-4".into(),
                rx_device: "Lobby-Amp-PoE".into(),
                rx_channel: "Rx 01 (Lobby Fill)".into(),
                tx_device: "X32-FOH-Dante".into(),
                tx_channel: "Matrix 3 (Foyer)".into(),
                rx_status: "UNICAST".into(),
                signal_dbfs: -16,
                identify_flashing: false,
            },
        ],
        ndi_receivers: vec![
            NdiReceiver {
                id: "ndi-rx-1".into(),
                receiver_name: "Lobby Signage Display (Studio Monitor)".into(),
                ip: "10.1.24.71:5960".into(),
                subscribed_source: "ONE-RING (Lobby Feed)".into(),
                expected_source: "ONE-RING (Lobby Feed)".into(),
                status: "CONNECTED".into(),
                tally_program: true,
            },
            NdiReceiver {
                id: "ndi-rx-2".into(),
                receiver_name: "Stage Confidence Monitor".into(),
                ip: "10.1.24.72:5960".into(),
                subscribed_source: "PROPRESENTER (Stage Display)".into(),
                expected_source: "PROPRESENTER (Stage Display)".into(),
                status: "CONNECTED".into(),
                tally_program: false,
            },
            NdiReceiver {
                id: "ndi-rx-3".into(),
                receiver_name: "OBS Lower-Third Keyer".into(),
                ip: "127.0.0.1:5961".into(),
                subscribed_source: "PROPRESENTER (Audience Alpha Key)".into(),
                expected_source: "PROPRESENTER (Audience Alpha Key)".into(),
                status: "CONNECTED".into(),
                tally_program: true,
            },
        ],
        ndi_sources: vec![
            "ONE-RING (Lobby Feed)".into(),
            "PROPRESENTER (Stage Display)".into(),
            "PROPRESENTER (Audience Alpha Key)".into(),
            "CAM-1 (Stage Wide NDI|HX3)".into(),
            "CAM-2 (Pulpit Tight NDI|HX3)".into(),
            "OBS-PROGRAM (Main Output)".into(),
        ],
        slides: SlideState {
            app: "ProPresenter 22.0.1".into(),
            playlist_name: "Sunday 10:30 AM".into(),
            presentation_name: "Pre-Service Announcements".into(),
            current_slide: 1,
            total_slides: 8,
            current_text: "Welcome! Service begins in 5 minutes.".into(),
            next_text: "5-Minute Countdown Video".into(),
            cleared: false,
            stage_message: "Doors Open • Mic Check Complete".into(),
            transport_layer: "presentation (Auto-Advance Active)".into(),
        },
        cues: vec![
            ServiceCue {
                id: "cue-1".into(),
                index: 1,
                title: "Pre-Service Loop".into(),
                actions: vec![
                    "ProPresenter: Pre-Service Announcements".into(),
                    "X32: Media DCA ON, Pastor/Band Muted".into(),
                    "OBS 16:9 + 9:16: Pre-Service Loop".into(),
                    "PTZ Cam 1: Stage Wide".into(),
                ],
                obs_scene: "Pre-Service Loop".into(),
                vertical_scene: "Vertical: Pre-Service Reels".into(),
                camera_preset_id: "cam-wide".into(),
                slide_label: "Pre-Service Announcements".into(),
                unmute_dcas: vec!["dca-3".into()],
                mute_dcas: vec!["dca-1".into(), "dca-2".into()],
                record_chapter: "Pre-Service Loop".into(),
                risk_tier: 1,
            },
            ServiceCue {
                id: "cue-2".into(),
                index: 2,
                title: "Countdown & Go Live (YT + FB + Rec)".into(),
                actions: vec![
                    "ProPresenter: 5-Minute Countdown (ProLink Preroll)".into(),
                    "OBS + SLOBS: Start YT + FB + MKV Recording".into(),
                    "OBS 33: CreateRecordChapter('Countdown')".into(),
                ],
                obs_scene: "Countdown".into(),
                vertical_scene: "Vertical: Countdown".into(),
                camera_preset_id: "cam-wide".into(),
                slide_label: "5-Minute Countdown".into(),
                unmute_dcas: vec!["dca-3".into()],
                mute_dcas: vec!["dca-1".into(), "dca-2".into()],
                record_chapter: "5-Minute Countdown".into(),
                risk_tier: 2,
            },
            ServiceCue {
                id: "cue-3".into(),
                index: 3,
                title: "Worship Set".into(),
                actions: vec![
                    "ProPresenter: Praise (Song 1) + Stage Lyrics".into(),
                    "X32: Unmute Worship Band DCA 2".into(),
                    "OBS 16:9: Band Wide • 9:16: Lead Vocal Crop".into(),
                    "PTZ Cam 2: Worship Center".into(),
                ],
                obs_scene: "Band Wide".into(),
                vertical_scene: "Vertical: Worship Lead".into(),
                camera_preset_id: "cam-worship".into(),
                slide_label: "Praise (Song 1)".into(),
                unmute_dcas: vec!["dca-2".into()],
                mute_dcas: vec!["dca-1".into()],
                record_chapter: "Worship Set".into(),
                risk_tier: 1,
            },
            ServiceCue {
                id: "cue-4".into(),
                index: 4,
                title: "Welcome & Announcements".into(),
                actions: vec![
                    "ProPresenter: Welcome & Next Steps".into(),
                    "X32: Unmute Pastor DCA 1 (Verify Dante Tx1 Signal)".into(),
                    "OBS 16:9 + 9:16: Stage Host".into(),
                    "PTZ Cam 1: Stage Wide".into(),
                ],
                obs_scene: "Stage".into(),
                vertical_scene: "Vertical: Host Center".into(),
                camera_preset_id: "cam-wide".into(),
                slide_label: "Welcome & Next Steps".into(),
                unmute_dcas: vec!["dca-1".into(), "dca-3".into()],
                mute_dcas: vec!["dca-2".into()],
                record_chapter: "Welcome & Announcements".into(),
                risk_tier: 1,
            },
            ServiceCue {
                id: "cue-5".into(),
                index: 5,
                title: "Sermon: Hope Anchored".into(),
                actions: vec![
                    "ProPresenter: Sermon Notes + Lower-Third Alpha Key".into(),
                    "X32: Pastor DCA 1 ON + Band Muted".into(),
                    "OBS 33: Cut to Pulpit + CreateRecordChapter('Sermon')".into(),
                    "PTZ Cam 1: Recall Preset 2 (Pulpit Tight)".into(),
                ],
                obs_scene: "Pulpit".into(),
                vertical_scene: "Vertical: Pastor Tight 9:16".into(),
                camera_preset_id: "cam-pulpit".into(),
                slide_label: "Sermon: Hope Anchored".into(),
                unmute_dcas: vec!["dca-1".into(), "dca-3".into()],
                mute_dcas: vec!["dca-2".into()],
                record_chapter: "Sermon: Hope Anchored".into(),
                risk_tier: 1,
            },
            ServiceCue {
                id: "cue-6".into(),
                index: 6,
                title: "Closing & Benediction".into(),
                actions: vec![
                    "ProPresenter: Benediction & Dismissal".into(),
                    "X32: Pastor + Worship Band DCAs Active".into(),
                    "OBS 16:9: Stage Wide • NDI Lobby: Dismissal Slide".into(),
                    "PTZ Cam 3: Crowd / Keys".into(),
                ],
                obs_scene: "Stage Wide".into(),
                vertical_scene: "Vertical: Closing Wide".into(),
                camera_preset_id: "cam-crowd".into(),
                slide_label: "Benediction & Dismissal".into(),
                unmute_dcas: vec!["dca-1".into(), "dca-2".into()],
                mute_dcas: vec![],
                record_chapter: "Closing & Benediction".into(),
                risk_tier: 1,
            },
        ],
        last_verification: None,
        event_log: vec![
            "[22:00:01] [ring-discovery] mDNS + Multicast active: _netaudio-arc._udp, _ndi._tcp, _proapiv1._tcp, 224.0.0.90:18514".into(),
            "[22:00:02] [propresenter] Connected to POST /v1/status/updates (chunked multiplex stream: 6 topics)".into(),
            "[22:00:02] [streamlabs] Auto-authorized on local TCP 127.0.0.1:28194 + \\\\.\\pipe\\slobs (DualOutputService synced)".into(),
            "[22:00:03] [obs-ws-v5] Identified on ws://127.0.0.1:4455 (obswebsocket.msgpack, 2 canvases)".into(),
            "[22:00:03] [dante-conmon] Subscribed to UDP 224.0.0.232:8751 1-byte dBFS peak metering".into(),
            "[22:00:04] [ndi-discovery] Connected to TCP :5959 as receiver_listener (3 active receivers verified)".into(),
        ],
    };
    recompute_derived_alerts(&mut s);
    s
}
