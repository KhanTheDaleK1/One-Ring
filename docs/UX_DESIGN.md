# UX & UI Design Specification — One Ring To Rule Them All

> **Target Platforms:** Windows & macOS (Desktop)  
> **Operating Environment:** Dimly lit Front-of-House (FOH) / Broadcast booths during live church services  
> **Primary Personas:** Sunday Volunteers (zero-clutter, mistake-proof execution) & Tech Directors / Engineers (deep system control & cue authoring)

---

## 1. Dual-Persona & Mode Architecture

The application separates **execution** from **configuration** via two distinct operational modes, plus a pre-service **Preflight** gate:

1. **Preflight Check (Pre-Service Gate):** Automated readiness verification across all 5 production domains before going live.
2. **Volunteer "Show Mode" (Default Live View):** High-contrast, linear cue-stack execution with constrained, mistake-proof quick controls.
3. **Engineer Mode (Technical View):** Full-access workspace for X32 mixing, Dante clock/routing, PTZ camera programming, OBS/Streamlabs source & stream health, and Cue/Macro authoring.

**Mode Switching & Role Lock:**
- Switching from **Show Mode → Engineer Mode** can be optionally PIN-protected (configurable per venue, e.g., 4-digit PIN or `Shift+Click` unlock) so volunteers cannot accidentally enter deep routing screens mid-service.
- Returning from **Engineer Mode → Show Mode** is instant and single-click.

---

## 2. Visual Design Tokens (FOH Dark-Room Palette)

Designed for dark booths where bright white UIs cause eye strain and bleed light onto FOH consoles, while maintaining **WCAG AAA** contrast for critical text and tally states.

### Color Tokens
| Token | Hex | Usage |
| :--- | :--- | :--- |
| `--bg-canvas` | `#0B0D10` | App background, main FOH canvas |
| `--bg-surface-1` | `#14181F` | Cards, cue stack items, mixer strips |
| `--bg-surface-2` | `#1E242E` | Active cards, hover states, modals |
| `--border-subtle` | `#2A3240` | Hairline dividers, strip borders |
| `--text-primary` | `#F3F5F8` | Primary labels, active cue title |
| `--text-secondary` | `#9AA5B4` | Metadata, secondary labels, timestamps |
| `--text-muted` | `#636E7E` | Disabled/inactive controls |
| `--status-ok` | `#22C55E` | Connected, clock locked, stream healthy |
| `--status-warn` | `#F59E0B` | High CPU, dropped frames <1%, unverified preset |
| `--status-danger` | `#EF4444` | Disconnected, LIVE ON AIR tally, Mute active, Destructive |
| `--accent-primary` | `#3B82F6` | Primary focus, "GO NEXT CUE" ready state |
| `--accent-preview` | `#10B981` | Broadcast Preview tally (Green) |
| `--accent-program` | `#EF4444` | Broadcast Program / Live tally (Red) |

### Typography & Sizing
- **UI Sans:** `Inter` / `SF Pro` (macOS) / `Segoe UI` (Windows) — `14px` base, `18px–22px` for Cue titles.
- **Monospace (Numeric/Timecode):** `JetBrains Mono` / `SF Mono` with `tabular-nums` for dB readouts, stream bitrate, and countdown timers so numbers never jitter.
- **Minimum Hit Targets:**
  - Volunteer Show Mode buttons: `>= 48×48px` (Primary `GO NEXT CUE` button: `>= 72px` tall, full column width).
  - Engineer Mode faders/toggles: `>= 36×36px` with generous `8px` gutter spacing.

---

## 3. Component Hierarchy

```text
AppShell
├── TopStatusBar (Persistent across all modes)
│   ├── ServiceIdentityBadge (Service Name + Live Clock + Countdown)
│   ├── DomainHealthPills (X32 | Dante | OBS | Slides | NDI/Cams)
│   ├── ModeSwitcher (Preflight | Show Mode | Engineer Mode [PIN Lock])
│   └── EmergencyPanicTrigger (Hold-to-Confirm Mute Mains / Cut Stream)
├── MainViewport
│   ├── PreflightView
│   │   ├── PreflightChecklistGrid (5 Domain Cards)
│   │   └── PreflightActionFooter (Re-Run All | Bypass & Enter Show Mode)
│   ├── ShowModeView (3-Column Fixed Grid)
│   │   ├── LeftCol: ServiceCueStack (Past / ACTIVE / NEXT / Upcoming)
│   │   │   ├── CueRow[] (Icon badges for Slides, Audio, Cam, OBS)
│   │   │   └── PrimaryGoBar ("GO NEXT CUE" + "Undo Last Cue")
│   │   ├── CenterCol: SafeQuickControls
│   │   │   ├── SlidesQuickCard (Prev / Next / Blank / Stage Timer)
│   │   │   ├── AudioDcaCard (Worship, Pastor, Media, Crowd Mutes + Trim)
│   │   │   └── CameraPresetGrid (4–8 Named Visual Preset Buttons)
│   │   └── RightCol: BroadcastMonitorCard
│   │       ├── LiveProgramPreview (NDI/OBS low-latency thumbnail)
│   │       └── StreamRecordControls (Start/Stop Stream [Guarded], Record)
│   └── EngineerModeView (Tabbed / Dockable Workspace)
│       ├── Tab: Audio & Dante (X32 Faders/DCAs/Buses + Dante Clock/Matrix)
│       ├── Tab: Video & PTZ (OBS Scenes/Sources + PTZ Joystick & Preset Programmer)
│       ├── Tab: Slides & Stage (ProPresenter/EasyWorship Playlist & Stage Layout)
│       └── Tab: Cue & Macro Editor (Timeline/Step Builder + Hardware Triggers)
└── GlobalSafetyOverlay
    ├── HoldToConfirmModal / TwoStepGuardModal
    ├── DisconnectedBanner (Per-domain reconnect & stale-data indicator)
    └── UndoToast (10s quick-revert banner after any cue execution)
```

---

## 4. Preflight Check Screen

Displayed automatically on launch (or via the Top Status Bar) before Sunday service begins. Runs parallel health probes and presents a **Green / Amber / Red** readiness matrix.

| Domain | Automated Checks | Auto-Fix / Remediation Action |
| :--- | :--- | :--- |
| **Behringer X32** | OSC reachable (`10023`), firmware/model match, Mains unmuted or at expected pre-service scene, DCA sanity | `Reconnect OSC` / `Recall Pre-Service Scene` |
| **Dante Network** | Primary/Secondary link status, Grandmaster Clock locked (`48kHz`), zero clock-sync errors, expected Virtual Soundcard/Via subscriptions active | `Open Dante Matrix` / `Refresh Discovery` |
| **Livestream & Multi-Broadcast** | OBS/Streamlabs WebSocket/IPC connected, **YouTube Live & Facebook Live** stream keys/destinations verified, audio input metering active, CPU/GPU headroom OK | `Reconnect WebSocket` / `Verify RTMP Targets` |
| **FOH Slides** | ProPresenter/EasyWorship API connected, today's playlist loaded, Stage Display active | `Reconnect API` / `Select Playlist` |
| **NDI & PTZ Cameras** | NDI discovery active, all configured PTZ cameras online, Home/Wide presets reachable | `Ping Cameras` / `Recall Home Presets` |

**Exit States:**
- **All Green:** Primary button `Enter Show Mode` is highlighted in `--status-ok`.
- **Amber/Red Warnings:** Shows exact failing check(s); allows Engineer override (`Bypass & Enter Show Mode (Logged)`) with a confirmation click.

---

## 5. Volunteer "Show Mode" Layout

Designed so a first-time volunteer can run an entire Sunday service using **one primary button** (`GO NEXT CUE`) and a small set of guarded quick controls.

```text
+-----------------------------------------------------------------------------+
| [●] Sunday 10:30 AM   [X32 OK] [Dante OK] [OBS LIVE 00:14:22] [Slides OK] [Cams OK]  [Show Mode ▾] |
+------------------------------------+----------------------------------------+
| SERVICE CUE STACK                  | QUICK SAFE CONTROLS                    |
|                                    |                                        |
|  ✓ 1. Pre-Service Loop             |  SLIDES (ProPresenter)                 |
| ────────────────────────────────── |  [ < Prev ]   [ Next > ]   [ Clear ]   |
|  ▶ 2. WELCOME & ANNOUNCEMENTS      |  Now: "Welcome Slide 2/4"              |
|     [Slides: Welcome] [Pastor: ON] | ────────────────────────────────────── |
|     [Cam 1: Wide]    [OBS: Stage]  |  AUDIO DCAs (Safe Mutes & ±3dB Trim)   |
| ────────────────────────────────── |  [Pastor Mic: ON]  [Worship Band: MUTE] |
|  NEXT ▶ 3. WORSHIP SET             |  [Media/Video: ON] [House Music: MUTE] |
|     [Slides: Song 1] [Band: ON]    | ────────────────────────────────────── |
|     [Cam 2: Worship] [OBS: Band]   |  CAMERA PRESETS (Tap to Switch)        |
|                                    |  [1: Stage Wide] [2: Pulpit Tight]     |
|    4. Sermon: "Hope"               |  [3: Worship Ctr] [4: Crowd/Keys]      |
|    5. Closing & Benediction        | ────────────────────────────────────── |
|                                    |  MULTI-BROADCAST (YT + FB + REC)       |
| [ ↶ Undo Last Cue ]                |  [● YT LIVE 5.8M]  [● FB LIVE 5.8M]    |
| [        GO NEXT CUE (Space)     ] |  [ Go Live All ] [Hold: Stop Streams]  |
+------------------------------------+----------------------------------------+
```

**Key Volunteer UX Rules:**
1. **No Raw Faders or Routing Matrices:** Volunteers see only named **DCA Mute/Unmute** toggles and optional `±3 dB` nudge buttons (clamped to safe Engineer-defined min/max bounds).
2. **One-Tap Camera Presets:** Named buttons (e.g., `Pulpit Tight`, `Stage Wide`) execute both the PTZ preset recall (on Preview first if configured, or direct cut with smooth transition) and optional tally update.
3. **Cue Preview:** The `NEXT` cue explicitly lists every cross-domain action it will trigger (e.g., `Slides`, `X32`, `OBS`, `Cam`) before the volunteer presses `GO NEXT CUE`.

---

## 6. Engineer Mode Layout

Accessible via the Top Status Bar (PIN-protected if Role Lock is enabled). Uses a dense, multi-panel layout with real-time telemetry.

### Sub-Views / Tabs
1. **Audio & Dante:**
   - **X32 Strip Bank:** 8/16-channel fader banks, DCA groups, Bus/Matrix sends, Channel Mute/Solo, and Scene/Snippet recall list.
   - **Dante Health & Routing:** Clock leader badge (`48kHz / 24-bit`), Primary/Secondary NIC status, latency histogram, and Rx/Tx crosspoint subscription matrix with conflict/error highlighting.
2. **Video, NDI & PTZ:**
   - **PTZ Control Deck:** Virtual pan/tilt/zoom joystick (supports hardware USB/MIDI joystick), speed slider, Exposure/White Balance/Focus lock controls, and **Preset Programmer** (move camera → `Long-Press / Save Preset #`).
   - **OBS / Streamlabs, Multi-Broadcast & NDI:** Scene list, Source visibility/audio mixer, Preview/Program bus, **Multi-Broadcast Output Panel** (independent YouTube Live & Facebook Live RTMPS destination status, bitrate/drop-frame graphs, per-platform start/stop/reconnect, and Keychain-backed stream keys), encoder CPU/GPU graph, and NDI source discovery list.
3. **Slides & Stage:**
   - ProPresenter/EasyWorship playlist browser, direct slide grid trigger, Stage Display layout switcher, and countdown timer controls.
4. **Cue & Macro Editor:**
   - Drag-and-drop cue stack builder. Each Cue can bundle parallel or staggered actions across all 5 domains (e.g., `T+0.0s: X32 Unmute Pastor`, `T+0.2s: PTZ Cam 1 → Pulpit`, `T+0.5s: OBS Cut to Pulpit`).
   - Built-in **"Test Cue (Dry Run / Safe)"** mode to verify targets without disrupting live audio/stream.

---

## 7. Live-Show Safety Guardrails

Production environments cannot tolerate single-click accidents. The following guardrails are enforced globally:

| Action Risk Tier | Examples | Guardrail Mechanism |
| :--- | :--- | :--- |
| **Tier 1: Safe / Reversible** | Next Slide, Switch Camera Preset, Next Cue | Single click; **Undo Last Cue** available for 10s (restores previous X32 mutes/DCAs, OBS scene, and PTZ preset). |
| **Tier 2: High Impact** | Mute Pastor Mic while active, Full X32 Scene Recall, Switch Dante Clock | **Two-Step Confirmation Modal** detailing exact impact (e.g., *"Recall Scene 'Sermon' — will reset 16 faders"*). |
| **Tier 3: Destructive / On-Air** | **Stop Livestream**, **Mute Main LR**, **Emergency Blackout** | **Hold-to-Confirm (1.5s progress ring)** button. Releasing early cancels safely. |

### Disconnected & Stale-State Indicators
- If any adapter loses connection (e.g., X32 OSC timeout > 2s, OBS WebSocket drop):
  - Its Top Bar pill pulses **Amber/Red** with `RECONNECTING...`.
  - Controls for that domain dim to `50%` opacity with a `STALE — LAST KNOWN` badge and lock out destructive writes until re-synced.
  - Background auto-reconnect runs with exponential backoff (`1s → 2s → 5s`) without blocking other domains.

---

## 8. Keyboard, Stream Deck & MIDI Trigger Mapping

### Default Keyboard Shortcuts
> *Safety Rule:* Single-key triggers (`Space`, `Right`) are **disabled** whenever a text input, search bar, or modal is focused, and can be locked behind `Ctrl/Cmd` in Engineer settings.

| Shortcut | Action | Scope |
| :--- | :--- | :--- |
| `Space` | **GO NEXT CUE** (with 400ms debounce to prevent double-fire) | Show Mode |
| `Cmd/Ctrl + Z` | **Undo / Revert Last Cue** | Show Mode |
| `Right Arrow` / `PageDown` | Next Slide (ProPresenter / EasyWorship) | Global (when unlocked) |
| `Left Arrow` / `PageUp` | Previous Slide | Global (when unlocked) |
| `1` – `8` | Trigger Camera Presets 1–8 | Show Mode |
| `Cmd/Ctrl + Shift + E` | Toggle **Show Mode ↔ Engineer Mode** (prompts PIN if locked) | Global |
| `Esc` | Cancel any open Hold-to-Confirm / Modal | Global |

### Stream Deck & MIDI Integration
- **Stream Deck (Companion / Native Plugin):**
  - Exposes bidirectional state: button icons and colors update live from app state (e.g., `OBS LIVE` button turns solid Red `#EF4444` with live timer; `Pastor Mute` reflects actual X32 DCA mute state).
  - Recommended 15-key Volunteer Layout:
    - Row 1: `GO NEXT CUE` (2x1 wide), `Undo Cue`, `Next Slide`, `Prev Slide`
    - Row 2: `Cam 1 Wide`, `Cam 2 Pulpit`, `Cam 3 Worship`, `Cam 4 Crowd`, `Clear Slides`
    - Row 3: `Pastor Mute`, `Band Mute`, `Media Mute`, `OBS Cut`, `Hold: Stop Stream`
- **MIDI / OSC Learn:**
  - Any Cue, DCA Mute, or Camera Preset in the Cue Editor supports `MIDI Learn` (Note On / CC) and custom incoming `OSC` path binding for foot pedals or hardware X-Touch/fader wings.
