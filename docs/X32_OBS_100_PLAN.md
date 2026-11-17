# Plan of Action: 100% Parity for Behringer X32-Edit & OBS Studio

**Baseline:** `v0.2.3-alpha` (X32 ~46% | OBS ~36%)
**Goal:** Close every remaining gap identified via REA inspection (`OBS/decompiled/`, `docs/re-findings/obs.md`, `docs/re-findings/x32.md`).

---

## Track A — Behringer X32-Edit (46% → 100%)

### Phase A1: Full Console Bi-Directional OSC & Sends-on-Fader
1. **Expand `x32_adapter.rs` & `x32.rs`:**
   - Add full `/ch/01..32/mix/fader`, `/ch/01..32/mix/on`, `/ch/01..32/preamp/gain`, `/ch/01..32/preamp/phantom`, `/ch/01..32/dyn/*`, `/ch/01..32/eq/*`, and `/bus/01..16/*` bidirectional `/xremote` subscription.
   - Add **`/meters/2`** & **`/meters/3`** (100-band RTA FFT bin parser) to stream live spectrum data to the UI.
2. **UI Upgrades in `X32FullConsoleModal.tsx`:**
   - **Sends on Fader** toggle: clicking any Bus (1–16) or Matrix (1–6) flips all 32 channel faders to display & edit send levels to that bus.
   - **100-Band RTA Overlay**: render live FFT spectrum bars behind the 4-band SVG Parametric EQ curve.
   - **Mute Groups (1–6) & Channel Link / Delay (`0–500 ms`)** bar.

### Phase A2: 8-Slot Stereo FX Racks & `.scn` Show File Engine
1. **8-Slot FX Rack UI + OSC (`/fx/1..8/type`, `/fx/1..8/par/*`):**
   - Hall/Plate Reverb, Stereo Delay, Dual 31-Band Graphic EQ, De-Esser, Wave Designer, Combinator.
2. **`.scn` Scene File Parser (`src-tauri/src/protocols/x32_scene.rs`):**
   - Parse & export Behringer `.scn` text files, channel/parameter safes, and Cue List automation.

---

## Track B — OBS Studio (36% → 100%)

### Phase B1: Interactive Canvas & Scene Collections (Pure TypeScript + Rust)
1. **Interactive Transform & Snapping Handles (`ProgramCanvasRenderer.tsx`):**
   - Click-to-select source bounding box, 8-point corner/edge resize handles, `Alt`-drag crop, and screen/center/source alignment snapping guides.
2. **Profiles & Scene Collections (`state.rs` + `BroadcastCanvasView.tsx`):**
   - Persist multiple named Scene Collections & Encoder Profiles (`1080p60 NVENC`, `720p30 x264`, etc.).
3. **Source Projectors:**
   - Right-click `Open Source Projector` launches a clean `SecondaryOutputWindow` dedicated to a single source.

### Phase B2: Real Replay Buffer, Audio DSP & Stinger Transitions (`obs_daemon.rs`)
1. **FFmpeg Rolling Replay Buffer:**
   - Run `ffmpeg -f segment -segment_time 5 -segment_wrap 6` into a temp ring buffer; clicking **Save Instant Replay** concatenates the last 30s into an `.mp4` clip.
2. **WebAudio / Rust Audio DSP Chain:**
   - Wire real WebAudio `BiquadFilterNode` (EQ), `DynamicsCompressorNode` (Compressor/Limiter), and `AudioWorklet` Noise Gate directly onto armed PC Mic & System Loopback streams.
3. **Stinger & Luma Wipe Transitions:**
   - Support alpha `.webm`/`.mov` stinger video overlay synced at the cut point of Studio Mode T-Bar.

### Phase B3: Native `libobs` Off-Screen GPU Compositor & Virtual Camera (Option 2)
1. **Headless `libobs` C-ABI Worker (`obs-worker` binary):**
   - Link `obs.dll` / `libobs.framework` in a dedicated sidecar process controlled via local IPC, giving One Ring native DirectX 11 / Metal compositing, **Game Capture**, **DeckLink/AJA SDI**, **CEF Browser Source**, **native `.vst3` / `.component` (AU) audio hosting**, and **Virtual Camera** (`CoreMediaIO` / `DirectShow`).
