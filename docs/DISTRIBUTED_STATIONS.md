# One Ring — Multi-Operator Distributed Station Architecture

## 1. Vision & Core Philosophy
Church production rarely runs from a single desk. On any given Sunday:
- An operator at the **FOH Media Booth** controls **Slides & Stage Displays**.
- A sound tech at the **Audio Console** manages **Audio Mixing & Mutes**.
- A streaming tech in the **Broadcast Suite** runs **Broadcasting, Encoders & Cameras**.
- A service director runs the master **Show Mode Cue Stack**.

With **One Ring**, operators do not need separate software or separate setups. Any computer running One Ring on the church network connects into the shared live production session with role-based station views and synchronized state.

---

## 2. Distributed Sync Model

### A. Local High-Speed LAN Sync (Sub-Millisecond Zero-Cloud Latency)
- **Local Leader & Mesh**: One machine acts as the primary hardware adapter host (or connects directly to the Behringer X32, Dante network, and OBS/cameras).
- **mDNS Auto-Discovery** (\`_onering._tcp\`): Any laptop or desktop opening One Ring automatically discovers the active venue session on the local network (local LAN subnet).
- **Real-Time Bidirectional Event Bus**:
  - Uses the Tauri v2 event runtime channels (\`device://health\`, \`state://slides\`, \`state://audio\`, \`meter://x32\`, \`cue://progress\`).
  - When the Slide operator triggers a slide advance, the Program output, Stage Display, and Broadcast Lower-Third update instantaneously across all connected screens.

### B. Account & Profile Cloud Sync
- **Venue & User Profiles**: Operators log into their church/venue account.
- **Synchronized Data**:
  - Saved Show Files (\`*.ring.json\`) and worship setlists.
  - Device endpoint configurations (X32 IP, Dante subnets, YouTube/Facebook RTMP keys).
  - Custom UI layouts, hotkey preferences, and PIN permissions.
- **Sit Anywhere**: A volunteer can log in on the booth laptop, the pastor's backstage tablet, or the sound booth Mac, and immediately receive their customized workspace.

---

## 3. Position Roles & Machine Lock Modes

In **Settings > Station & Account Setup**, each machine can be configured for its operational role:

| Position Role | Visible Tabs & Permissions | Description |
| :--- | :--- | :--- |
| **Master Show Control** | Show Mode, All Positions, Preflight | Full access for Tech Lead / Producer; triggers master cues, dry-run rehearsal, and overrides. |
| **Slides Station** | **Slides** only (optional Stage preview) | Locked view for lyric/scripture volunteer; big slide grid, timer controls, clear text buttons. |
| **Audio Mixing Station** | **Audio Mixing** only | Faders, DCA trims, channel mutes, Dante clock health, and live dBFS signal meters. |
| **Broadcasting & Cameras** | **Broadcasting** + **Cameras** | Video switcher, PTZ joystick/presets, dual-canvas preview (16:9 + 9:16), stream/record toggles. |
| **Backstage Confidence Monitor** | Stage Display (Full Screen) | Dedicated HDMI output for stage confidence / green room viewing. |

---

## 4. Blank Slate + Venue Show Files
- **Zero Hardcoded Assumptions**: Starts completely clean.
- **Show Templates**: Churches can create and save templates (e.g., *"Sunday Traditional Service"*, *"Sunday Contemporary Service"*, *"Wednesday Youth Night"*).
