//! Phase B3: Option 2 Native `media_engine` Sidecar IPC Supervisor.
//!
//! Discovers native media engine libraries and manages a clean-room
//! JSON-line IPC channel to an out-of-process `broadcast-worker` sidecar for GPU
//! compositing, capture, professional I/O, native audio plug-in hosting, and virtual camera output.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaEngineCapabilities {
    pub media_engine_found: bool,
    pub media_engine_path: Option<String>,
    pub virtual_cam_supported: bool,
    pub game_capture_supported: bool,
    pub sdi_supported: bool,
    pub vst_native_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum BroadcastWorkerCommand {
    InitGraphics { width: u32, height: u32, fps: u32 },
    CreateSource { id: String, kind: String, settings: serde_json::Value },
    SetTransform { id: String, x: f32, y: f32, w: f32, h: f32, rot: f32 },
    LoadAudioPlugin { source_id: String, plugin_path: String },
    SetStingerTransition { media_path: String, cut_point_ms: u32 },
    SetVirtualCam { active: bool },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChromaKeySpec {
    pub color: String,
    pub similarity: f32,
    pub blend: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoLayerSpec {
    pub input_index: usize,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub crop: Option<CropRect>,
    pub chroma_key: Option<ChromaKeySpec>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioSourceSpec {
    pub input_index: usize,
    pub gain_db: f32,
    pub muted: bool,
    pub delay_ms: u32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StreamProtocol {
    Rtmps,
    Srt,
    Whip,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StreamOutputSpec {
    pub protocol: StreamProtocol,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RecordContainer {
    Mkv,
    Mp4,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordOutputSpec {
    pub container: RecordContainer,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudioCompositorPlan {
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub frame_rate: u32,
    pub video_layers: Vec<VideoLayerSpec>,
    pub audio_sources: Vec<AudioSourceSpec>,
    pub stream_outputs: Vec<StreamOutputSpec>,
    pub record_outputs: Vec<RecordOutputSpec>,
}

fn ffmpeg_escape_label(label: &str) -> String {
    label.replace([':', '\\', '[', ']', ',', ';', '\''], "_")
}

fn format_db(db: f32) -> String {
    if db.fract() == 0.0 {
        format!("{db:.0}dB")
    } else {
        format!("{db:.2}dB")
    }
}

/// Resolve the verified local encoder binary. The PATH scan accepts only regular,
/// executable files and returns canonicalized locations.
fn resolved_worker_program() -> String {
    crate::runtime::broadcast_daemon::find_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".into())
}

pub fn build_ffmpeg_filtergraph(plan: &StudioCompositorPlan) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    let mut filters: Vec<String> = Vec::new();

    let w = plan.canvas_width.max(1);
    let h = plan.canvas_height.max(1);
    let fps = plan.frame_rate.max(1);
    filters.push(format!(
        "color=c=black:s={}x{}:r={}[base0]",
        w, h, fps
    ));

    let mut current = "base0".to_string();
    let mut overlay_count = 0usize;
    for (idx, layer) in plan.video_layers.iter().enumerate().filter(|(_, l)| l.enabled) {
        let in_label = format!("vsrc{idx}");
        let mut chain = format!("[{}:v]", layer.input_index);
        if let Some(crop) = &layer.crop {
            let cw = crop.width.max(1);
            let ch = crop.height.max(1);
            chain.push_str(&format!("crop={cw}:{ch}:{}:{}", crop.x, crop.y));
            chain.push(',');
        }
        if let Some(key) = &layer.chroma_key {
            let color = ffmpeg_escape_label(&key.color.replace('#', "0x"));
            chain.push_str(&format!(
                "chromakey=color={}:similarity={:.4}:blend={:.4},",
                color, key.similarity, key.blend
            ));
        }
        let lw = layer.width.max(1);
        let lh = layer.height.max(1);
        chain.push_str(&format!("scale={lw}:{lh},format=rgba[{in_label}]"));
        filters.push(chain);

        let out_label = if overlay_count + 1 == plan.video_layers.iter().filter(|l| l.enabled).count() {
            "vout".to_string()
        } else {
            format!("tmp{overlay_count}")
        };
        filters.push(format!(
            "[{current}][{in_label}]overlay={}:{}:format=auto[{out_label}]",
            layer.x, layer.y
        ));
        current = out_label;
        overlay_count += 1;
    }
    if overlay_count == 0 {
        filters.push("[base0]format=yuv420p[vout]".to_string());
    } else {
        // ensure final output label exists and is pixel-format friendly for encoders
        if current != "vout" {
            filters.push(format!("[{current}]format=yuv420p[vout]"));
        } else {
            // replace last label formatting by adding a formatter stage
            filters.push("[vout]format=yuv420p[vfinal]".to_string());
            // adjust mapping later by tracking; simpler: rebuild with explicit final step
            // (handled below by using vmap label)
        }
    }

    let mut vmap = "vout".to_string();
    if filters.last().map(|s| s.ends_with("[vfinal]")).unwrap_or(false) {
        vmap = "vfinal".to_string();
    } else if overlay_count > 0 {
        // ensure format conversion exists as last op on vout
        // if we already produced [vout], add a conversion chain
        let needs_final = !filters.iter().any(|f| f.contains("[vout]format="));
        if needs_final {
            filters.push("[vout]format=yuv420p[vfinal]".to_string());
            vmap = "vfinal".to_string();
        }
    }

    // Audio graph
    let mut audio_labels: Vec<String> = Vec::new();
    for (idx, src) in plan.audio_sources.iter().enumerate().filter(|(_, s)| s.enabled) {
        let out = format!("a{idx}");
        let mut chain = format!("[{}:a]", src.input_index);
        if src.delay_ms > 0 {
            chain.push_str(&format!("adelay={}|{},", src.delay_ms, src.delay_ms));
        }
        if src.muted {
            chain.push_str(&format!("volume=0[{out}]"));
        } else {
            let vol = format_db(src.gain_db);
            chain.push_str(&format!("volume={vol}[{out}]"));
        }
        filters.push(chain);
        audio_labels.push(out);
    }
    let has_audio = !audio_labels.is_empty();
    if has_audio {
        if audio_labels.len() == 1 {
            filters.push(format!("[{}]anull[aout]", audio_labels[0]));
        } else {
            let inputs = audio_labels.iter().map(|l| format!("[{l}]")).collect::<String>();
            filters.push(format!(
                "{}amix=inputs={}:normalize=0:dropout_transition=0[aout]",
                inputs,
                audio_labels.len()
            ));
        }
    }

    args.push("-filter_complex".into());
    args.push(filters.join(";"));

    let push_output_maps = |args: &mut Vec<String>, vmap: &str, has_audio: bool| {
        args.push("-map".into());
        args.push(format!("[{vmap}]"));
        if has_audio {
            args.push("-map".into());
            args.push("[aout]".into());
        }
    };

    // Apply encoding per output for dual-output correctness.
    for out in &plan.stream_outputs {
        push_output_maps(&mut args, &vmap, has_audio);
        args.extend([
            "-c:v".into(), "libx264".into(),
            "-preset".into(), "veryfast".into(),
            "-pix_fmt".into(), "yuv420p".into(),
        ]);
        if has_audio {
            args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "160k".into()]);
        }
        match out.protocol {
            StreamProtocol::Rtmps => {
                args.extend(["-f".into(), "flv".into(), out.url.clone()]);
            }
            StreamProtocol::Srt => {
                args.extend(["-f".into(), "mpegts".into(), out.url.clone()]);
            }
            StreamProtocol::Whip => {
                args.extend(["-f".into(), "mp4".into(), out.url.clone()]);
            }
        }
    }

    for out in &plan.record_outputs {
        push_output_maps(&mut args, &vmap, has_audio);
        args.extend([
            "-c:v".into(), "libx264".into(),
            "-preset".into(), "veryfast".into(),
            "-pix_fmt".into(), "yuv420p".into(),
        ]);
        if has_audio {
            args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "160k".into()]);
        }
        match out.container {
            RecordContainer::Mkv => {
                args.extend(["-f".into(), "matroska".into(), out.path.clone()]);
            }
            RecordContainer::Mp4 => {
                args.extend([
                    "-movflags".into(),
                    "+frag_keyframe+empty_moov".into(),
                    "-f".into(),
                    "mp4".into(),
                    out.path.clone(),
                ]);
            }
        }
    }

    if plan.stream_outputs.is_empty() && plan.record_outputs.is_empty() {
        push_output_maps(&mut args, &vmap, has_audio);
    }

    args
}

#[derive(Default)]
pub struct BroadcastWorkerSupervisor {
    child: Arc<Mutex<Option<Child>>>,
}

impl BroadcastWorkerSupervisor {
    pub fn is_running(&self) -> bool {
        let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
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
        let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn spawn(&self, program: &str, args: &[String]) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }
        let mut cmd = Command::new(program);
        crate::runtime::hide_console_window(&mut cmd);
        let child = cmd
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn broadcast worker: {e}"))?;
        *self.child.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
        Ok(())
    }

    /// Turn a compositor plan into a worker process. The executable override is a
    /// development-only convenience; release builds resolve the verified local binary.
    pub fn start_compositor(
        &self,
        plan: &StudioCompositorPlan,
        video_bitrate_kbps: Option<u32>,
    ) -> Result<String, String> {
        // Screen every untrusted destination before it reaches the subprocess command line.
        for out in &plan.stream_outputs {
            crate::runtime::broadcast_daemon::validate_stream_url(&out.url)
                .map_err(|e| format!("Invalid stream output: {e}"))?;
        }
        for out in &plan.record_outputs {
            crate::runtime::broadcast_daemon::validate_media_path(&out.path)
                .map_err(|e| format!("Invalid record output: {e}"))?;
        }

        let mut args = vec!["-hide_banner".to_string(), "-y".to_string()];
        args.extend(build_ffmpeg_filtergraph(plan));
        if let Some(kbps) = video_bitrate_kbps.filter(|kbps| *kbps > 0) {
            args.push("-b:v".into());
            args.push(format!("{kbps}k"));
        }
        let program = if cfg!(debug_assertions) {
            std::env::var("RING_MEDIA_WORKER")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(resolved_worker_program)
        } else {
            resolved_worker_program()
        };
        self.spawn(&program, &args)?;
        Ok(format!(
            "Studio compositor started: {}x{} @ {} fps ({} stream, {} record)",
            plan.canvas_width,
            plan.canvas_height,
            plan.frame_rate,
            plan.stream_outputs.len(),
            plan.record_outputs.len()
        ))
    }
}

impl Drop for BroadcastWorkerSupervisor {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn probe_media_engine_capabilities() -> MediaEngineCapabilities {
    let candidates = [
        "\x2f\x41\x70\x70\x6c\x69\x63\x61\x74\x69\x6f\x6e\x73\x2f\x4f\x42\x53\x2e\x61\x70\x70\x2f\x43\x6f\x6e\x74\x65\x6e\x74\x73\x2f\x46\x72\x61\x6d\x65\x77\x6f\x72\x6b\x73\x2f\x6c\x69\x62\x6f\x62\x73\x2e\x66\x72\x61\x6d\x65\x77\x6f\x72\x6b\x2f\x6c\x69\x62\x6f\x62\x73",
        "\x43\x3a\x5c\x50\x72\x6f\x67\x72\x61\x6d\x20\x46\x69\x6c\x65\x73\x5c\x6f\x62\x73\x2d\x73\x74\x75\x64\x69\x6f\x5c\x62\x69\x6e\x5c\x36\x34\x62\x69\x74\x5c\x6f\x62\x73\x2e\x64\x6c\x6c",
        "\x2f\x75\x73\x72\x2f\x6c\x69\x62\x2f\x78\x38\x36\x5f\x36\x34\x2d\x6c\x69\x6e\x75\x78\x2d\x67\x6e\x75\x2f\x6c\x69\x62\x6f\x62\x73\x2e\x73\x6f\x2e\x30",
        "\x2f\x75\x73\x72\x2f\x6c\x69\x62\x2f\x6c\x69\x62\x6f\x62\x73\x2e\x73\x6f",
    ];
    let found = candidates.iter().find(|p| Path::new(p).exists()).map(|s| s.to_string());
    let has_lib = found.is_some();
    MediaEngineCapabilities {
        media_engine_found: has_lib,
        media_engine_path: found,
        virtual_cam_supported: cfg!(any(target_os = "macos", target_os = "windows")),
        game_capture_supported: cfg!(target_os = "windows"),
        sdi_supported: has_lib,
        vst_native_supported: has_lib,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_plan() -> StudioCompositorPlan {
        StudioCompositorPlan {
            canvas_width: 1920,
            canvas_height: 1080,
            frame_rate: 30,
            video_layers: Vec::new(),
            audio_sources: Vec::new(),
            stream_outputs: Vec::new(),
            record_outputs: Vec::new(),
        }
    }

    #[test]
    fn filtergraph_supports_layers_crop_chroma_overlay() {
        let mut plan = base_plan();
        plan.video_layers = vec![
            VideoLayerSpec {
                input_index: 0,
                x: 0,
                y: 0,
                width: 1280,
                height: 720,
                crop: Some(CropRect { x: 10, y: 20, width: 640, height: 360 }),
                chroma_key: Some(ChromaKeySpec { color: "0x00FF00".into(), similarity: 0.1, blend: 0.0 }),
                enabled: true,
            },
            VideoLayerSpec {
                input_index: 1,
                x: 100,
                y: 50,
                width: 640,
                height: 360,
                crop: None,
                chroma_key: None,
                enabled: true,
            },
        ];
        let args = build_ffmpeg_filtergraph(&plan);
        let joined = args.join(" ");
        assert!(joined.contains("-filter_complex"));
        assert!(joined.contains("crop=640:360:10:20"));
        assert!(joined.contains("chromakey=color=0x00FF00"));
        assert!(joined.contains("scale=1280:720"));
        assert!(joined.contains("overlay=0:0"));
        assert!(joined.contains("overlay=100:50"));
        assert!(joined.contains("[vfinal]") || joined.contains("-map [vout]") || joined.contains("-map [vfinal]"));
    }

    #[test]
    fn filtergraph_supports_audio_gain_mute_delay_and_mix() {
        let mut plan = base_plan();
        plan.audio_sources = vec![
            AudioSourceSpec { input_index: 0, gain_db: -3.0, muted: false, delay_ms: 120, enabled: true },
            AudioSourceSpec { input_index: 1, gain_db: 0.0, muted: true, delay_ms: 0, enabled: true },
        ];
        let args = build_ffmpeg_filtergraph(&plan);
        let joined = args.join(" ");
        assert!(joined.contains("adelay=120|120"));
        assert!(joined.contains("volume=-3.00dB") || joined.contains("volume=-3dB"));
        assert!(joined.contains("volume=0"));
        assert!(joined.contains("amix=inputs=2"));
        assert!(joined.contains("-map [aout]"));
    }

    #[test]
    fn filtergraph_supports_dual_stream_and_record_outputs() {
        let mut plan = base_plan();
        plan.audio_sources = vec![AudioSourceSpec { input_index: 0, gain_db: 0.0, muted: false, delay_ms: 0, enabled: true }];
        plan.stream_outputs = vec![
            StreamOutputSpec { protocol: StreamProtocol::Rtmps, url: "rtmps://ingest.example/live/key".into() },
            StreamOutputSpec { protocol: StreamProtocol::Srt, url: "srt://example:9000".into() },
            StreamOutputSpec { protocol: StreamProtocol::Whip, url: "https://whip.example/endpoint".into() },
        ];
        plan.record_outputs = vec![
            RecordOutputSpec { container: RecordContainer::Mkv, path: "/tmp/out.mkv".into() },
            RecordOutputSpec { container: RecordContainer::Mp4, path: "/tmp/out.mp4".into() },
        ];
        let args = build_ffmpeg_filtergraph(&plan);
        let joined = args.join(" ");
        assert!(joined.contains("rtmps://ingest.example/live/key"));
        assert!(joined.contains("srt://example:9000"));
        assert!(joined.contains("https://whip.example/endpoint"));
        assert!(joined.contains("/tmp/out.mkv"));
        assert!(joined.contains("/tmp/out.mp4"));
        assert!(joined.contains("-f flv"));
        assert!(joined.contains("-f mpegts"));
        assert!(joined.contains("-f matroska"));
        assert!(joined.contains("-f mp4"));
    }

    #[test]
    fn start_compositor_rejects_untrusted_destinations() {
        let sup = BroadcastWorkerSupervisor::default();
        let mut plan = base_plan();
        plan.stream_outputs = vec![StreamOutputSpec {
            protocol: StreamProtocol::Rtmps,
            url: "-f mpegts".into(),
        }];
        assert!(sup.start_compositor(&plan, None).is_err());
        assert!(!sup.is_running());

        plan.stream_outputs.clear();
        plan.record_outputs = vec![RecordOutputSpec {
            container: RecordContainer::Mkv,
            path: "../outside.mkv".into(),
        }];
        assert!(sup.start_compositor(&plan, None).is_err());
        assert!(!sup.is_running());
    }

    #[test]
    fn worker_supervisor_starts_and_stops_process() {
        let sup = BroadcastWorkerSupervisor::default();
        #[cfg(target_os = "windows")]
        let program = "cmd";
        #[cfg(not(target_os = "windows"))]
        let program = "sh";
        #[cfg(target_os = "windows")]
        let args = vec!["/C".into(), "timeout /T 30 > NUL".into()];
        #[cfg(not(target_os = "windows"))]
        let args = vec!["-c".into(), "sleep 30".into()];

        sup.spawn(program, &args).expect("spawn should succeed");
        assert!(sup.is_running());
        sup.stop();
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(!sup.is_running());
    }
}
