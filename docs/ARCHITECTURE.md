# Technical Architecture — One Ring To Rule Them All

## 1. Overview & Technology Stack

**One Ring To Rule Them All** is a single-codebase, cross-platform (**macOS & Windows**) desktop control suite for church production. It unifies FOH presentation, livestreaming, audio mixing, Dante/NDI routing, and PTZ cameras behind a volunteer-safe **Live Show** interface and an expandable **Engineer** view.

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **App Shell** | **Tauri v2** | Native windowing, small binary footprint, OS keychain/entitlements, single codebase for macOS & Windows. |
| **Backend Runtime** | **Rust + `tokio`** | Lock-free async I/O for UDP (OSC, VISCA, mDNS), WebSockets (OBS v5, ProPresenter), and sub-millisecond cue orchestration. |
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
│   │   └── engineer/           # X32 mixer, Dante matrix, NDI/PTZ control, logs
│   └── components/             # Shared UI primitives & confirmation guards
├── crates/                     # Pure Rust domain & protocol crates (no Tauri dependency)
│   ├── ring-core/              # DeviceAdapter trait, CueEngine, ShowFile schema, Mock registry
│   ├── ring-discovery/         # Cross-platform mDNS-SD (_netaudio-arc._tcp, _ndi._tcp)
│   ├── ring-slides/            # ProPresenter & EasyWorship adapters + mocks
│   ├── ring-stream/            # OBS WebSocket v5 & Streamlabs adapters + mocks
│   ├── ring-x32/               # Behringer X32 OSC/UDP 10023 + /xremote keepalive + mock
│   ├── ring-av-routing/        # Dante & NDI routing adapters + RE protocol hooks + mocks
│   └── ring-camera/            # VISCA-over-IP & NDI PTZ adapters + mocks
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
}
```

### 3.2 Health Heartbeat & Auto-Reconnect

A dedicated `SupervisorTask` per registered device manages connection lifecycle:
1. **Heartbeat Loop**: Polls `health_check()` (or tracks last-packet-received timestamp for push protocols like X32 `/xremote`) every `2s`.
2. **State Machine**: `Disconnected` → `Connecting` → `Healthy` → `Degraded` (missed 1–2 probes or high RTT) → `Reconnecting`.
3. **Exponential Backoff**: On disconnect or timeout, retries at `500ms → 1s → 2s → 4s → max 15s` with ±20% jitter.
4. **UI Propagation**: State transitions emit `device://health` events to the frontend status strip so volunteers see green/amber/red indicators immediately.

### 3.3 Built-In Mock / Simulator Mode

Testing church production software without a physical X32, Dante network, or PTZ camera is a first-class requirement.
- **Activation**: Global `--mock` CLI flag, `RING_MOCK=1` env var, or per-device `"mode": "mock"` in the Show File (allowing hybrid testing, e.g., real OBS + simulated X32/Dante/VISCA).
- **Behavior**: Each crate provides a `Mock*Adapter` implementing `DeviceAdapter` with:
  - Realistic in-memory state (e.g., 32 X32 channels, DCAs, mutes; 8 PTZ presets; OBS scenes & stream timer; virtual Dante/NDI endpoints).
  - Configurable simulated latency (`latency_ms`) and fault injection (dropped packets, transient disconnects) for testing Cue Engine timeouts and auto-reconnect.

---

## 4. Control Domain Adapters

| Domain | Targets | Transport & Protocol Details |
| :--- | :--- | :--- |
| **FOH Slides** | **ProPresenter** | HTTP REST (`/v1/presentation/...`, `/v1/timers`, `/v1/status/layers`) + WebSocket/chunked status stream for active slide, stage message, and playlist sync. |
| | **EasyWorship** | TCP/WebSocket remote control protocol; integration shaped by `docs/re-findings/easyworship.md` (handshake, schedule item trigger, blackout/clear). |
| **Livestream** | **OBS Studio** | **OBS WebSocket v5** (`tokio-tungstenite`) with SHA-256 challenge-response auth (`Identify` op), scene switching, `StartStream`/`StopStream`, `StartOutput`/`StopOutput` (for `obs-multi-rtmp` / custom outputs), record state, and source mute. |
| | **Streamlabs** | Local WebSocket / JSON-RPC named-pipe/port API (authentication token, scene/source visibility, stream/record & multistream toggles) informed by `docs/re-findings/streamlabs.md`. |
| | **Multi-Broadcast (YouTube + Facebook)** | Simultaneous dual/multi-destination RTMPS fan-out via either: (1) OBS/Streamlabs multi-output control, or (2) a Rust-managed **local RTMP-to-RTMPS `tee` relay** (`rtmps://a.rtmp.youtube.com/live2/...` + `rtmps://live-api-s.facebook.com:443/rtmp/...`) so a single local encode feeds both platforms with independent per-target start/stop, bitrate/drop telemetry, auto-reconnect, and OS Keychain stream-key storage. |
| **Audio Mixing** | **Behringer X32** | **OSC over UDP (`:10023`)**. Background task sends `/xremote` every **8 seconds** (required `<10s` keepalive) to receive live board updates. Supports channel faders (`/ch/NN/mix/fader`), mutes (`/ch/NN/mix/on`), DCAs (`/dca/N/fader`, `/dca/N/on`), bus sends, and scene/snippet recall (`/-action/goscene`). |
| **Dante & NDI** | **Dante** (Controller, DVS, Via, Studio) | mDNS-SD discovery via `_netaudio-arc._tcp.local` and `_netaudio-chan._tcp.local`. Control/routing/clocking hooks wired to `docs/re-findings/dante-*.md` specs (UDP ARC packets, channel subscription, clock master status). |
| | **NDI 6 Tools** | mDNS-SD discovery via `_ndi._tcp.local`. Source enumeration, NDI routing/matrix switching, tally state, and NDI Bridge/Studio Monitor hooks per `docs/re-findings/ndi-*.md`. |
| **Cameras** | **VISCA-over-IP** | UDP (`:52381`) with 8-byte VISCA-IP header (payload type + incrementing 32-bit sequence number). Commands: Pan/Tilt/Zoom speed vectors, Preset Recall/Set, Exposure/WB, Tally. |
| | **NDI PTZ** | NDI PTZ XML/metadata commands (`ntk_ptz_*` / NDI SDK FFI or native wire protocol per RE findings) for pan/tilt/zoom, focus, and preset recall. |

### Integration Hooks for `docs/re-findings/`
`ring-discovery` and `ring-av-routing` define a `ProtocolSpec` boundary:
- Discovery resolves mDNS TXT records and IP/port pairs into normalized `DiscoveredEndpoint` structs.
- Reverse-engineered packet codecs (e.g., Dante ARC channel subscribe, EasyWorship remote auth, Streamlabs local RPC) live in isolated modules under `crates/ring-*/src/protocols/` with explicit references to `docs/re-findings/<app>.md` and golden packet unit tests.

---

## 5. Cross-Device Cue / Macro Engine

A **Cue** (or Macro) coordinates actions across multiple domains (e.g., *"Start Sermon"*: recall X32 scene, switch OBS to Pastor Cam, recall PTZ Preset 2, trigger ProPresenter Sermon Title slide).

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
  - Actions tagged `destructive: true` (e.g., `StopStream`, `MuteMains`, `DanteClockSwitch`, `ClearAll`) require explicit `confirmed: true` from a UI confirmation modal before `CueEngine` dispatches them.
- **Live Telemetry**: Emits `cue://progress` events (`step_index`, `status`, `elapsed_ms`, `error`) so the Live Show UI shows real-time progress and highlights partial failures without blocking the operator.

---

## 6. Persistent Configuration & Show-File Schema

State is split into two files:
1. **Local App Config (`config.toml` in OS app-config dir)**: Window layout, active mode (`live_show` vs `engineer`), last opened show path, global mock override, and log level.
2. **Portable Show File (`*.ring.json` or `*.ring.toml`)**: Shareable across church computers (e.g., via cloud sync or USB).

> **Security Rule**: Passwords/tokens (OBS WebSocket password, ProPresenter API token) are **never** stored in plaintext inside portable Show Files. The Show File stores a `credential_ref` key resolved at runtime from the OS Keychain (`keyring` crate) or environment variables.

### Show-File Schema (`*.ring.json`)

```json
{
  "schema_version": 1,
  "show_name": "Sunday Morning Service",
  "devices": [
    {
      "id": "x32-foh",
      "kind": "behringer_x32",
      "mode": "live",
      "endpoint": "192.168.10.50:10023",
      "options": { "keepalive_interval_ms": 8000 }
    },
    {
      "id": "obs-stream",
      "kind": "obs_ws_v5",
      "mode": "live",
      "endpoint": "ws://127.0.0.1:4455",
      "credential_ref": "ring.obs.main"
    },
    {
      "id": "cam-stage-left",
      "kind": "visca_ip",
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
            { "device": "x32-foh", "op": "recall_scene", "params": { "scene": 4 }, "on_error": "continue" },
            { "device": "cam-stage-left", "op": "recall_preset", "params": { "preset": 2 }, "timeout_ms": 2000, "on_error": "continue" }
          ]
        },
        {
          "type": "single",
          "device": "obs-stream",
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

- **Live Show Mode (Volunteer-First)**:
  - High-contrast grid of large, unmistakable Cue buttons (`Pre-Service`, `Worship`, `Sermon`, `Go Live`, `Emergency Mute`).
  - Top **Health Strip** showing live status dots for FOH Slides, Livestream, X32, Dante, NDI, and Cameras.
  - Confirmation modal for destructive cues (`requires_confirmation: true`).
- **Engineer View (Expandable Drawer / Tab)**:
  - X32 fader/DCA/mute bank with live meter updates (throttled to ~20–30 fps over Tauri events).
  - Dante & NDI discovery table + routing matrix.
  - PTZ pan/tilt/zoom pad and preset programmer.
  - Protocol & Cue execution log viewer + per-device Mock/Live toggle.

---

## 8. Build & Packaging Pipeline

CI/CD runs on **GitHub Actions** with a dual-OS matrix (`macos-latest` and `windows-latest`) using `tauri-apps/tauri-action`:

| Platform | Output Artifacts | Signing & OS Permissions |
| :--- | :--- | :--- |
| **macOS** (`universal-apple-darwin`) | `.app` bundle & `.dmg` installer | `codesign` with Apple Developer ID + `notarytool` notarization. `Info.plist` includes `NSLocalNetworkUsageDescription` and `NSBonjourServices` (`_netaudio-arc._tcp`, `_ndi._tcp`, `_obs-websocket._tcp`) for mDNS/UDP access on macOS Sequoia+. |
| **Windows** (`x86_64-pc-windows-msvc`) | `.msi` (WiX) & `.exe` (NSIS) | Authenticode code signing (`signtool`). Installer/first-run registers Windows Defender Firewall inbound/outbound rules for UDP `:10023` (X32), UDP `:52381` (VISCA), and mDNS `:5353`. |

### Release Verification
1. `cargo test --workspace` (runs all unit tests + MockAdapter Cue Engine integration tests).
2. `npm run build` (TypeScript typecheck + Vite production bundle).
3. `cargo tauri build` on macOS & Windows runners, producing signed installers and updater manifests (`latest.json`).
