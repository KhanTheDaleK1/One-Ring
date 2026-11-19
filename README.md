# One Ring — Unified Production Suite (`v0.3.2-alpha`)

A clean-slate, cross-platform (**Windows & macOS**) desktop production suite built with **Tauri v2, Rust, React, and TypeScript**. One Ring unifies church/live-production workflows — slides, broadcast compositing, multi-camera PTZ switching, audio mixing, and IP video routing — inside one customizable interface.

**Scope:** One Ring as a standalone cross-platform church & live production suite unifying: Network Audio Console (OSC), AoIP Audio Matrix, Studio Broadcast Engine (RTMP/RTMPS/WHIP/SRT + FFmpeg + Multi-Canvas), Presentation & Slides Engine (FOH/Stage/Lower-Third outputs, Public-Domain Scripture, Song Library), IP Video Routing, and Robotic IP PTZ Control.

> **Clean-Room Policy:** This codebase is 100% original (Rust + TypeScript). Reverse engineering with REA is strictly used to document wire protocols, endpoints, message schemas, and state machines in `docs/re-findings/`. Zero proprietary source code or vendor assets are copied into this repository.

---

## Core Workspaces (Canvases)

You can customize your active canvas title (e.g., `"Main Sanctuary"`) and re-order, show, or hide any top-bar navigation tab in **Settings**:

1. **Mixing**
   - Mixing board over OSC/UDP (`:10023` + keepalive + telemetry)
   - Channel strips with mute guards, dB faders, and live signal indicators
   - Audio converter with multicast route diagnostics and beltpack mute detection
   - Audio interface support with multichannel networking

2. **Video**
   - Multi-camera preset matrix with Program / Preview Tally indicators
   - PTZ pan/tilt/zoom controls
   - IP Video Routing matrix with discovery and auto-heal

3. **Slides**
   - Raw lyrics importer with auto-detected section headers and instant reflow (**2 lines per slide** default, 1L–4L toggle)
   - Theme & Typography Editor: Solid, studio gradient, or image/motion URL backgrounds, customizable font family, size slider, text colors, and Lower Thirds accent bar
   - **3-Screen Live Previews**: Simultaneous Audience Screen (FOH), Livestream Lower Thirds (Alpha), and Stage Confidence Monitor (current / next)
   - **Pop-Out Output Windows**: Launch independent, synced full-screen windows for secondary displays

4. **Broadcast**
   - Support for all native source types with dedicated modals for hardware devices, FPS, URLs, custom CSS, file loops, text styling, and colors
   - **Full Right-Click Context Menu**: Copy / Paste / Duplicate, Copy/Paste Filters, Plugin / Video Effect Rack, Transform editor, Order (Up/Down/Top/Bottom), Scale Filtering, Blending Mode, Deinterlacing, Rename, Visibility, Lock, and Screenshot capture
   - Dual-canvas (`16:9` Horizontal + `9:16` Vertical) output with V5 adapter and automatic VOD record chapters

5. **Master**
   - Unified Show Runner & Cue Timeline combining slide advances, camera cuts, audio mutes, and broadcast recording markers with transactional 16-depth **Undo**, dry-run rehearsal toggle, and readiness diagnostics

---

## Networking, Sync & Native App Features

- **Automated LAN Peer Discovery & Pairing (`UDP :47888`)**: Automatically detects nearby One Ring stations on your local network and prompts you to pair and sync stations together.
- **Portable Show Files (`.ring.json`)**: Export and import full cue stacks, scenes, sources, audio routes, and slide decks.
- **Built-In Auto-Updater & macOS Menu Bar**: Native `About One Ring` / `Check for Updates...` panel fetching signed GitHub releases directly inside the app.
- **Clean-Slate Architecture**: Launches cleanly without pre-loaded dummy shows or fake mock traffic. Set `RING_LIVE=1` to activate live socket adapters.

---

## Documentation

- [VISION.md](./VISION.md) — Project vision & unified production design goals
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — Rust workspace, Tauri IPC, event bus, & live `DeviceAdapter` architecture
- [docs/ROADMAP_TO_100.md](./docs/ROADMAP_TO_100.md) — Phased parity tracking toward 100% standalone replacement across all six production suites
- [docs/UX_DESIGN.md](./docs/UX_DESIGN.md) — Canvas UX & operator guardrails
- `docs/re-findings/` — Clean-room protocol & API specifications generated via REA analysis