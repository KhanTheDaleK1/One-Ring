# One Ring — Unified Production Suite (`v0.2.0-alpha`)

A clean-slate, cross-platform (**Windows & macOS**) desktop production suite built with **Tauri v2, Rust, React, and TypeScript**. One Ring unifies church/live-production workflows — slides, broadcast compositing, multi-camera PTZ switching, audio mixing, Dante routing, and NDI discovery — inside one customizable interface.

> **Clean-Room Policy:** This codebase is 100% original (Rust + TypeScript). Reverse engineering with REA is strictly used to document wire protocols, endpoints, message schemas, and state machines in `docs/re-findings/`. Zero proprietary source code or vendor assets are copied into this repository.

---

## Core Workspaces (Canvases)
You can customize your active canvas title (e.g., `"Main Sanctuary"`) and re-order, show, or hide any top-bar navigation tab in **Settings**:

1. **Mixing**
   - **Behringer X32 / Midas M32** over OSC/UDP (`:10023` + `/xremote` keepalive + `/meters/1` telemetry).
   - DCA channel strips with mute guards, dB faders, and live signal indicators.
   - **Audinate Dante** Conmon (`UDP :8751` multicast) & ARC (`0x27FF`) adapter, route diagnostics, `IDENTIFY (0x0063)` LED flash, and **Silent Pastor Mic** (`0xFE`) detector.
2. **Video**
   - Multi-camera preset matrix with **Red (Program)** / **Green (Preview)** Tally indicators.
   - **VISCA-over-IP** (`:52381`) & **NDI PTZ** pan/tilt D-pad and zoom controls.
   - Live **NDI 6 Discovery Service** (`TCP :5959`) remote receiver switcher and auto-heal matrix.
3. **Slides**
   - **Lyric Reflow Importer**: Paste raw lyrics with auto-detected `[Verse]` / `[Chorus]` section headers and instant reflow (**2 lines per slide** default, 1L–4L toggle).
   - **Theme & Typography Editor**: Solid, studio gradient, or image/motion URL backgrounds, customizable font family, size slider, text colors, and Lower Thirds accent bar.
   - **3-Screen Live Previews**: Simultaneous **Audience Screen (FOH)**, **Livestream Lower Thirds (Alpha/NDI)**, and high-contrast **Stage Confidence Monitor** (`Yellow` current / `Cyan` next).
   - **Pop-Out Output Windows**: Launch independent, synced full-screen windows for secondary displays (`FOH Screen`, `Lower 3rds`, `Stage Screen`).
4. **Broadcast**
   - Support for **all 15 OBS native source types**: `Application Audio Capture (BETA)`, `Audio Input/Output Capture`, `Browser`, `Color`, `Display Capture`, `Game Capture`, `Image`, `Image Slide Show`, `Media`, `Scene`, `Text (GDI+)`, `Video Capture Device`, `Window Capture`, and `Group`.
   - **Source Properties & Configuration**: Dedicated modal for hardware devices, FPS, URLs, custom CSS, file loops, text styling, and colors.
   - **Full OBS-Style Right-Click Context Menu**: `Set Color` tags, `Copy / Paste / Duplicate`, `Copy/Paste Filters`, **VST 2/3 & AU Plugin / Video Effect Filter Rack**, `Transform` editor, `Order` (Up/Down/Top/Bottom), `Scale Filtering`, `Blending Mode`, `Deinterlacing`, inline `Rename`, Visibility, Lock, and Screenshot capture.
   - Dual-canvas (`16:9` Horizontal + `9:16` Vertical) output + `obs-websocket` v5 (`:4455`) and Streamlabs Desktop (`127.0.0.1:28194`) adapters with automatic VOD record chapters.
5. **Master**
   - Unified Show Runner & Cue Timeline combining slide advances, camera cuts, X32 DCA mutes, and broadcast recording markers with transactional 16-depth **Undo**, dry-run rehearsal toggle, and readiness diagnostics.

---

## Networking, Sync & Native App Features
- **Automated LAN Peer Discovery & Pairing (`UDP :47888`)**: Automatically detects nearby One Ring stations on your local network and prompts you to pair and sync stations together.
- **Portable Show Files (`.ring.json`)**: Export and import full cue stacks, scenes, sources, audio routes, and slide decks.
- **Built-In Auto-Updater & macOS Menu Bar**: Native `About One Ring` / `Check for Updates...` panel fetching signed GitHub releases directly inside the app.
- **Clean-Slate Architecture**: Launches cleanly without pre-loaded dummy shows or fake mock traffic. Set `RING_LIVE=1` to activate live socket adapters.

---

## Quick Start

### Install Pre-Built Release (macOS `.dmg` & Windows `.msi` / `.exe`)
Download the latest installer from [GitHub Releases](https://github.com/KhanTheDaleK1/One-Ring/releases).

### Build & Run from Source
Requires **Node.js 20+** and **[Rust](https://rustup.rs/)** (`cargo` / `rustc`):

```bash
# Install frontend dependencies
npm install

# Run UI only (browser dev server)
npm run dev

# Run native Tauri desktop app in dev mode
npm run tauri dev

# Build production installer (.dmg on macOS / .msi on Windows)
npm run tauri build
```

---

## Documentation
- [VISION.md](./VISION.md) — Project vision & unified production design goals
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — Rust workspace, Tauri IPC, event bus, & live `DeviceAdapter` architecture
- [docs/ROADMAP_TO_100.md](./docs/ROADMAP_TO_100.md) — Phased parity tracking toward 100% standalone replacement across all six production suites
- [docs/UX_DESIGN.md](./docs/UX_DESIGN.md) — Canvas UX & operator guardrails
- `docs/re-findings/` — Clean-room protocol & API specifications generated via REA analysis (`dante.md`, `ndi.md`, `obs.md`, `propresenter.md`, `streamlabs.md`, `x32.md`)
