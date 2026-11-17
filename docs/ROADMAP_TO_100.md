# Roadmap to 100% Standalone Feature Parity

This document tracks the systematic closure of every gap identified in the REA binary audit across all six production suites.

## Phase 1 — Live Socket Coverage (SHIPPED in v0.1.10-alpha)
- [x] **Dante Conmon/ARC Runtime Adapter (`src-tauri/src/runtime/dante_adapter.rs`)**: Live multicast UDP `:8751` metering listener + beltpack `0xFE` mute trap + `IDENTIFY_QUERY (0x0063)` hardware flash + ARC crosspoint packet sender.
- [x] **NDI 6 Discovery Runtime Adapter (`src-tauri/src/runtime/ndi_adapter.rs`)**: Live TCP `:5959` NDI 6 Receiver Listener, source/receiver graph hydration, `<control_receiver>` source switching, and PTZ metadata command dispatch.
- [x] **Dedicated Output Displays (`src/components/SecondaryOutputWindow.tsx`)**: Multi-window BroadcastChannel sync for independent FOH Fullscreen Display, Livestream Lower Thirds Keyed Output, and Stage Confidence Display windows.

## Phase 2 — Assigned to Worker Agent Team (`opencode` / `rea-decompiler`)
- **Host Media & Audio Plugin Discovery**:
  - `scan_installed_audio_plugins`: Recursively scan OS VST3 / AU / VST2 directories on Windows & macOS so `SourceFiltersModal` populates native plugins automatically.
  - `list_capture_hardware`: Enumerate OS cameras, audio I/O endpoints, and secondary monitors so `SourceSettingsModal` and Secondary Outputs snap automatically to projector monitors.
- **Full X32 32-Channel Mixer Strip + EQ/Dynamics UI**:
  - Expand `EngineerView` / `Mixing` canvas from DCA strips to all 32 Input Channels, 16 Mix Buses, 6 Matrices, Parametric EQ frequency curve canvas, Gate/Compressor dynamics, and `.scn` show-file import/export.
- **Option 2 Embedded libobs Daemon**:
  - Headless `libobs` process supervisor for standalone GPU scene compositing, FFmpeg hardware encoding (VideoToolbox/NVENC), VST audio processing, and simultaneous multi-RTMP/RTMPS/WHIP output without external OBS Desktop open.
- **ProPresenter Deep Feature Closure**:
  - Visual Slide Canvas WYSIWYG editor, Scripture Bible lookup/SQLite store, CCLI SongSelect / Planning Center Online sync, Timers, Stage Layouts, Props, and `.pro` / `.ewsx` EasyWorship schedule import.
