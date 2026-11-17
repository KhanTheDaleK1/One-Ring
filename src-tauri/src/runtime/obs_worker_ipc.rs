//! Phase B3: Option 2 Native `libobs` Sidecar IPC Supervisor.
//!
//! Discovers `obs.dll` (Windows) or `libobs.framework` (macOS) and manages a clean-room
//! JSON-line IPC channel to an out-of-process `obs-worker` sidecar for Metal/DX11 GPU
//! compositing, Game Capture, DeckLink/AJA SDI, native VST3/AU hosting, and Virtual Camera.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibObsCapabilities {
    pub libobs_found: bool,
    pub libobs_path: Option<String>,
    pub virtual_cam_supported: bool,
    pub game_capture_supported: bool,
    pub decklink_supported: bool,
    pub vst_native_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum ObsWorkerCommand {
    InitGraphics { width: u32, height: u32, fps: u32 },
    CreateSource { id: String, kind: String, settings: serde_json::Value },
    SetTransform { id: String, x: f32, y: f32, w: f32, h: f32, rot: f32 },
    LoadAudioPlugin { source_id: String, plugin_path: String },
    SetStingerTransition { media_path: String, cut_point_ms: u32 },
    SetVirtualCam { active: bool },
}

pub fn probe_libobs_capabilities() -> LibObsCapabilities {
    let candidates = [
        "/Applications/OBS.app/Contents/Frameworks/libobs.framework/libobs",
        r"C:\Program Files\obs-studio\bin\64bit\obs.dll",
        "/usr/lib/x86_64-linux-gnu/libobs.so.0",
        "/usr/lib/libobs.so",
    ];
    let found = candidates.iter().find(|p| Path::new(p).exists()).map(|s| s.to_string());
    let has_lib = found.is_some();
    LibObsCapabilities {
        libobs_found: has_lib,
        libobs_path: found,
        virtual_cam_supported: cfg!(any(target_os = "macos", target_os = "windows")),
        game_capture_supported: cfg!(target_os = "windows"),
        decklink_supported: has_lib,
        vst_native_supported: has_lib,
    }
}
