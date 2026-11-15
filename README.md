# One Ring — Church Production Suite

A unified, cross-platform (**Windows & macOS**) desktop application to control your entire Sunday production from a single, volunteer-friendly interface.

> **Clean-Room Policy:** This codebase is 100% original (Rust + TypeScript). Reverse engineering with REA is used strictly to document interoperability specifications (network protocols, endpoints, message schemas, and state machines) in `docs/re-findings/`. No proprietary source code or assets from third-party applications are copied into this repository.

## Control Domains
- **FOH Slides**: ProPresenter & EasyWorship (slide advance/prev/clear, playlists, stage display)
- **Multi-Broadcast Livestreaming**: Simultaneous **YouTube Live** + **Facebook Live** RTMPS broadcast + local recording (OBS WebSocket v5, Streamlabs, or Rust-managed RTMP-to-RTMPS relay) with independent health, bitrate, and 1.5s hold-to-stop safety guards
- **Audio Mixing & Routing**:
  - **Behringer X32** over OSC/UDP (`:10023` + `/xremote` keepalive) — safe Volunteer DCA mutes & clamped `±3 dB` trim, full Engineer mixer
  - **Dante** network clock & routing status (`48 kHz` lock, mDNS discovery)
- **Cameras & Video Transport**: **VISCA-over-IP** (`:52381`) & **NDI PTZ** camera presets, joystick control, and NDI source discovery

## Modes
1. **Preflight Check** — Automated Green/Amber/Red readiness verification across every domain before service starts.
2. **Volunteer "Show Mode"** — Clutter-free Service Cue Stack, giant `GO NEXT CUE (Space)` button, `Undo Last Cue`, and guarded quick controls.
3. **Engineer Mode** — Full technical access for X32 mixing, Dante clock/routing, independent YouTube/Facebook stream targets, and Cue/Macro editing.

## Quick Start

### 1. Run UI + Built-in Simulator (No hardware or Rust required)
```bash
npm install
npm run dev
```
Open `http://localhost:1420` in your browser to test Preflight, Volunteer Show Mode, Multi-Broadcast (YT + FB), and Engineer Mode using the built-in Simulator.

### 2. Run as Native Desktop App (Tauri v2 — macOS & Windows)
Requires [Rust](https://rustup.rs/) (`rustc` / `cargo`):
```bash
npm run tauri dev
```
Build native installers (`.app`/`.dmg` on macOS, `.msi`/`.exe` on Windows):
```bash
npm run tauri build
```

## Documentation
- [VISION.md](./VISION.md) — Project goals & scope
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — Tauri v2 / Rust backend, `DeviceAdapter` trait, Cue Engine, Mock Simulator, & packaging
- [docs/UX_DESIGN.md](./docs/UX_DESIGN.md) — Preflight, Volunteer Show Mode, Engineer Mode, & safety guardrails
- `docs/re-findings/` — Clean-room protocol & API specifications generated from REA analysis
