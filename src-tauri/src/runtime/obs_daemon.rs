//! Option 2: Headless Media Engine Supervisor (`libobs` / FFmpeg) & OS Plugin/Device Discovery.
//!
//! Provides native filesystem scanning for VST3 / VST2 / Audio Unit (AU) plugins, hardware
//! capture device discovery, and subprocess supervision for standalone headless video encoding
//! and streaming when external OBS Desktop is not open.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAudioPlugin {
    pub name: String,
    pub format: String, // "VST3" | "AU" | "VST2"
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaEngineStatus {
    pub obs_binary_path: Option<String>,
    pub ffmpeg_binary_path: Option<String>,
    pub vst_plugin_count: usize,
    pub au_plugin_count: usize,
    pub daemon_running: bool,
}

pub struct ObsDaemonSupervisor {
    child: Arc<Mutex<Option<Child>>>,
}

impl Default for ObsDaemonSupervisor {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
        }
    }
}

impl ObsDaemonSupervisor {
    pub fn is_running(&self) -> bool {
        let mut guard = self.child.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(None) => return true,
                _ => {
                    *guard = None;
                }
            }
        }
        false
    }

    pub fn stop(&self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Launches a headless OBS Studio instance if installed (`--minimize-to-tray --disable-shutdown-check`)
    /// so One Ring's `obs_adapter` can drive GPU compositing & multi-RTMP natively without user setup.
    pub fn start_headless_obs(&self) -> Result<String, String> {
        if self.is_running() {
            return Ok("Headless libobs daemon already running".into());
        }
        let bin = find_obs_binary().ok_or_else(|| {
            "OBS binary not found on system. Install OBS Studio or place ffmpeg in PATH for headless mode.".to_string()
        })?;
        let child = Command::new(&bin)
            .args(["--minimize-to-tray", "--disable-shutdown-check"])
            .spawn()
            .map_err(|e| format!("Failed to spawn headless OBS ({}): {e}", bin))?;
        *self.child.lock().unwrap() = Some(child);
        Ok(format!("Spawned headless media daemon from {bin}"))
    }
}

pub fn find_obs_binary() -> Option<String> {
    let candidates = [
        "/Applications/OBS.app/Contents/MacOS/OBS",
        "C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe",
        "/usr/bin/obs",
        "/usr/local/bin/obs",
    ];
    for c in candidates {
        if Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    None
}

pub fn find_ffmpeg_binary() -> Option<String> {
    let candidates = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
    ];
    for c in candidates {
        if Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    None
}

/// Scans standard OS plugin directories for VST3, VST2, and macOS Audio Unit (.component) bundles.
pub fn scan_installed_audio_plugins() -> Vec<InstalledAudioPlugin> {
    let mut results = Vec::new();
    let mut dirs: Vec<(&str, &str)> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        dirs.push(("/Library/Audio/Plug-Ins/VST3", "VST3"));
        dirs.push(("/Library/Audio/Plug-Ins/Components", "AU"));
        dirs.push(("/Library/Audio/Plug-Ins/VST", "VST2"));
    }
    #[cfg(target_os = "windows")]
    {
        dirs.push(("C:\\Program Files\\Common Files\\VST3", "VST3"));
        dirs.push(("C:\\Program Files\\VSTPlugins", "VST2"));
    }
    #[cfg(target_os = "linux")]
    {
        dirs.push(("/usr/lib/vst3", "VST3"));
        dirs.push(("/usr/local/lib/vst3", "VST3"));
    }

    for (dir, format) in dirs {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.starts_with('.') {
                    continue;
                }
                let stem = fname
                    .trim_end_matches(".vst3")
                    .trim_end_matches(".component")
                    .trim_end_matches(".vst")
                    .trim_end_matches(".dll")
                    .to_string();
                results.push(InstalledAudioPlugin {
                    name: stem,
                    format: format.to_string(),
                    path: path.to_string_lossy().to_string(),
                });
            }
        }
    }

    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    results
}

pub fn probe_media_engine_status(supervisor: &ObsDaemonSupervisor) -> MediaEngineStatus {
    let plugins = scan_installed_audio_plugins();
    let vst_plugin_count = plugins.iter().filter(|p| p.format.starts_with("VST")).count();
    let au_plugin_count = plugins.iter().filter(|p| p.format == "AU").count();
    MediaEngineStatus {
        obs_binary_path: find_obs_binary(),
        ffmpeg_binary_path: find_ffmpeg_binary(),
        vst_plugin_count,
        au_plugin_count,
        daemon_running: supervisor.is_running(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostMediaDevice {
    pub name: String,
    pub kind: String, // "audio_input" | "audio_output" | "video_input"
}

pub fn list_host_audio_devices() -> Vec<HostMediaDevice> {
    let mut devices = Vec::new();
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = Command::new("system_profiler").args(["SPAudioDataType", "-json"]).output() {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                if let Some(arr) = v.get("SPAudioDataType").and_then(|x| x.as_array()) {
                    for cat in arr {
                        if let Some(items) = cat.get("_items").and_then(|x| x.as_array()) {
                            for item in items {
                                if let Some(name) = item.get("_name").and_then(|x| x.as_str()) {
                                    let is_in = item.get("coreaudio_device_input").and_then(|x| x.as_u64()).unwrap_or(0) > 0;
                                    let is_out = item.get("coreaudio_device_output").and_then(|x| x.as_u64()).unwrap_or(0) > 0;
                                    if is_in {
                                        devices.push(HostMediaDevice { name: name.to_string(), kind: "audio_input".into() });
                                    }
                                    if is_out {
                                        devices.push(HostMediaDevice { name: name.to_string(), kind: "audio_output".into() });
                                    }
                                    if !is_in && !is_out {
                                        devices.push(HostMediaDevice { name: name.to_string(), kind: "audio_input".into() });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                r#"Get-CimInstance Win32_SoundDevice | ForEach-Object { $_.Name }"#,
            ])
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout);
            for line in s.lines() {
                let name = line.trim();
                if !name.is_empty() {
                    devices.push(HostMediaDevice { name: name.to_string(), kind: "audio_input".into() });
                    devices.push(HostMediaDevice { name: format!("{name} (Loopback Output)"), kind: "audio_output".into() });
                }
            }
        }
    }
    devices
}

pub fn list_host_video_devices() -> Vec<HostMediaDevice> {
    let mut devices = Vec::new();
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = Command::new("system_profiler").args(["SPCameraDataType", "-json"]).output() {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                if let Some(arr) = v.get("SPCameraDataType").and_then(|x| x.as_array()) {
                    for item in arr {
                        if let Some(name) = item.get("_name").and_then(|x| x.as_str()) {
                            devices.push(HostMediaDevice { name: name.to_string(), kind: "video_input".into() });
                        }
                    }
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                r#"Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'Camera' -or $_.PNPClass -eq 'Image' } | ForEach-Object { $_.Name }"#,
            ])
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout);
            for line in s.lines() {
                let name = line.trim();
                if !name.is_empty() {
                    devices.push(HostMediaDevice { name: name.to_string(), kind: "video_input".into() });
                }
            }
        }
    }
    devices
}
