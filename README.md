# One Ring — Unified Production Suite (`v0.3.4-alpha`)

A clean-slate, cross-platform (**Windows, macOS & Linux**) desktop production suite built with **Tauri v2, Rust, React, and TypeScript**. One Ring unifies church and live-production workflows — slides, broadcast compositing, live stream telemetry & audience chat, zero-popup native window/display capture, multi-camera PTZ switching, audio mixing, AoIP routing, and IP video routing — inside one customizable interface.

**Scope:** Standalone cross-platform church & live production suite unifying: Network Audio Console (OSC), AoIP Audio Matrix (mDNS discovery & crosspoint control), Studio Broadcast Engine (RTMP/RTMPS/WHIP/SRT + hardware-accelerated FFmpeg compositor + Multi-Canvas + Live Telemetry & Audience Chat Relay), Presentation & Slides Engine (FOH/Stage/Lower-Third outputs, Public-Domain Scripture KJV/WEB/ASV, OpenLyrics & binary deck import), IP Video Routing, and Robotic IP PTZ Control.

> **Clean-Room Policy:** This codebase is 100% original (Rust + TypeScript) with automated CI enforcement (`scripts/check_clean_room.py`). Zero proprietary source code, third-party trademarks, or private personal data are included in this repository.

---

## Core Workspaces (Canvases)

Customize your active canvas title (e.g., `"Main Sanctuary"`) and re-order, show, or hide any top-bar navigation tab in **Settings**:

1. **Show Mode (Volunteer-First Boot)**
   - Boots cleanly into **Volunteer Show Mode** for calm, distraction-free cue execution, slide advances, timers, live stream status pill, and audience chat drawer.
   - Transactional 16-depth **Undo**, dry-run rehearsal mode, keyboard-operable **Hold-to-Confirm** safety guards for high-risk live actions, and a `?` keyboard shortcuts cheat-sheet.
   - Unlocking **Engineer Mode** (Mixing, Video, Slides, Broadcast, Settings) is enforced by a **Rust-side constant-time Engineer PIN gate** (with first-run PIN setup).

2. **Mixing & Audio Network (AoIP)**
   - Bidirectional 32-channel / 16-bus / 6-matrix / 8-DCA mixing console sync over OSC/UDP (`:10023`), USB recorder transport, safes/snippets, keyboard-accessible faders, and an integrated **FX Rack**.
   - AoIP RFC 6762 mDNS device discovery, live metering, and accessible crosspoint routing matrix with guarded clear/lock controls.

3. **Video & Robotic PTZ**
   - Multi-camera roster and preset matrix with Program / Preview tally indicators.
   - Full PTZ pan/tilt/zoom and optics controls (Focus, Iris, Exposure, White Balance, Home) plus hold-to-move safety.
   - IP Video Routing matrix with discovery, presets, and guarded auto-heal.

4. **Slides & Scripture**
   - WYSIWYG Slide Editor, raw lyrics importer with instant reflow (**2 lines per slide** default, 1L–4L toggle), OpenLyrics `.xml` and slide archive import (with pre-extraction path/symlink screening), and Public-Domain Scripture lookup (**KJV / WEB / ASV**).
   - **3-Screen Live Previews & Pop-Out Windows**: Simultaneous Audience Screen (FOH with looping video backgrounds), Livestream Lower Thirds (Alpha + one-click pinned audience chat overlay), and Stage Confidence Monitor (current / next / timers / alerts) with physical monitor assignment.

5. **Broadcast, Native Capture & Audience Engagement**
   - **Zero-Popup Native Window & Display Capture**: Enumerates and streams OS windows and displays natively in Rust (CoreGraphics on macOS, Win32 on Windows, X11/xrandr on Linux) without browser `getDisplayMedia()` picker popups.
   - **Real-Time Stream Telemetry & Audience Chat Relay**: 1 Hz bitrate sparkline, dropped frames %, congestion badge, CPU %, render ms, live/peak viewer counts, configurable WebSocket/Webhook/IRC chat relay, operator replies with optional Closed Captioning, canned church announcements, and one-click **"Show on Lower-Third"**.
   - **Hardware Encoder & Multi-Canvas Studio**: GPU encoder probing, supervised FFmpeg `filter_complex` compositor, Simple / Advanced / Custom FFmpeg profiles, dual-canvas (`16:9` + `9:16`), and automatic VOD chapter marks.

6. **Settings & Diagnostics**
   - Searchable 7-tab settings hub with sticky Save/Revert bar, dirty-tab and live health indicators, inline **"Test Connection"** probes, one-click **"Auto-Discover LAN"** pickers, dynamic RTMP destination management, PTZ roster editing, JSON profile import/export, sanitized diagnostic bundle export, UI Scale (`90%–125%`), and **High-Contrast Booth Mode**.

---

## Security, Networking & Native App Features

- **Authenticated LAN Sync & Discovery (`UDP :47888` / `WS :47800`)**: Opt-in peer discovery and shared-secret authenticated WebSocket pub/sub hub with message-kind allowlists, frame/client caps, and sender echo suppression.
- **Hardened Desktop Architecture**: Restrictive non-null Tauri CSP, `http(s)`-only sandboxed browser sources, `0600`/`0700` local settings permissions, zero secrets in `localStorage`, and bounded protocol parsers.
- **Portable Show Files (`.ring.json`)**: Export and import validated cue stacks, scenes, sources, audio routes, and slide decks.
- **Built-In Update Check**: Native `About One Ring` / `Check for Updates...` panel that checks release metadata over HTTPS. **Alpha builds are unsigned**: installers must be verified and promoted manually; Tauri signed-updater integration is planned for beta/GA.
- **Clean-Slate Architecture**: Launches cleanly without pre-loaded dummy shows. Set `RING_LIVE=1` to activate live socket adapters.

---

## Documentation

- [VISION.md](./VISION.md) — Project vision & unified production design goals
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — Rust workspace, Tauri IPC, event bus, & live `DeviceAdapter` architecture
- [docs/ROADMAP_TO_100.md](./docs/ROADMAP_TO_100.md) — Phased parity tracking across all production domains
- [docs/UX_DESIGN.md](./docs/UX_DESIGN.md) — Canvas UX & operator guardrails
