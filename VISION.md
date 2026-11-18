# One Ring To Rule Them All

Unified, cross-platform (**Windows & macOS**) control suite for church production — intelligently designed for ease of use by both tech leads and Sunday volunteers.

## Core Control Domains
1. **FOH Slides & Presentation**: ProPresenter / EasyWorship (slide triggers, stage display, timers, playlists, cues)
2. **Livestream & Multi-Broadcast**: OBS Studio / Streamlabs (scene switching, simultaneous multi-destination streaming to **YouTube Live** + **Facebook Live**, local recording, audio/video sources, per-platform health & alerts)
3. **Audio Routing & Mixing**:
   - **Behringer X32** mixing board (OSC control: faders, mutes, DCAs, scenes/snippets, bus sends)
   - **Dante** (Controller, Virtual Soundcard, Via, Studio — routing, clocking, device/channel discovery & health)
4. **Cameras & Video Transport**:
   - **NDI** (NDI 6 Tools — source discovery, PTZ, tally, routing)
   - **Cameras** (PTZ presets, pan/tilt/zoom, exposure/white balance, tally)

## Reverse-Engineering Inputs (`docs/re-findings/`)
As REA decompiles each application from reference production applications, protocol specifications, local IPC/WebSocket/OSC/HTTP APIs, discovery mechanisms, and authentication/handshake details are documented in `docs/re-findings/<app>.md` to inform clean, native integrations.

## UX & Architecture Principles
- **Volunteer-First Simplicity**: Clean "Live Show" mode with big, unmistakable cues/macros ("Pre-Service", "Worship", "Sermon", "Go Live", "Emergency Mute") alongside an expandable "Engineer" view for deep mixer/Dante/camera tweaks.
- **Cross-Platform**: Single codebase targeting Windows & macOS.
- **Safe Under Pressure**: Confirmation guards on destructive live actions (stopping stream, muting mains, switching Dante clock), live health indicators for every connected device, and automatic reconnect.
