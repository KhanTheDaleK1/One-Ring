# Feature-Gap Analysis: ProPresenter 22 & NDI 6 Tools → One Ring Alpha 2

> **Status:** Planning / Alpha 2 input
> **Audience:** Lead Agent, frontend + Rust implementers, UX
> **Baseline:** One Ring `v0.1.0-alpha.1` working tree
> **Evidence:** ProPresenter 22.0.1 artifacts, NDI Tools 6.3.2 artifacts, `docs/re-findings/propresenter.md`, `docs/re-findings/ndi.md`, current One Ring source
> **Clean-room notice:** This document describes observable protocol behavior, feature surfaces, and configuration semantics only. It contains no copied source, decompiled method bodies, proprietary assets, or vendor code. UI labels are cited as interoperability evidence, not as reusable content.

---

## 1. Executive Summary

One Ring already has the right architectural spine: a Rust `AdapterRegistry`, typed event channels, a persisted settings model, a cue/undo engine, and three distinct operator surfaces (Preflight, Show, Engineer). The gap is not architecture; it is **coverage of the two hardest production domains** — presentation control and video/NDI routing.

Today the product is effectively a **simulator with one live presentation adapter and three live audio/video adapters**. ProPresenter is partially integrated (five subscribed topics, three commands). NDI is a **protocol codec with no runtime client**. PTZ recall, receiver switching, auto-heal, and preflight probes are UI simulations. There is no stage-confidence window, no playlist/media surface, no display-output model, and no Studio Monitor or Router control.

The highest-value Alpha 2 move is to turn the existing codec work into live, observable control in this order:

1. **ProPresenter state depth** — store timers, transport time, layers, and a real slide list; expand subscriptions; add transport and clear-group commands.
2. **Stage confidence output** — a second Tauri window backed by real ProPresenter stage state, not a local React timer.
3. **NDI receiver routing** — a real Discovery Service client that sends `<control_receiver><command>connect</command>` and consumes telemetry.
4. **Studio Monitor REST control** — `/v1/sources`, `/v1/configuration`, `/v1/recording` for displays that expose web control.
5. **PTZ dispatch** — NDI `ntk_ptz_*` metadata and a vendor/VISCA transport, with preset recall actually leaving the building.
6. **Media/audio playlists and screen-output awareness** — the minimum surface a volunteer needs to run a service without touching ProPresenter's UI.

Everything else (edge blend, HDR, corner pinning, macros, looks, props, Router presets, Bridge/HX) should be modeled and surfaced progressively, not all at once. Alpha 2 should make One Ring **trustworthy for a Sunday**, not feature-complete against ProPresenter.

### Top 10 gaps, ranked by service-day impact

| # | Gap | Why it matters | Current state |
|---|---|---|---|
| 1 | No stage-confidence window | Volunteers cannot see current/next/notes/timers on stage | ❌ Absent; Show Mode uses a local interval |
| 2 | Display switching is fake | "Switch display" logs an XML string but sends nothing | 🟡 Simulator-only |
| 3 | Camera preset recall only mutates UI state | Presets never move a camera | 🟡 Simulator-only |
| 4 | Presentation state is scalar | No slide list, notes, layers, real timers, transport | 🟡 Partial live, shallow model |
| 5 | No media/audio playlist control | Can't trigger walk-in music, loops, or media from One Ring | ❌ Absent |
| 6 | No display-output model | Can't answer "which screen is audience vs stage vs stream key?" | ❌ Absent (hardcoded display strings) |
| 7 | No direct display-device control | Can't fix a lobby/stage display remotely | ❌ Absent |
| 8 | Preflight always passes | Operators get false confidence | 🟡 Simulator-only |
| 9 | No clear groups / messages / props / looks | Can't run a service without the presentation app's UI | ❌ Absent |
| 10 | No video topology/telemetry view | Can't see drift, tally, codec, or connection quality | 🔵 Codec-only |

---

## 2. Method & Evidence

### 2.1 Sources reviewed

| Source | What it establishes | Confidence |
|---|---|---|
| `ProPresenter/decompiled/openapi_v1.json` | 205 paths / 256 operations; authoritative route catalog and parameter names | High |
| `ProPresenter/.../en.lproj/ProPresenter.strings` | 13,839 lines / 5,791 keys; feature taxonomy, screen configuration, stage layouts, playback behaviors, cue actions | High (UI surface), Medium (runtime semantics) |
| `ProPresenter/decompiled/ProPresenter_Helper_Network/control_tower_rodata.txt` | Web remote / stage-display tokens, embedded UI hints, ProLink vocabulary | Medium-High |
| `ProPresenter/decompiled/proApi_proto_tokens.txt`, `communications_proto_tokens.txt` | ProLink, stage, screen, NDI/Syphon, communication device vocabulary | Medium |
| `NDI Tools/decompiled/native/Application.Network.StudioMonitor.x64.exe/strings.txt` | Full Studio Monitor configuration/decorations key set, PTZ vendor strings | High (keys exist), Medium (semantics) |
| `NDI Tools/extracted/app/Studio Monitor/web/content/js/studio_monitor.js` + `index.html` | Live REST usage: `/v1/sources`, `/v1/configuration`, `/v1/recording`, `/v1/authorize`; decoration toggles | High |
| `NDI Tools/decompiled/managed/Router/managed-members.json` | Router input/output/preset models and runtime controller fields | High |
| `NDI Tools/decompiled/managed/Bridge.UI/managed-members.json` | Runtime modes, HX encoder model, ProxyHX settings and error taxonomy | High |
| `NDI Tools/decompiled/managed/DiscoveryService.UI/managed-members.json` | Receiver/source telemetry fields, discovery settings model | High |
| Current One Ring source | Implemented behavior vs. simulated behavior | High |

### 2.2 Maturity legend used below

| Code | Meaning |
|---|---|
| ✅ **Implemented** | Real outbound/inbound behavior exists and is wired end-to-end |
| 🟡 **Simulator-only** | UI changes local state; no protocol traffic leaves the process |
| 🔵 **Codec-only** | Encode/parse logic exists, but no transport/runtime adapter uses it |
| ❌ **Absent** | No meaningful model, UI, or transport |

### 2.3 Clean-room boundary

All recommendations are expressed as **interoperable behavior**: HTTP routes, JSON/XML document shapes, state machines, and UI affordances. Implementations must be written independently from the specifications in `docs/re-findings/`. Do not port decompiled bodies, string tables, icons, or assets.

---

## 3. Current One Ring Baseline

### 3.1 What is genuinely live

| Domain | Capability | Evidence |
|---|---|---|
| Audio | X32 adapter, DCA mute/nudge dispatch | `src-tauri/src/runtime/x32_adapter.rs`, `AdapterRegistry` |
| Video | OBS and Streamlabs adapters | `src-tauri/src/runtime/` |
| Presentation | ProPresenter HTTP status stream; `Next`, `Previous`, `ClearLayer("slide")` | `runtime/propresenter_adapter.rs`, `lib.rs::trigger_slide_action` |
| Settings | `AppSettings` persisted to `app_config_dir/settings.json`; engineer PIN gate | `state.rs`, `lib.rs` setup |
| Ops | Cue engine, undo stack, verification report, event log | `state.rs`, `lib.rs` |
| UI | Preflight, Show Mode, Engineer Mode, Settings | `src/App.tsx`, `src/components/*` |

### 3.2 What is simulated

| Surface | Current behavior | Evidence |
|---|---|---|
| NDI receiver switch | Mutates `subscribed_source`/`status`; logs a fabricated `[ndi-discovery-5959] Sent <control_receiver>…` line | `lib.rs::switch_ndi_receiver` |
| NDI auto-heal | Forces every receiver to `expected_source` / `CONNECTED` | `lib.rs::auto_heal_ndi_receivers` |
| PTZ recall | Sets `active_camera_preset_id` only | `lib.rs::recall_camera_preset` |
| Preflight | Sets every check to `pass` | `lib.rs::run_preflight_probes` |
| Broadcast/Dante/DCA in mock | Local state mutation (X32 dispatch only when live) | `lib.rs`, `bridge.ts` |
| Stage timer | `useState` + `setInterval` in React | `src/components/ShowModeView.tsx` (~L84–123) |

### 3.3 What is codec-only

| Codec | Contents | Not yet used by |
|---|---|---|
| `src-tauri/src/protocols/ndi.rs` | mDNS constant, source/receiver models, `<add_source>`, `<add_receiver>`, `<control_receiver>`, `<ndi_routing>`, `<ndi_tally>`, `<ndi_enabled_streams>`, parser | No NDI runtime adapter, no socket, no discovery loop |
| `src-tauri/src/protocols/propresenter.rs` | Multiplexed `POST /v1/status/updates` decoder, 5-topic church preset, WS path constant | Only the 5 topics are consumed; control calls are hand-built |
| `protocols/obs.rs`, `streamlabs.rs`, `x32.rs` | Adapter codecs | Used by live adapters |

### 3.4 Data-model ceiling

`AppStateSnapshot.slides` is a single `SlideState` with scalar fields:

```
app, playlist_name, presentation_name, current_slide, total_slides,
current_text, next_text, cleared, stage_message, transport_layer
```

There is **no** `Vec<Slide>`, no notes, no timer objects, no media/audio playlists, no stage layout, no messages/props/looks/macros/clear groups, no screen/output graph, and no NDI receiver telemetry beyond `status` + tally. `timers` and `transportTime` arrive as raw `state://slides` patches but are **not stored** in the snapshot. The stage timer in Show Mode is therefore necessarily local.

This is the single most important backend constraint for Alpha 2: the UI cannot render what the snapshot does not hold.

---

## 4. ProPresenter 22 Gap Analysis

ProPresenter's public `/v1` surface is a 205-route catalog. One Ring currently uses **5 streaming topics** and **3 commands**. The sections below prioritize what a church operator actually needs.

### 4.1 Essential settings

| Capability | ProPresenter evidence | One Ring state | Alpha 2 recommendation |
|---|---|---|---|
| API enablement, port, auto-reselect port | `ProApiNetworkConfiguration` fields in re-findings; mDNS `_proapiv1._tcp` | Connection is env-driven (`RING_PP_HOST/PORT`); no settings UI field beyond endpoint | Add `host`, `port`, `autoReselect`, `pollInterval`, `streamReconnect` to a new `PresentationSettings`; show discovered instances |
| Remote WebSocket enable + password | `_pro7proremote._tcp`; `/remote` auth (`password`, `protocol`, `controller`) | ❌ | Model remote auth separately from stage auth; never store plaintext in logs |
| Stage display enable + password | `_pro7stagedsply._tcp`; `/stagedisplay` auth (`stageDisplay`) | ❌ | Required for the stage window (see 4.4) |
| ProLink group / secret / heartbeat | `224.0.0.90:18514`; `GroupDefinition` + `MemberStatus`; `/group`, `/heartbeat`, `/preroll` | ❌ | Defer to Alpha 3 unless multi-room sync is in scope; model fields now |
| AirPlay receiver enable | `_airplay._tcp` / `_raop._tcp`; `AirTunes/220.68` | ❌ | Out of Alpha 2 scope; record as non-goal |
| NDI/Syphon output configuration | `TYPE_NDI`, `TYPE_SYPHON`; alpha type straight/premultiplied; audio buses | ❌ | Read-only detection in Alpha 2; output creation in Alpha 3 |
| Capture / stream settings | `/v1/capture/status`, `/v1/capture/settings`, `/v1/capture/encodings/{type}` | ❌ | Surface status only; do not duplicate One Ring broadcast settings |
| SongSelect credentials | Existing settings model | 🟡 Fields exist, no live flow | Keep, but mark as "not wired" in UI |
| Theme / mask / chord chart | `/v1/themes`, `/v1/masks`, `/v1/presentation/chord_chart` | ❌ | Alpha 3 |

**Design rule:** settings should be **capability-detected**, not a wall of toggles. If ProPresenter advertises a stage WebSocket, show stage settings; if not, explain why the stage window will be read-only.

### 4.2 Display outputs and screen configuration

ProPresenter exposes `GET /v1/status/screens`, `GET/PUT /v1/status/audience_screens`, `GET/PUT /v1/status/stage_screens`, and a rich local Screen Configuration surface. The localization table confirms:

- **Screen types:** Audience and Stage screens, each addable/removable.
- **Arrangements:** `Single`, `Mirror` (with `Outputs`), `Grouped` (with `Rows`/`Columns`), `Edge Blend`.
- **Hardware:** output count, display device, `Identify`, `Test Patterns…`, HDR format (`SDR`, `HDR - Rec. 2100 PQ`, `HDR - Rec. 2100 HLG`).
- **Color:** Red/Green/Blue, `Gamma`, `Black`, `HDR Max Brightness`.
- **Geometry:** rotation, aspect-ratio lock, corner pinning (`ΔX`/`ΔY` per corner, `Reset All`).
- **Compositing:** `Alpha Key` tab with `None` / `Premultiplied` / `Straight`, separate `Fill:`/`Key:` outputs, Blackmagic `External`/`Internal` key type and `Blend:` level.
- **Edge blend:** `Width`, `Gamma`, `Mode`, `Radius`, `Intensity`, `Black Level Compensation`, left/right screen pairs.
- **Timing:** per-output `Video Delay`.
- **Screen color** and test patterns for alignment.

Current One Ring state: `DisplayAssignments` is three hardcoded strings (`foh_window`, `stage_display_window`, `ndi_alpha_output`). There is no screen graph, no resolution, no enable/disable, no alpha semantics, and no stage/audience distinction in the runtime.

**Alpha 2 scope (minimum):**

1. Ingest `status/screens` and store a `ScreenOutput` list: `id`, `name`, `screenType` (`audience`/`stage`), `width`, `height`, `enabled`, `arrangement`, `alphaType`, `ndiName`.
2. Replace hardcoded `DisplayAssignments` with references to detected screens + user-assigned roles (`audience`, `stage`, `confidence`, `lobby`, `livestreamKey`).
3. Add a read-only **Video Outputs** table in Engineer Mode with Identify and enable/disable toggles.
4. Add a **display preflight** check: expected audience/stage screen present, resolution matches, alpha output present when the livestream path needs key/fill.

**Alpha 3 scope (defer):** editing edge blend, corner pinning, HDR, color calibration, video delay. These are install-time tasks, not Sunday-morning tasks, and writing them through a controller is high-risk.

### 4.3 Media and audio playlists

ProPresenter exposes complete playlist surfaces:

- Media: `/v1/media/playlists`, `/v1/media/playlist/{playlist_id}`, `/updates`, `/thumbnail`, focus/trigger/next/previous, `/v1/media/playlist/{scope}` for `focused`/`active`.
- Audio: `/v1/audio/playlists`, `/v1/audio/playlist/{playlist_id}`, `/updates`, focus/trigger/next/previous.
- Global triggers: `/v1/trigger/media/next|previous`, `/v1/trigger/audio/next|previous`.
- Cue-level transport: `/v1/transport/audio/play|pause|skip_forward|skip_backward|go_to_end|time|current`.
- Localization confirms playback behaviors: `Loop For Play Count…`, `Loop For Time…`, plus stop/loop semantics, `Shuffle`, transition duration, audio track vs. sound-effect type, and `Set Native Rotation` / `Set Source Rotation` for media.

Current One Ring state: ❌ no playlist model, no media/audio UI, no thumbnails, no audio transport.

**Alpha 2 recommendation — "Walk-in / Playback" panel:**

| UI element | Behavior |
|---|---|
| Media playlist selector | `focused` vs `active`; show item count and thumbnail grid |
| Audio playlist selector | Separate tab; show track name, artist, duration, type (track/sound effect) |
| Now playing card | `is_playing`, name, artist, `audio_only`, duration; progress + seek |
| Transport row | Play/Pause, ±10 s, Go to End, Next/Previous |
| Trigger grid | Tap thumbnail to trigger; long-press for "trigger + loop" |
| Health | If `/v1/audio/playlist/active` is unavailable, show "ProPresenter audio not configured" instead of an empty grid |

**Backend model:**

```rust
struct MediaPlaylist { id, name, kind: Media|Audio, active: bool, items: Vec<MediaItem> }
struct MediaItem { id, name, kind: Video|Image|Audio|SoundEffect, duration_ms, thumbnail_url, loop_mode }
struct PlaybackState { layer, is_playing, item_id, name, artist, audio_only, duration_ms, position_ms }
```

Subscribe to the active playlist `/updates` endpoints and the audio transport `time` stream. Do **not** poll thumbnails per item on every render; cache by media UUID and invalidate on playlist update.

### 4.4 Stage confidence

This is the highest-impact ProPresenter gap and the most visible Alpha 2 deliverable.

Evidence of the real feature set:

- Multiple stage screens; `/v1/stage/screens`; per-screen `/v1/stage/screen/{id}/layout`; `/v1/stage/layout_map` (GET/PUT); `/v1/stage/layouts`; layout thumbnails.
- Stage message: `/v1/stage/message` (GET/PUT/DELETE), with `Flash When Message Shown` and `Flash Color`; `STAGE_WINDOW_STAGE_MESSAGE_label`, Show/Hide controls.
- Stage-only presentation: `Show Slide on Stage Screens Only` (`/v1/presentation/{scope}/...` plus stage destination).
- Layout elements/tokens include current/next slide text, notes, stage message, system clock, video countdown, audio countdown, and timer values (confirmed by text-link and undo strings: `Set System Clock Text/Date Format/Time Format`, `Set Video Countdown Format/Source/Color Triggers`, `Set Audio Countdown Format/Color Triggers`, `STAGE_MESSAGE_*`).
- Stage WebSocket `/stagedisplay`, authenticated with a stage-display password, advertised as `_pro7stagedsply._tcp`.

Current One Ring state: `SlideState` has `current_text`/`next_text`/`stage_message`, but there is **no notes**, **no stage layout**, **no real timer**, and **no second window**. Show Mode renders a local `stageSeconds` interval that is unrelated to ProPresenter. `tauri.conf.json` defines one window. `DisplayAssignments.stage_display_window` is a string label, not a window.

**Alpha 2 scope:**

1. **Data:** subscribe to `status/slide` (already), `timers/current`, `transport/presentation/time`, and stage message; store `StageState { layoutId, current, next, notes, message, messageFlash, timers[], clock }`.
2. **Window:** add a second Tauri window `stage` (borderless, remembered display, fullscreen on the assigned stage display). Use a dedicated route (`?window=stage`) or a second React entry; do **not** reuse Show Mode chrome.
3. **Layouts:** start with one configurable "One Ring Stage" layout rather than a full editor. Elements: current slide, next slide, notes, stage message, service timer, wall clock, connection/health badge.
4. **Message control:** Engineer/Show action to set, show/hide, and flash a stage message; clear on cue if configured.
5. **Timers:** render ProPresenter timers when available; fall back to One Ring's service timer only when explicitly in simulator mode and label it as such.
6. **Safety:** if the stage stream drops, the stage window must show a clear "STAGE DISPLAY DISCONNECTED — last update HH:MM:SS" banner, not stale content pretending to be live.
7. **Privacy:** never show operator-only notes or credentials on the stage window; notes are opt-in per layout.

**Do not** build a full drag-and-drop stage layout editor in Alpha 2. The valuable part is trustworthy current/next/notes/timer/message output, not pixel-perfect layout parity.

### 4.5 Adjacent surfaces worth including or explicitly deferring

| Surface | ProPresenter routes | Alpha 2 decision |
|---|---|---|
| Timers | `/v1/timers`, `/v1/timers/current`, start/stop/reset, `/timer/{id}/increment`, `/timer/system_time`, `/timer/video_countdown` | **Include read + start/stop/reset**; needed for stage confidence |
| Messages | `/v1/messages`, `/v1/message/{id}`, `/trigger` with token values, `/clear` | **Include**; high value for "service starts in 5 minutes" |
| Clear groups | `/v1/clear/groups`, `/v1/clear/group/{id}`, `/trigger`, icon/tint/layers/stop-timeline flags | **Include**; maps directly to One Ring cue actions |
| Looks | `/v1/looks`, `/v1/look/current`, `/look/{id}/trigger` | **Read + trigger**; useful for lighting/IMAG presets |
| Props | `/v1/props`, `/v1/prop/{id}`, trigger/clear/auto-clear, collections | **Defer to Alpha 3** unless lower-thirds are in the Sunday script |
| Macros | `/v1/macros`, `/macro/{id}/trigger`, collections | **Defer**; becomes the escape hatch for arbitrary automation |
| Announcements | `/v1/announcement/active/*` | **Read-only status**; full control in Alpha 3 |
| Video inputs | `/v1/video_inputs`, `/trigger` | **Include trigger + clear**; useful for camera/aux inputs |
| Capture | `/v1/capture/*` | **Status only**; do not duplicate encoding settings |
| Themes/masks | `/v1/themes`, `/v1/masks` | **Defer** |
| Chord charts | `/v1/presentation/chord_chart` | **Defer** |

### 4.6 ProPresenter cue-action taxonomy to model

Localization confirms a broad action palette. One Ring's `ServiceCue.actions: Vec<String>` is currently untyped strings. For Alpha 2, introduce a typed enum covering at least:

`AudienceLook`, `Audio`, `AudioStream`, `BackgroundMedia`, `Capture`, `Clear`, `ClearAll`, `ClearAnnouncement`, `ClearAudio`, `ClearMedia`, `ClearMessages`, `ClearProps`, `ClearSlide`, `ClearToLogo`, `ClearVideoInput`, `ClearGroup`, `Communication`, `Document`, `ForegroundMedia`, `GoToNextTimer`, `VideoStream`, `Image`, `LibraryPlaylist`, `VideoInput`, `Macro`, `Media`, `Message`, `Presentation`, `Prop`, `PropSlide`, `Screen`, `SlideDestination`, `Stage`, `Timer`, `Web`.

This is also the right foundation for a future cue-authoring UI: actions become validated, previewable, and reversible instead of opaque strings.

---

## 5. NDI 6 Tools Gap Analysis

### 5.1 Remote receiver routing

The NDI Discovery Service (`TCP 5959`) is the correct control plane for "switch what this display is showing":

- Receiver advertisers register `<receiver>` with `receiver_id`, `name`, `input_id`, `input_name`, `address`, capabilities, and `control_capabilities`.
- Receiver listeners query with `<query_receivers/>` / `<query_inputs/>` and command with `<control_receiver><receiver_id>…<command>connect</command><arg>/<source>…`.
- Telemetry via `<monitor_request>` / `<monitor_events>` carries `connected-receivers`, `video/audio/metadata` counters, tally, codec/resolution/frame rate/alpha/color, and receive mode.
- DiscoveryService.UI confirms the model fields: `ReceiverViewModel` (`ReceiverId`, `ReceiverAddress`, `InputName`, `InputId`, `AvailableCommands`, `ReceiverEventsSubscribed`, `IsLocked`, `IsPinned`), `SourceViewModel` (`MachineName`, `Groups`, `Metadata`, `FullIpAddress`, `Port`), and `SourceInformation` (video/audio codec, resolution, frame rate, alpha, color primaries, transfer function, matrix, counters).

Current One Ring state: 🔵 codec-only (`protocols/ndi.rs` can build `<control_receiver>`), 🟡 simulator-only behavior (`switch_ndi_receiver` logs but sends nothing), no TCP client, no receiver registry, no telemetry subscription.

**Alpha 2 scope:**

1. **Discovery client** (`runtime/ndi_discovery.rs`):
   - Connect to one or more Discovery Service endpoints (default `5959`), with reconnect/backoff.
   - Advertise as a receiver listener (optionally also a sender listener).
   - Maintain a `ReceiverRegistry` keyed by `receiver_id`, with source binding, capabilities, and last-seen.
   - Consume `<monitor_events>` into typed telemetry and a per-receiver health state.
2. **Routing command**:
   - Resolve a UI display role (e.g. `stage-left`) to a receiver ID.
   - Validate the requested source exists in the current source list.
   - Send `<control_receiver>` and wait for telemetry confirmation (`input_name` change or reconnect event) with a timeout.
   - Surface `pending → confirmed → failed` in the UI; never optimistically claim success.
3. **Fallback order:** Discovery Service → Studio Monitor REST → manual instruction. If both control paths fail, show the exact NDI source name the operator must select.
4. **Safety:** "Switch all displays" requires confirmation; a per-receiver lock (`IsLocked`-style) prevents accidental changes during service.

**Acceptance criteria:**

- A real Studio Monitor on the LAN changes source after a One Ring action, confirmed by its own `/v1/configuration` or discovery telemetry.
- Pulling the network cable produces `OFFLINE` within a bounded timeout, with the last-known source and timestamp.
- No fabricated success log entries remain in the code path.

### 5.2 Studio Monitor controls

Studio Monitor exposes an embedded HTTP server when "Allow Web Control" is enabled. Confirmed endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/sources` | GET | `{ "ndi_sources": [...] }` |
| `/v1/configuration` | GET | Current config + `audio_devices`, `display_devices`, `controllers` |
| `/v1/configuration` | POST | Update source, overlay, scaling, audio output, PTZ, decorations |
| `/v1/recording` | GET/POST | Status/duration; start/stop local recording |
| `/v1/authorize` | POST | Set/verify web-control credentials |

The full configuration/decorations vocabulary (from executable strings) includes:

- **Source/video:** `NDI_source`, `NDI_overlay`, `low_bandwidth`, `lowest_latency`, `hw_accel`, `enable_deinterlacing`, `connection_quality`, `enable_ndi_output`.
- **Display/window:** `window.display_device`, `always_on_top`, `hide_border`, `run_on_startup`, `menu_posn_x`, `menu_posn_y`, `show_web_address`, `web_server`.
- **Overlays/guides:** `checkerboard`, `picture_in_picture`, `tally`, `center_cross`, `safe_areas`, `show_4_3`, `best_fit`, `square_aspect`, `show_alpha`, `flip_horizontal`, `flip_vertical`.
- **Audio:** `mute_audio`, `audio_gain`, `vu_meter`, `vu_meter_scale`.
- **PTZ/UI:** `PTZ_controller`, `hide_ptz_controls`, `do_not_hide_controls`.
- **Recording:** `record_path`.

The bundled web UI only toggles `picture_in_picture`, `vu_meter`, and `mute_audio`, but the executable accepts the wider key set. Treat unknown keys as read-only/unsupported until verified against a live instance.

Current One Ring state: ❌ absent. No HTTP client, no device discovery, no config model.

**Alpha 2 scope:**

1. **Device model:** `StudioMonitorDevice { id, name, baseUrl, version, authorized, displays[], audioDevices[], controllers[], lastSeen }`.
2. **Onboarding:** "Scan for Studio Monitors" using the Discovery Service receiver list (`web_control` capability) and/or a manual URL. Never scan arbitrary subnets by default.
3. **Control panel per device:**
   - Source selector (from `/v1/sources`).
   - Overlay selector.
   - Display device assignment.
   - Audio output + mute/gain.
   - Toggles: tally, safe areas, center cross, checkerboard, PiP, VU meter, low bandwidth, alpha.
   - Recording start/stop with elapsed time.
4. **Credential handling:** store in OS keychain or an encrypted local store; never in `settings.json` plaintext. Support "authorize once" and surface 401 distinctly.
5. **Reconciliation:** after POST, re-GET `/v1/configuration` and show the actual state; do not assume the write succeeded.

**Acceptance criteria:**

- Changing a source in One Ring changes the Studio Monitor's displayed source, and the UI reflects the post-write GET.
- Toggling `mute_audio` and `tally` persists across a Studio Monitor restart (if the device does).
- A wrong password yields an actionable "Authorization required" state, not a generic failure.

### 5.3 PTZ camera control

NDI PTZ metadata (`ntk_ptz_*`) is the cleanest cross-vendor path when the camera advertises `ntk_ptz="true"`. Confirmed operations from re-findings and Studio Monitor strings:

- Absolute zoom, zoom speed (`ntk_ptz_zoom_speed`).
- Absolute pan/tilt and pan/tilt speed (`ntk_ptz_pan_tilt_speed`).
- Focus mode/distance and focus speed (`ntk_ptz_focus`).
- White balance (auto/indoor/outdoor/one-shot/manual red-blue).
- Exposure (auto/manual iris/gain/shutter).
- Store/recall preset (`ntk_ptz_store_preset`, `ntk_ptz_recall_preset` with speed).
- Vendor families present in Studio Monitor: PTZOptics, Panasonic, Lumens, Sony, Marshall, Minrray, plus `NDI-HX-*-PTZ-V1` capability strings.
- Joystick support is a first-class Studio Monitor feature ("No Joystick Attached").

Current One Ring state: 🟡 `recall_camera_preset` only sets `active_camera_preset_id`; `NdiPtzSettings` has a discovery range and `visca_port: 52381`, but no socket, no driver selection, no preset mapping, and no capability detection.

**Alpha 2 scope:**

1. **Camera registry:** merge NDI source metadata + discovery telemetry + manual configuration into `CameraDevice { id, ndiName, vendor, model, controlProtocol: NdiPtz|ViscaUdp|ViscaSerial|Vendor, presets[] }`.
2. **Capability detection:** only show PTZ controls when the source advertises `ntk_ptz` or the operator explicitly selects a vendor driver. Do not send `ntk_ptz_*` to arbitrary sources.
3. **Preset recall:** map One Ring cue preset IDs to camera-native preset indices. Recall must send the command and verify via telemetry (or a bounded "assumed applied" state if the camera provides no feedback).
4. **Preset store:** explicit, confirmed, and role-gated; storing over a live preset is destructive.
5. **Manual control:** pan/tilt/zoom speed pad, focus +/-, zoom rocker, speed slider. Default to **speed** commands for continuous input and **absolute** commands for presets.
6. **Tally/exposure safety:** lock exposure/WB during service unless Engineer Mode; show a "camera is live on program" warning before storing presets.
7. **VISCA:** implement as a separate transport (UDP 52381) for cameras that do not expose NDI PTZ. Keep it behind a driver interface so vendor quirks do not leak into the UI.
8. **Joystick:** defer; keyboard/gamepad support is a later enhancement.

**Acceptance criteria:**

- A preset recall physically moves the camera (verified visually or via telemetry position).
- The UI never reports "recalled" when the command failed to send.
- A camera without PTZ capability shows a clear "No PTZ control exposed by this source" message.

### 5.4 NDI Router virtual matrix

NDI Router creates virtual NDI outputs that redirect receivers to an upstream source without decode/re-encode. The managed model confirms:

- `RouterInputModel`: source item, mixed state, destination labels.
- `RouterOutputModel`: `RoutingName`, `SelectedSource`, routing instance, input model, output instances, `CreateRouting`/`UpdateRouting`/`ClearRouting`/`DestroyRouting`.
- `RouterPresetModel`: named presets.
- `SerializationModel`: `RouterInputModels`, `RouterOutputModels`, `RouterPresetModels`.
- Persistence: `Application.NDI.Router.json`, `Router_Preset_{0}.json`.
- UI model: inputs/outputs/presets, edit mode, preview, labels with font/color/background styling, NDI channel name.

Current One Ring state: 🔵 `ndi_routing()` / `ndi_routing_clear()` exist; no Router client, no preset model, no crosspoint UI.

**Alpha 2 recommendation:** do **not** implement the Router data plane. Instead:

1. **Discover** Router outputs as normal NDI sources (they appear as `MACHINE (Output Name)`).
2. **Control** Router presets only if a stable control surface is verified; otherwise treat Router as an external tool.
3. **Model** One Ring's own logical outputs (`Stage Confidence`, `Lobby`, `Livestream Key`) as display roles that can point at either a Router output or a direct source. This preserves the zero-cost switching benefit without reimplementing Router.
4. **Alpha 3:** add a crosspoint grid if Router exposes a usable API or if One Ring hosts its own routing instance via `NDIlib_routing_*`.

**Acceptance criteria:** One Ring can list Router outputs, assign them to display roles, and warn if a selected route's upstream source is offline.

### 5.5 NDI Bridge and HX

Bridge is not a Sunday-morning control surface, but the model matters for multi-site churches.

Confirmed model:

- `RuntimeMode`: `None`, `Host`, `Join`, `Local`.
- `EncoderType`: `H264`, `HEVC`, `HEVC10`.
- `HXEncoderSettingsModel`: `Quality`, `SelectedGPU`, `Output`, `Encoder`, `NDI4CompatibilityMode`.
- `ProxyHXRoot`: `SelectedGPU`, `Codec`, `Bitrate`, `Parallel`, `MaxMachineCount`, `MachineFilter`, `Quality`, `Output`, `Encoder`, `NDI4CompatibilityMode`.
- `ProxyHXError`: `WINDOWS_10_REQUIRED`, `NO_GPU`, `NO_HEVC_ENC`, `NO_H264_ENC`, `NO_HEVC_DEC`, `NO_H264_DEC`, `INVALID_PARAM`, `NO_HEVC10_ENC`, `NO_HEVC10_DEC`.
- `DiscoveryServiceSettings`: `IPAddressString`, `UseAccessManagerSettings`, `UseLocalHost`, `ShowSenderAdvertiserOnly`.
- Bridge host uses STUN/signal services and an encryption key; Join uses IP/port/key.

Current One Ring state: ❌ absent.

**Alpha 2 decision:** **out of scope**, but add a **read-only "WAN link" health tile** if Bridge is discoverable. Do not build Host/Join configuration until multi-site is an explicit milestone. If included later, treat the encryption key as a secret and never expose it in logs or screenshots.

### 5.6 Discovery telemetry and Access Manager

DiscoveryService.UI exposes richer telemetry than One Ring's current `NdiReceiver` model:

- `SourceInformation`: `ConnectedReceivers`, `Version`, `MetadataFramesSent/BytesSent`, `AudioReceiveMode/Present/Codec/Channels/SampleRate/FramesSent/BytesSent`, `VideoPresent/Codec/Resolution/FrameRate/FrameType/HasAlpha/ColorPrimaries/TransferFunction/MatrixCoefficients/FramesSent/BytesSent`, `VideoReceiveMode`.
- `ReceiverViewModel`: `IsAvailable`, `IsAbleToConnect`, `IsLocked`, `IsPinned`, `ReceiverEventsSubscribed`, `AvailableCommands`, `SourceInformation`.
- `DiscoverySettingsModel`: `IPAddressString`, `UseAccessManagerSettings`, `UseLocalHost`, `ShowSenderAdvertiserOnly`.
- Access Manager groups (`AccessManager.NdiGroupEditor`) gate which senders/receivers are visible.

Current One Ring state: `NdiReceiver { id, receiver_name, ip, subscribed_source, expected_source, status, tally_program }`. No codec/resolution/frame rate/alpha, no audio telemetry, no counters, no groups, no lock/pin.

**Alpha 2 scope:**

1. Expand the receiver/source model with the telemetry fields above.
2. Add a **Topology** view: sources → receivers, color-coded by state, with codec/resolution/alpha badges.
3. Add **drift detection**: expected vs. subscribed source, plus stale telemetry age.
4. Support **groups** as a filter: only show/allow sources in the configured receive group.
5. Add **pin/lock** semantics for critical displays.
6. Do not implement Access Manager administration; consume its group filtering only.

---

## 6. Prioritized Capability-Gap Matrix

Priority meanings: **P0** = required for a trustworthy Alpha 2 service day; **P1** = high-value follow-on within Alpha 2; **P2** = model now, implement later.

| # | Capability | Domain | Current | Target Alpha 2 | Priority | Effort | Risk |
|---|---|---|---|---|---|---|---|
| 1 | Real slide list + notes + layers + timers in snapshot | PP | 🟡 scalar | Typed `PresentationState` | P0 | M | Low |
| 2 | Stage-confidence window | PP | ❌ | Second Tauri window, live state | P0 | M | Medium |
| 3 | Stage message set/show/hide/flash | PP | ❌ | Command + UI + stage render | P0 | S | Low |
| 4 | Discovery Service client + receiver routing | NDI | 🟡 fake | TCP client + confirmation | P0 | L | Medium |
| 5 | Studio Monitor `/v1/configuration` control | NDI | ❌ | Device panel + reconcile | P0 | M | Medium |
| 6 | PTZ preset recall dispatch | NDI | 🟡 fake | NDI PTZ + VISCA driver | P0 | M | Medium |
| 7 | Preflight real probes | Ops | 🟡 always pass | Per-domain live checks | P0 | M | Low |
| 8 | Media/audio playlist + transport | PP | ❌ | Walk-in panel | P1 | L | Medium |
| 9 | Screen/output graph | PP | ❌ hardcoded | Detected screens + roles | P1 | M | Low |
| 10 | Clear groups | PP | ❌ | Typed actions + trigger | P1 | S | Low |
| 11 | Messages (audience) | PP | ❌ | List + trigger + clear | P1 | S | Low |
| 12 | Looks read/trigger | PP | ❌ | Preset row | P1 | S | Low |
| 13 | Video input trigger/clear | PP | ❌ | Source row | P1 | S | Low |
| 14 | NDI topology/telemetry | NDI | 🔵 codec | Source/receiver graph | P1 | M | Low |
| 15 | Router output awareness | NDI | 🔵 codec | List + assign roles | P2 | S | Low |
| 16 | Bridge/HX | NDI | ❌ | Read-only health (optional) | P2 | L | High |
| 17 | Props/macros/announcements | PP | ❌ | Defer | P2 | L | Medium |
| 18 | Edge blend/HDR/corner pin | PP | ❌ | Defer | P2 | XL | High |

---

## 7. Alpha 2 UI/UX Recommendations

> **Naming rule:** Every user-facing surface uses functional domain language — **Slides**, **Audio Mixing**, **Broadcasting**, **Cameras**, **Video Routing**, **Settings** — never vendor names. Vendor/product names may appear only in integration detail, diagnostics, or "Connected via" metadata, and never as a navigation label, page title, button, or empty-state headline. This keeps the interface stable if the church changes presentation software or video hardware.

### 7.1 Information architecture

Keep the four existing modes, but make the content match the operator's job:

```
Preflight   → "Is everything ready?" (real checks, blockers first)
Show        → "Run the service" (cues, current/next, messages, playback, stage)
Engineer    → "Fix and configure" (outputs, video routing, cameras, media & audio, diagnostics)
Settings    → "Set up once" (integrations, credentials, roles, safety)
```

Add **one new top-level surface**: a detachable **Stage** window. Do not add a fifth nav tab for it; it is a window, not a mode.

### 7.2 Show Mode changes

| Area | Recommendation |
|---|---|
| Current/next | Replace scalar text with a two-panel slide view; show notes only in Engineer/Preview, never on the confidence output unless configured |
| Timers | Show the real service timer + wall clock from the presentation integration; remove the local interval from `ShowModeView` or gate it behind `mockMode` and label it "LOCAL" |
| Messages | A "Message" action opens a compact composer with saved messages + token values; Show/Hide/Flash controls |
| Playback | A dockable "Walk-in / Playback" card with now-playing, transport, and next audio item |
| Displays | A compact "Displays" strip: each role (Stage L/R, Lobby, Confidence) with source + state; tap opens a switch sheet |
| Cameras | Preset buttons show the camera label and a live/armed indicator; long-press shows store/recall |
| Safety | Any action affecting live program (clear all, switch all displays, store preset) gets a hold-to-confirm or two-step confirmation |

### 7.3 Engineer Mode changes

Proposed sections, in order:

1. **Video Outputs** — audience/stage screens, resolution, alpha, output name, Identify, enable/disable.
2. **Video Routing** — sources → displays, telemetry badges, drift, lock/pin, "Switch source" per display.
3. **Cameras** — device list, control capability, preset map, manual pan/tilt/zoom pad, exposure/white-balance lock.
4. **Media & Audio** — media/audio bins, thumbnails, playback behavior, trigger/loop.
5. **Stage Screen** — choose layout, toggle notes/message/clock/timers, preview.
6. **Diagnostics** — raw discovery events, last commands, latency, reconnect counts, copyable support bundle.

Each section should answer three questions: **What is connected? What is doing what? What can I safely change?**

### 7.4 Settings changes

First, rename the existing tabs to functional labels: **X32 Mixer → Audio Mixing**, **Dante Audio → Audio Routing**, **Video & Broadcast → Broadcasting**, **Presentation / Slides → Slides**, **NDI & PTZ Cameras → Cameras**. Vendor names remain visible only as connection detail inside each tab.

Replace the current flat endpoint fields with capability-based groups:

- **Slides**: host/port, auto-detect, stream topics, stage/remote credentials, reconnect policy.
- **Video Outputs**: role assignment (audience/stage/confidence/lobby/key), resolution expectations, identify/test.
- **Video Routing**: discovery servers, groups, receive filters, default control path (discovery → direct device), timeouts.
- **Cameras**: driver per camera, control port, preset mapping, speed limits, exposure lock.
- **Media & Audio**: default playlist, loop defaults, crossfade/transition.
- **Broadcasting**: destinations, recording path/format, encoder choice, stream keys.
- **Safety**: destructive-action confirmations, live-program locks, engineer PIN.

Every field needs a **"Test"** affordance that performs a real round-trip and reports latency/result. A settings page that cannot verify itself is how false confidence accumulates.

### 7.5 Interaction rules

1. **No optimistic success.** Show `pending` until the device confirms; show `failed` with the exact reason.
2. **Progressive disclosure.** Default to role-based simple controls; reveal codec/alpha/telemetry under "Details".
3. **Stale-state honesty.** Any value older than its freshness budget gets a clock icon + age. Stage output gets a disconnected banner.
4. **Rehearsal parity.** Rehearsal mode must exercise the same code paths but suppress live output; never fork behavior into a "fake" branch that hides bugs.
5. **Keyboard-first.** Space = next, Backspace = previous, Esc = clear, `M` = message, `T` = timer. Show shortcuts in tooltips.
6. **Volunteer language.** Prefer "Stage screen", "Lyrics", "Walk-in music", "Camera 1" over device/protocol jargon, model numbers, and preset indices.

### 7.6 Empty/error states that matter

- Slides unreachable → "Presentation control offline. Last slide: … at 09:41:12. Start the presentation app or check its API port."
- No stage screen configured → "No stage screen detected. Assign one in Settings → Video Outputs."
- Video source missing → "Camera 2 is not on the network. Last seen 09:38. Expected `STAGE-PC (Camera 2)`."
- Camera control unsupported → "This camera does not expose remote control."
- Video discovery offline → "Video discovery service unreachable. Falling back to direct device control."

---

## 8. Alpha 2 Backend Recommendations

### 8.1 Module layout

```
src-tauri/src/
  runtime/
    ndi_discovery.rs     # TCP 5959 client, receiver/source registry, telemetry
    ndi_routing.rs       # <control_receiver> command + confirmation state machine
    studio_monitor.rs    # REST client for /v1/sources|configuration|recording|authorize
    ptz/
      mod.rs             # PtzDriver trait, preset mapping
      ndi_ptz.rs          # ntk_ptz_* metadata
      visca.rs            # UDP 52381 transport
    propresenter_adapter.rs  # expand topics/commands (existing)
  protocols/
    ndi.rs               # keep as pure codec; add missing message types
    propresenter.rs      # keep as pure codec; add typed models
  state/
    presentation.rs      # Slide, Timer, StageState, Playlist models
    displays.rs          # ScreenOutput, DisplayRole
    ndi.rs               # ReceiverTelemetry, SourceTelemetry
```

Keep protocol codecs pure and transport-free. Adapters own sockets, retries, and health.

### 8.2 Data model additions

Minimum Rust structs (mirrored in `src/types.ts`):

```rust
struct PresentationState {
    active_presentation: Option<PresentationRef>,
    current: Option<Slide>,
    next: Option<Slide>,
    slides: Vec<Slide>,          // bounded window, not necessarily all
    notes: Option<String>,
    layers: LayerState,          // video_input, media, slide, announcements, props, messages, audio
    timers: Vec<TimerState>,
    transport: TransportState,   // presentation + announcement + audio
    stage: StageState,
}

struct Slide { id, index, text, notes, thumbnail_url }

struct TimerState { id, name, kind, remaining_ms, elapsed_ms, running, format }

struct StageState {
    layout_id, screen_ids, message, message_visible, message_flash,
    clock, video_countdown, audio_countdown, updated_at,
}

struct ScreenOutput {
    id, name, screen_type, width, height, enabled,
    arrangement, alpha_type, ndi_name, role: Option<DisplayRole>,
}

struct MediaPlaylist { id, name, kind, active, items: Vec<MediaItem> }
struct PlaybackState { layer, is_playing, item_id, name, artist, audio_only, duration_ms, position_ms }
struct ReceiverTelemetry { receiver_id, source_name, codec, width, height, fps, has_alpha, connected, tally, updated_at }
```

**Important:** keep a `last_updated` on every live object. Freshness is part of the model, not a UI afterthought.

### 8.3 Event-channel taxonomy

Current channels are domain-level (`state://slides`, `meter://…`, `device://health`, `cue://progress`). Expand deliberately:

| Channel | Payload |
|---|---|
| `state://presentation` | current/next/notes/layers/slide list window |
| `state://stage` | stage message, layout, clock, countdowns |
| `state://timers` | timer deltas |
| `state://playback` | media/audio transport |
| `state://displays` | screen graph + roles |
| `state://ndi/topology` | source/receiver registry + telemetry deltas |
| `state://ndi/command` | pending/confirmed/failed routing commands |
| `state://ptz` | camera state, preset recall result |
| `state://preflight` | per-check live result |

Do not overload `state://slides` with unrelated payloads. The current `timers`/`transportTime` raw patches are a symptom of a missing channel.

### 8.4 Adapter protocol

Introduce a common adapter contract:

```rust
trait DomainAdapter {
    fn kind(&self) -> DeviceKind;
    fn health(&self) -> DeviceHealth;
    fn capabilities(&self) -> CapabilitySet;
    fn dispatch(&self, cmd: AdapterCommand) -> Result<CommandHandle, AdapterError>;
}
```

`CommandHandle` should carry a correlation ID so the UI can show `pending → confirmed/failed` and so tests can assert on outcomes. Extend `AdapterRegistry` with NDI, Studio Monitor, and PTZ registrations; keep `runtime: Mutex<Option<Arc<AdapterRegistry>>>` semantics.

### 8.5 ProPresenter adapter expansion

1. **Subscriptions:** add `status/screens`, `status/layers` (existing), `timers/current`, `transport/presentation/time`, `transport/audio/time`, `playlist/active`, `presentation/active`, `stage/message`, `look/current`, and the active media/audio playlist updates.
2. **Commands:** `Next`, `Previous`, `ClearLayer(layer)`, `TriggerCue(scope,index)`, `TriggerPlaylistItem`, `TransportPlay/Stop/Pause/Seek`, `StartTimer/StopTimer/ResetTimer`, `SetStageMessage/ClearStageMessage`, `TriggerLook`, `TriggerClearGroup`, `TriggerVideoInput`.
3. **Decoder:** type the `{url,data}` envelope into a `ProPresenterEvent` enum; reject unknown URLs explicitly rather than silently ignoring them.
4. **Reconnect:** exponential backoff with jitter; preserve last-known state and mark it stale rather than clearing the UI.
5. **Timeouts:** every command gets a deadline; a hung socket must not block the UI thread or the cue engine.

### 8.6 NDI backend details

- **Discovery client:** one task per configured server; XML framing over TCP; heartbeat/reconnect; backpressure-safe event queue.
- **Identity:** persist a stable controller UUID; advertise capabilities honestly (`metadata`, `video: false`, `audio: false`, `commands: connect`).
- **Command state machine:** `Queued → Sent → AwaitingTelemetry → Confirmed | TimedOut | Rejected`. UI reads this, not a boolean.
- **Source validation:** resolve names against the current source registry; send the canonical NDI name, not a display label.
- **Studio Monitor client:** `reqwest` with per-device timeouts, bearer/basic auth as observed, and a response-size cap. Never follow redirects to arbitrary hosts.
- **PTZ transport:** metadata-only NDI connection (`<ndi_enabled_streams video="false" audio="false" text="true"/>`) so camera control consumes no video bandwidth. Rate-limit continuous commands (e.g. 20 Hz) and send a stop on release/blur.
- **Secrets:** Studio Monitor passwords and Bridge keys go to the OS keychain; settings store only a reference.

### 8.7 Preflight must become real

Replace `run_preflight_probes` with per-domain checks that return `pass | warn | fail | unknown`:

| Domain | Live check |
|---|---|
| Slides | HTTP `/version` + stream connected + slide freshness |
| Stage | stage screen exists + stage stream fresh + layout assigned |
| Video Routing | discovery connected + every expected display present + no source drift |
| Displays | device configuration endpoint reachable + authorized |
| Cameras | camera reachable + control protocol detected |
| Audio Mixing | audio device reachable + expected channel state |
| Video | video app reachable + expected scene |
| Broadcasting | destinations configured + encoder available |

A check that cannot be performed must return `unknown`, never `pass`. This is the difference between a preflight and a placebo.

### 8.8 Cue model

Move from `actions: Vec<String>` to typed actions with targets:

```rust
enum CueAction {
    Presentation(PresentationAction),
    Playback(PlaybackAction),
    Clear(ClearGroupRef),
    Message(MessageAction),
    Stage(StageAction),
    Ndi(NdiAction),
    Ptz(PtzAction),
    Audio(X32Action),
    Video(ObsAction),
    Broadcast(BroadcastAction),
}
```

Each action gets `preview()`, `apply()`, `verify()`, and `undo()` semantics consistent with the existing undo stack. The verification report should include real observed values (e.g. "Display 3 → `STAGE-PC (Camera 2)` confirmed in 420 ms"), not canned `APPLIED`.

### 8.9 Settings schema and migration

- Add `schema_version` to `AppSettings`.
- Migrate existing `DisplayAssignments` strings into `DisplayRoleAssignments` with nullable screen IDs.
- Keep unknown existing fields (forward compatibility) rather than dropping them.
- Validate on load: invalid URLs/ports produce warnings, not crashes.
- Persist credentials separately; never serialize secrets into the main settings file.

### 8.10 Testing strategy

| Layer | Tests |
|---|---|
| Codecs | Golden XML/JSON fixtures for every NDI message and ProPresenter envelope; malformed-input fuzzing |
| Adapters | Mock TCP/HTTP servers; assert exact bytes for `<control_receiver>`, `/v1/configuration` POST bodies |
| State | Snapshot serialization round-trip; stale-marking; migration tests |
| Cue engine | One test per action type: preview → apply → verify → undo |
| UI | Playwright/Vitest for stage window, routing confirmation, empty/error states |
| Integration | Optional LAN test harness with a real Studio Monitor + PTZ camera, gated behind an env flag |

---

## 9. Implementation Order & Acceptance Criteria

### Phase A2.0 — State foundation (1 sprint)

- Add `PresentationState`, `StageState`, `ScreenOutput`, `TimerState` to Rust + TS.
- Expand ProPresenter subscriptions; store timers/transport/layers.
- Remove raw `timers`/`transportTime` patches; add `state://presentation` and `state://timers`.
- **Done when:** the snapshot round-trips, the UI shows real timers, and stale data is visibly marked.

### Phase A2.1 — Stage confidence (1–2 sprints)

- Second Tauri window with dedicated route; display role assignment.
- Stage layout with current/next/notes/message/timer/clock.
- Stage message commands + Show/Hide/Flash.
- Disconnection banner.
- **Done when:** a stage display on a second monitor shows live current/next/notes and a real timer; unplugging ProPresenter produces an honest disconnect state within 5 s.

### Phase A2.2 — NDI discovery + routing (2 sprints)

- Discovery client, receiver registry, telemetry.
- `switch_ndi_receiver` sends real `<control_receiver>` and waits for confirmation.
- Topology view with drift/lock/pin.
- **Done when:** changing a receiver in One Ring changes a real Studio Monitor's source and the UI shows `confirmed` with latency; no fabricated logs remain.

### Phase A2.3 — Studio Monitor + PTZ (2 sprints)

- Studio Monitor client + per-device panel + authorization.
- PTZ registry, NDI PTZ dispatch, VISCA transport, preset mapping.
- **Done when:** a real PTZ camera moves on preset recall; a Studio Monitor source/audio/tally change survives a page refresh and is reconciled from GET.

### Phase A2.4 — Playback + outputs + clear groups (2 sprints)

- Media/audio playlist models, walk-in panel, transport.
- Screen/output graph and role assignment.
- Typed clear groups, messages, looks, video inputs.
- **Done when:** an operator can run walk-in music, trigger a media item, clear all layers via a clear group, and see audience/stage screen health without opening the presentation app.

### Phase A2.5 — Preflight + hardening (1 sprint)

- Real per-domain probes with `unknown` semantics.
- Command correlation IDs and failure surfaces.
- Reconnect/backoff, secret storage, migration.
- **Done when:** preflight fails when a device is unplugged, and recovers automatically when it returns.

### Explicit non-goals for Alpha 2

- Editing edge blend, corner pinning, HDR, or color calibration.
- Full stage layout editor.
- NDI Router data plane or Bridge Host/Join configuration.
- Access Manager administration.
- Props/macros/announcements/themes/masks/chord charts.
- ProLink multi-machine synchronization.
- AirPlay receiver control.

---

## 10. Risks & Re-Findings Spec Gaps

### 10.1 Product/engineering risks

| Risk | Impact | Mitigation |
|---|---|---|
| ProPresenter route semantics differ from OpenAPI descriptions | Commands may no-op or 400 | Verify against a live instance per command; keep a compatibility matrix |
| Studio Monitor decoration keys accepted but ignored | UI toggles appear to work but do nothing | Post-write GET reconciliation; mark unsupported keys |
| Discovery Service not deployed | Receiver routing unavailable | Studio Monitor REST fallback + clear topology messaging |
| PTZ vendor quirks | Wrong direction/speed, preset collisions | Driver abstraction, conservative speed limits, store confirmation |
| Stage window on the wrong display | Volunteer sees operator content | Display role assignment + Identify + per-window position persistence |
| Secrets in logs/screenshots | Credential leakage | Keychain storage, redaction, no secrets in event log |
| False preflight confidence | Service-day failure | `unknown` semantics, live probes, explicit blockers |
| Snapshot growth | UI jank / memory | Bounded slide window, delta events, thumbnail cache eviction |

### 10.2 Gaps in `docs/re-findings/ndi.md`

The current spec is strong on wire protocol but omits:

1. Full Studio Monitor configuration/decorations key set and semantics (only the four REST endpoints are listed).
2. `/v1/configuration` request/response schema details (`studio_monitors`, `audio_devices`, `display_devices`, `controllers` shapes).
3. Router preset model, output naming, style/label fields, and persistence behavior.
4. Bridge/HX `BridgeLaunchConfig` fields, host/join key handling, and HX quality/GPU semantics.
5. Access Manager group semantics and how they filter discovery.
6. Discovery Service UI telemetry field inventory (codec/resolution/alpha/color/counters).
7. Authentication behavior for `/v1/authorize` (header vs. body, session lifetime).
8. Error/timeout semantics for `<control_receiver>` (what does the server return on failure?).

**Action:** add a follow-up section to `ndi.md` with verified request/response examples and a compatibility table per Studio Monitor version.

### 10.3 Gaps in `docs/re-findings/propresenter.md`

The current spec covers routes well but omits:

1. Stage layout element/token catalog (current/next/notes/message/clock/countdown/timer; per-element styling/visibility).
2. Screen configuration data model (arrangement, alpha key, HDR, edge blend, corner pinning, color, video delay) and which fields are readable via `/v1/status/screens`.
3. Full cue action taxonomy and target semantics (the localization list is broader than the route table).
4. Playlist item playback behaviors (loop count/time, shuffle, transition duration, track vs. sound effect).
5. Stage message flash semantics (duration, color, trigger source) and stage-only slide destination behavior.
6. `/v1/status/updates` envelope edge cases (initial snapshot, error envelopes, reconnect behavior).
7. Authentication requirements for `/remote` vs. `/stagedisplay` vs. `/v1/*` (the spec says `/v1/*` is unauthenticated; verify per version).
8. Thumbnail formats/caching headers and whether thumbnails are stable across arrangement changes.

**Action:** add a "Stage & Screen Data Model" appendix and a "Cue Action Reference" table to `propresenter.md` before implementation starts.

### 10.4 Assumptions to validate before coding

- [ ] ProPresenter 22.0.1 on the target machine exposes the routes used here (some may be ProPresenter 21/22-version-specific).
- [ ] Studio Monitor web control is enabled and reachable on the production LAN.
- [ ] A Discovery Service is deployed, or Studio Monitor REST is an acceptable fallback.
- [ ] The PTZ cameras advertise `ntk_ptz` or support VISCA over UDP.
- [ ] The stage display machine can run a second One Ring window on a distinct display.
- [ ] The church's ProPresenter stage password policy permits a controller connection.

---

## Appendix A — Evidence Index

| Claim area | Artifact |
|---|---|
| 205 routes / 256 operations | `ProPresenter/decompiled/openapi_v1.json` |
| Screen arrangements, alpha key, HDR, edge blend, corner pin | `.../en.lproj/ProPresenter.strings` keys `SCREEN_CONFIGURATION_*`, `UNDO_SCREEN_CONFIGURATION_*` |
| Stage layouts/messages/countdowns | `.../en.lproj/ProPresenter.strings` keys `STAGE_WINDOW_*`, `TEXT_LINK_STAGE_MESSAGE*`, `UNDO_DOCUMENT_STAGE_*`, `UNDO_DATA_LINK_TEXT_*` |
| Playback behaviors | `.../en.lproj/ProPresenter.strings` keys `PLAYLIST_ITEM_GLOBAL_PLAYBACK_BEHAVIOR_*` |
| Cue action taxonomy | `.../en.lproj/ProPresenter.strings` keys `ACTION_TYPE_*` |
| ProPresenter transport/stream vocabulary | `ProPresenter/decompiled/ProPresenter_Helper_Network/control_tower_rodata.txt`, `proApi_proto_tokens.txt` |
| Studio Monitor REST endpoints | `NDI Tools/extracted/app/Studio Monitor/web/content/js/studio_monitor.js` |
| Studio Monitor config keys | `NDI Tools/decompiled/native/Application.Network.StudioMonitor.x64.exe/strings.txt` |
| PTZ vendors/commands | Same Studio Monitor strings; `docs/re-findings/ndi.md` §4.4 |
| Router models | `NDI Tools/decompiled/managed/Router/managed-members.json` |
| Bridge/HX models | `NDI Tools/decompiled/managed/Bridge.UI/managed-members.json` |
| Discovery telemetry | `NDI Tools/decompiled/managed/DiscoveryService.UI/managed-members.json` |
| Current One Ring behavior | `src-tauri/src/runtime/`, `src-tauri/src/protocols/`, `src-tauri/src/state.rs`, `src-tauri/src/lib.rs`, `src/components/` |

## Appendix B — Route Coverage Snapshot

| Domain | ProPresenter routes available | One Ring consumed today |
|---|---|---|
| Status/stream | `status/slide`, `status/layers`, `status/screens`, `status/updates` | `status/slide`, `status/layers` |
| Presentation | `presentation/active`, `slide_index`, `timeline`, trigger/next/previous | none |
| Playlist | `playlist/active`, playlist items, updates, trigger | `playlist/active` (read) |
| Media | `media/playlists`, playlist items, updates, thumbnails | none |
| Audio | `audio/playlists`, playlist items, updates, transport | none |
| Timers | `timers`, `timers/current`, timer operations | `timers/current` (unused in state) |
| Stage | `stage/message`, `stage/screens`, `stage/layouts`, `stage/layout_map` | none |
| Messages/props/looks/macros | full CRUD + trigger | none |
| Clear groups | list/create/update/trigger | none |
| Screens | `status/screens`, enable/disable | none |
| Video inputs | list/trigger | none |
| Capture | status/settings/encodings | none |

## Appendix C — Definitions

- **Confidence output / stage display:** a display visible to presenters showing current/next content, notes, timers, and messages, separate from the audience output.
- **Program/preview:** broadcast semantics; "program" is live-to-audience, "preview" is operator-only.
- **Receiver (NDI):** a device consuming an NDI source (Studio Monitor, hardware decoder, OBS).
- **Sender/source (NDI):** a device publishing an NDI stream.
- **Virtual routing:** an NDI router output that redirects receivers to an upstream source without transcoding.
- **Codec-only:** protocol encode/parse exists, but no transport or runtime adapter.
- **Simulator-only:** UI state changes with no external protocol traffic.

---

*End of report.*
