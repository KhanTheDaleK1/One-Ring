# UX Audit — One Ring (volunteer-facing copy & flow)

**Scope:** `src/App.tsx` and all 27 files in `src/components/*.tsx`
**Personas:** Sunday volunteer (execution) and tech director (configuration)
**Verdict:** The bones are good — strong dark-room palette, clear active/up-next states, real safety thinking (guard mutes, hold-to-stop). The problems are almost all **copy** and **where things live**, plus a few **unreachable screens**.

---

## 1. Confusing / overly technical verbiage

### 1.1 Worst offenders (fix first)

| Location | Current wording | Problem | Suggested |
| --- | --- | --- | --- |
| `EngineerView.tsx:34-38` | `OBS 33 / SLOBS Dual-Canvas & Chapters` | "OBS 33" reads like a version nobody has; "SLOBS" is unexplained slang | `Streaming & Recording` |
| `EngineerView.tsx:35` | `X32 Mixer & Beltpack Fault Sim` | "Beltpack Fault Sim" sounds like an error, not a test tool | `Sound Desk & Mic Check` |
| `EngineerView.tsx:36` | `Dante ARC RXSTATUS & Conmon :8751` | Three acronyms + a port number in a tab label | `Audio Network` |
| `EngineerView.tsx:37` | `NDI 6 Receiver Matrix (:5959)` | Protocol + port as navigation | `Screens & Cameras` |
| `EngineerView.tsx:38` | `Unified Protocol & Cue Event Log` | Reads like a backend class name | `Activity Log` |
| `App.tsx:320` / `EngineerView.tsx:171` | `Simulate Pastor Beltpack Fault (Dante 0xFE)` / `Clear Simulated Beltpack Fault` | Raw protocol byte in a button; "fault" implies something is broken | `Test the silent-mic alert` / `End mic test` |
| `PreflightView.tsx:27` | `Pre-Service Executable Readiness & Topology Proof` | Nobody says "topology proof" | `Sunday Readiness Check` |
| `PreflightView.tsx:40,54` | `Re-Probe All`, `6/6 PROBES VERIFIED` | "Probe" is network-speak; hard-coded "6/6" breaks when checks change | `Check again`, `6 of 6 checks passed` |
| `PreflightView.tsx:93` | `Evidence: …` | Implies an incident report | `Detected:` |
| `SettingsView.tsx:803-814` | `IPC command: update_settings`, `Backend: src-tauri/src/state.rs`, `app_config_dir()/settings.json` | Source code paths in a user-facing settings panel | Delete the panel, or hide behind "Advanced" |
| `SettingsView.tsx:454,489,493` | `Clock Sync Warning Thresholds`, `Multi-RTMPS Destinations`, `RTMPS ingest URL` | Assumes networking background | `Audio clock warning`, `Stream destinations`, `Stream address` |
| `EngineerView.tsx:244` | `Identify Device (0x0063)` | Hex code leaks into the label | `Flash this device's light` |
| `VideoCanvasView.tsx:83,187` | `VISCA over IP :52381`, `VISCA Preset #` | Protocol + port for a camera preset | `Camera control` / `Preset 3` |
| `UpdateModal.tsx:109` | `New Revision Available` | "Revision" is engineering vocabulary | `Update available` |

### 1.2 Acronyms with no explanation

These appear in primary UI (not tooltips) with no gloss and no glossary anywhere:

- **Audio:** `DCA` (Show Mode: "AUDIO DCAs · SAFE MUTES & ±3 dB TRIM", `ShowModeView.tsx:610`; Show Builder "Audio Channels / DCAs"), `dBFS`, `PTP`, `OSC`, `Conmon`, `ARC`, `DB25/subnet interface`, `keepalive`.
- **Video/network:** `NDI`, `SMPTE HD`, `EBU 75%`, `mDNS`, `224.0.0.251:5353`, `RX/TX`, `crosspoint`, `tally`, `PGM/PVW`.
- **Streaming:** `RTMP(S)`, `NVENC`, `VideoToolbox`, `x264`, `MKV`, `alpha channel`, `lower third`, `FOH`.
- **Presentation:** `CCLI`, `OAuth client ID/secret`, `ChordPro`.

Minimum fix: one `<HelpTip>`/`<abbr title>` wrapper used consistently, plus a plain-English gloss on first use ("DCA — a group of channels on one fader").

### 1.3 Confidence-damaging copy

- `App.tsx:157` — `Loading One Ring...` is the entire loading state (no logo, no progress, no "connecting to sound desk").
- `EngineerView.tsx:155` — describes the feature as *"injecting a simulated `0xFE` (`<-90 dBFS`) beltpack mute while DCA 1 is unmuted"* — a developer's test plan pasted into the UI.
- `ShowModeView.tsx:320` — `4/4 POST-CONDITIONS APPLIED`; `:1031` — `Tier 3 action: release early to cancel safely.` "Tier 3" is an internal risk model; volunteers have no way to learn the tiers.
- `ShowBuilderView.tsx:577-582` — `Risk tier: 1 — Safe / 2 — High impact / 3 — On-air destructive`. Label as `What happens if this cue is wrong?` with plain options.
- `BroadcastCanvasView.tsx:223` — `● Option 2 Core Active` (strings from an internal comparison doc).
- `PairingPrompt.tsx:67` — `Found another One Ring instance on your network`; "instance" → "another One Ring computer".
- `DanteControllerMatrix.tsx:415` — `LOCKED (±0.002 ms)` reads as if the user must verify a tolerance.
- `EngineerView.tsx:196` — `UNMUTED (LIVE)` on a mute button is ambiguous about what a click will do.
- `SettingsView.tsx:242` says settings are written automatically, but `:277` also has an explicit `Save Configuration` button and `:150` reports `Saved to AppState — persisted by the Rust backend.` — three competing stories about saving.

---

## 2. Layout & flow issues

### 2.1 Broken navigation (highest severity)

1. **`PreflightView` is imported but never rendered** (`App.tsx:13`). The readiness gate described in `docs/UX_DESIGN.md` does not exist at runtime. Same for **`ShowBuilderView`**, which isn't imported at all — cues, DCAs, camera presets and show-file import are unreachable.
2. **The welcome tour navigates to invalid modes.** `App.tsx:558` accepts `preflight | show | engineer | settings`, but `ViewMode` is only `mixing | video | slides | broadcast | master | settings` (`types.ts:69-71`). Tour steps use `audio` and `show` (`WelcomeTour.tsx:72,102`), so "Continue" from the Audio/Broadcast/Master steps sets a mode that renders **nothing below the header** — a blank screen.
3. **The first screen a volunteer sees is the engineer view.** `useState<ViewMode>("mixing")` (`App.tsx:32`) lands on the densest technical canvas. Show Mode is four clicks away under a tab labelled "Master".
4. **Tab names don't match the mental model:** `Mixing` (actually the device/engineer console), `Master` (actually the volunteer run screen). Volunteers won't guess that "Master" means "run the service".

### 2.2 Engineer view duplicates itself

- `DanteControllerMatrix` is rendered *unconditionally* at the bottom of `EngineerView` (`:342`), so it appears again underneath the Broadcast, Audio, NDI and Log tabs, not just the "Dante" tab. Two large matrices on one screen on the Dante tab.
- `X32FullConsoleModal` is mounted with `showFullX32` state that is **never set to `true`** (`EngineerView.tsx:27,350`) — the full console is dead UI.
- Tab labels are so long the row wraps to 2–3 lines on a 1366×768 laptop before any content is shown.

### 2.3 Header and global chrome

- `App.tsx:165-298` squeezes brand + editable show name + venue tag + one health pill per service domain + 5 nav tabs + Settings into a single fixed 64 px row. With 5+ health domains the pills overflow and squeeze the navigation.
- Health pills show `{latencyMs}ms` as the primary numeric (`:242`) and put `protocol — detail` only in a `title` tooltip. A volunteer sees "Dante 3ms" and has no idea whether that's good, or what Dante is.
- The header has no "is it safe to go live?" summary — the one question every volunteer has.

### 2.4 Alert banner conflates real and simulated faults

`App.tsx:301-326`: the silent-pastor-mic banner is a full-width red bar with a destructive-looking button ("Clear Simulated Beltpack Fault") shown to **everyone**, on every tab, in every environment. A real mic failure and a test injection look identical.

### 2.5 Inconsistent safety on destructive actions

| Action | Guard |
| --- | --- |
| Stop all streams (Show Mode) | Hold 1.5 s ✅ |
| **Go live** (Show Mode, `:1004`) | Single click ❌ |
| Start / stop stream (Broadcast view, `:590-621`) | Single click both ways ❌ |
| Mute pastor mic | 2-step dialog ✅ |
| Delete a source / song | Single click, no undo ❌ |

Starting a stream to the wrong destination is at least as costly as stopping one, and it's the unguarded action.

### 2.6 Dead or fake controls

- `VideoCanvasView.tsx:239-355`: the entire PTZ D-pad and both Zoom buttons have **no `onClick`**. Volunteers press them and nothing happens, with no disabled styling.
- Camera "previews" are placeholders (`[IP Video Stream: 1080p60 NDI]`, `:183`), so the multiview can't actually be used to choose a shot.
- `ShowModeView.tsx:908` hard-codes `NDI 120ms` as if it were live telemetry; `:929` hard-codes `OBS 33 • 1920×1080 @ 60fps`; `BroadcastCanvasView.tsx:692` hard-codes `60.0 fps • CPU 4.2%`. Fake green numbers erode trust when the real stream is struggling.

### 2.7 Long single-row toolbars

- `SlidesCanvasView.tsx:194-362`: eight controls (FOH / Lower 3rds / Stage / Scripture / Timers / Theme / Clear / Paste lyrics) in one ungrouped flex row, all visually equal weight. Group into **Screens ▾**, **Content ▾**, and keep **Go live with lyrics** as the one blue button.
- `BroadcastCanvasView.tsx:200-264`: `Launch Headless Media Core`, `Studio Mode`, and `+ Add Source (All 15 OBS Types)` compete in the same row; the first two are advanced and should live in a menu.
- `VideoCanvasView.tsx:359`: the full `NdiStudioTools` panel (router matrix, discovery server, SMPTE bars, tone generator) is appended below the camera view, making that tab several screens tall for a volunteer.

### 2.8 Nagging and re-entry

- `PairingPrompt` is driven by a 2.5 s poll (`App.tsx:83-91`) and `dismissedPeers` is in-memory (`:36`), so the prompt returns after every reload. It also floats over whatever modal the user is in.
- The welcome tour cannot be reopened (no entry in Settings) and has no "don't show again" checkbox separate from completing it.

### 2.9 Settings honesty

- No "Test connection" / "Flash light" action next to mixer IP, Dante interface, camera ranges — a volunteer can't tell they typed the wrong IP until the service starts.
- `SettingsView:487-532` lists destinations as `YouTube Live (youtube-m1abc)` — raw generated IDs in titles.
- `SettingsView:585-607` asks for "OAuth client ID / secret" with no link or explanation of why a church needs it.

---

## 3. Top 5 quick UX wins

### 1. Repair navigation, then make Show Mode the front door
**Effort: ~1 h · Impact: critical**

- Render `PreflightView` and `ShowBuilderView` in `App.tsx` (add `"preflight"` to `ViewMode` and a `"showbuilder"` route, or mount the builder inside Settings/an Engineer tab).
- Change every tour `tabKey` to a real `CanvasId` (`audio` → `mixing`, `show` → `master`, add `preflight`), and drop the silent `if ([...].includes(tabKey))` guard that currently swallows bad values.
- Default `mode` to Show Mode for a fresh profile; keep the engineer canvas one click behind a labelled tab.
- Rename tabs: `Mixing → Tech Booth`, `Master → Live Show`, `Slides → Lyrics`, `Broadcast → Stream`.

### 2. Copy pass on the 10 highest-traffic strings
**Effort: ~1 h · Impact: high**

Rewrite the 5 engineer tabs, the 5 top-level tabs, the preflight headline (`Sunday Readiness Check`), the health-pill labels, the beltpack test button, and `New Revision Available`. Keep the existing technical detail, move it into a `Technical details` disclosure on each panel instead of the title. A copy-only PR — no layout risk.

### 3. Make test mode obviously a test
**Effort: ~30 min · Impact: high**

- Add a persistent amber chip in the header when `state.mockMode` is true: `Practice mode — nothing is sent to your equipment`.
- Move the beltpack simulation into Engineer → Sound Desk behind a confirm, relabel to `Test the silent-mic alert`, and remove "Clear Simulated…" from the global red banner. The banner gets `Dismiss` + `Show me which mic`, nothing else.
- Never render an alert that a real fault and a simulated fault share.

### 4. One `HelpTip` component + plain-language health strip
**Effort: ~2 h · Impact: high**

Create `src/components/HelpTip.tsx` (an `ⓘ` with `<abbr>` + one-sentence plain gloss) and apply it to the ~25 acronyms listed in §1.2. Same PR: replace the per-domain health pills with three words volunteers understand — `Sound`, `Video`, `Internet` — each a dot plus a word, with the protocol/latency moved into the tooltip. Turns the header from a network dashboard into a traffic light.

### 5. Destructive-action parity
**Effort: ~1 h · Impact: high**

- Wrap `Go Live` (`ShowModeView.tsx:1004`) and stream start (`BroadcastCanvasView.tsx:590`) in the existing `HoldConfirmButton`; both already have a hold-to-*stop*, so the pattern exists.
- Add undo or a confirm to `Remove Source`, `Delete cue`, and `Remove song` (the toast system in `BroadcastCanvasView` is already there for "Undo").
- Meanwhile, delete the dead PTZ handlers or wire them up — a control that does nothing is worse than a hidden one.

---

## Appendix — quick reference

| Concept | Internal term | Volunteer term |
| --- | --- | --- |
| Engineer console | `mixing` | Tech Booth |
| Show execution | `master` | Live Show |
| Preflight | `preflight` / "probes" | Sunday Readiness Check |
| DCA | DCA | Channel group |
| Beltpack fault sim | `0xFE`, `Beltpack Fault Sim` | Silent-mic test |
| NDI receiver | `NDI RX` / crosspoint | Screen / display |
| RTMPS destination | ingest URL | Stream destination |
| PTP grandmaster | PTPv2 grandmaster | Audio clock |
| Risk tier | Tier 1/2/3 | What happens if this is wrong? |
