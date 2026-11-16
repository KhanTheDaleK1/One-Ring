# Feature Gaps: Broadcast (OBS / Streamlabs) & Audio (Dante)

> **Status:** Alpha 1 gap analysis — input to Alpha 2 planning  
> **Date:** 2026-11-16  
> **Scope:** OBS Studio 33 (obs-websocket v5), Streamlabs Desktop (JSON-RPC 2.0), Dante Suite (Conmon / ARC / Controller)  
> **Policy:** Clean-room. This document is derived from documented wire protocols, published user-facing settings labels, and extracted configuration/UI strings only. No third-party source, assets, or proprietary implementation is copied.  
> **Naming:** User-facing surfaces use functional names — **Broadcasting**, **Audio Mixing**, **Settings**. Vendor/engine names appear only in technical references, protocol sections, and code paths.

---

## 1. Executive summary

One Ring already has a working control plane for the three broadcast/audio engines:

- `src-tauri/src/protocols/obs_streamlabs.rs` implements obs-websocket v5 framing/authentication, scene and output control, record chapters, input mute/volume, screenshots, and Streamlabs JSON-RPC model/subscription primitives.
- `src-tauri/src/runtime/obs_adapter.rs` and `streamlabs_adapter.rs` keep scene/output state live.
- `src-tauri/src/protocols/dante.rs` implements Conmon framing, metering decode, ARC subscription scaffolding, and an RX-status state machine.

What is missing is **configuration depth** and **observability**, not basic transport. Today One Ring can *start and stop* a stream and *see* a Dante meter; it cannot answer the questions a tech director asks before and during service:

- “Will this encoder setting actually hold 1080p60 on this machine?”
- “Is the stream key pointed at the right destination, at the right bitrate for that platform?”
- “Is program audio being monitored, and is the meter showing sample peak or true peak?”
- “Which Dante device is clock leader, are we in one clock domain, and why is this subscription late?”

This report catalogues the gaps and proposes an Alpha 2 surface that stays volunteer-first: safe defaults and plain-language status in Show Mode, deep controls gated behind Engineer Mode.

### Gap severity at a glance

| Area | Current state | Alpha 2 need | Severity |
| :--- | :--- | :--- | :--- |
| Encoder settings (NVENC / VideoToolbox / x264) | Single `encoder` enum, no configuration | Rate control, preset, profile, keyframe, B-frames, multipass, look-ahead, psychovisual tuning | **Critical** |
| Bitrate policy | None | Video/audio bitrate, dynamic bitrate, per-platform caps, buffer size | **Critical** |
| Canvas / output video | Canvas list only | Base vs output resolution, downscale filter, FPS, color format/space/range | **High** |
| Audio monitoring & metering | None | Per-source monitoring mode, meter type/decay, true peak, track routing | **Critical** |
| Recording resilience | MKV/MP4 only | Hybrid/Fragmented MP4, split by time/size, replay buffer, chapter markers | **High** |
| Stream service profiles | Raw RTMP URL + key | Service profiles with codec/keyframe/bitrate recommendations | **High** |
| Dante routing | Display-only routes, identify flash | Full crosspoint matrix read/write, subscription lifecycle | **High** |
| Dante clock domain | A single `danteClock` string | Leader election, domain status, PTP role, sample rate/pull-up | **Critical** |
| Dante latency | Warn/error thresholds only | Per-device RX latency selection, latency histogram | **High** |
| Conmon diagnostics | Metering + RXSTATUS | Interface stats, error counters, flow/fanout limits, event log | **Medium–High** |
| AES67 / external sync | None | AES67 config, external word clock, sync-to-external flags | **Medium** |

---

## 2. Current One Ring baseline

### 2.1 Settings model

`src-tauri/src/state.rs` (`BroadcastSettings`, replicated in `src/types.ts`):

```rust
pub struct BroadcastSettings {
    pub destinations: Vec<RtmpDestination>, // id, platform, rtmp_url, stream_key, enabled
    pub recording_path: String,
    pub recording_format: String,           // "MKV" | "MP4"
    pub encoder: String,                    // "NVENC" | "VideoToolbox" | "Software"
}
```

There is no bitrate, keyframe interval, rate control, preset, profile, audio track, canvas geometry, monitoring, color, or replay-buffer field. `RtmpDestination` stores one URL and key per platform; there is no service profile, recommended settings, or validation state.

`DanteSettings`:

```rust
pub struct DanteSettings {
    pub subnet_interface: String,
    pub conmon_meter_port: u16,   // 8751
    pub conmon_control_port: u16, // 8700
    pub clock_sync_warn_ms: u32,  // 50
    pub clock_sync_error_ms: u32, // 150
}
```

There is no clock-domain model, leader/Preferred Leader selection, sample-rate enforcement, per-device RX latency, AES67 toggle, or diagnostics retention.

### 2.2 Protocol/adapters

Implemented (OBS):

- `GetVersion`, `GetStats`, `GetCanvasList`, `GetSceneList`
- `SetCurrentProgramScene`, `SetCurrentPreviewScene`, `GetOutputList`, `GetOutputStatus`, start/stop/toggle output
- `GetStreamStatus`, `StartStream`, `StopStream`, `SendStreamCaption`
- `GetRecordStatus`, `StartRecord`, `StopRecord`, `SplitRecordFile`, `CreateRecordChapter`
- `GetInputMute`, `SetInputMute`, `GetInputVolume`, `SetInputVolume`
- `GetSourceScreenshot`, batch requests, event subscription mask

Implemented (Streamlabs):

- `HELPER`/`SUBSCRIPTION`/`PROMISE`/`EVENT` decoding, `StreamingService`, `ScenesService`, `DualOutputService`, scene activation, stream/record toggle, `AudioSource`/scene resource IDs, auth.

Implemented (Dante):

- Conmon header encode/parse (spec 24-byte and observed 32-byte framing), multicast groups, opcode constants
- Metering frame decode with dB mapping and clipping
- ARC packet framing + RXSTATUS / subscription parsing, `DanteRxStatus` machine
- RX error status constant, device identify constant, AES67 constants (declared, not driven)

### 2.3 UI

`src/components/EngineerView.tsx` exposes tabs for Broadcast, Audio & Dante, Dante, NDI, and Logs. Broadcast shows live cards with endpoint, canvas, bitrate text, and a live toggle. Dante shows clocks and signal values plus identify flashing. There is **no settings editor** for either subsystem; the settings are persistence-only today.

---

## 3. Broadcast gaps — OBS Studio 33 / Streamlabs

### 3.1 Output mode and encoder topology

OBS exposes three output modes: **Simple**, **Advanced**, and **FFmpeg**. One Ring currently models a single flat encoder choice, which cannot represent either Simple’s intent-based presets or Advanced’s per-output encoder stacks.

| Gap | OBS/Streamlabs evidence | Alpha 2 requirement |
| :--- | :--- | :--- |
| Output mode not modelled | Simple / Advanced / FFmpeg modes; separate streaming, recording, and replay-buffer encoders | `output_mode` + independent `stream_encoder`, `record_encoder`, `replay_encoder` configs |
| Simple-mode intent missing | Hardware (NVENC H.264/HEVC/AV1), Hardware (Apple H.264/HEVC), Software (x264), low-CPU x264; presets `ultrafast`, `veryfast` (default), `fast` | Simple-mode intent enum (`quality`, `balanced`, `low_cpu`) that compiles to concrete Advanced settings |
| Encoder identity is coarse | Streamlabs encoder IDs include `x264`, `x264_lowcpu`, `obs_x264`, `nvenc`, `jim_nvenc`, `ffmpeg_nvenc`, `amd`, `amd_amf_h264`, `qsv`, AV1 variants | Store concrete encoder ID + display name + capability probe, not a UI enum |
| No hardware capability probe | NVENC/VideoToolbox availability depends on GPU, driver, OS, and codec | Probe once, cache `(encoder, codec, max_res, max_fps, bf_frames_supported)` and show disabled reasons |
| No multi-output parity | Streamlabs `DualOutputService` records and streams independently | Allow different encoders/resolutions per output (stream 1080p, record 4K is a real request) |

### 3.2 NVENC configuration

Values that must be exposed (defaults chosen conservatively for volunteer safety):

| Setting | Typical options | One Ring default | Notes |
| :--- | :--- | :--- | :--- |
| Codec | H.264, HEVC, AV1 (Ada+) | H.264 | H.264 is the compatibility floor for YouTube/Facebook |
| Rate control | CBR, VBR, CQP, Lossless | CBR | CBR for live RTMP; CQP for local recording |
| Bitrate | 2,500–51,000 kbps | 6,000 kbps @1080p30, 9,000 @1080p60 | Hard-cap by destination and uploaded bandwidth |
| Buffer size | Usually equal to bitrate | = bitrate (CBR) | Independent buffer only for VBR |
| Keyframe interval | 0–10 s (0 = auto) | 2 s | Must match destination rec; YouTube/Facebook both document 2 s |
| Preset | P1 (fastest) … P7 (slowest/best) | P5 | Map to legacy “Speed / Balanced / Quality / Max Quality” labels in UI |
| Tuning | High Quality, Low Latency, Ultra Low Latency | High Quality (stream), Low Latency (record) | Ultra Low Latency can hurt compression efficiency |
| Multipass | Disabled, qres, fullres | qres | Fullres is expensive; warn on laptops |
| Profile | Baseline, Main, High | High | Main for Facebook compatibility per service matrix |
| Look-ahead | off/on + depth | off | Adds latency; useful on dedicated GPUs |
| Psycho Visual Tuning | off/on | on | Small quality gain, extra GPU load |
| B-frames | 0–4 | 2 | Some destinations/decoders behave poorly with 4 |
| Repeat headers | off/on | on | Needed for some RTMP ingest behaviors |
| GPU / adapter | index selection | auto (0) | Multi-GPU laptops must pin the discrete GPU |
| Rescale output | off/on + resolution + filter | off | Prefer canvas-level scaling; rescale is per-output escape hatch |

### 3.3 VideoToolbox configuration (macOS)

| Setting | Typical options | One Ring default | Notes |
| :--- | :--- | :--- | :--- |
| Codec | H.264, HEVC | H.264 | HEVC only if destination and decoder support it |
| Rate control | CBR, VBR, CQP | CBR for stream | `Average Bit Rate` for VBR |
| Bitrate | 1,000–51,000 kbps | 6,000 @1080p30 | Apple encoders often need more bitrate than NVENC for equal quality |
| Keyframe interval | seconds or frames | 2 s | Keep destination-aligned |
| Profile | Baseline, Main, High | High | |
| Quality | 0–100 or preset | ~60 | “Quality” can silently override bitrate; expose as advanced |
| Allow frame reordering | off/on | on | B-frames via VT; off for lowest latency |
| Max B-frames | 0–3 | 2 | |
| Spatial AQ | off/on | on | Improves flat areas; small cost |
| Hardware acceleration | on (state only) | on | Surface the OS-reported unavailable reason instead of a generic failure |
| Colour | inherited from canvas | inherit | VT path is sensitive to full/limited range mismatches |

Implementation note: on macOS, `encoder = "VideoToolbox"` currently means “Apple hardware path,” but OBS distinguishes H.264 vs HEVC hardware encoder IDs. One Ring must store codec independently so it never sends an HEVC-only property set to an H.264 encoder.

### 3.4 Software x264 configuration

| Setting | Options | Default | Notes |
| :--- | :--- | :--- | :--- |
| Rate control | CBR, VBR, CQP, CRF | CBR (stream), CRF 20 (record) | CRF is not available for RTMP CBR expectations |
| Preset | ultrafast … veryslow | `veryfast` | OBS Simple default is `veryfast`; `fast` is also offered |
| Profile | baseline, main, high | high | |
| Tune | none, film, animation, zerolatency | zerolatency for live | |
| x264 options | free-form key=value | empty | Advanced only; validate keys |
| Repeat headers | off/on | on | |
| Threads | auto/0–N | auto | Warn if CPU headroom < 20% |

### 3.5 Bitrate, buffering, and dynamic bitrate

Missing entirely. Required fields:

- `video_bitrate_kbps`, `audio_bitrate_kbps` (per track), `buffer_size_kbps`
- `dynamic_bitrate` (RTMP only) with min/max and adaptation aggressiveness
- `reconnect` toggle, `retry_delay_sec` (default 2), `max_retries` (default 20)
- `bandwidth_test` result and a preflight estimate from recent stream stats
- `rescale_output` per output
- `enhanced_broadcasting` flag (where supported) and its incompatibility warnings

Destination guidance (documented service recommendations, encoded as editable presets — not hard-coded policy):

| Service | Protocol | Video cap | Audio | Keyframe | Profile | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| YouTube Live | RTMPS / HLS | 51,000 kbps | 160 kbps AAC | 2 s | High | Higher ceilings; do not assume home upload can sustain them |
| Facebook Live | RTMPS | 9,000 kbps | 128 kbps AAC | 2 s | Main | Matrix varies by resolution/FPS; Main profile avoids some decoder issues |

One Ring should compute a **safe bitrate** as `min(service_cap, measured_upload × 0.7, encoder_cap)` and explain which term won. This is the single highest-value anti-failure feature for volunteers.

### 3.6 Canvas, output video, and FPS

Currently `BroadcastCanvas` is read-only display data (`resolution`, `aspect`, `active_scene`). Missing configuration:

| Setting | OBS equivalent | Alpha 2 handling |
| :--- | :--- | :--- |
| Base (Canvas) Resolution | Canvas video settings | Editable in Engineer Mode; warn if changed while live |
| Output (Scaled) Resolution | Output video settings | Per-output; default 1920×1080 |
| Downscale filter | Bilinear, Bicubic, Lanczos, Area | Default Lanczos for quality; Area for heavy downscale (e.g., 4K→1080p) |
| FPS type | Common / Integer / Fractional | Common FPS values plus 29.97/59.94 exact rational support |
| Canvas aspect | Horizontal 16:9, Vertical 9:16 | Already represented; must round-trip to OBS multi-canvas UUID |
| HDR / colour | Format, space, range, SDR white, HDR peak | See §3.9 |

The vertical-canvas path is a differentiator for churches that simulcast to Shorts/Reels. Alpha 2 should let a cue target a canvas by UUID and verify the output actually consumes it.

### 3.7 Audio: monitoring, metering, tracks, sync

This is the largest audio gap on the broadcast side.

| Gap | OBS/Streamlabs evidence | Alpha 2 requirement |
| :--- | :--- | :--- |
| Monitoring mode per source | Off / Monitor Only (mute output) / Monitor and Output; Streamlabs values 0/1/2 | `monitoring_type` enum per audio source, with “Monitor Only” guarded to prevent feedback |
| Monitoring device | Advanced audio monitoring device | Global device selector + per-source override where supported |
| Meter type | Sample Peak vs True Peak | Global meter type; True Peak requires oversampling |
| Meter decay | Fast, Medium (Type I PPM), Slow (Type II PPM) | Selectable decay with matching ballistics |
| Meter scale/colours | dBFS scale, peak-hold | Peak hold + clip latch + reset; consistent with `--status-warn`/`--status-danger` |
| Track routing | Up to 6 audio tracks (1–6 bitrates) | Per-source track bitmap + per-track bitrate/name; “Track 1 = program, Track 2 = isolate” preset |
| Sync offset | Streamlabs `-950..5000` ms | Per-source sync offset with signed input and reset |
| Balance / force mono | `balance`, `forceMono` | Per-source balance and mono fold-down |
| Fader model | `fader{db, deflection, mul}`, `audioMixers`, `mixerHidden` | Preserve dB↔deflection mapping; show dB, not raw multiplier |
| Push-to-mute / push-to-talk | Global hotkey behavior | Optional engineer binding; volunteer-safe default is off |
| Low-latency buffering | Audio buffering setting | Surface buffer ms and underrun count |
| Desktop audio devices | Global desktop audio 1/2 | Explicitly disable or route; churches often capture the wrong device |
| Audio bitrate | Per-track AAC bitrate | Default 160 kbps program, 128 kbps spare |

Monitoring is a safety issue, not a nicety: “Monitor and Output” on a mic in a room with speakers causes feedback. The UI must label it as destructive when the source is a live microphone.

### 3.8 Recording, replay buffer, and resilience

| Gap | Evidence | Requirement |
| :--- | :--- | :--- |
| Formats | MKV, FLV, MP4, MOV, TS, HLS, Hybrid MP4/MOV, Fragmented MP4/MOV | Add Hybrid/Fragmented MP4 and TS as safe defaults; retain MKV as maximum-resilience default |
| Unfinalized-file risk | MP4/MOV are unrecoverable if the process dies before finalization | Preflight warning + automatic “safe recording” policy |
| Split recording | By time, by size, manual | Time/size split with sane bounds; manual split already exists as `SplitRecordFile` |
| Replay buffer | Duration + separate encoder | Optional; useful for highlight clipping, usually low priority for church |
| Chapters | Already implemented | Add automatic chapter on cue advance (already modelled as `recordChapter`) and verify on OBS |
| Recording path validation | Path string only | Check existence, free space, write permission, and same-volume constraints |
| Audio-only / isolate track | Not modelled | Record separate tracks for later remix; expose track count in preflight |
| Recording encoder | Separate from stream encoder | Independent config; allow software x264 for archival quality while NVENC streams |

### 3.9 Advanced video, colour, and network

| Gap | Options | Alpha 2 handling |
| :--- | :--- | :--- |
| Colour format | NV12, I420, I444, P010, I010, P216, P416, BGRA | Default NV12; only expose HDR-capable formats when HDR is enabled |
| Colour space | sRGB, Rec.601, Rec.709, Rec.2100 PQ, Rec.2100 HLG | Rec.709 default for SDR; PQ/HLG gated behind HDR toggle |
| Colour range | Limited, Full | Limited for broadcast; warn on Full mismatches |
| SDR white level | nits | Only relevant in HDR workflows |
| HDR peak | nits | Validate against display/capture chain |
| Network bind | Bind to IP, IP family (IPv4/IPv6/any) | Multi-NIC churches need explicit bind; default Any |
| TCP pacing | off/on + pacing settings | Advanced; expose only when RTT/jitter is unstable |
| Custom muxer settings | free-form | Hidden advanced field with validation |
| Stats | CPU, memory, disk, FPS, dropped frames, congestion | Add `GetStats`/`GetStreamStatus` fields to preflight and live strip |

### 3.10 Missing OBS protocol builders

To drive the above, add clean-room request builders (no source copying):

- `GetVideoSettings` / `SetVideoSettings` (base and output resolution, FPS numerator/denominator)
- `GetStreamServiceSettings` / `SetStreamServiceSettings` (service type, server, key, use-auth)
- `GetRecordDirectory` / `SetRecordDirectory`
- `GetInputList`, `GetInputSettings`, `SetInputSettings` (audio device binding, monitoring device)
- `GetInputAudioTracks` / `SetInputAudioTracks`
- `GetInputAudioSyncOffset` / `SetInputAudioSyncOffset`
- `GetInputAudioBalance` / `SetInputAudioBalance`
- `GetInputAudioMonitorType` / `SetInputAudioMonitorType`
- `GetOutputSettings` / `SetOutputSettings` (encoder-specific property bag)
- `GetProfileList` / `SetCurrentProfile`, `GetProfileParameter` / `SetProfileParameter`
- `GetSceneItemList` with source types (to classify audio vs video inputs)
- `TriggerHotkeyByName` (push-to-mute/talk, only when explicitly enabled)
- Batch execution for atomic “apply profile then start stream”

Streamlabs equivalents: `AudioSource.setMonitoringType`, `setSyncOffset`, `setAudioMixers`, `setMuted`, `setForceMono`, `setBalance`, plus `StreamingService`/`RecordingService` settings models. Use the existing `SlobsParams`/`SlobsRequest` builders; do not add a parallel codec.

---

## 4. Dante gaps — routing, clocking, latency, diagnostics

### 4.1 Routing and subscriptions

Current `DanteRoute` is a display row with `rx_status: UNICAST | MULTICAST | PREPARING | UNRESOLVED`, dBFS, and `identify_flashing`. It cannot create, modify, or tear down a subscription.

Required model:

| Field | Source concept | Notes |
| :--- | :--- | :--- |
| TX device / channel | ARC TX channel | Stable device identity (name + MAC/instance ID), not display name alone |
| RX device / channel | ARC RX channel | Same identity discipline |
| Subscription status | Subscription Status column | Map to `DanteRxStatus` plus a human label |
| Primary/Secondary status | Network Status columns | Redundant network truth, not a single health bit |
| Latency setting | Per-RX-device latency | Device-wide setting, not per-flow |
| Latency status | Latency Status column | Actual vs configured |
| Packet errors | Packet Errors column | Counter + rate |
| Flow type | Unicast/multicast | Multicast requires bandwidth budget check |
| Bandwidth | TX/RX B/W | Aggregate against interface capacity |
| Identify | Device identify opcode | Already declared (`IDENTIFY_QUERY`/`STATUS`) but not wired |

Routing operations to add:

- `unsubscribe` (already represented by `ArcSubscription::is_unsubscribe`) and `subscribe`
- atomic “replace subscription” to avoid a silent gap during service
- dry-run validation: same clock domain, channel existence, latency compatibility, bandwidth headroom
- explicit confirmation for changes to **live** subscriptions, with undo within a bounded window

### 4.2 Clock domain and leader

This is the most important Dante correctness gap. A single `dante_clock` string cannot express:

- which device is **Leader** (grandmaster) vs **Preferred Leader**
- whether all devices are in the **same clock domain**
- **Sync** state per device (Locked / Not Locked / Leader / Disabled / Error)
- **Mute** state (a muted clock device can still be leader)
- **Clock Source** (internal, external word clock, AES67, etc.)
- **Domain Status** (leader/follower, domain name, v1/v2 multicast)
- **Enable Sync To External** and external word clock frequency
- **Sample rate** and **pull-up** (e.g., 48 kHz, 48 kHz +0.1%, −0.1%, 44.1 kHz)

Required model:

```text
DanteClockState {
  domain_id, domain_name,
  leader_device_id, preferred_leader_device_id,
  ptp_version (v1 | v2),
  sample_rate_hz, pull_up_ppm,
  external_sync_enabled, external_sync_source,
  devices: [{
    id, name, sync_state, mute_state, clock_source,
    domain_status, rx_multicast_v1, rx_multicast_v2,
    preferred_leader, sync_to_external, last_seen_ms
  }]
}
```

Derived truths One Ring must compute:

- `domain_healthy = every device sync_state ∈ {Locked, Leader} && one leader`
- `split_brain = >1 leader in the same domain`
- `orphan = device in a different domain than the intended program domain`
- `preferred_leader_mismatch = configured preferred leader ≠ actual leader`

The last one is the classic “we rebooted the switch and the wrong device became leader” failure. It should be a Preflight amber/red check with a one-click “restore intended leader” action (where the underlying device permits it).

### 4.3 Latency

Current settings only define warn/error thresholds for clock sync (`50 ms` / `150 ms`). They conflate **clock sync** with **audio latency**. Separate them.

Required:

| Setting | Options / shape | Default | Notes |
| :--- | :--- | :--- | :--- |
| Device RX latency | 0.15, 0.25, 0.5, 1, 2, 5, 10, 20, 50 ms (device-dependent) | 1 ms wired; 2–5 ms wireless/Via | Per-RX-device, applied to all its subscriptions |
| Latency status | OK / Late / Early / Uncalibrated | — | From subscription status, not a timer |
| Latency histogram | Setting, Peak, Average, Late count, Duration | — | Audio flows only; video flows report differently |
| Warn / error thresholds | ms | 5 ms warn, 20 ms error | Independent from clock-sync thresholds |
| Audio/video sync | offset between Dante audio and video | 0 ms | Relevant when Dante feeds broadcast and FOH simultaneously |

UI: a compact “latency health” strip per device in Engineer Mode, with a histogram drawer. Show **Late** counts, not just averages — average latency hides intermittent misses that cause audible dropouts.

### 4.4 Conmon diagnostics

Existing code has the framing and opcodes; the diagnostics surface is missing.

| Diagnostic | Opcode / source | Requirement |
| :--- | :--- | :--- |
| Interface stats | `IFSTATS_STATUS` 0x0040 / query 0x0041 | TX/RX bytes, packets, errors, drops, link speed per interface |
| RX error status | `RX_ERROR_STATUS` 0x0110 | Error counters by subscription, rate over time |
| Clock status | `CLOCKING_STATUS` 0x0020 | Per-device sync/mute/source/domain |
| Master status / query | `MASTER_STATUS` 0x0022 / `MASTER_QUERY` 0x0023 | Leader identity and changes |
| Name/identify | `NAME_ID_STATUS` 0x0026 / `IDENTIFY_QUERY` 0x0063 | Human labels, identify flash |
| Interface status/control | `INTERFACE_STATUS` 0x0011 / `INTERFACE_CONTROL` 0x0013 | Link state, redundancy mode |
| Sample rate | `SRATE_STATUS` 0x0080 / control 0x0081 | 44.1/48/96 kHz, pull-up |
| Encoding | `ENC_STATUS` 0x0082 / control 0x0083 | PCM bit depth / encoding |
| AES67 | `AES67_STATUS` 0x1007 / control 0x1006 | Enable/disable, SAP, PTP interop |
| Device lock | `DEVICE_LOCK_STATUS` 0x1009 / control 0x1008 | Prevent accidental changes |
| Flow change | `FLOW_CHANGE` 0x0104 | Detect re-routes caused by other operators |
| Fanout / bandwidth | Subscription error tooltips | Detect TX fanout limit and bandwidth exceeded before they cause dropouts |

Also surface the Controller terminology in plain language:

- Subscription error reasons: clock-domain mismatch, bandwidth exceeded, no suitable channel latency, RX/TX link down, TX fanout limit, unresolved channel, device offline.
- Multicast clock states: Startup, Initializing, Faulty, Disabled, Listening, PreLeader, Leader, Passive, Uncalibrated, Follower, Standby.

### 4.5 AES67, external sync, and device configuration

Missing entirely from `DanteSettings`:

- AES67 mode enable/disable and its prerequisites (PTP domain, multicast, sample rate)
- External word clock source and frequency
- Sample-rate pull-up and the resulting broadcast/FOH mismatch risk
- Device locking to prevent volunteer/engineer edits during service
- Per-device encoding and channel count
- Firmware/version visibility (`VERSIONS_STATUS` 0x0060)
- Device reset control (`SYS_RESET_CONTROL` 0x0092) — destructive, engineer-only, two-step

---

## 5. Alpha 2 recommendations

### 5.1 Product principles

1. **Volunteer-safe defaults, engineer-only depth.** Show Mode gets a single “Ready to Broadcast” verdict and a guarded start/stop. All encoder math, colour formats, and audio clock domains live in Engineer Mode.
2. **Explain the constraint, not just the value.** “6,000 kbps — limited by measured upload (8.6 Mbps)” beats a bare number.
3. **Never allow silent divergence.** If a setting cannot be applied to the live engine, show `configured ≠ applied` explicitly.
4. **Destructive actions are two-step and reversible.** Feedback-risk monitoring, subscription replacement, leader changes, and device reset.
5. **Preflight owns safety.** Every new field that can break a service gets a Preflight check and a remediation action.

### 5.2 UI/UX recommendations

User-facing surfaces in this section use functional names only: **Broadcasting**, **Audio Mixing**, **Settings**. Engine names stay in protocol/backend documentation and are never shown as navigation labels.

| Current label | Proposed user-facing label |
| :--- | :--- |
| Broadcast | **Broadcasting** |
| Audio & Dante | **Audio Mixing** |
| Dante | **Audio Mixing → Clocking & Routing** |
| Logs | **Settings → Diagnostics** |

#### Broadcasting (Engineer Mode)

- **Mode selector:** Simple / Advanced. Simple exposes three intent cards (Best Quality, Balanced, Low CPU) and a platform picker. Advanced reveals the encoder and output property groups.
- **Encoder card:** Codec, rate control, bitrate, buffer, keyframe, preset, tuning, profile, B-frames, multipass, look-ahead, psycho-visual, GPU selection. Show a live “estimated GPU/CPU load” badge.
- **Bitrate planner:** Visual bar showing service cap, measured upload × 0.7, and chosen bitrate; one-click “use safe value.” Include a per-destination table for simultaneous YouTube + Facebook.
- **Video card:** Base vs output resolution with aspect lock, downscale filter, FPS (including 29.97/59.94), and a warning when changing while live.
- **Audio card:**
  - Source list with meter, dB fader, mute, sync offset, balance, force mono, track checkboxes.
  - Monitoring column with explicit labels: `Off`, `Monitor only (silent to stream)`, `Monitor + output (feedback risk)`. The third option is red and requires confirmation for microphone sources.
  - Meter settings: Sample Peak vs True Peak; Fast / Medium (Type I) / Slow (Type II); peak hold; clip latch reset.
  - Track matrix: 6 tracks with names and bitrates; a “Program / Isolate / Spare” preset.
- **Recording card:** Format (default MKV or Hybrid MP4), path with free-space check, split by time/size, separate encoder, chapters-on-cue toggle, replay buffer (collapsed by default).
- **Diagnostics drawer:** CPU, GPU, disk, dropped frames, congestion, reconnect count, current bitrate vs target, keyframe interval actually in use.

#### Audio Mixing (Engineer Mode)

- **Topology/health header:** Domain name, leader, sample rate, pull-up, device count, “All locked” verdict.
- **Clock table:** Device | Sync | Mute | Clock Source | Domain Status | Preferred Leader | External Sync. Sort problem devices first. Distinct icons for Leader, Locked, Not Locked, Disabled, Error.
- **Routing matrix:** TX devices × RX channels, with subscription state, latency setting/status, packet errors, and bandwidth. Right-click or long-press for subscribe/unsubscribe with validation preview. Never apply a live change without showing the affected flow.
- **Latency panel:** Per-device selector with the standard options, plus a histogram (Peak / Average / Late / Duration). Show audio-flow caveat.
- **Network panel:** Primary/Secondary status, TX/RX bandwidth, packet errors, fanout usage. A “multicast budget” bar prevents oversubscription.
- **Event log:** Timestamped clock changes, subscription errors, link flaps, and identify events; retain enough history to diagnose a Sunday failure on Monday.
- **Guardrails:** Device lock indicator, “changes blocked while live” banner, two-step confirmation for leader/AES67/sample-rate changes.

#### Show Mode additions

- Broadcasting card shows a single verdict: `Ready`, `Degraded` (with one-line cause), or `Blocked` (with remediation).
- Live strip shows actual bitrate, dropped-frame percentage, audio peak, and stream uptime. No encoder jargon.
- A “Fix” action deep-links to the exact Engineer Mode field that failed preflight, without exposing the rest of the panel.

### 5.3 Backend implementation plan

#### Phase A — data model and protocol builders (highest leverage)

1. Extend `BroadcastSettings`:
   - `output_mode`, `stream_encoder: EncoderConfig`, `record_encoder: EncoderConfig`, `replay_encoder: Option<EncoderConfig>`
   - `video: VideoConfig` (base/output resolution, downscale filter, FPS num/den, colour)
   - `audio: AudioConfig` (sample rate, channels, meter type/decay, monitoring device, tracks)
   - `network: NetworkConfig` (bind IP, family, TCP pacing)
   - `recording: RecordingConfig` (format, path, split, chapters)
   - `destinations: Vec<StreamDestination>` with `service_profile`, `recommended`, `validation`
2. Extend `DanteSettings`:
   - `clock: ClockConfig` (domain, preferred leader, sample rate, pull-up, external sync)
   - `latency: LatencyConfig` (defaults + per-device map, thresholds)
   - `aes67: Aes67Config`
   - `diagnostics: DiagnosticsConfig` (retention, polling interval)
3. Add request builders listed in §3.10, keeping them in `protocols/obs_streamlabs.rs` beside existing builders.
4. Add Dante control builders for `CLOCKING_STATUS/CONTROL`, `MASTER_QUERY`, `IFSTATS_QUERY`, `SRATE_*`, `ENC_*`, `AES67_*`, `IDENTIFY_QUERY`, and ARC subscribe/unsubscribe. Keep ARC body handling opaque unless a documented layout is confirmed; expose typed helpers only for confirmed fields.

#### Phase B — adapters and state mapping

1. On connect, read full configuration once, then subscribe to change events. Cache `configured` separately from `applied`.
2. Poll `GetStats`/`GetStreamStatus` at 1 Hz while live; poll Dante interface stats at 2–5 s.
3. Map OBS advanced output settings into a typed `EncoderConfig` with validation (bitrate > 0, keyframe 0–10, B-frames 0–4, preset P1–P7).
4. Map Streamlabs `AudioSource` fields into the same internal audio model so UI and cues are engine-agnostic.
5. Implement Dante derived health (`domain_healthy`, `split_brain`, `preferred_leader_mismatch`) in Rust, not in the UI.

#### Phase C — preflight and safety

1. New Preflight checks: encoder capability, bitrate vs upload, keyframe vs service, audio monitoring feedback risk, track routing, recording path/free space, Dante domain singleton, leader match, subscription errors, latency late counts, AES67/sample-rate mismatch.
2. Remediation actions must be explicit and logged; no silent auto-fix of clock leader or routing.
3. Two-step guard for: enabling “Monitor + output” on a mic, replacing a live subscription, changing leader, changing sample rate/pull-up, enabling AES67, device reset.
4. Undo window for non-destructive app-level changes; hardware changes require re-application.

#### Phase D — verification and test strategy

- Golden JSON fixtures for OBS request/response and Streamlabs model payloads (existing style).
- Conmon frame round-trip tests for every new opcode, including the 24- vs 32-byte framing ambiguity.
- Fuzz/negative tests for malformed ARC and Conmon bodies; always fail closed.
- Simulator scenarios: upload collapse, encoder unavailable, wrong clock leader, late subscriptions, bandwidth exceeded, link flap, disk full.
- A “rehearsal” mode that applies settings to a profile without going live, mirroring the existing cue rehearsal concept.

### 5.4 Suggested Alpha 2 scope cut

If Alpha 2 must be time-boxed, ship in this order:

1. **Encoder + bitrate planner** (prevents the most common failed stream).
2. **Audio monitoring + meter type/track routing** (prevents feedback and silent program audio).
3. **Audio clock-domain health + leader mismatch** (prevents the most common audio-network outage).
4. **Subscription matrix read/write with validation** (prevents wrong routing).
5. **Latency panel + interface/error counters** (diagnosis).
6. **Recording format/split/resilience** (protects the archive).
7. **AES67/external sync/device lock** (advanced venues).

Defer replay buffer, HDR/colour depth beyond Rec.709, custom muxer settings, and FFmpeg output mode unless a specific venue needs them.

---

## 6. Acceptance criteria

Alpha 2 is “broadcast/audio complete” when all of the following hold:

- [ ] A volunteer can see one broadcast verdict and start/stop without touching encoder settings.
- [ ] An engineer can configure NVENC and VideoToolbox with the fields in §3.2/§3.3 and see `configured == applied` after reconnect.
- [ ] Bitrate selection is capped by service, upload estimate, and encoder, with the limiting factor displayed.
- [ ] Canvas base/output resolution, downscale filter, FPS (including 29.97/59.94), and colour range round-trip to OBS.
- [ ] Every audio source exposes monitoring mode, sync offset, balance, force mono, track assignment, and meter values.
- [ ] “Monitor + output” on a microphone requires confirmation and is visibly marked as feedback risk.
- [ ] Recording supports MKV and Hybrid/Fragmented MP4, validates path/free space, and can split by time/size.
- [ ] Audio Mixing UI shows clock domain, leader, preferred leader, per-device sync/mute/source, and flags split-brain or orphan devices.
- [ ] Routing changes are validated (domain, latency, bandwidth, fanout) and require confirmation when live.
- [ ] Latency histogram and subscription error reasons are visible for audio flows.
- [ ] Conmon interface stats, RX errors, and clock changes are retained in an event log.
- [ ] All destructive actions are two-step, logged, and covered by simulator scenarios.
- [ ] No third-party code or assets are introduced; all protocol work remains clean-room from documented behavior.

---

## 7. References

- `docs/re-findings/obs.md` — obs-websocket v5, OBS 33 multi-canvas, outputs/services.
- `docs/re-findings/streamlabs.md` — Streamlabs JSON-RPC, `DualOutputService`, `AudioSource`.
- `docs/re-findings/dante.md` — Conmon, ARC, mDNS, Via/Studio, Controller behavior.
- `src-tauri/src/state.rs` — `BroadcastSettings`, `DanteSettings`, `BroadcastCanvas`, `DanteRoute`.
- `src-tauri/src/protocols/obs_streamlabs.rs` — existing OBS/Streamlabs codec.
- `src-tauri/src/protocols/dante.rs` — existing Conmon/ARC codec.
- `src-tauri/src/runtime/obs_adapter.rs`, `streamlabs_adapter.rs` — live adapters.
- `src/components/EngineerView.tsx` — current engineer UI.
- `docs/UX_DESIGN.md` — dual-persona model, Preflight, design tokens.
- OBS `locale/en-US.ini` and `rtmp-services/data/services.json` (extracted install data) — user-facing setting labels, defaults, and service recommendations.
- Streamlabs renderer bundle (extracted install data) — encoder IDs, settings keys, `AudioSource` model.
- Dante Controller `i18n_en.properties` (extracted install data) — clock/latency/status terminology and diagnostic labels.
- `Dante/decompiled/ARCHITECTURE.md`, `GHIDRA_DECOMPILE_SUMMARIES.md` — component roles and confirmed protocol behavior.

---

*Prepared as a clean-room gap analysis. All recommendations describe behavior and configuration semantics observed in documented protocols and shipped user-facing data; no proprietary implementation is reproduced.*
