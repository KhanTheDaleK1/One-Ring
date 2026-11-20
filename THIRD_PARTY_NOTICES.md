# Third-Party Notices

One Ring incorporates and adapts portions of the following open-source works, and integrates optionally with user-installed runtimes.

---

## Churchfront Video & Churchfront Kit
- **Upstream repositories:**
  - `https://github.com/Churchfront/churchfront-video`
  - `https://github.com/Churchfront/churchfront-kit`
- **License:** Apache License, Version 2.0 (`http://www.apache.org/licenses/LICENSE-2.0`)
- **Upstream Notice:**
  - Copyright 2026 Churchfront LLC
  - Portions of One Ring's hardware video switcher UDP `:9910` protocol adapter (`src-tauri/src/protocols/video_switcher.rs`, `src-tauri/src/runtime/video_switcher_adapter.rs`) and cross-platform dynamic-load LAN IP video runtime bridge (`src-tauri/src/runtime/ip_video_bridge.rs`) were adapted from these Apache 2.0 works.
  - "Churchfront" is a registered trademark of Churchfront LLC; the Apache 2.0 license does not grant permission to use it (Section 6), and One Ring does not use it in its UI, branding, or product naming.
  - Third-party hardware and video runtime trademarks belong to their respective owners; no proprietary SDK or runtime binary is bundled with One Ring.

---

## General-Legal / legal-templates
- **Upstream repository:** `https://github.com/General-Legal/legal-templates`
- **License:** CC0 1.0 Universal (Public Domain Dedication)
- **Note:** Structural foundation for One Ring's `PRIVACY.md` and `TERMS.md`.

---

## FFmpeg (Optional User-Downloaded Runtime)
- **License:** LGPL-2.1-or-later / GPL-3.0-or-later (`https://ffmpeg.org/legal.html`)
- **Note:** FFmpeg is not bundled inside One Ring installers. Operators may optionally install a standalone FFmpeg binary into `~/.onering/bin` or system `PATH` for headless streaming, recording, and MP4 remuxing.

---

## OpenCode CLI (Optional User-Downloaded Runtime)
- **License:** MIT License (`https://github.com/anomalyco/opencode`)
- **Note:** OpenCode CLI is not bundled inside One Ring installers. Operators may optionally install it locally for free local AI assistant support.
