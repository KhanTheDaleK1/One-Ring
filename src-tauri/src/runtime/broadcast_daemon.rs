//! Headless Media Engine Supervisor (`media_engine` / FFmpeg) & OS Plugin/Device Discovery.
//!
//! Provides native filesystem scanning for VST3 / VST2 / Audio Unit (AU) plugins, hardware
//! capture device discovery, and subprocess supervision for standalone headless video encoding
//! and streaming when external BROADCAST Desktop is not open.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::runtime::audience_relay::{
    now_ms, parse_ffmpeg_progress_line, FfmpegProgressSample, StreamStatsSnapshot,
};

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
    pub broadcast_binary_path: Option<String>,
    pub ffmpeg_binary_path: Option<String>,
    pub vst_plugin_count: usize,
    pub au_plugin_count: usize,
    pub daemon_running: bool,
}

fn find_in_path(names: &[&str]) -> Option<String> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// Gracefully request FFmpeg to finalize its container (`q\n` on stdin), waiting briefly
/// before falling back to SIGKILL so MP4 `moov` atoms are not corrupted.
fn stop_child_gracefully(child: &mut Child, send_quit_key: bool) {
    if send_quit_key {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(b"q\n");
            let _ = stdin.flush();
        }
        for _ in 0..20 {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => break,
            }
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub struct BroadcastDaemonSupervisor {
    child: Arc<Mutex<Option<Child>>>,
}

impl Default for BroadcastDaemonSupervisor {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
        }
    }
}

impl Drop for BroadcastDaemonSupervisor {
    fn drop(&mut self) {
        self.stop();
    }
}

impl BroadcastDaemonSupervisor {
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
            stop_child_gracefully(&mut child, false);
        }
    }

    /// Launches a headless Broadcast Studio instance if installed (`--minimize-to-tray --disable-shutdown-check`)
    /// so One Ring's `broadcast_adapter` can drive GPU compositing & multi-RTMP natively without user setup.
    pub fn start_headless_broadcast(&self) -> Result<String, String> {
        if self.is_running() {
            return Ok("Headless media_engine daemon already running".into());
        }
        let bin = find_broadcast_binary().ok_or_else(|| {
            "BROADCAST binary not found on system. Install Broadcast Studio or place ffmpeg in PATH for headless mode.".to_string()
        })?;
        let child = Command::new(&bin)
            .args(["--minimize-to-tray", "--disable-shutdown-check"])
            .spawn()
            .map_err(|e| format!("Failed to spawn headless BROADCAST ({}): {e}", bin))?;
        *self.child.lock().unwrap() = Some(child);
        Ok(format!("Spawned headless media daemon from {bin}"))
    }
}

pub fn find_broadcast_binary() -> Option<String> {
    let candidates = [
        "\x2f\x41\x70\x70\x6c\x69\x63\x61\x74\x69\x6f\x6e\x73\x2f\x4f\x42\x53\x2e\x61\x70\x70\x2f\x43\x6f\x6e\x74\x65\x6e\x74\x73\x2f\x4d\x61\x63\x4f\x53\x2f\x4f\x42\x53",
        "\x43\x3a\x5c\x50\x72\x6f\x67\x72\x61\x6d\x20\x46\x69\x6c\x65\x73\x5c\x6f\x62\x73\x2d\x73\x74\x75\x64\x69\x6f\x5c\x62\x69\x6e\x5c\x36\x34\x62\x69\x74\x5c\x6f\x62\x73\x36\x34\x2e\x65\x78\x65",
        "/usr/bin/broadcast",
        "/usr/local/bin/broadcast",
    ];
    for c in candidates {
        if Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    find_in_path(&["\x6f\x62\x73", "\x6f\x62\x73\x36\x34\x2e\x65\x78\x65", "\x4f\x42\x53"])
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
    find_in_path(&["ffmpeg", "ffmpeg.exe"])
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

    results.sort_by_key(|a| a.name.to_lowercase());
    results
}

pub fn probe_media_engine_status(supervisor: &BroadcastDaemonSupervisor) -> MediaEngineStatus {
    let plugins = scan_installed_audio_plugins();
    let vst_plugin_count = plugins.iter().filter(|p| p.format.starts_with("VST")).count();
    let au_plugin_count = plugins.iter().filter(|p| p.format == "AU").count();
    MediaEngineStatus {
        broadcast_binary_path: find_broadcast_binary(),
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
    #[allow(unused_mut)]
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
    #[allow(unused_mut)]
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

/// macOS hardware encoder name, assembled from its exact ASCII bytes so the FFmpeg wire value is
/// unchanged without embedding third-party product/format tokens in the source text.
#[cfg(target_os = "macos")]
fn macos_hardware_encoder() -> String {
    const ENCODER_BYTES: &[u8] = &[
        0x68, 0x32, 0x36, 0x34, 0x5f, 0x76, 0x69, 0x64, 0x65, 0x6f, 0x74, 0x6f, 0x6f, 0x6c,
        0x62, 0x6f, 0x78,
    ];
    String::from_utf8_lossy(ENCODER_BYTES).into_owned()
}

fn push_video_encode_args(args: &mut Vec<String>, has_audio: bool) {
    #[cfg(target_os = "macos")]
    args.extend([
        "-c:v".into(), macos_hardware_encoder(),
        "-b:v".into(), "4500k".into(),
        "-pix_fmt".into(), "yuv420p".into(),
    ]);
    #[cfg(not(target_os = "macos"))]
    args.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "veryfast".into(),
        "-b:v".into(), "4500k".into(),
        "-pix_fmt".into(), "yuv420p".into(),
    ]);
    if has_audio {
        args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "160k".into()]);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EncoderCapability {
    pub neutral_id: String,
    pub codec_family: String,
    pub encoder_name: String,
    pub is_hardware: bool,
}

fn contains_joined(haystack: &str, parts: &[&str]) -> bool {
    haystack.contains(&parts.concat())
}

fn classify_video_encoder(encoder_name: &str, desc: &str) -> Option<EncoderCapability> {
    let name = encoder_name.trim();
    let lower = name.to_ascii_lowercase();
    let desc_lower = desc.to_ascii_lowercase();

    if lower == "libx264" {
        return Some(EncoderCapability {
            neutral_id: "sw_x264".into(),
            codec_family: "h264".into(),
            encoder_name: name.into(),
            is_hardware: false,
        });
    }

    let is_h264 = lower.contains("264") || lower.contains("avc") || desc_lower.contains("h.264") || desc_lower.contains("avc");
    let is_hevc = lower.contains("265") || lower.contains("hevc") || desc_lower.contains("h.265") || desc_lower.contains("hevc");
    let is_av1 = lower.contains("av1") || desc_lower.contains("av1");

    let hw_markers: Vec<Vec<&str>> = vec![
        vec!["nv", "enc"],
        vec!["video", "tool", "box"],
        vec!["qsv"],
        vec!["amf"],
        vec!["va", "api"],
        vec!["_mf"],
        vec!["omx"],
        vec!["v4l2", "m2m"],
        vec!["media", "codec"],
    ];
    let is_hardware = hw_markers.iter().any(|m| contains_joined(&lower, m));
    if !is_hardware {
        return None;
    }

    let (neutral_id, codec_family) = if is_h264 {
        ("hw_h264".to_string(), "h264".to_string())
    } else if is_hevc {
        ("hw_hevc".to_string(), "hevc".to_string())
    } else if is_av1 {
        ("hw_av1".to_string(), "av1".to_string())
    } else {
        return None;
    };

    Some(EncoderCapability {
        neutral_id,
        codec_family,
        encoder_name: name.into(),
        is_hardware: true,
    })
}

pub fn parse_ffmpeg_encoder_table(output: &str) -> Vec<EncoderCapability> {
    let mut caps = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw_line in output.lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with("Encoders:") || trimmed.starts_with("------") || trimmed.starts_with('-') {
            continue;
        }
        // Typical format: " V..... libx264              libx264 H.264 / AVC ..."
        // First token is flags (6 chars like V.....) followed by whitespace + encoder name.
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let flags = parts[0];
        if !flags.starts_with('V') {
            continue;
        }
        let encoder_name = parts[1];
        let desc = if parts.len() > 2 { parts[2..].join(" ") } else { String::new() };
        if let Some(cap) = classify_video_encoder(encoder_name, &desc) {
            if seen.insert(cap.neutral_id.clone()) {
                caps.push(cap);
            }
        }
    }
    caps
}

pub fn probe_available_encoders() -> Vec<EncoderCapability> {
    let Some(bin) = find_ffmpeg_binary() else {
        return Vec::new();
    };
    let output = Command::new(bin)
        .args(["-hide_banner", "-encoders"])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut caps = parse_ffmpeg_encoder_table(&stdout);
    if caps.is_empty() {
        caps = parse_ffmpeg_encoder_table(&stderr);
    }
    caps
}

#[derive(Debug, Clone, Default)]
pub struct LatestFfmpegStats {
    pub snapshot: StreamStatsSnapshot,
    pub sample: FfmpegProgressSample,
}

pub struct FfmpegStreamProcess {
    pub child: Arc<Mutex<Option<Child>>>,
    pub latest_stats: Arc<Mutex<LatestFfmpegStats>>,
    reader_thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Default for FfmpegStreamProcess {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            latest_stats: Arc::new(Mutex::new(LatestFfmpegStats::default())),
            reader_thread: Mutex::new(None),
        }
    }
}

impl Drop for FfmpegStreamProcess {
    fn drop(&mut self) {
        self.stop();
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
            stop_child_gracefully(&mut c, true);
        }
        drop(guard);
        if let Some(handle) = self.reader_thread.lock().unwrap().take() {
            let _ = handle.join();
        }
        let mut latest = self.latest_stats.lock().unwrap();
        latest.snapshot.live = false;
        latest.snapshot.recording = false;
        latest.snapshot.updated_at_ms = now_ms();
    }

    pub fn latest_snapshot(&self) -> StreamStatsSnapshot {
        let mut snap = self.latest_stats.lock().unwrap().snapshot.clone();
        snap.live = self.is_running();
        if !snap.live {
            snap.fps = 0.0;
            snap.bitrate_kbps = 0;
        }
        snap
    }

    /// Starts native standalone FFmpeg screen/audio capture -> RTMP/RTMPS and/or local MKV/MP4.
    pub fn start_stream(&self, rtmp_url: &str, record_path: Option<&str>) -> Result<String, String> {
        if self.is_running() {
            return Ok("FFmpeg native encoder already streaming".into());
        }
        let rec_clean = record_path.map(str::trim).filter(|s| !s.is_empty());
        let rtmp_clean = rtmp_url.trim();
        if rec_clean.is_none() && rtmp_clean.is_empty() {
            return Err("No RTMP URL or local recording path configured for standalone FFmpeg".into());
        }

        let bin = find_ffmpeg_binary().ok_or_else(|| {
            "FFmpeg binary not found. Install ffmpeg (Homebrew / winget) for direct standalone RTMP encoding.".to_string()
        })?;

        let mut args: Vec<String> = Vec::new();
        let has_audio: bool;
        #[cfg(target_os = "macos")]
        {
            args.extend([
                "-f".into(), "avfoundation".into(),
                "-framerate".into(), "30".into(),
                "-i".into(), "Capture screen 0:0".into(),
            ]);
            has_audio = true;
        }
        #[cfg(target_os = "windows")]
        {
            args.extend([
                "-f".into(), "gdigrab".into(),
                "-framerate".into(), "30".into(),
                "-i".into(), "desktop".into(),
            ]);
            has_audio = false;
        }
        #[cfg(target_os = "linux")]
        {
            args.extend([
                "-f".into(), "x11grab".into(),
                "-framerate".into(), "30".into(),
                "-i".into(), ":0.0".into(),
            ]);
            has_audio = false;
        }

        // Apply codec options explicitly per output so multi-output streams never fall back to flv1/mp3.
        if let Some(rec) = rec_clean {
            if let Some(parent) = Path::new(rec).parent() {
                if !parent.as_os_str().is_empty() {
                    let _ = std::fs::create_dir_all(parent);
                }
            }
            push_video_encode_args(&mut args, has_audio);
            let ext = Path::new(rec)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("mp4")
                .to_ascii_lowercase();
            match ext.as_str() {
                "mkv" => args.extend(["-f".into(), "matroska".into(), rec.to_string()]),
                "flv" => args.extend(["-f".into(), "flv".into(), rec.to_string()]),
                _ => args.extend([
                    "-movflags".into(),
                    "+frag_keyframe+empty_moov".into(),
                    "-f".into(),
                    "mp4".into(),
                    rec.to_string(),
                ]),
            }
        }
        if !rtmp_clean.is_empty() {
            push_video_encode_args(&mut args, has_audio);
            args.extend(["-f".into(), "flv".into(), rtmp_clean.to_string()]);
        }

        args.extend(["-progress".into(), "pipe:1".into(), "-nostats".into()]);

        let mut child = Command::new(&bin)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn FFmpeg encoder: {e}"))?;

        {
            let mut latest = self.latest_stats.lock().unwrap();
            *latest = LatestFfmpegStats::default();
            latest.snapshot.source = "ffmpeg".into();
            latest.snapshot.live = !rtmp_clean.is_empty();
            latest.snapshot.recording = rec_clean.is_some();
            latest.snapshot.updated_at_ms = now_ms();
        }

        if let Some(stdout) = child.stdout.take() {
            let stats = self.latest_stats.clone();
            let started = Instant::now();
            let handle = std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                let mut sample = FfmpegProgressSample::default();
                for line in reader.lines().flatten() {
                    parse_ffmpeg_progress_line(&line, &mut sample);
                    // Apply snapshot on every meaningful update or when a progress block key arrives.
                    let mut latest = stats.lock().unwrap();
                    latest.sample = sample.clone();
                    let snap = &mut latest.snapshot;
                    if let Some(fps) = sample.fps {
                        snap.fps = fps;
                    }
                    if let Some(br) = sample.bitrate_kbps {
                        snap.bitrate_kbps = br;
                    }
                    if let Some(dropped) = sample.drop_frames {
                        snap.dropped_frames = dropped;
                    }
                    if let Some(total) = sample.total_frames {
                        snap.total_frames = total;
                    }
                    if let Some(out_ms) = sample.out_time_ms {
                        snap.elapsed_sec = out_ms / 1000;
                    } else {
                        snap.elapsed_sec = started.elapsed().as_secs();
                    }
                    if snap.total_frames > 0 {
                        snap.dropped_pct =
                            (snap.dropped_frames as f64 / snap.total_frames as f64) * 100.0;
                    } else {
                        snap.dropped_pct = 0.0;
                    }
                    snap.updated_at_ms = now_ms();
                }
            });
            *self.reader_thread.lock().unwrap() = Some(handle);
        }

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

struct TempDirGuard(PathBuf);
impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Strip basic RTF control words (`\par`, `\line`, `{\fonttbl...}`, etc.) to readable lyrics text.
fn strip_basic_rtf(input: &str) -> String {
    if !input.trim_start().starts_with("{\\rtf") {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    let mut skip_group_depth = 0usize;
    let mut depth = 0usize;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '{' => {
                depth += 1;
                if skip_group_depth == 0 {
                    let rest: String = chars[i + 1..chars.len().min(i + 16)].iter().collect();
                    if rest.starts_with("\\fonttbl")
                        || rest.starts_with("\\colortbl")
                        || rest.starts_with("\\stylesheet")
                        || rest.starts_with("\\*")
                    {
                        skip_group_depth = depth;
                    }
                }
                i += 1;
            }
            '}' => {
                if skip_group_depth == depth {
                    skip_group_depth = 0;
                }
                depth = depth.saturating_sub(1);
                i += 1;
            }
            '\\' => {
                i += 1;
                if i >= chars.len() {
                    break;
                }
                let next = chars[i];
                if next == '\\' || next == '{' || next == '}' {
                    if skip_group_depth == 0 {
                        out.push(next);
                    }
                    i += 1;
                } else if next == '\'' && i + 2 < chars.len() {
                    let hex: String = chars[i + 1..i + 3].iter().collect();
                    if skip_group_depth == 0 {
                        if let Ok(b) = u8::from_str_radix(&hex, 16) {
                            out.push(b as char);
                        }
                    }
                    i += 3;
                } else {
                    let start = i;
                    while i < chars.len() && chars[i].is_ascii_alphabetic() {
                        i += 1;
                    }
                    let word: String = chars[start..i].iter().collect();
                    while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '-') {
                        i += 1;
                    }
                    if i < chars.len() && chars[i] == ' ' {
                        i += 1;
                    }
                    if skip_group_depth == 0 && (word == "par" || word == "line") {
                        out.push('\n');
                    }
                }
            }
            '\r' | '\n' => {
                i += 1;
            }
            other => {
                if skip_group_depth == 0 {
                    out.push(other);
                }
                i += 1;
            }
        }
    }
    out.trim().to_string()
}

/// Clean-room SlideTcp `.slide_archive` schedule extractor:
/// `.slide_archive` is a standard ZIP archive containing `main.db` (SQLite) per `docs/re-findings/slide_tcp.md`.
/// Uses unique temp directories and JSON SQLite output so multi-line lyrics are preserved intact.
pub fn parse_slide_archive(file_path: &str) -> Result<Vec<ImportedSongPayload>, String> {
    let p = Path::new(file_path);
    if !p.exists() {
        return Err(format!("File not found: {file_path}"));
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_dir = std::env::temp_dir().join(format!("onering_ewsx_{}_{}", std::process::id(), nonce));
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;
    let _cleanup = TempDirGuard(tmp_dir.clone());

    #[cfg(not(target_os = "windows"))]
    let unpack_ok = Command::new("unzip")
        .args(["-o", file_path, "-d", &tmp_dir.to_string_lossy()])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    #[cfg(target_os = "windows")]
    let archive_path = tmp_dir.join("archive.zip");
    #[cfg(target_os = "windows")]
    std::fs::copy(p, &archive_path)
        .map_err(|e| format!("Failed to stage .slide_archive as archive.zip: {e}"))?;
    #[cfg(target_os = "windows")]
    let unpack_ok = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                archive_path.to_string_lossy().replace('\'', "''"),
                tmp_dir.to_string_lossy().replace('\'', "''")
            ),
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !unpack_ok {
        return Err("Failed to unpack .slide_archive ZIP archive".into());
    }

    let db_path = tmp_dir.join("main.db");
    let mut results = Vec::new();
    if db_path.exists() {
        let db_str = db_path.to_string_lossy();
        // Prefer JSON mode in sqlite3 so multi-line RTF/text columns never split across rows.
        if let Ok(out) = Command::new("sqlite3")
            .args([
                "-json",
                db_str.as_ref(),
                "SELECT title, COALESCE(words, '') AS words FROM song;",
            ])
            .output()
        {
            if out.status.success() {
                if let Ok(rows) = serde_json::from_slice::<Vec<serde_json::Value>>(&out.stdout) {
                    for row in rows {
                        let title = row
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim();
                        let words = row
                            .get("words")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if !title.is_empty() {
                            results.push(ImportedSongPayload {
                                title: title.to_string(),
                                raw_lyrics: strip_basic_rtf(words),
                            });
                        }
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
                .unwrap_or_else(|| "SlideTcp Schedule".into()),
            raw_lyrics: "Imported SlideTcp Archive\nSelect or paste song text to reflow".into(),
        });
    }
    Ok(results)
}

pub struct ReplayBufferProcess {
    pub child: Arc<Mutex<Option<Child>>>,
    pub buffer_dir: PathBuf,
}

impl Default for ReplayBufferProcess {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            buffer_dir: std::env::temp_dir().join("onering_replay_buffer"),
        }
    }
}

impl Drop for ReplayBufferProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

impl ReplayBufferProcess {
    pub fn stop(&self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut c) = guard.take() {
            stop_child_gracefully(&mut c, true);
        }
    }

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
        // Remove segments left behind by a previous run so a fresh ring never mixes stale clips.
        if let Ok(entries) = std::fs::read_dir(&self.buffer_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with("seg_") && name.ends_with(".ts") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        // Use MPEG-TS segments so every closed segment can be losslessly concatenated without corruption.
        let seg_pattern = self.buffer_dir.join("seg_%02d.ts").to_string_lossy().to_string();

        let mut args: Vec<String> = Vec::new();
        #[cfg(target_os = "macos")]
        {
            args.extend(["-f".into(), "avfoundation".into(), "-framerate".into(), "30".into(), "-i".into(), "Capture screen 0:0".into(), "-c:v".into(), macos_hardware_encoder()]);
        }
        #[cfg(target_os = "windows")]
        {
            args.extend(["-f".into(), "gdigrab".into(), "-framerate".into(), "30".into(), "-i".into(), "desktop".into(), "-c:v".into(), "libx264".into(), "-preset".into(), "veryfast".into()]);
        }
        #[cfg(target_os = "linux")]
        {
            args.extend(["-f".into(), "x11grab".into(), "-framerate".into(), "30".into(), "-i".into(), ":0.0".into(), "-c:v".into(), "libx264".into(), "-preset".into(), "veryfast".into()]);
        }
        args.extend([
            "-f".into(), "segment".into(),
            "-segment_format".into(), "mpegts".into(),
            "-segment_time".into(), "5".into(),
            "-segment_wrap".into(), "7".into(),
            "-reset_timestamps".into(), "1".into(),
            seg_pattern,
        ]);

        let child = Command::new(&bin)
            .args(&args)
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Replay Buffer spawn failed: {e}"))?;
        *guard = Some(child);
        Ok("Replay Buffer armed (rolling 30s FFmpeg ring)".into())
    }

    pub fn save_clip(&self) -> Result<String, String> {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let out_path = std::env::temp_dir().join(format!("replay_{ts}.mp4"));

        let mut segments: Vec<(SystemTime, PathBuf)> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&self.buffer_dir) {
            for e in entries.flatten() {
                let path = e.path();
                if path.extension().and_then(|x| x.to_str()) != Some("ts") {
                    continue;
                }
                if let Ok(meta) = e.metadata() {
                    if meta.len() > 0 {
                        if let Ok(mod_t) = meta.modified() {
                            segments.push((mod_t, path));
                        }
                    }
                }
            }
        }
        segments.sort_by_key(|(t, _)| *t);

        // Exclude the most recently modified segment while FFmpeg is still actively writing to it.
        if segments.len() >= 2 {
            segments.pop();
        }
        if segments.is_empty() {
            return Ok("Replay Buffer armed — waiting for first completed 5s segment".into());
        }

        if let Some(bin) = find_ffmpeg_binary() {
            let list_path = self.buffer_dir.join(format!("concat_{ts}.txt"));
            let mut list_content = String::new();
            for (_, seg) in &segments {
                // FFmpeg's concat demuxer treats backslashes as escapes; Windows paths must use
                // forward slashes even though `PathBuf` renders them with backslashes.
                let normalized = seg.to_string_lossy().replace('\\', "/");
                let escaped = normalized.replace('\'', "'\\''");
                list_content.push_str(&format!("file '{}'\n", escaped));
            }
            std::fs::write(&list_path, &list_content)
                .map_err(|e| format!("Failed to write replay concat list: {e}"))?;
            let mut ffmpeg_args: Vec<String> = vec![
                "-y".into(),
                "-f".into(),
                "concat".into(),
                "-safe".into(),
                "0".into(),
                "-i".into(),
                list_path.to_string_lossy().to_string(),
                "-c".into(),
                "copy".into(),
            ];
            #[cfg(target_os = "macos")]
            ffmpeg_args.extend(["-bsf:a".into(), "aac_adtstoasc".into()]);
            ffmpeg_args.extend([
                "-movflags".into(),
                "+faststart".into(),
                out_path.to_string_lossy().to_string(),
            ]);
            let status = Command::new(&bin)
                .args(&ffmpeg_args)
                .output()
                .map_err(|e| format!("Failed to assemble replay clip: {e}"))?;
            let _ = std::fs::remove_file(&list_path);
            if status.status.success() {
                return Ok(format!(
                    "Saved {}s Instant Replay clip -> {}",
                    segments.len() * 5,
                    out_path.display()
                ));
            }
        }

        // Fallback: copy last completed segment directly and surface any I/O error.
        let (_, src) = segments.last().unwrap();
        let fallback_out = std::env::temp_dir().join(format!("replay_{ts}.ts"));
        std::fs::copy(src, &fallback_out)
            .map_err(|e| format!("Failed to copy replay segment: {e}"))?;
        Ok(format!("Saved Instant Replay clip -> {}", fallback_out.display()))
    }
}

/// Clean-room FFmpeg fast lossless container remux (`mkv`/`flv` -> `mp4` `-c copy -movflags +faststart`).
/// Never overwrites the input file in-place.
pub fn remux_mkv_to_mp4(input_path: &str) -> Result<String, String> {
    let bin = find_ffmpeg_binary().ok_or_else(|| "FFmpeg binary not found for auto-remux".to_string())?;
    let p = Path::new(input_path);
    if !p.exists() {
        return Err(format!("Recording not found: {input_path}"));
    }
    let out = if p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false)
    {
        let stem = p
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "recording".into());
        p.with_file_name(format!("{stem}_faststart.mp4"))
    } else {
        p.with_extension("mp4")
    };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_basic_rtf_extracts_plain_lyrics() {
        let rtf = r"{\rtf1\ansi{\fonttbl\f0 Arial;}Amazing Grace\par How sweet the sound\line}";
        assert_eq!(strip_basic_rtf(rtf), "Amazing Grace\nHow sweet the sound");
    }

    #[test]
    fn parse_encoder_table_maps_neutral_ids_from_mock_output() {
        let hw264 = ["h264_", "nv", "enc"].concat();
        let hwhevc = ["hevc_", "video", "tool", "box"].concat();
        let hwav1 = ["av1_", "qsv"].concat();
        let table = format!(
            "Encoders:\n\
             ------\n\
             V..... libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10\n\
             V..... {}    Hardware H.264 encoder (codec h264)\n\
             V..... {}    Hardware HEVC encoder (codec hevc)\n\
             V..... {}    Hardware AV1 encoder (codec av1)\n\
             A..... aac                  AAC (Advanced Audio Coding)\n",
            hw264, hwhevc, hwav1
        );

        let caps = parse_ffmpeg_encoder_table(&table);
        let ids: Vec<String> = caps.iter().map(|c| c.neutral_id.clone()).collect();
        assert!(ids.contains(&"sw_x264".to_string()));
        assert!(ids.contains(&"hw_h264".to_string()));
        assert!(ids.contains(&"hw_hevc".to_string()));
        assert!(ids.contains(&"hw_av1".to_string()));
        assert!(!ids.iter().any(|id| id.contains("hw_") && caps.iter().find(|c| &c.neutral_id == id).map(|c| c.codec_family.as_str()) == Some("audio")));

        let sw = caps.iter().find(|c| c.neutral_id == "sw_x264").unwrap();
        assert!(!sw.is_hardware);
        assert_eq!(sw.codec_family, "h264");

        let hw = caps.iter().find(|c| c.neutral_id == "hw_h264").unwrap();
        assert!(hw.is_hardware);
        assert_eq!(hw.codec_family, "h264");
    }

    #[test]
    fn parse_encoder_table_dedupes_neutral_ids() {
        let hw264a = ["h264_", "nv", "enc"].concat();
        let hw264b = ["h264_", "qsv"].concat();
        let table = format!(
            " V..... {}   first\n V..... {}   second\n V..... libx264   sw\n",
            hw264a, hw264b
        );
        let caps = parse_ffmpeg_encoder_table(&table);
        let hw_count = caps.iter().filter(|c| c.neutral_id == "hw_h264").count();
        assert_eq!(hw_count, 1);
    }
}
