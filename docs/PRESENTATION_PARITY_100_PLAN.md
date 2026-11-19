# Presentation Parity 100% Plan — ProPresenter 22 & EasyWorship 7

**Baseline:** `v0.3.2-alpha` (`a2e56e5`)
**Goal:** Close the presentation gaps identified by REA and `docs/re-findings/` using one shared, typed presentation model.
**Policy:** Clean-room. Only documented wire protocols, routes, message schemas, and observed UI behavior are used.

---

## 0. What "100%" means here

A capability counts as complete only when all of the following are true:

1. The protocol path is implemented in Rust (not simulated in the frontend).
2. The result is stored in `AppStateSnapshot` with typed fields.
3. The UI renders the state and clearly distinguishes live, stale, and unavailable data.
4. A reconnect or failure path is defined and tested.
5. A preflight or health check can report the capability's real status.
6. Unit or integration coverage exists for the codec/state transition.

"100%" is measured against the documented route/action catalog in `docs/re-findings/propresenter.md` and `docs/re-findings/easyworship.md`, with deferred items listed explicitly. It is not measured by counting UI controls.

---

## 1. Current baseline

### ProPresenter

Implemented today:

- One multiplexed `POST /v1/status/updates` stream with 5 topics.
- Three commands: `Next`, `Previous`, `ClearLayer`.
- Scalar slide text, playlist name, clear flag, and untracked raw `timer`, `transportTime`, and `layers` patches.
- ProLink preroll codec and coordinator, not yet connected to a transport.
- `/v1/ws` envelope codec, not yet connected.

Missing:

- Notes, typed timers, stage message state, screen graph, playback/media state.
- Direct slide selection, stage message control, timer control, clear groups, looks, video inputs.
- mDNS discovery and capability-detected settings.
- Stage-confidence window driven by live state.

### EasyWorship

Implemented today:

- `.ewsx` schedule import via `parse_easyworship_ewsx` in `runtime/obs_daemon.rs`.
- TypeScript/SQLite library import helpers.
- UI copy referencing EasyWorship.

Missing:

- `_ezwremote._tcp` discovery.
- TCP JSON-line transport, handshake/pairing, heartbeat, reconnect.
- `status`, slide/schedule navigation, media transport.
- `ScheduleData` / `LiveData` binary index parsing and slide metadata/image retrieval.
- Runtime integration into `AppStateSnapshot`.

---

## 2. Phase 0 — Shared presentation model

**Why first:** Both adapters and every presentation UI depend on the same state. Building adapters first would force a second migration.

### Deliverables

1. Typed models in `src-tauri/src/state.rs` and `src/types.ts`:
   - `PresentationTimer`
   - `StageMessage`
   - `ScreenOutput`
   - `PlaybackState`
   - `MediaPlaylist` / `MediaItem`
2. Extend `SlideState`:
   - `currentNotes`, `nextNotes`
   - `timers`, `stageMessageVisible`, `stageMessageFlash`
   - `transportTime`, `activeLayers`
   - `screens`, `playback`
   - `connected`, `lastUpdateMs`, `adapter`
3. Extend `SlidesPatch` and `apply_slides` for every new field.
4. Add capability/health reporting so UI can say "Not configured", "Connecting", "Live", "Stale", or "Disconnected".
5. Replace Show Mode's synthesized placeholder slides with an explicit empty state.
6. Replace the local-only stage timer with live timer state when available.

### Acceptance

- `npm run build` passes.
- `cargo check` passes.
- Existing slide grid, song selection, and cue engine still work.
- A blank state renders an empty-state card, not fabricated slides.

---

## 3. ProPresenter phases

### Phase P0 — Trustworthy service-day state

| Capability | Route / mechanism | Target |
|---|---|---|
| Current/next slide + notes | `status/slide` | Typed text + notes + UUIDs |
| Slide index | `presentation/slide_index` | Current index and presentation ID |
| Timers | `timers/current` | Typed timer list, formatted values |
| Transport time | `transport/presentation/time` | Stored numeric time |
| Layers | `status/layers` | Active layer list |
| Screens | `status/screens` | Screen list with type/resolution |
| Connection state | stream lifecycle | `connected`, `lastUpdateMs` |
| Direct slide select | `presentation/active/{index}/trigger` | Command + UI |
| Stage message | `stage/message` | Set/show/hide/flash + stage render |
| Stage window | new Tauri window / route | Live current, next, notes, timer, message |

Existing 3 commands remain. New commands:

- `GoToSlide(index)`
- `SetStageMessage(Option<String>)`
- `SetStageMessageVisible(bool)`
- `TimerAction { id, operation }`
- `ClearGroup(id)`

### Phase P1 — Operator surfaces

- Media playlists and audio playlists with thumbnails.
- Playback state and transport (play/pause/seek/next/previous).
- Screen graph roles (`audience`, `stage`, `confidence`, `livestreamKey`).
- Clear groups, looks, video inputs.
- Typed `PresentationAction` enum replacing opaque cue strings.

### Phase P2 — Full catalog closure

- mDNS `_proapiv1._tcp` discovery and auto-port reselect.
- Capability-detected settings.
- ProLink group/heartbeat/preroll transport.
- Remote and stage-display authentication.
- Props, macros, announcements, themes, masks, chord charts, capture status.
- Explicit non-goals: AirPlay receiver, full edge-blend/corner-pin editing.

---

## 4. EasyWorship phases

### Phase E0 — Remote transport and navigation

| Capability | Mechanism | Target |
|---|---|---|
| Discovery | `_ezwremote._tcp` mDNS | Instance name + ephemeral port |
| Framing | newline JSON / `\r\n` responses | Codec + tests |
| Pairing | `connect` action | Paired / not paired states |
| Keepalive | `heartbeat` | 2 s send, 6 s timeout handling |
| Status | `status` | Live/black/clear/index state |
| Navigation | `prevSlide`, `nextSlide`, `gotoSlideN`, `gotoScheduleN` | Commands |
| Reconnect | TCP lifecycle | Backoff + stale state |

### Phase E1 — Schedule and slide metadata

- `ScheduleData` / `LiveData` binary index parsing.
- `getSlideInfo` for title, reference, content, notes.
- `getSlideImage` / `getCurrentImage` JPEG retrieval.
- `gotoStartSlide`, `gotoStartPresentation`.
- Media transport actions (`Toggle`, `Play`, `Pause`).

### Phase E2 — Full closure

- Black/clear/logo controls and permissions model.
- `.ewsx` library depth beyond schedule import.
- MIDI cue automation and MIDI sync.
- NDI output naming and receiver input.
- CCLI usage export compatibility.

---

## 5. Test gates

Every phase must pass:

```sh
npm run build
~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml
~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml
```

Additional gates:

- Protocol codec unit tests for each new frame/action.
- State patch tests for each new field.
- Reconnect test using a local fake server.
- UI test or deterministic state fixture for empty, live, stale, and error states.
- Preflight check that fails when the expected adapter is unavailable.

---

## 6. Tracking

| Phase | Scope | Status |
|---|---|---|
| 0 | Shared presentation model | Implemented; live verification pending |
| P0 | ProPresenter service-day state | Implementation complete; live verification pending |
| P1 | ProPresenter operator surfaces | Transport/playback/clear groups complete; playlist enumeration, thumbnails and `PresentationAction` deferred; live verification pending |
| P2 | ProPresenter full catalog | Looks/props/macros catalog routes, resource triggers, raw response logging, direct slide trigger and stage-message controls implemented; discovery/ProLink/auth and remaining catalog surfaces deferred; live verification pending |
| E0 | EasyWorship transport/navigation | Implementation complete; live verification pending |
| E1 | EasyWorship schedule/metadata | Index parser, metadata follow-ups and transport complete; JPEG retrieval delivered in E2; live verification pending |
| E2 | EasyWorship full closure | Status-derived screen flags, local-only black/clear/logo overrides, and bounded JPEG image cache/preview implemented; MIDI/NDI/CCLI/deeper `.ewsx` deferred; live verification pending |

"Implementation complete" means the build/test acceptance gates pass at the current commit; it does **not** claim on-site verification against ProPresenter 22 or EasyWorship 7 hardware. Update this table only when the acceptance gates for a phase pass.

### What landed in Phase 0 / P0 / E0 / P1 / E1

- **Shared model** (`state.rs`, `types.ts`): `PresentationTimer`, `ScreenOutput`, `PlaybackState`, expanded `SlideState`/`SlidesPatch` with notes, timers, layers, screens, stage message, transport time, playback, `connected`, `lastUpdateMs`, `adapter`.
- **ProPresenter**: 8-topic multiplexed subscription; typed parsing of slide/notes/timers/transport/layers/screens/stage message; `go_to_slide`, `control_presentation_timer`, `set_stage_message`, `set_stage_message_flag` Tauri commands and `bridge.ts` API; real `chk-presentation-link` preflight (pass/warn/stale); explicit empty deck card; live/stale/unavailable badges; stage-confidence output with notes, timers, message and flash.
- **EasyWorship**: DNS-SD/mDNS PTR/SRV/A codec (`easyworship_discovery.rs`) with compression-pointer support; JSON-lines codec (`easyworship.rs`) for connect/heartbeat/actions/status/pairing/binary headers; TCP adapter (`easyworship_adapter.rs`) with 2 s heartbeat, 6 s receive timeout, pairing state, binary-body consumption, typed `status`/`slideInfo` patches, navigation commands, and exponential-backoff reconnect; runtime registry, capability probe, and dual-adapter slide dispatch.
- **ProPresenter P1**: 9-topic subscription including `transport/presentation/current`; typed `PlaybackState` mapping; documented `trigger/{media,audio}/{next,previous}`, `transport/{layer}/{play,pause,go_to_end}`, `PUT transport/{layer}/time` and clear-group paths with validation helpers; `propresenter_playlist_control`, `propresenter_transport_control`, `propresenter_transport_seek`, `propresenter_clear_group` Tauri commands and `bridge.ts` methods; Show Mode media/audio/transport/clear-group strip.
- **EasyWorship E1**: typed `ScheduleData`/`LiveData` binary index parser (`IndexPayload`/`IndexItem`/`IndexSlide`) with 1-byte and 4-byte outer-flag interpretations; revision-driven `GetScheduleData`/`GetLiveData` and key-change-driven `getSlideInfo` follow-ups (including optional `requestrev`); `LiveData` slides applied to the shared typed deck via `SlidesPatch.slides`; `gotoStartSlide`, `gotoStartPresentation`, `Toggle`, `Play`, `Pause` exposed through `easyworship_control`, `bridge.ts`, and Show Mode.
- **ProPresenter P2**: Verified the already-implemented 0-based direct slide trigger (`/v1/presentation/active/{index}/trigger`) and stage-message PUT/DELETE controls; added documented catalog paths (`/v1/looks`, `/v1/look/current`, `/v1/props`, `/v1/macros`, `/v1/prop_collections`, `/v1/macro_collections`, `/v1/clear/groups`) and validated single-resource paths for look/prop/macro trigger, prop clear and prop auto-clear pause/resume. Catalog responses have no documented schema in the REA findings, so raw JSON is logged verbatim instead of being mapped to invented typed fields. `propresenter_catalog` and `propresenter_resource` Tauri commands, `bridge.ts` methods and Show Mode controls were added.
- **EasyWorship E2**: `status` booleans now populate typed `SlideState.screen` (`black`, `clear`, `logo`); black/clear/logo buttons are explicitly local display overrides because the documented TCP action catalog has no toggle frame — the next status report overwrites them. Added documented `getSlideImage`/`getCurrentImage` request frames, binary-header `BinaryMeta` parsing, JPEG SOI validation, a bounded 32 MiB raw-JPEG cache (8 MiB per image), hash/revision-driven image follow-ups, `SlideState.image` metadata, `easyworship_image` byte access, and a Show Mode preview.
- **Configuration**: `RING_PP_HOST`/`RING_PP_PORT` for ProPresenter; `RING_EZW_ENDPOINT`, or `RING_EZW_HOST`/`RING_EZW_PORT`, or `RING_EZW_DISCOVER=1` (default mDNS path) for EasyWorship.

### Explicit non-goals for the current increment

The following remain in P2/E2 (or later) and are **not** claimed as complete:

- ProPresenter playlist/presentation enumeration and thumbnails, announcements, themes, capture status, `/v1/ws` control bridge, ProLink preroll transport, mDNS discovery, authentication, full 205-path catalog. Catalog response schemas for looks/props/macros are undocumented, so only raw response logging is claimed.
- EasyWorship remote black/clear/logo toggle frames (none are documented; local overrides only), permissions UI, MIDI automation/sync, NDI output naming, CCLI export, deeper `.ewsx` library import. JPEG image bodies are cached and previewed; no undocumented image formats or response fields are inferred.
- Source arbitration between the two presentation adapters; deployments must still enable one presentation source at a time.
- Any proprietary source, decompiled code, vendor assets, or copyrighted lyrics/media (permanent clean-room policy).

The documented EasyWorship index layout names an "outer flag" without stating its byte width. The parser accepts both a one-byte and a little-endian int32 interpretation and requires the chosen form to consume the payload exactly; this assumption still needs confirmation against live EasyWorship 7 hardware.

Both presentation adapters write the shared `slides` state; `SlideState.adapter` identifies the last writer. Deployments should enable only one presentation source at a time until source arbitration is implemented.

### Verification log (this increment)

| Gate | Result |
|---|---|
| `npm run build` | Pass (TypeScript + Vite, 1611 modules) |
| `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml` | Pass — 122 tests, 0 failures |
| `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml` | Pass |
| Live ProPresenter 22 / EasyWorship 7 hardware | Pending — requires on-site network and paired remote client |

Unrelated uncommitted X32 cleanup files were left untouched throughout this increment.
