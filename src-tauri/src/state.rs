use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainHealth {
    pub id: String,
    pub label: String,
    pub status: String, // "ok" | "warn" | "error"
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightCheck {
    pub id: String,
    pub domain: String,
    pub title: String,
    pub status: String, // "pass" | "warn" | "fail"
    pub detail: String,
    pub fix_label: Option<String>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraPreset {
    pub id: String,
    pub camera_id: String,
    pub name: String,
    pub preset_index: u8,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceCue {
    pub id: String,
    pub index: u32,
    pub title: String,
    pub actions: Vec<String>,
    pub obs_scene: String,
    pub camera_preset_id: String,
    pub slide_label: String,
    pub unmute_dcas: Vec<String>,
    pub mute_dcas: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateSnapshot {
    pub mock_mode: bool,
    pub service_name: String,
    pub active_cue_index: usize,
    pub can_undo: bool,
    pub health: Vec<DomainHealth>,
    pub preflight: Vec<PreflightCheck>,
    pub dcas: Vec<DcaChannel>,
    pub cameras: Vec<CameraPreset>,
    pub active_camera_preset_id: String,
    pub obs_scene: String,
    pub broadcasts: Vec<BroadcastTarget>,
    pub slides: SlideState,
    pub cues: Vec<ServiceCue>,
    pub dante_clock: String,
}

pub struct ManagedState {
    pub inner: Mutex<AppStateSnapshot>,
    pub undo_snapshot: Mutex<Option<AppStateSnapshot>>,
}

impl Default for ManagedState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(default_simulator_state()),
            undo_snapshot: Mutex::new(None),
        }
    }
}

pub fn default_simulator_state() -> AppStateSnapshot {
    AppStateSnapshot {
        mock_mode: true,
        service_name: "Sunday 10:30 AM Service".into(),
        active_cue_index: 0,
        can_undo: false,
        dante_clock: "48 kHz / 24-bit • Primary Locked (X32-Dante)".into(),
        health: vec![
            DomainHealth { id: "x32".into(), label: "X32".into(), status: "ok".into(), detail: "OSC 10.1.24.50:10023".into() },
            DomainHealth { id: "dante".into(), label: "Dante".into(), status: "ok".into(), detail: "48kHz Locked".into() },
            DomainHealth { id: "yt".into(), label: "YT Live".into(), status: "ok".into(), detail: "Standby (RTMPS Ready)".into() },
            DomainHealth { id: "fb".into(), label: "FB Live".into(), status: "ok".into(), detail: "Standby (RTMPS Ready)".into() },
            DomainHealth { id: "slides".into(), label: "Slides".into(), status: "ok".into(), detail: "ProPresenter Connected".into() },
            DomainHealth { id: "cams".into(), label: "Cams/NDI".into(), status: "ok".into(), detail: "3 PTZ Online".into() },
        ],
        preflight: vec![
            PreflightCheck { id: "chk-x32".into(), domain: "Behringer X32".into(), title: "OSC reachable on :10023 & /xremote active".into(), status: "pass".into(), detail: "Simulated X32 Producer (FW 4.09)".into(), fix_label: None },
            PreflightCheck { id: "chk-dante".into(), domain: "Dante Network".into(), title: "Grandmaster Clock 48kHz locked, 0 sync errors".into(), status: "pass".into(), detail: "DVS + X-Dante Rx/Tx subscribed".into(), fix_label: None },
            PreflightCheck { id: "chk-yt".into(), domain: "YouTube Live".into(), title: "RTMPS key loaded & ingest reachable".into(), status: "pass".into(), detail: "rtmps://a.rtmp.youtube.com/live2".into(), fix_label: None },
            PreflightCheck { id: "chk-fb".into(), domain: "Facebook Live".into(), title: "RTMPS key loaded & ingest reachable".into(), status: "pass".into(), detail: "rtmps://live-api-s.facebook.com:443/rtmp".into(), fix_label: None },
            PreflightCheck { id: "chk-slides".into(), domain: "FOH Slides".into(), title: "ProPresenter API connected, Sunday playlist loaded".into(), status: "pass".into(), detail: "24 slides ready, Stage Display active".into(), fix_label: None },
            PreflightCheck { id: "chk-cams".into(), domain: "NDI & PTZ Cameras".into(), title: "3 PTZ cameras online, Home presets verified".into(), status: "pass".into(), detail: "VISCA-over-IP :52381 + NDI PTZ".into(), fix_label: None },
        ],
        dcas: vec![
            DcaChannel { id: "dca-1".into(), number: 1, name: "Pastor".into(), muted: true, level_db: 0.0, min_db: -6.0, max_db: 6.0, guard_mute: false },
            DcaChannel { id: "dca-2".into(), number: 2, name: "Band".into(), muted: true, level_db: -2.0, min_db: -9.0, max_db: 3.0, guard_mute: false },
            DcaChannel { id: "dca-3".into(), number: 3, name: "Media / Video".into(), muted: false, level_db: 0.0, min_db: -12.0, max_db: 3.0, guard_mute: false },
            DcaChannel { id: "dca-4".into(), number: 4, name: "Main LR".into(), muted: false, level_db: 0.0, min_db: -3.0, max_db: 0.0, guard_mute: true },
        ],
        cameras: vec![
            CameraPreset { id: "cam-wide".into(), camera_id: "cam1".into(), name: "1: Stage Wide".into(), preset_index: 1 },
            CameraPreset { id: "cam-pulpit".into(), camera_id: "cam1".into(), name: "2: Pulpit Tight".into(), preset_index: 2 },
            CameraPreset { id: "cam-worship".into(), camera_id: "cam2".into(), name: "3: Worship Ctr".into(), preset_index: 1 },
            CameraPreset { id: "cam-crowd".into(), camera_id: "cam3".into(), name: "4: Crowd / Keys".into(), preset_index: 1 },
        ],
        active_camera_preset_id: "cam-wide".into(),
        obs_scene: "Pre-Service Loop".into(),
        broadcasts: vec![
            BroadcastTarget { id: "youtube".into(), platform: "YouTube Live".into(), live: false, bitrate_kbps: 0, dropped_frames: 0, elapsed_sec: 0, endpoint: "rtmps://a.rtmp.youtube.com/live2".into() },
            BroadcastTarget { id: "facebook".into(), platform: "Facebook Live".into(), live: false, bitrate_kbps: 0, dropped_frames: 0, elapsed_sec: 0, endpoint: "rtmps://live-api-s.facebook.com:443/rtmp".into() },
            BroadcastTarget { id: "record".into(), platform: "Local Recording".into(), live: false, bitrate_kbps: 0, dropped_frames: 0, elapsed_sec: 0, endpoint: "NAS /Recordings/Sunday.mkv".into() },
        ],
        slides: SlideState {
            app: "ProPresenter".into(),
            playlist_name: "Sunday 10:30 AM".into(),
            presentation_name: "Pre-Service Announcements".into(),
            current_slide: 1,
            total_slides: 8,
            current_text: "Welcome! Service begins in 5 minutes.".into(),
            next_text: "5-Minute Countdown Video".into(),
            cleared: false,
        },
        cues: vec![
            ServiceCue {
                id: "cue-1".into(),
                index: 1,
                title: "Pre-Service Loop",
                actions: vec!["Slides: Pre-Service".into(), "X32: Media Unmuted".into(), "OBS: Pre-Service Loop".into(), "Cam: Stage Wide".into()],
                obs_scene: "Pre-Service Loop".into(),
                camera_preset_id: "cam-wide".into(),
                slide_label: "Pre-Service Announcements".into(),
                unmute_dcas: vec!["dca-3".into()],
                mute_dcas: vec!["dca-1".into(), "dca-2".into()],
            },
            ServiceCue {
                id: "cue-2".into(),
                index: 2,
                title: "Countdown & Go Live (YT + FB)",
                actions: vec!["Slides: Countdown".into(), "OBS: Countdown".into(), "Broadcast: YT + FB Live".into()],
                obs_scene: "Countdown".into(),
                camera_preset_id: "cam-wide".into(),
                slide_label: "5-Minute Countdown".into(),
                unmute_dcas: vec!["dca-3".into()],
                mute_dcas: vec!["dca-1".into(), "dca-2".into()],
            },
            ServiceCue {
                id: "cue-3".into(),
                index: 3,
                title: "Worship Set",
                actions: vec!["Slides: Worship Lyrics".into(), "X32: Band Unmuted".into(), "OBS: Band Wide".into(), "Cam: Worship Ctr".into()],
                obs_scene: "Band Wide".into(),
                camera_preset_id: "cam-worship".into(),
                slide_label: "Praise (Song 1)".into(),
                unmute_dcas: vec!["dca-2".into()],
                mute_dcas: vec!["dca-1".into()],
            },
            ServiceCue {
                id: "cue-4".into(),
                index: 4,
                title: "Welcome & Announcements",
                actions: vec!["Slides: Announcements".into(), "X32: Pastor Unmuted".into(), "OBS: Stage".into(), "Cam: Stage Wide".into()],
                obs_scene: "Stage".into(),
                camera_preset_id: "cam-wide".into(),
                slide_label: "Welcome & Next Steps".into(),
                unmute_dcas: vec!["dca-1".into(), "dca-3".into()],
                mute_dcas: vec!["dca-2".into()],
            },
            ServiceCue {
                id: "cue-5".into(),
                index: 5,
                title: "Sermon",
                actions: vec!["Slides: Sermon Notes".into(), "X32: Pastor Unmuted".into(), "OBS: Pulpit".into(), "Cam: Pulpit Tight".into()],
                obs_scene: "Pulpit".into(),
                camera_preset_id: "cam-pulpit".into(),
                slide_label: "Sermon: Hope Anchored".into(),
                unmute_dcas: vec!["dca-1".into(), "dca-3".into()],
                mute_dcas: vec!["dca-2".into()],
            },
            ServiceCue {
                id: "cue-6".into(),
                index: 6,
                title: "Closing & Benediction",
                actions: vec!["Slides: Closing".into(), "X32: Band + Pastor".into(), "OBS: Stage Wide".into(), "Cam: Crowd / Keys".into()],
                obs_scene: "Stage Wide".into(),
                camera_preset_id: "cam-crowd".into(),
                slide_label: "Benediction & Dismissal".into(),
                unmute_dcas: vec!["dca-1".into(), "dca-2".into()],
                mute_dcas: vec![],
            },
        ],
    }
}
