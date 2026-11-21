# One Ring — Unified Production Suite (`v0.3.11-alpha`)

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
- **Built-In AI Production Assistant**: Slide-over AI chatbot powered by **OpenCode CLI (free local models)**, **Ollama**, or any **HTTPS OpenAI-compatible API** to draft announcement slides, worship sets, slide themes, and stage alerts with operator-confirmed one-click Apply cards.
- **Hardware Video Switcher (`UDP :9910`) & Dynamic-Load LAN IP Video Bridge**: Two-way hardware video switcher control (Preview/Program tallies, Cut, Auto/Fade, guarded FTB, USK/DSK, Macros) plus dynamic runtime LAN IP video discovery & broadcast output with zero bundled proprietary SDKs.
- **15-Translation English Bible Lookup**: Full dropdown of 15 Public-Domain and Open-License English Bible translations.
- **In-App Song & Lyric Search**: Search by title, artist, or lyric phrase across live online lyrics (`lrclib.net`), a local offline church song folder (`.txt`, `.cho`/`.chordpro`, OpenLyrics `.xml`), and an expanded built-in Public-Domain Hymnal.
- **Sanitized Crash Reporter & Silent Windows Launch**: Automatic Rust panic + React `ErrorBoundary` capture with path/secret scrubbing, opt-in Cloudflare Worker → GitHub Issues relay (`workers/crash-relay/`), and console-free Windows background subprocess execution (`CREATE_NO_WINDOW`).
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
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) — Apache 2.0 upstream open-source attributions

### What's New in v0.3.11-alpha
- **41+ Translation Multi-Provider Bible Engine:** Categorized dropdown across all 6 translation families (Word-for-Word, Thought-for-Thought, Paraphrases, Catholic & Orthodox Canons, Jewish Tanakh, Historical Predecessors), live open-license lookup (`helloao.org` + `bible-api.com`), inline official Crossway ESV API & API.Bible key setup, and local offline XML/OSIS/Zefania/OpenSong/JSON importer.
- **One-Click Runtime Installers:** Fixed Windows OpenCode CLI installer (official GitHub release zip) + added one-click standalone FFmpeg installer (`~/.onering/bin` auto-discovery).
- **Song & Lyric Search Polish:** Unified into 1 universal search bar + smart word-boundary line-balancing with a persistent `2 / 4 lines per slide` toggle.
- **Legal & Security Compliance:** Added `PRIVACY.md` (US + GDPR), `TERMS.md`, `SECURITY.md`, `PRODUCT.md`, expanded `THIRD_PARTY_NOTICES.md`, and path-traversal hardening on local Bible imports.

### What's New in v0.3.11-alpha
- **AI Assistant Real Tool Execution:** Asking the AI Production Assistant to add songs or Bible passages now invokes One Ring's built-in Song & Lyric Search and 41+ translation Bible Engine, smart-balances lines, splits into 2/4-line slides, and adds a one-click  button.
- **Impeccable Booth UX/UI Polish:** Added green  badge + confirmation guard before switching to engineer tabs, upgraded  to  ( + instant Undo toast), pill mode tabs with crisp focus rings,  dim-booth header legibility, clarified song-import strip, and a session-dismissible AI CLI banner.
- **Live Crash Relay:** Baked  secret support into automated Windows & macOS release builds.

### What's New in v0.3.11-alpha
- **Android Sideloadable APK + Touch-First UI:** Full Tauri v2 Android build pipeline (.github/workflows/android.yml), 44px touch targets, horizontally scrollable mode tabs, overflow menu, and pure-Rust Android HTTPS for lyrics, Bible, AI, and crash reporting.
- **Desktop LAN Remote Control:** Desktop pairing server on port 39880 (6-digit pairing code + revocable bearer tokens) + Android Remote tab for controlling desktop-only features (FFmpeg streaming, Window Capture, blackout/clear, slides) over church Wi-Fi.
- **Native Tauri v2 Auto-Updater (Windows & macOS):** Integrated tauri-plugin-updater + tauri-plugin-process with Ed25519 signed artifacts, CI-generated latest.json, and 1-click Update & Restart with live progress % in Settings.
