# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary (Sunday / Live Service):** Church production volunteers (often non-technical) operating in a dim A/V booth, needing fast, unmistakable controls with guardrails against accidental live mistakes.
- **Secondary (Setup & Maintenance):** A lead tech or audio/video engineer who configures hardware endpoints, audio routing, RTMP destinations, Bible API keys, and display assignments beforehand via PIN-locked Engineer Mode.

## Product Purpose

One Ring unifies front-of-house slides, scripture projection, multi-destination live streaming, digital audio mixing, PTZ camera control, hardware video switching, and stage/audience monitoring into a single offline-first desktop application (Tauri v2 + Rust + React/TypeScript). Success means a volunteer can run an entire Sunday worship and teaching service calmly from one window without alt-tabbing between 4–6 separate apps or risking an on-air mishap.

## Positioning

One unified, offline-first desktop suite replacing 4–6 disconnected booth tools (slides, livestream, mixer, PTZ, video switcher) with a two-tier safety model: a calm, distraction-free volunteer **Show Mode** backed by a PIN-locked **Engineer Mode**, with zero cloud lock-in and zero recurring subscription gate.

## Operating Context

- **Physical environment:** Dim or dark A/V booths, often on compact or older booth monitors (`1024×768` and up) alongside secondary FOH projector and stage confidence displays.
- **Live service cadence:** Pre-service setup → Worship (rapid lyric cueing, section jumps, Clear Text / Clear All) → Welcome & Announcements → Teaching / Sermon (live scripture lookup, lower-thirds, PTZ camera presets with Preview-Only safety lock) → Closing & Recording remux.
- **Hardware & local network:** LAN-only device control (OSC/UDP consoles, hardware video switchers, IP video sources, PTZ cameras, MIDI controllers) plus local FFmpeg/native window capture.
- **Operator-triggered online extras:** Optional online lyric index, open-license & user-keyed scripture APIs, and local/bring-your-own-key AI Production Assistant (every AI action previews before going live).

## Capabilities and Constraints

- **Clean-room compliance:** Zero third-party product trademarks and zero bundled copyrighted modern lyrics or Bible text (enforced by `scripts/check_clean_room.py`). Licensed translations load only via official user-supplied publisher APIs or user-imported local XML/JSON Bible files.
- **Offline-first reliability:** Core live Sunday operations (slides, local hymns/songs, local Bibles, audio mixing, PTZ, switcher, recording) must work without internet access.
- **Cross-platform parity:** Ships native Windows and macOS installers from a single Tauri v2 + Rust + React/TypeScript codebase.
- **Safety guardrails:** Engineer Mode PIN locks destructive/routing changes; critical live actions (e.g. stream start/stop, blackout, clear) use explicit confirmation or hold-to-confirm affordances; PTZ supports Preview-Only lock so cameras never move while live on Program.

## Brand Commitments

- **Name:** One Ring.
- **Voice:** Calm, direct, volunteer-friendly booth terminology — clear action labels over jargon, zero hype or marketing filler inside the operator workspace.

## Evidence on Hand

- Live Tauri v2 + React/TypeScript codebase (`src/`, `src-tauri/`), 250+ Rust tests, IPC parity checks, and clean-room scanner (`scripts/check_clean_room.py`).
- No fabricated testimonials, customer counts, or third-party endorsements may be added to UI or docs.

## Product Principles

1. **Volunteer calm over engineer density:** Default surfaces (Show Mode) prioritize the next live action; deep configuration lives behind Engineer Mode.
2. **Never break Sunday morning:** Offline-first execution, explicit live/preview separation, and accidental-click protection outweigh visual novelty.
3. **One window, zero alt-tabbing:** Slides, scripture, broadcast, audio, PTZ, and switcher share coherent status cues and keyboard workflows.
4. **Legally clean by architecture:** Never bundle copyrighted content or third-party trademarks; empower churches with open standards, official user-keyed APIs, and local file import.
5. **Booth-grade legibility:** Every control must remain scannable, reachable, and unambiguous in a dim booth at `1024×768` and above.

## Accessibility & Inclusion

- Supports narrow booth displays (`1024×768`+) without clipped primary cue controls.
- Includes **High-Contrast Booth Mode** and configurable **UI Scale** in Settings for low-light visibility.
- Full keyboard navigation for live slide cueing (arrow keys, Escape to close modals, keyboard-operable hold-to-confirm buttons) and ARIA landmarks/labels across modals and controls.
