# One Ring To Rule Them All

Unified, cross-platform (**Windows & macOS**) control suite for church production — intelligently designed for ease of use by both tech leads and Sunday volunteers.

**Scope:** One Ring as a standalone cross-platform church & live production suite unifying: Network Audio Console (OSC), AoIP Audio Matrix, Studio Broadcast Engine (RTMP/RTMPS/WHIP/SRT + FFmpeg + Multi-Canvas), Presentation & Slides Engine (FOH/Stage/Lower-Third outputs, Public-Domain Scripture, Song Library), IP Video Routing, and Robotic IP PTZ Control.

Unified, cross-platform (**Windows & macOS**) control suite for church production — intelligently designed for ease of use by both tech leads and Sunday volunteers.

## Core Control Domains

1. **FOH Slides & Presentation**: Slide triggers, stage display, timers, playlists, cues, and Lower Thirds outputs
2. **Livestream & Multi-Broadcast**: Scene switching, simultaneous multi-destination streaming, local recording, audio/video sources, per-platform health & alerts
3. **Audio Routing & Mixing**:
   - Mixing board (OSC control: faders, mutes, DCAs, scenes/snippets, bus sends)
   - IP audio matrix (routing, clocking, device/channel discovery & health)
4. **Cameras & Video Transport**:
   - PTZ pan/tilt/zoom presets, pan/tilt/zoom, exposure/white balance, tally
   - IP video routing matrix with discovery and auto-heal

## Reverse-Engineering Inputs (`docs/re-findings/`)

As REA decompiles each application from reference production applications, protocol specifications, local IPC/WebSocket/OSC/HTTP APIs, discovery mechanisms, and authentication/handshake details are documented in `docs/re-findings/<app>.md` to inform clean, native integrations.

## UX & Architecture Principles

- **Volunteer-First Simplicity**: Clean "Live Show" mode with big, unmistakable cues/macros ("Pre-Service", "Worship", "Sermon", "Go Live", "Emergency Mute") alongside an expandable "Engineer" view for deep mixer/camera tweaks.
- **Cross-Platform**: Single codebase targeting Windows & macOS.
- **Safe Under Pressure**: Confirmation guards on destructive live actions (stopping stream, muting mains, switching clock), live health indicators for every connected device, and automatic reconnect.