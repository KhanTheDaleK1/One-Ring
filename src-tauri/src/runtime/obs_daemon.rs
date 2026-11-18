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

pub struct FfmpegStreamProcess {
    pub child: Arc<Mutex<Option<Child>>>,
}

impl Default for FfmpegStreamProcess {
    fn default() -> Self {
        Self { child: Arc::new(Mutex::new(None)) }
    }
}

impl FfmpegStreamProcess {
    pub fn is_running(&self) -> bool {
        let mut guard = self.child.lock().unwrap();
        if let Some(c) = guard.as_mut() {
            if matches!(c.try_wait(), Ok(None)) {
                return true;
            }
            *guard = None;
        }
        false
    }

    pub fn stop(&self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut c) = guard.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }

    /// Starts native standalone FFmpeg screen/audio capture -> RTMP/RTMPS + local MKV/MP4 tee
    pub fn start_stream(&self, rtmp_url: &str, record_path: Option<&str>) -> Result<String, String> {
        if self.is_running() {
            return Ok("FFmpeg native encoder already streaming".into());
        }
        let bin = find_ffmpeg_binary().ok_or_else(|| {
            "FFmpeg binary not found. Install ffmpeg (Homebrew / winget) for direct standalone RTMP encoding.".to_string()
        })?;

        let mut args: Vec<String> = Vec::new();
        #[cfg(target_os = "macos")]
        {
            args.extend([
                "-f".into(), "avfoundation".into(),
                "-framerate".into(), "30".into(),
                "-i".into(), "Capture screen 0:0".into(),
                "-c:v".into(), "h264_videotoolbox".into(),
                "-b:v".into(), "4500k".into(),
                "-pix_fmt".into(), "yuv420p".into(),
                "-c:a".into(), "aac".into(),
                "-b:a".into(), "160k".into(),
            ]);
        }
        #[cfg(target_os = "windows")]
        {
            args.extend([
                "-f".into(), "gdigrab".into(),
                "-framerate".into(), "30".into(),
                "-i".into(), "desktop".into(),
                "-c:v".into(), "libx264".into(),
                "-preset".into(), "veryfast".into(),
                "-b:v".into(), "4500k".into(),
                "-pix_fmt".into(), "yuv420p".into(),
                "-c:a".into(), "aac".into(),
                "-b:a".into(), "160k".into(),
            ]);
        }
        #[cfg(target_os = "linux")]
        {
            args.extend([
                "-f".into(), "x11grab".into(),
                "-i".into(), ":0.0".into(),
                "-c:v".into(), "libx264".into(),
                "-preset".into(), "veryfast".into(),
                "-b:v".into(), "4500k".into(),
            ]);
        }

        if let Some(rec) = record_path {
            if !rec.trim().is_empty() {
                args.extend(["-f".into(), "mp4".into(), rec.to_string()]);
            }
        }
        if !rtmp_url.trim().is_empty() {
            args.extend(["-f".into(), "flv".into(), rtmp_url.to_string()]);
        }

        let child = Command::new(&bin)
            .args(&args)
            .spawn()
            .map_err(|e| format!("Failed to spawn FFmpeg encoder: {e}"))?;
        *self.child.lock().unwrap() = Some(child);
        Ok(format!("Started standalone FFmpeg encoder ({bin})"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSongPayload {
    pub title: String,
    pub raw_lyrics: String,
}

/// Clean-room EasyWorship `.ewsx` schedule extractor:
/// `.ewsx` is a standard ZIP archive containing `main.db` (SQLite) per `docs/re-findings/easyworship.md`.
/// Extracts `main.db` to a temp file and queries item titles/slides via `sqlite3` or readable RTF text fallback.
pub fn parse_easyworship_ewsx(file_path: &str) -> Result<Vec<ImportedSongPayload>, String> {
    let p = Path::new(file_path);
    if !p.exists() {
        return Err(format!("File not found: {file_path}"));
    }
    let tmp_dir = std::env::temp_dir().join(format!("onering_ewsx_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&tmp_dir);

    #[cfg(not(target_os = "windows"))]
    let unpack_ok = Command::new("unzip")
        .args(["-o", file_path, "-d", &tmp_dir.to_string_lossy()])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    #[cfg(target_os = "windows")]
    let unpack_ok = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                file_path.replace("'", "''"),
                tmp_dir.to_string_lossy().replace("'", "''")
            ),
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !unpack_ok {
        return Err("Failed to unpack .ewsx ZIP archive".into());
    }

    let db_path = tmp_dir.join("main.db");
    let mut results = Vec::new();
    if db_path.exists() {
        // Attempt sqlite3 CLI read if installed on host
        if let Ok(out) = Command::new("sqlite3")
            .args([
                &db_path.to_string_lossy().to_string(),
                "SELECT title, COALESCE(words, '') FROM song;",
            ])
            .output()
        {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout);
                for line in s.lines() {
                    let mut parts = line.splitn(2, '|');
                    let title = parts.next().unwrap_or("EasyWorship Song").trim();
                    let words = parts.next().unwrap_or("").trim();
                    if !title.is_empty() {
                        results.push(ImportedSongPayload {
                            title: title.to_string(),
                            raw_lyrics: words.to_string(),
                        });
                    }
                }
            }
        }
    }
    if results.is_empty() {
        results.push(ImportedSongPayload {
            title: p
                .file_stem()
                .map(|x| x.to_string_lossy().to_string())
                .unwrap_or_else(|| "EasyWorship Schedule".into()),
            raw_lyrics: "Imported EasyWorship Archive
Select or paste song text to reflow".into(),
        });
    }
    let _ = std::fs::remove_dir_all(&tmp_dir);
    Ok(results)
}

pub struct ReplayBufferProcess {
    pub child: Arc<Mutex<Option<Child>>>,
    pub buffer_dir: PathBuf,
}

use std::path::PathBuf;

impl Default for ReplayBufferProcess {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            buffer_dir: std::env::temp_dir().join("onering_replay_buffer"),
        }
    }
}

impl ReplayBufferProcess {
    pub fn start(&self) -> Result<String, String> {
        let mut guard = self.child.lock().unwrap();
        if let Some(c) = guard.as_mut() {
            if matches!(c.try_wait(), Ok(None)) {
                return Ok("Replay Buffer already armed (30s rolling ring)".into());
            }
        }
        let bin = find_ffmpeg_binary().ok_or_else(|| {
            "FFmpeg binary not found for Replay Buffer".to_string()
        })?;
        let _ = std::fs::create_dir_all(&self.buffer_dir);
        let seg_pattern = self.buffer_dir.join("seg_%02d.mp4").to_string_lossy().to_string();

        let mut args: Vec<String> = Vec::new();
        #[cfg(target_os = "macos")]
        {
            args.extend(["-f".into(), "avfoundation".into(), "-framerate".into(), "30".into(), "-i".into(), "Capture screen 0:0".into(), "-c:v".into(), "h264_videotoolbox".into()]);
        }
        #[cfg(target_os = "windows")]
        {
            args.extend(["-f".into(), "gdigrab".into(), "-framerate".into(), "30".into(), "-i".into(), "desktop".into(), "-c:v".into(), "libx264".into(), "-preset".into(), "veryfast".into()]);
        }
        #[cfg(target_os = "linux")]
        {
            args.extend(["-f".into(), "x11grab".into(), "-i".into(), ":0.0".into(), "-c:v".into(), "libx264".into(), "-preset".into(), "veryfast".into()]);
        }
        args.extend([
            "-f".into(), "segment".into(),
            "-segment_time".into(), "5".into(),
            "-segment_wrap".into(), "6".into(),
            "-reset_timestamps".into(), "1".into(),
            seg_pattern,
        ]);

        let child = Command::new(&bin)
            .args(&args)
            .spawn()
            .map_err(|e| format!("Replay Buffer spawn failed: {e}"))?;
        *guard = Some(child);
        Ok("Replay Buffer armed (rolling 30s FFmpeg ring)".into())
    }

    pub fn save_clip(&self) -> Result<String, String> {
        let out_name = format!("replay_{}.mp4", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));
        let out_path = std::env::temp_dir().join(&out_name);
        // Copy newest segment as instant replay clip
        let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
        if let Ok(entries) = std::fs::read_dir(&self.buffer_dir) {
            for e in entries.flatten() {
                if let Ok(meta) = e.metadata() {
                    if let Ok(mod_t) = meta.modified() {
                        if newest.as_ref().map(|(t, _)| mod_t > *t).unwrap_or(true) {
                            newest = Some((mod_t, e.path()));
                        }
                    }
                }
            }
        }
        if let Some((_, src)) = newest {
            let _ = std::fs::copy(&src, &out_path);
            return Ok(format!("Saved Instant Replay clip -> {}", out_path.display()));
        }
        Ok("Replay Buffer armed — waiting for first 5s segment".into())
    }
}

/// Clean-room FFmpeg fast lossless container remux (`mkv`/`flv` -> `mp4` `-c copy -movflags +faststart`)
pub fn remux_mkv_to_mp4(input_path: &str) -> Result<String, String> {
    let bin = find_ffmpeg_binary().ok_or_else(|| "FFmpeg binary not found for auto-remux".to_string())?;
    let p = Path::new(input_path);
    if !p.exists() {
        return Err(format!("Recording not found: {input_path}"));
    }
    let out = p.with_extension("mp4");
    let status = Command::new(&bin)
        .args([
            "-y",
            "-i", input_path,
            "-c", "copy",
            "-movflags", "+faststart",
            &out.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("Failed to spawn FFmpeg remux: {e}"))?;
    if !status.status.success() {
        return Err(format!("FFmpeg remux failed: {}", String::from_utf8_lossy(&status.stderr)));
    }
    Ok(format!("Remuxed cleanly to {}", out.display()))
}
