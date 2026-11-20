# Technical Architecture — One Ring To Rule Them All

## 1. Overview & Technology Stack

**One Ring To Rule Them All** is a single-codebase, cross-platform (**macOS & Windows**) desktop control suite for church production. It unifies FOH presentation, livestreaming, audio mixing, IP video routing, and PTZ cameras behind a volunteer-safe **Live Show** interface and an expandable **Engineer** view.

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **App Shell** | **Tauri v2** | Native windowing, small binary footprint, OS keychain/entitlements, single codebase for macOS & Windows. |
| **Backend Runtime** | **Rust + `tokio`** | Lock-free async I/O for UDP (OSC, camera control, mDNS), WebSockets, and sub-millisecond cue orchestration. |
| **Frontend UI** | **React 19 + TypeScript + Vite** | Componentized Live Show / Engineer views, Zustand state synced from Rust events, Tailwind CSS. |
| **IPC** | **Tauri Commands & Events** | Typed request/response commands (`invoke`) + high-frequency state/meter/health push streams (`app.emit`). |
| **Testing / Offline** | **Built-in Mock/Simulator Mode** | Every `DeviceAdapter` has a stateful in-memory simulator so full shows and cues run without live church hardware. |

---

## 2. Monorepo & Directory Layout

```text
one-ring-to-rule-them-all/
├── Cargo.toml                  # Rust workspace root
├── package.json                # Frontend + Tauri CLI scripts
├── docs/
│   ├── ARCHITECTURE.md         # This document
│   └── re-findings/            # Reverse-engineered protocol specs (<app>.md)
├── src/                        # React + TypeScript frontend
│   ├── app/                    # Router, providers, global keybindings
│   ├── stores/                 # Zustand stores hydrated by Tauri events
│   ├── views/
│   │   ├── live-show/          # Volunteer-first cue deck, status bar, safety modals
│   │   └── engineer/           # Mixer, routing, camera control, logs
│   └── components/             # Shared UI primitives & confirmation guards
├── crates/                     # Pure Rust domain & protocol crates (no Tauri dependency)
│   ├── ring-core/              # DeviceAdapter trait, CueEngine, ShowFile schema, Mock registry
│   ├── ring-discovery/         # Cross-platform mDNS-SD (_netaudio-arc._tcp, _ndi._tcp)
│   ├── ring-slides/            # Slide & presentation adapters + mocks
│   ├── ring-stream/            # Broadcasting adapters + mocks
│   ├── mixing-board/           # Mixing board OSC/UDP adapter + mock
│   ├── av-routing/             # Audio/video routing adapters + RE protocol hooks + mocks
│   └── ring-camera/            # Camera control adapters + mocks
└── src-tauri/                  # Tauri v2 host binary
    ├── tauri.conf.json
    ├── capabilities/           # Tauri v2 ACL permissions
    └── src/
        ├── main.rs / lib.rs    # App bootstrap, tokio runtime, tray/menu
        ├── state.rs            # DeviceManager, CueEngine, active ShowFile handle
        ├── commands/           # Tauri #[command] handlers (devices, cues, config)
        └── events.rs           # Throttled state/meter/health event emitter to UI
```

Keeping protocol logic in `crates/*` decouples it from Tauri, enabling fast `cargo test` runs, CLI headless smoke tests, and clean isolation of reverse-engineered protocols.

---

## 3. Core Backend Architecture

### 3.1 `DeviceAdapter` Abstraction

All hardware and software targets implement a unified async trait in `ring-core`:

```rust
#[async_trait]
pub trait DeviceAdapter: Send + Sync {
    fn id(&self) -> &DeviceId;
    fn kind(&self) -> DeviceKind;
    fn capabilities(&self) -> DeviceCapabilities;

    /// Establish transport connection and start background keepalive/reader tasks.
    async fn connect(&self) -> Result<(), AdapterError>;
    async fn disconnect(&self) -> Result<(), AdapterError>;

    /// Lightweight liveness probe used by the Health Supervisor.
    async fn health_check(&self) -> HealthStatus;

    /// Execute a normalized domain action (e.g., TriggerSlide, SetFader, RecallPtzPreset).
    async fn execute(&self, action: DeviceAction) -> Result<ActionResult, AdapterError>;

    /// Subscribe to normalized state updates (fader moves, active scene, tally, etc.).
    fn subscribe(&self) -> broadcast::Receiver<DeviceEvent>;
```

### 3.2 Health Heartbeat & Auto-Reconnect

A dedicated `SupervisorTask` per registered device manages connection lifecycle:

1. **Heartbeat Loop**: Polls `health_check()` (or tracks last-packet-received timestamp for push protocols) every `2s`.
2. **State Machine**: `Disconnected` → `Connecting` → `Healthy` → `Degraded` (missed 1–2 probes or high RTT) → `Reconnecting`.
3. **Exponential Backoff**: On disconnect or timeout, retries at `500ms → 1s → 2s → 4s → max 15s` with ±20% jitter.
4. **UI Propagation**: State transitions emit `device://health` events to the frontend status strip so volunteers see green/amber/red indicators immediately.

### 3.3 Built-In Mock / Simulator Mode

Testing church production software without physical hardware is a first-class requirement.

- **Activation**: Global `--mock` CLI flag, `RING_MOCK=1` env var, or per-device `"mode": "mock"` in the Show File (allowing hybrid testing, e.g., real broadcasting software + simulated mixing/routing/camera).
- **Behavior**: Each crate provides a `Mock*Adapter` implementing `DeviceAdapter` with:
  - Realistic in-memory state (e.g., 32-channel mixer, DCAs, mutes; PTZ presets; broadcasting scenes & stream timer; virtual audio/video endpoints).
  - Configurable simulated latency (`latency_ms`) and fault injection (dropped packets, transient disconnects) for testing Cue Engine timeouts and auto-reconnect.

---

## 4. Control Domain Adapters

| Domain | Targets | Transport & Protocol Details |
| :--- | :--- | :--- |
| **FOH Slides** | Presentation software | HTTP REST (`/v1/presentation/...`, `/v1/timers`, `/v1/status/layers`), `POST /v1/status/updates` multiplexed chunked status stream, and UDP multicast (`224.0.0.90:18514`) two-step preroll per protocol spec. |
| **Livestream** | Broadcasting software | **WebSocket v5** with challenge-response auth, scene switching, stream start/stop, canvas list (dual-canvas `16:9` + `9:16`), record chapters, and output start/stop per protocol spec. |
| | **Multi-Broadcast** | Simultaneous dual/multi-destination RTMPS fan-out via managed `tee` relay so a single local encode feeds multiple platforms with independent per-target start/stop, bitrate/drop telemetry, auto-reconnect, and stream-key storage. |
| **Audio Mixing** | Mixing board | **OSC over UDP (`:10023`)**. Background task sends keepalive every **8 seconds** (required `<10s` keepalive) to receive live board updates. Supports channel faders, mutes, DCAs, bus sends, and scene/snippet recall. |
| **Camera Control** | Camera control interface | UDP (`:52381`) with 8-byte header (payload type + incrementing 32-bit sequence number). Commands: Pan/Tilt/Zoom speed vectors, Preset Recall/Set, Exposure/WB, Tally. |

### Integration Hooks for `docs/re-findings/`

`ring-discovery` / `ring-av-routing` / `ring-slides` / `ring-stream` / `mixing-board` / `ring-camera` define clean-room protocol codecs and wire frames directly from reverse-engineered protocol specifications:

- Audio routing transport → `ring-av-routing`
- Video routing discovery → `ring-discovery`
- Presentation API → `ring-slides`
- Broadcasting control → `ring-stream`
- Mixing board control → `mixing-board`
- Camera control → `ring-camera`

---

## 5. Cross-Device Cue / Macro Engine

A **Cue** (or Macro) coordinates actions across multiple domains (e.g., *"Start Sermon"*: recall mixer scene, switch broadcasting software to appropriate source, recall PTZ preset, trigger presentation slide).

### Execution Model

- **Step Graph**: A Cue contains an ordered list of **Steps**. Each Step is either:
  - `Single(ActionStep)`
  - `Parallel(Vec<ActionStep>)` (executed concurrently via `tokio::join!` / `JoinSet`)
  - `Delay(Duration)`
- **Timeouts**: Every `ActionStep` has a default timeout (e.g., `3000ms`, overridable per step) wrapped in `tokio::time::timeout`.
- **Failure Policies** (per step):
  - `Abort`: Stop the cue immediately and report failure.
  - `ContinueOnError`: Log warning, mark step `PartialFailure`, and continue remaining steps (ideal when a non-critical camera or timer fails during live worship).
  - `Retry { max_attempts, delay_ms }`: Retry transient network errors before applying `Abort` or `ContinueOnError`.
- **Safety & Confirmation Guards**:
  - Actions tagged `destructive: true` (e.g., `StopStream`, `MuteMains`, `ClockSwitch`, `ClearAll`) require explicit `confirmed: true` from a UI confirmation modal before `CueEngine` dispatches them.
- **Live Telemetry**: Emits `cue://progress` events (`step_index`, `status`, `elapsed_ms`, `error`) so the Live Show UI shows real-time progress and highlights partial failures without blocking the operator.

---

## 6. Persistent Configuration & Show-File Schema

State is split into two files:

1. **Local App Config** (`config.toml` in OS app-config dir): Window layout, active mode (`live_show` vs `engineer`), last opened show path, global mock override, and log level.
2. **Portable Show File** (`*.ring.json` or `*.ring.toml`): Shareable across church computers (e.g., via cloud sync or USB).

> **Security Rule**: Passwords/tokens (broadcasting software credentials) are **never** stored in plaintext inside portable Show Files. The Show File stores a `credential_ref` key resolved at runtime from the OS Keychain (`keyring` crate) or environment variables.

### Show-File Schema (`*.ring.json`)

```json
{
  "schema_version": 1,
  "show_name": "Sunday Morning Service",
  "devices": [
    {
      "id": "mixer-foh",
      "kind": "mixing_board",
      "mode": "live",
      "endpoint": "192.168.10.50:10023",
      "options": { "keepalive_interval_ms": 8000 }
    },
    {
      "id": "stream-broadcast",
      "kind": "broadcasting",
      "mode": "live",
      "endpoint": "ws://127.0.0.1:4455",
      "credential_ref": "ring.broadcast.main"
    },
    {
      "id": "cam-stage-left",
      "kind": "camera-ip",
      "mode": "mock",
      "endpoint": "192.168.10.81:52381"
    }
  ],
  "cues": [
    {
      "id": "cue-sermon",
      "label": "Sermon",
      "color": "#2563EB",
      "requires_confirmation": false,
      "steps": [
        {
          "type": "parallel",
          "actions": [
            { "device": "mixer-foh", "op": "recall_scene", "params": { "scene": 4 }, "on_error": "continue" },
            { "device": "cam-stage-left", "op": "recall_preset", "params": { "preset": 2 }, "timeout_ms": 2000, "on_error": "continue" }
          ]
        },
        {
          "type": "single",
          "device": "stream-broadcast",
          "op": "set_scene",
          "params": { "scene": "Pastor Wide" },
          "on_error": "abort"
        }
      ]
    }
  ]
}
```

---

## 7. Frontend Architecture & UX Modes

- **Boot Posture**: The frontend opens in Volunteer Show Mode. Mixing, camera, slide, broadcast, and settings views are gated behind an Engineer PIN checked by the native host (`unlock_engineer_mode` / `get_engineer_lock_status`); returning to Show Mode calls `lock_engineer_mode`. Cross-window sync payloads carry a per-session nonce and are shape/URL validated, and secrets (stream keys, relay tokens) are never written to localStorage.
- **Live Show Mode (Volunteer-First)**:
  - High-contrast grid of large, unmistakable Cue buttons (`Pre-Service`, `Worship`, `Sermon`, `Go Live`, `Emergency Mute`).
  - Top **Health Strip** showing live status dots for Slides, Livestream, Mixer, Routing, and Cameras.
  - Confirmation modal for destructive cues (`requires_confirmation: true`).
- **Engineer View (Expandable Drawer / Tab)**:
  - Mixer fader/DCA/mute bank with live meter updates (throttled to ~20–30 fps over Tauri events).
  - Routing discovery table + matrix.
  - PTZ pan/tilt/zoom pad and preset programmer.
  - Protocol & Cue execution log viewer + per-device Mock/Live toggle.

---

## 8. Build & Packaging Pipeline

CI/CD runs on **GitHub Actions** with a dual-OS matrix (`macos-latest` and `windows-latest`) using `tauri-apps/tauri-action`:

| Platform | Output Artifacts | Signing & OS Permissions |
| :--- | :--- | :--- |
| **macOS** | `.app` bundle & `.dmg` installer | **Alpha builds are unsigned** — no Developer ID signing or notarization is applied yet. `Info.plist` includes `NSLocalNetworkUsageDescription` and `NSBonjourServices` (`_netaudio-arc._tcp`) for mDNS/UDP access on macOS Sequoia+. Signed artifacts and notarization are planned for beta/GA. |
| **Windows** (`x86_64-pc-windows-msvc`) | `.msi` (WiX) & `.exe` (NSIS) | **Alpha builds are unsigned** — no Authenticode signature is applied yet. Installer/first-run registers Windows Defender Firewall inbound/outbound rules for UDP `:10023` (mixer), UDP `:52381` (camera), and mDNS `:5353`. Signed artifacts are planned for beta/GA. |

### Release Verification

1. `cargo test --manifest-path src-tauri/Cargo.toml` (runs native unit tests + Cue Engine integration tests).
2. `python3 scripts/check_clean_room.py` (clean-room compliance gate, before dependency installation).
3. `npm ci` followed by `npm run build` (TypeScript typecheck + Vite production bundle).
4. `cargo tauri build` on macOS & Windows runners. Builds are published as **drafts** for explicit human promotion; alpha installers are unsigned and are not distributed through a signed updater. Tauri signed-updater integration and signed updater manifests (`latest.json`) are planned for beta/GA.