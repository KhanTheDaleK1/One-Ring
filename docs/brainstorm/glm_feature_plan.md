# One Ring — Feature Roadmap & Next-Release Plan

*Generated from a code-level audit of `src/components/*.tsx` and `src-tauri/src/lib.rs` (+ adapters/protocols/state). File references point at the exact gap. Last updated: Nov 2026, post v0.2.3-alpha.*

---

## 1. Current state in one paragraph

The architecture is strong: clean-room protocol codecs (OBS-websocket v5, ProPresenter v1, X32 OSC, Dante Conmon/ARC, NDI 6 Discovery) are unit-tested, six live adapters exist behind `RING_LIVE=1`, and the cue engine fans commands out through `AdapterRegistry` (`src-tauri/src/runtime/mod.rs`). The problem is that **most of the app's power features dead-end in local React state or are unreachable UI**, while the backend has latent capability the frontend never touches. The gap between codec and value is the roadmap.

---

## 2. Highest-impact missing features by integration

### OBS
- **Audio mixer is fake** — `ObsAudioMixerPanel.tsx` meters are synthesized sine waves; mute/volume are `setState` (`BroadcastCanvasView.tsx:700-717`). The codec already ships `SetInputMute`/`SetInputVolumeDb`/volume-meter subscriptions (`obs_streamlabs.rs:276-296`) and the adapter ignores them (`ObsCommand`, `obs_adapter.rs:49-59`, only 9 variants). This is the single cheapest high-impact win: real faders, real meters, real mute — all protocol work is done.
- **No multi-canvas scene switching.** The cue model has `vertical_scene` (`state.rs:197`) but `ObsCommand::SetProgramScene` targets only canvas 1; `GetCanvasList`/canvas-scoped `GetSceneList` builders exist (`obs_streamlabs.rs:183-193`) and are never used.
- **Source management is entirely browser-local.** The whole source system in `BroadcastCanvasView` (add/transform/filter/track-routing) never reaches OBS; there are no `CreateInput`/`SetSceneItemTransform`/`SetInputSettings` commands at all.
- Cosmetic bits: fabricated bitrates (12 000/5 800 hard-coded, `obs_adapter.rs:509-513`), `requestId` never used to correlate responses, and recording chapters depend on cue transitions only.

### ProPresenter
- **Slides only go next/prev/clear.** The `/v1/ws` bidirectional envelope (`WsRequest`, `propresenter.rs:250-293`) and the full `paths` module (stage message, transport, playlist, presentation trigger, `propresenter.rs:24-39`) are implemented but **never wired to a transport**. No stage-message support, no deck/playlist browsing, no slide-index writes.
- **ProLink preroll is a state machine without a socket.** `PrerollCoordinator` (`propresenter.rs:377+`) is complete; the multicast `224.0.0.90:18514` join in `runtime/` does not exist.
- **Lyric/Bible imports never reach ProPresenter.** `LyricImportModal` and `BibleLookupModal` build local decks; once a local deck exists, `App.tsx:351-401` stops calling `trigger_slide_action` (the only real ProPresenter path) entirely.
- **Cue engine ignores `slide_label`.** `ServiceCue.slide_label` is set but `dispatch_cue_actions` (`lib.rs:257-294`) never sends a ProPresenter command — cues can't open a presentation.

### EasyWorship
- **The parser is real but unreachable.** `parse_easyworship_ewsx` (`obs_daemon.rs:378-451`) shelling `unzip` + `sqlite3` is registered as `import_ewsx_schedule`, yet `SlidesCanvasView.tsx:495` reads `.ewsx` files **as plain text locally** and never calls it. Fix is a ~10-line frontend change.
- **Fragile dependencies**: external `sqlite3`/`unzip` on PATH; failure returns a hardcoded placeholder payload instead of an error. No RTF decode, no `document/`/`attachment` table support.
- **No handoff**: imported songs land in local slide state; no "send to ProPresenter" or "send to OBS as text source" path.

### Dante
- **Routing is send-and-forget guesswork.** `RouteCrosspoint` (`dante_adapter.rs:104-122`) builds a hand-crafted `0x3010` ARC body the codec itself flags as unverified (`dante.rs:388-390`); no subscription verification, no `RxStatusMachine` decode of replies (the state machine exists and is never fed), `let _ = send_to` everywhere.
- **Replies ignored**: incoming Conmon packets are tried only as meter frames; clock-status replies (queried every 10 s) are never decoded; `DanteRoute.rx_status` never updates live.
- **No discovery**: no mDNS `_netaudio-arc/_netaudio-cmc` browse; the matrix falls back to synthetic IPs (`DanteControllerMatrix.tsx:105-113`) when the backend returns no routes.
- Settings disconnect: `AppSettings.dante.*` (subnet interface, ports) is edited in UI but never read by the adapter.

### X32
- **The flagship full console is dead code.** `X32FullConsoleModal` (103 KB, sends real OSC via `send_x32_osc`) can never be opened — no code path ever sets `showFullX32=true` (`EngineerView.tsx:27,352`).
- **`send_x32_osc` honors only 4 of ~30 address patterns** (`lib.rs:751-776`): EQ, gate, dynamics, bus sends, preamp, config/name, color, routing are silently dropped. Console is write-only over fake initial state; nothing hydrates from `/ch/NN/config/name` or channel echoes (which arrive and are reduced to a `lastChannelChange` debug string).
- **Cue engine never recalls scenes.** `X32Command::RecallScene` exists and is even flagged "confirmation enforced by cue engine" (`x32_adapter.rs:333-335`), but `dispatch_cue_actions` sends no scene recall.
- Guessed `/meters/1` DCA offset (`x32_adapter.rs:31-34`), `keepalive_interval_sec` setting stored but ignored.

### NDI
- **Control-plane only; zero video.** Discovery service, receiver switching, and metadata PTZ are genuinely live, but there is no NDI video source/receiver pipeline anywhere (no `ndi_routing` redirect usage, no libndi/FFmpeg ingest). The program canvas renders webcams via `getUserMedia`, which is the webview's camera, not an NDI feed.
- **Tally and status dropped.** The codec parses `TallyEcho`/`MonitorEvents` (`ndi.rs`) and the adapter discards them (`ndi_adapter.rs:149 _ => {}`); receiver status is hardcoded `"CONNECTED"`, `tally_program` hardcoded `false` (`ndi_adapter.rs:143-145`). One-way `auto_heal` marks everything CONNECTED without verification.
- **Cue engine ignores `camera_preset_id`** — same story as ProPresenter: PTZ recall (`trigger_ndi_ptz`, `lib.rs:721-748`) exists but cues never dispatch it. Also no VISCA-over-IP despite `visca_port: 52381` in Settings.
- `VideoCanvasView` PTZ d-pad buttons have **no onClick at all** (`VideoCanvasView.tsx:239-356`); working PTZ exists only inside NdiStudioTools.

### Cross-cutting (worth fixing before anything else)
- **`RuntimeConfig::from_env` ignores `AppSettings`** (`runtime/mod.rs:50-107`): every device IP/port/password lives in env vars at startup only. The Settings UI is decorative for hardware. This is the #1 blocker for non-technical volunteer operators.
- **Cue "verification" is fabricated.** `verification_steps` (`lib.rs:221-255`) hardcodes observed strings and latencies (4/2/5/3 ms); `apply_live_status` only checks adapter *presence*. Trust in the cue engine — the product's core promise — rests on fake telemetry.
- **Dead surfaces**: `ShowBuilderView` (show-file save/load; `export_show_file` has zero frontend callers), `PreflightView` (never rendered; `run_preflight_probes` never called), `WelcomeTour` navigates to nonexistent tabs.
- **Secondary output is a browser popup** synced via BroadcastChannel; no Tauri windows, no monitor assignment, and it doesn't show timers/nursery alerts.
- Peer discovery beacons an empty IP and hardcoded port; no peer sync transport consumes the registry.

---

## 3. Top 5 concrete actions for the next release

Ordered by impact-per-hour. Each is scoped, testable, and builds on existing (already-tested) codecs.

### 1. Make Settings drive the adapters (kill `from_env`)
Replace `RuntimeConfig::from_env()` with `RuntimeConfig::from_settings(&AppSettings)`; on `update_settings` (`lib.rs:575-595`), diff against the current registry and rebuild/start/stop only affected adapters. Surface adapter health from `device://health` in SettingsView.
**Acceptance:** enter X32 IP + OBS password in Settings → adapters connect live without env vars; changing the IP reconnects within seconds. This unblocks every other item and makes the product installable by volunteers.

### 2. Finish the cue engine: dispatch ProPresenter, PTZ, and scene recall from cues
Extend `dispatch_cue_actions` (`lib.rs:257-294`) to (a) send a ProPresenter open/trigger for `slide_label` (path `/v1/presentation/active` or ws trigger), (b) dispatch `NdiCommand::RecallPtzPreset` for `camera_preset_id` mapped through `NdiPtzSettings.preset_names`, and (c) dispatch `X32Command::RecallScene` when a cue declares one (add `x32_scene: Option<u32>` to `ServiceCue`). Order the fan-out as an `ObsRequestBatch` with `SerialFrame` where OBS is involved.
**Acceptance:** one GO button moves OBS scene, camera preset, DCA mutes, and slides — verified by real device responses, not strings.

### 3. Replace fake cue verification with real post-conditions
Track command→response correlation (use `requestId` in OBS; store in-flight writes per adapter), and have `verification_steps` report actual adapter observations: last scene change event timestamp, meter silence/signal state, ProPresenter slide status from the live `/v1/status/updates` stream, X32 echo. Keep the fake path only in simulator mode.
**Acceptance:** pull the network cable mid-cue → the report shows DRIFT for the affected domains with the real failure, and the event log matches.

### 4. Real OBS audio mixer + fix the dead X32 console
- Add `ObsCommand::SetInputMute/SetInputVolumeDb` (+ optional `ToggleInputMute`) to the adapter, subscribe to `INPUT_VOLUME_METERS`, and wire `ObsAudioMixerPanel` mute/volume/meters to the real stream (delete the sine-wave tick).
- Make `EngineerView` mount `X32FullConsoleModal` behind an actual button, and extend `send_x32_osc` into a general `OscMessage` pass-through (`x32.rs::OscMessage::encode` already exists) while hydrating channel strip names/meters from `/xremote` echoes and `/meters/1`.
**Acceptance:** mute a mic in One Ring → OBS mutes it; move an EQ knob in the console → `/eq/...` hits the console and the change echoes back within 1 s.

### 5. Ship the three "orphaned feature" fixes (small, huge perceived value)
1. **EasyWorship:** route `SlidesCanvasView`'s `.ewsx` input through `import_ewsx_schedule` (and make the parser return `Err` instead of placeholder text); add a graceful "sqlite3 not found — bundled fallback coming" error.
2. **Re-mount `ShowBuilderView`** (or a trimmed "Service" tab) so show-file export/import (`export_show_file`/`import_show_file`) is reachable; wire `PreflightView` and call `run_preflight_probes` on app start + before service.
3. **Fix the broken wirings:** WelcomeTour tab names, VideoCanvasView PTZ d-pad → `trigger_ndi_ptz`, `flash_dante_identify` IP-vs-routeId mismatch (`EngineerView.tsx:347`), and render timers/nursery alerts on the FOH/Stage output windows.

---

## 4. Beyond the next release (sequenced backlog)

| Horizon | Item | Rationale |
|---|---|---|
| Next+1 | NDI video path: FFmpeg/libndi ingest of one source into the program canvas + `ndi_routing` receiver redirect | The discovery control plane works; video is the missing half and churches run NDI cameras |
| Next+1 | Dante: mDNS device discovery, decode clock/RXSTATUS replies, verified ARC subscription encoder | Turns the matrix from best-effort into auditable |
| Next+2 | ProPresenter `/v1/ws` transport + stage display messaging; ProLink preroll socket | Codecs complete, transports absent |
| Next+2 | Tauri-native secondary output windows with monitor assignment (replace BroadcastChannel popups) | Reliability on stage displays |
| Next+3 | Bible API integration (offline dataset → on-demand reference lookup with cache) | 27 hardcoded passages today |
| Next+3 | Real source pipeline (scene items/inputs via OBS) replacing browser-local source state | Unifies "sources" between One Ring and OBS |
| Ongoing | Battery of integration tests against a fake OBS/X32/ProPresenter server in CI | Adapters already are the seams |

---

## 5. Quick wins / bugs spotted during the audit

- `import_ewsx_schedule` unused (§ EasyWorship) — 10-line fix.
- `ShowBuilderView`/`PreflightView` dead — mount them.
- `X32FullConsoleModal` unreachable — one button.
- `VideoCanvasView` PTZ d-pad has no handlers.
- `flash_dante_identify` receives an IP where the backend expects a route id (`EngineerView.tsx:347`).
- `WelcomeTour` → nonexistent tabs (`preflight`/`show`/`engineer`).
- Linux returns empty audio/video device lists (`obs_daemon.rs` has no `cfg(target_os = "linux")` branch).
- Peer announcement sends an empty `ip_address` and hardcoded port 47800.
- OBS device health id hardcoded `"yt"` / label "YT + FB" regardless of actual outputs.
