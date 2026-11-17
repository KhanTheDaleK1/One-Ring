# EasyWorship 7.4.1.9 Clean-Room Protocol & Interoperability Specification

**Target Analyzed:** `EasyWorship_V7.4.1.9.exe` (Inno Setup 6.1.0 Unicode installer)  
**Platform / Runtime:** Windows x86 (PE32) + x86_64 PowerPoint hook helper (PE32+)  
**Compiler / Frameworks:** Embarcadero Delphi (VCL + FireMonkey FMX DX9/DX11 + Agg2D vector engine)  
**Clean-Room Provenance:** Derived strictly from installer unpacking, PE import/export/resource/hardening analysis (`rea`), read-only SQLite schema/structure inspection, CHM technical documentation, and binary wire-protocol verification. Zero proprietary source code, decompiled code bodies, embedded API subscription keys, or copyrighted lyrics/media assets are reproduced in this document.

---

## 1. Installer, Process Topology & Bundled Frameworks

### 1.1 PE Binaries & Security Hardening Inventory

| Binary / Module | Arch / Bits | Role | SHA-256 (prefix) | Hardening (`ASLR` / `DEP` / `CFG` / `Signed`) | Notable Exports |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `EasyWorship.exe` | x86 / 32-bit | Primary presenter, live/alt/foldback compositor, Remote TCP/mDNS server, MIDI, NDI | `f2b4bb4253d3` | `ASLR=on`, `DEP=on`, `CFG=off`, `Signed=yes` | Delphi runtime (`dbkFCallWrapperAddr`, `TMethodImplementationIntercept`) |
| `EasyWorshipHelper.exe` | x86 / 32-bit | Background worker: media transcoding/metadata probe, auto-updates, CCLI usage auto-reporting | `3b0917dfa147` | `ASLR=on`, `DEP=on`, `CFG=off`, `Signed=yes` | Delphi runtime markers |
| `ezwHookpp.32.exe` / `.64.exe` | x86 (32) / x86_64 (64) | Architecture-matched out-of-process PowerPoint / Viewer hook coordinator | `39679ee4de69` / `1afa066e2170` | `ASLR=on` (+`HighEntropyVA` on 64), `DEP=on`, `Signed=yes` | Delphi runtime markers |
| `sdHookpp.32.dll` / `.64.dll` | x86 (32) / x86_64 (64) | `SetWindowsHookExW` injector targeting PowerPoint slide show windows (`POWERPNT.EXE` / `PPTVIEW.EXE`) | `c9a8ad35e598` / `5b9e906eb123` | `ASLR=on`, `DEP=on`, `Signed=yes` | `LoadPowerPointHook`, `UnLoadPowerPointHook` |
| `sdHookDX.32.dll` / `.64.dll` | x86 (32) / x86_64 (64) | DirectX (`D3D9`/`D3D10`/`D3D10_1`/`D3D11`) Present interceptor capturing slide frames via shared surface handles | `96412aa618af` / `ac0adb116f88` | `ASLR=on`, `DEP=on`, `Signed=yes` | `InitHooks`, `SetOutputRect` |
| `sslsparser2.dll` | x86 / 32-bit | CCLI SongSelect WebView2 DOM/text lyric & metadata parser (`Plugins/Extensions/`) | `67a1278a71e1` | `ASLR=off`, `DEP=off`, `CFG=off`, `Signed=no` | `ParseLyrics`, `GetLabel`, `CompareLabel`, `GetDLLDataInstanceCount`, `ParseJavaScriptResultForSongData`, `GetSongSelectParserJS` |
| `Processing.NDI.Lib.x86.dll` | x86 / 32-bit | Bundled NewTek/Vizrt NDI SDK runtime (under `app/NDI/x86/` alongside `av*-ndi-*` & IPCam plugins) | `c7cab1cf5e3e` | `ASLR=on`, `DEP=on`, `CFG=on`, `Signed=yes` | 116 `NDIlib_*` exports (`NDIlib_send_*`, `NDIlib_recv_*`, `NDIlib_find_*`, `NDIlib_framesync_*`) |
| `WebView2Loader.dll` | x86 / 32-bit | Microsoft Edge WebView2 loader (`MicrosoftEdgeWebview2Setup.exe` bundled in installer `tmp/`) | `58adea8c6896` | `ASLR=on`, `DEP=on`, `CFG=on`, `Signed=yes` | `CreateCoreWebView2Environment`, `CreateCoreWebView2EnvironmentWithOptions`, `GetAvailableCoreWebView2BrowserVersionString`, `CompareBrowserVersions` |
| `sqlite3.dll` | x86 / 32-bit | Core SQLite engine paired with ICU 60 (`icudt60.dll`, `icuin60.dll`, `icuuc60.dll`) | `8260ff654619` | `ASLR=on`, `DEP=on`, `CFG=on`, `Signed=yes` | 202 `sqlite3_*` exports |

> **Browser Engine Note:** EasyWorship 7.4.1.9 does **not** bundle CEF (Chromium Embedded Framework). Embedded web slides, SongSelect auth/import, and store integration use **Microsoft Edge WebView2** (`WebView2Loader.dll`, `SD.WebBrowser.WebViewExt.Win`).

### 1.2 Bundled Media, Graphics, Networking & Interop Libraries

Observed via extracted files, PE imports (`d3d9.dll`, `d3dx9_43.dll`, `dsound.dll`, `winmm.dll`, `wsock32.dll`, `winhttp.dll`, `wininet.dll`, `Avrt.dll`, `DWMAPI.DLL`), and Delphi `PACKAGEINFO` unit inventory (`1,441` compiled units in `EasyWorship.exe`):

* **Video Decode / Playback (`app/FFmpeg4/` & `app/DScaler5/`):**
  * FFmpeg 4 libraries: `avcodec-58.dll`, `avdevice-58.dll`, `avfilter-7.dll`, `avformat-58.dll`, `avutil-56.dll`, `swresample-3.dll`, `swscale-5.dll` (hardware decode paths for Intel QuickSync Video and NVIDIA CUVID; `SDL2Stubs`).
  * DVD MPEG-2 codecs (`app/DScaler5/`): `GenDMOProp.dll`, `MpegAudio.dll`, `MpegVideo.dll`.
* **2D/3D Rendering & Audio:**
  * Direct3D 9 / D3DX (`d3d9.dll`, `d3dx9_43.dll`) + HLSL Shader `.dfx` slide transitions (`SD.DXDFXFile`, `SD.PixelShaderWriter`).
  * `Agg2D` (`Agg*` units) software vector/text rasterizer + TrueType/FreeType glyph cache for slide text/shapes and remote preview/thumbnail rendering.
  * DirectSound 8 (`dsound.dll`, `SD.AudioContext.DS8`) + MMCSS (`Avrt.dll`) + `winmm.dll` (for MIDI I/O).
* **Capture / Live Feed Inputs (`SD.Feed*` units):**
  * **DirectShow** (`SD.FeedDirectShow`, `SD.FeedDirectShowPlayer`) — UVC / WDM webcams and capture cards.
  * **Blackmagic DeckLink** (`DeckLinkAPI_TLB`, `SD.FeedBlackMagic`, `SD.FeedBlackMagicPlayer`) — SDI/HDMI capture via Blackmagic COM SDK.
  * **NDI Receiver** (`SD.FeedNDI`, `SD.FeedNDIPlayer`, `NDIlib_find_*`, `NDIlib_recv_*`, `NDIlib_framesync_*`) — Network NDI streams as live slide/background feeds (`ezMID:NDI@` feed IDs, plus PTZ and NDI recording API bindings).
* **Networking & IPC:**
  * **Indy (`Id*`)**: `TIdCustomTCPServer` (Remote Control Server), `TIdTCPClient`, `TIdUDPClient`, `TIdSNTP`.
  * **Apple Bonjour (`dnssd.dll` dynamic loader)**: `SD.BonjourApi.WIN` dynamically binds `DNSServiceRegister`, `DNSServiceBrowse`, `DNSServiceResolve`, `TXTRecord*` for `_ezwremote._tcp` discovery.
  * **`Cromis.Comm.IPC` & `SD.PipeHelper`**: Named pipes connecting `EasyWorship.exe`, `EasyWorshipHelper.exe`, and `ezwHookpp.{32,64}.exe`.
* **Reporting, Compression & Spellcheck:**
  * `QuickReport` (`QRCtrls`, `QRPDFFilt`, `QRXLSXFilt`) + `Synopse` (`SynPdf`, `SynZip`, `SynLZ`, `SynCrypto`).
  * `Addict` spellchecker with `american.adm` and `autocorrect.adu`.

### 1.3 Local Multi-Process IPC (`\\.\pipe\*`)

| Pipe / Mutex Name | Direction | Wire Keys / Mechanism | Purpose |
| :--- | :--- | :--- | :--- |
| `\\.\pipe\EZW_PIPE` | Helper/External → `EasyWorship.exe` | `Cromis.Comm.IPC` messages with `RequestType`, `Result`, `MessageID`, `MessageValue`, `CommandLineFile` | Command-line file open routing (`.ewsx`, etc.) and helper notifications to main GUI process |
| `\\.\pipe\EZW_HELPER_PIPE` | `EasyWorship.exe` → `EasyWorshipHelper.exe` | `RequestType`, `ProfileName`, `RecType`, `RowID`, `MessageID`, `MessageValue` | Enqueue background jobs (media hash/probe, thumbnail/layout checks, database tasks) for the active profile |
| `\\.\pipe\EZW_HOOKPP_PIPE` + Mutex `EZW_HOOKPP_MUTEX` | `EasyWorship.exe` ↔ `ezwHookpp.{32,64}.exe` | Coordinates hooking `POWERPNT.EXE` / `PPTVIEW.EXE` (`Slide Show` / `paneClassDC`) | Spawns `sdHookpp.{32,64}.dll` → `sdHookDX.{32,64}.dll`, shares captured DX texture via `SharedHandle` / `SharedName` (`EZW_SURFACE_BRIDGE-...`), `SharedWidth`, `SharedHeight`, `SharedFormat` |

---

## 2. On-Disk Storage, Databases & Archive Formats

EasyWorship 7 stores profile libraries under `%PUBLIC%\Documents\Softouch\EasyWorship\<Profile>\` (`v6.1\Databases\Data\`, `Resources\`) and machine/application configuration under `%ProgramData%\Softouch\EasyWorship.v7\Settings\`. All SQLite databases use a custom registered ICU-backed case-insensitive Unicode collation named **`UTF8_U_CI`** (`icudt60`/`icuin60`/`icuuc60.dll`). External readers opening databases with standard SQLite must register a `UTF8_U_CI` collation stub (e.g., `NOCASE` or Unicode casefold) before querying indexed text columns or executing writes.

### 2.1 Library & Settings SQLite Database Catalog

| Database File | Purpose | Core Tables |
| :--- | :--- | :--- |
| `Songs.db` | Master song metadata index | `song`, `revision` |
| `SongWords.db` | RTF slide lyrics & per-slide revision vectors | `word` |
| `SongKeys.db` | Inverted full-text search index for songs | `word_key`, `word_list` |
| `SongHistory.db` | CCLI & local usage activity audit log | `action`, `song`, `revision` |
| `Media.db` | Videos, images, audio, DVD bookmarks, live capture feeds | `media`, `media_dvd`, `dvd_disk`, `dvd_pc`, `dvd_mac`, `media_feed`, `feed_pc`, `effect`, `effect_property`, `revision` |
| `MediaKeys.db` | Inverted search index for media | `word_key`, `word_list` |
| `Presentations.db` | Slide deck library items (`file_item_uid` / `.ewpx` links) | `file_item`, `revision` |
| `PresentationKeys.db` | Inverted search index for presentations | `word_key`, `word_list` |
| `Themes.db` | Song, Scripture, and Presentation theme catalog (`presentation_type`) | `file_item`, `revision` |
| `ThemeKeys.db` | Inverted search index for themes | `word_key`, `word_list` |
| `PresentationLayouts.db` | Complete slide/element/resource/property graph backing Presentations & Themes | `info`, `presentation`, `slide`, `element`, `resource`, `resource_*`, `*_property`, `*_property_group`, `file`, `token` |
| `Collections.db` | Smart/manual collections & filter rules | `collection`, `detail`, `condition` |
| `Users.db` | Profile user records & login stats | `user` |
| `Alerts.db` | Nursery/Message/Stage alert templates, countdown tokens & service interval windows | `alert`, `alert_token_link`, `token`, `interval`, `revision` |
| `ServiceIntervals.db` | Scheduled start/end times for service interval clocks | `interval` |
| `Thumbnails.db` | Cached JPEG/image thumbnails (`item_type`, `item_id`, `slide_uid`, `thumbnail_size`) | `info`, `thumbnails` |
| `WordWrapCache.db` | Precomputed Bible/scripture line-break caches | `word_wrap_cache` |
| `Shapes.db` | Custom DrawingML shape definitions | `category`, `file`, `file_category`, `shape_item`, `word_key`, `word_list` |
| `Bibles.db` | Installed Bible translation registry (`translation_id`, `translation_abbrv`) | `bible` |
| `RemoteControlClients.*.db` | Paired remote control devices & capability bitmasks | `client` |
| `MIDIControls.*.db` | MIDI Input/Output device bindings & Ableton export preferences | `midicontrol`, `midicontrol_out`, `midiexport` |
| `*.settings.db` (`Live.Settings.db`, `Alt.Settings.db`, `Foldback.Settings.db`, etc.) | Per-library UI column widths and output monitor/theme settings | `layout_setting`, `library_setting`, `setting`, `setting_data` |
| `updates.2.db` | Application updater state (`%ProgramData%\...\Plugins\Updates\`) | `update_info` |

### 2.2 Detailed Core SQLite Schemas

#### `Songs.db` & `SongWords.db` (`page_size = 1024`)

* **`Songs.db` → `song`**:
  * `rowid` (`integer PRIMARY KEY AUTOINCREMENT`), `song_item_uid` (`text UNIQUE`), `song_rev_uid` (`text`), `song_uid` (`text`)
  * `title` (`text NOT NULL COLLATE UTF8_U_CI`), `author`, `copyright`, `administrator`, `tags`, `reference_number` (`text COLLATE UTF8_U_CI`) — `reference_number` holds the CCLI Song #
  * `description` (`text`), `provider_id` (`integer DEFAULT -1`), `vendor_id` (`integer`), `presentation_id` (`integer` FK-equivalent to `PresentationLayouts.db` custom per-song layout), `layout_revision` (`integer DEFAULT 1`), `revision` (`integer DEFAULT 1`)
* **`SongWords.db` → `word`**:
  * `rowid` (`integer PRIMARY KEY`), `song_id` (`integer` matching `Songs.db.song.rowid`), `words` (`rtf` — Rich Text Format containing slide breaks and label markers), `slide_uids` (`text`), `slide_layout_revisions` (`int64a` packed 64-bit integer array), `slide_revisions` (`int64a` packed 64-bit integer array).
* **Full-Text `*Keys.db` (`word_key` + `word_list`)**:
  * `word_list(rowid, word)` and `word_key(link_id, word_list_id, field_flag)`.

#### `Media.db`, `Presentations.db` & `Themes.db`

* **`Media.db` → `media`**:
  * Identifiers: `rowid`, `media_uid` (`text UNIQUE`), `media_type` (`int8`), `title`, `author`, `copyright`, `description`, `tags`
  * File storage: `folder`, `path`, `filename`, `file_hash`, `filesize` (`int64`), `modified_date` (`datetime`), `alias_filename`, `location_flag` (`integer DEFAULT 1`)
  * Playback/Trim: `aspect_type` (`int8`), `width`, `height`, `start_pos`, `end_pos`, `poster_frame_pos`, `duration` (`int64`), `mute` (`boolean`), `volume` (`integer DEFAULT 100`), `repeating` (`boolean`), `repeating_type` (`int8`), `usage_type` (`int8`), `alpha_channel_mode` (`int8`)
  * Codec probe metadata: `want_mediainfo`, `video_stream_count`, `audio_stream_count`, `video_stream_type` (`DEFAULT -1`), `audio_stream_type` (`DEFAULT -1`), `audio_stream_profile` (`DEFAULT -1`)
  * Related tables: `media_dvd` + `dvd_disk` + `dvd_pc`/`dvd_mac`, `media_feed` (`feed_type int8`, `thumbnail png`) + `feed_pc` (`device_name`, `device_uid`, `video_standard`, `color_compression`, `frame_rate`, `input_port`, `field_dominance`), `effect` (`effect_uid`) + `effect_property` (`efffect_id`, `key`, `value`).
* **`Presentations.db` & `Themes.db` → `file_item`**:
  * `rowid`, `file_item_uid` (`text UNIQUE`), `presentation_type` (`int8`, present in `Themes.db` to distinguish Song vs Scripture vs Presentation themes), `presentation_id` (`integer` → `PresentationLayouts.db`), `title`, `author`, `copyright`, `description`, `tags`, `folder`, `path`, `filename`, `file_hash`, `filesize`, `modified_date`, `alias_filename`, `aspect_ratio`, `duration`, `location_flag`, `file_based` (`boolean DEFAULT 1`), `layout_revision`, `revision`, `ready`, `error_no`, `error_msg`, `vendor_id`.

#### `PresentationLayouts.db` (and Packed `main.db` inside Schedules/Presentations/Themes)

Observed schema version in `info`: `version = '7.4.1.3'`, `version_min = '6.5.1.0'`. Every presentation, schedule, and theme shares this relational layout:

1. **`presentation`**: `rowid`, `presentation_uid`, `presentation_rev_uid`, `presentation_global_uid`, `presentation_type` (`int8`; observed in demo DB: `8`, `12`, `13`, `14`), `aspect_ratio`, `group_level`, `order_index`, `thumbnail_slide_id`, `layout_revision`, `thumbnail_desired_rev`, `thumbnail_rev`, `thumbnail` (`jpeg`), `auto_theme` (`boolean`), `looping` (`boolean`), metadata (`title`, `author`, `copyright`, `administrator`, `description`, `tags`, `reference_number`, `provider_id`, `vendor_id`, `notes`, `modified_date`, `ready`, `error_no`).
2. **`slide`**: `rowid`, `presentation_id` (FK), `title`, `slide_uid`, `slide_rev_uid`, `order_index`, `layout_flag`, `theme_id`, `theme_slide_uid`, `modified_theme_id`, `modified_theme_layout_revision`, `layout_revision`, `thumbnail_desired_rev`, `thumbnail_rev`, `thumbnail` (`jpeg`).
3. **`element`**: `rowid`, `slide_id` (FK), `element_uid`, `element_type` (`int8`; observed `0, 1, 2, 5, 6`), `element_style_type` (`int8`; observed `0, 3..8`), `order_index`, normalized coordinates (`x`, `y`, `width`, `height` `double`), `background_resource_id` (FK → `resource`), `foreground_resource_id` (FK → `resource`), `shape_resource_id` (FK → `resource`), `internal_mute` (`boolean`), `from_master` (`boolean`).
4. **`resource` & Typed Subtables** (observed `resource_type`: `1, 2, 6, 8, 9, 13`):
   * `resource(rowid, resource_hash, resource_uid, resource_type, title, author, copyright, description, tags)`
   * `resource_color(resource_id, color integer)`
   * `resource_gradient(resource_id, angle integer, transparent boolean)` + `resource_gradient_color(resource_id, color_from, color_to, percent_from, percent_to, ramp)`
   * `resource_image(resource_id, file_id, original_filename, filesize, modified_date, width, height)`
   * `resource_video(resource_id, file_id, original_filename, filesize, modified_date, start_pos, end_pos, poster_frame_pos, width, height, duration, repeating, alpha_channel_mode, video_stream_count, audio_stream_count, video_stream_type, audio_stream_type, audio_stream_profile)`
   * `resource_audio(resource_id, file_id, original_filename, filesize, modified_date, start_pos, end_pos, duration, repeating, video_stream_count, audio_stream_count, video_stream_type, audio_stream_type, audio_stream_profile)`
   * `resource_text(resource_id, rtf rtf)`
   * `resource_shape(resource_id, shape_data text)` — DrawingML XML (`<spPr><prstGeom prst="...">...`) matching `SD.ShapesList.xml` / `SD.PresetShapes.1.xml` (`http://www.stdok.com/2014/presentation/shapelist`)
   * `resource_powerpoint(resource_id, file_id, original_filename, filesize, modified_date, width, height)`
   * `resource_web(resource_id, url text COLLATE UTF8_U_CI, remove_scroll_bars boolean)`
   * `resource_feed` / `resource_feed_pc` / `resource_dvd` / `resource_dvd_disk` / `resource_dvd_pc`
5. **`file`**: `rowid`, `file_hash` (`text`), `filename` (`text`), `shared_filename` (`text`). Maps packed assets inside `media\` of `.ewsx`/`.ewpx`/`.ewtx` ZIP archives.
6. **Hierarchical Property Bags**:
   * Tables: `{presentation,presentation_global,slide,element}_property_group(rowid, link_id, group_name)` + `*_property(rowid, group_id, value_type byte, key, value)`.
   * Observed `slide_property` keys:
     * `SlideAdvance`: `@changed` (`vt=5`), `Action` (`vt=6`), `Delay` (`vt=0`, ms e.g. `5000`)
     * `TransitionIn`: `@changed`, `AlwaysReset`, `Duration` (ms e.g. `750`), `LockBackground`, `Ramp`, `UID` (e.g. `sdDXCover`, `sdDXBlend`), `Value-Direction`, `Value-FadeIn`
   * Observed `element_property` keys:
     * `Element`: `ConstrainDims`, `Hidden`, `@changed`, `@mofChanged`
     * `Overrides`: `mofBackground`, `mofDims`, `mofForeground`, `mofText`
     * `Background`: `Opacity`
     * `Border`: `Color` (Delphi `TColor`), `Opacity`, `Style`
     * `Reflection`: `Opacity`, `Size`
     * `Shadow`: `Enabled`, `Offset`, `Radius`
     * `Text_Margins`: `Top`, `Bottom`, `Left`, `Right` (normalized floats, e.g. `0.041666...`, `0.0260416...`)
     * `Text_Style_<id>` (`101`, `103`, `201..203`, `300..309`): `Font_Color`, `Text_Alignment` (also full font/outline/shadow keys in editor: `Font_Name`, `Font_Size`, `Font_Opacity`, `Font_Bold`, `Font_Italic`, `Font_StrikeThrough`, `Font_Underline`, `Font_Superscript`, `Font_Subscript`, `Outline_*`, `Shadow_*`, `Indent_Level`, `Bullet_*`)
7. **`token`**: `rowid`, `presentation_id`, `uid`, `token_name`, `token_type` (`int8`), `token_format`, `token_interval`, `token_time_value`, `token_time_value_fixed`, `token_allow_overrun`, `token_value`.

#### `SongHistory.db`

* **`song`**: `rowid`, `song_uid` (`text UNIQUE`), `title`, `author`, `reference_number`, `provider_id` (`DEFAULT -1`), `provider_error` (`integer`).
* **`action`**: `rowid`, `song_id` (FK → `song.rowid`), `date` (`datetime`), `action_type` (`int8`), `transmit_date` (`datetime`).
  * Observed `action_type` enumeration in `Song Activity Report`:
    * `0`: **Add / Copy** (song added/copied to schedule/library)
    * `1`: **Print**
    * `2`: **Project** (displayed live)
* **`revision`**: `rowid`, `revision_num`, `tablename`, `key`.

#### `Alerts.db` & `ServiceIntervals.db`

* **`alert`**: `rowid`, `alert_type` (`int8`), `name`, `rtf`, `display_type`, `text_alignment`, `end_type`, `end_token`, `repeat_count`.
* **`token`** & **`alert_token_link`**: dynamic countdown/clock/text tokens (`token_format`, `token_interval`, `token_time_value`, `token_allow_overrun`).
* **`interval`** (`Alerts.db` / `ServiceIntervals.db`): `rowid`, `start_time`, `end_time`, `start_time_fixed`, `end_time_fixed`.

#### `RemoteControlClients.*.db` & `MIDIControls.*.db`

* **`client`**: `rowid`, `uid_hash` (`text`), `device_name` (`text`), `device_type` (`int8`), `device_permissions` (`int8`).
* **`midicontrol`**: `rowid`, `uid`, `caption`, `base_octave`, `auto_reset` (`boolean`), `input_device`, `output_device`, `commands_csv`, `notevals_csv`, `input_channel`, `permissions`.
* **`midicontrol_out`**: `output_channel`, `output_mode`, plus shared device fields.
* **`midiexport`**: `edition` (`integer`), `routing` (`integer`), `custom_routing` (`text`).

### 2.3 Binary File Formats: `.ewsx` / `.ewpx` / `.ewtx` / `.ewpck`, `.ewb` Bibles, `.dfx` Transitions

#### Schedule, Presentation, Theme & Package Archives (`.ewsx`, `.ewpx`, `.ewtx`, `.ewpck`)

* **`.ewsx` (Schedule), `.ewpx` (Presentation), `.ewtx` (Theme)** are **standard ZIP archives** containing:
  * `main.db` — SQLite database using the exact `PresentationLayouts.db` schema (`info`, `presentation`, `slide`, `element`, `resource*`, `*_property*`, `file`, `token`). Temporary atomic writes use `.tmp`.
  * `media\` — Embedded images, videos, audio, and PowerPoint files referenced by `file.filename` / `file.shared_filename` and `file.file_hash` (present when `"Pack files in schedule"` is enabled).
* **`.ewpck` Content Package (`demo.v4.ewpck`)**: Standard DEFLATE ZIP archive (`compress_type = 8`) containing:
  * `Data/`: `Media.db`, `PresentationLayouts.db`, `Presentations.db`, `Songs.db`, `SongWords.db`, `Themes.db`
  * `Resources/`: `Audio/`, `Images/`, `Presentations/`, `Schedules/`, `SharedMedia/`, `Themes/`, `Videos/`

#### `.ewb` Bible Database Format (`KJV.ewb`, `HCSB.ewb`, `RVA.ewb`)

Each `.ewb` file is a SQLite database (`page_size = 4096`) with 4 tables:
1. **`header`**: `id`, `key`, `name`, `abbrev_name`, `lang_code`, `plugin_version`, `format_version`, `copyright`, `license` (e.g., `KJV`: `id=17`, `plugin_version=1`, `format_version=1`; `HCSB`: `id=14`, `plugin_version=2`; `RVA`: `id=36`, `plugin_version=2`).
2. **`books`**: 66 rows (`rowid 1..66`, `name`, `abbrev_name`, `alt_name`):
   * **`book_info` (BLOB)**: `1 + N` bytes (`uint8`): byte `0` = chapter count `N` (e.g., Genesis `0x32` = 50 chapters, Psalm `0x96` = 150 chapters); bytes `1..N` = verse count per chapter `1..N`.
   * **`verse_info` (BLOB)**: Array of **8-byte little-endian `(u32 offset_len, u32 packed_ref)`** pairs (1 per verse in the book; e.g., Genesis = `12,264` bytes = `1,533` verses):
     * `offset_len`: `byte_offset = offset_len >> 10` (22 bits), `byte_length = offset_len & 0x3FF` (10 bits).
     * `packed_ref`: bitfield `(bible_id << 25) | (book_1based << 18) | (chapter_1based << 10) | (verse_1based << 2)` (low 2 bits unused/flags; e.g., KJV Gen 1:1 = `(17 << 25) | (1 << 18) | (1 << 10) | (1 << 2) = 0x22040404`).
3. **`streams`**: 1 row per book (`rowid 1..66`). `stream` BLOB is a **raw RFC 1950 zlib stream** (`78 DA ...`) starting at byte 0. Inside the decompressed UTF-8/codepage text stream, bytes `0..1` contain a 2-byte big-endian `uint16` equal to `header.id` (`0x00 0x11` for KJV, `0x00 0x0E` for HCSB, `0x00 0x24` for RVA), so verse text in `streams` is shifted +2 bytes relative to raw `byte_offset` in `verse_info` (and multi-byte UTF-8 accented translations such as RVA increment byte indices consistently in the compiler stream).
4. **`words`**: Concordance index (`word TEXT`, `verse_info INT32A` packed array of 4-byte little-endian `packed_ref` uint32 values).

#### `.dfx` DirectX Slide Transition Format (`Blend`, `Cover`, `Iris`, `Push`, `Reveal`, `Wipe`)

Each `.dfx` file is a SQLite database (`page_size = 1024`):
* **`info`**: `rowid`, `version` (`1`), `uid` (`sdDXBlend`, `sdDXCover`, `sdDXIris`, `sdDXPush`, `sdDXReveal`, `sdDXWipe`), `title`, `fxtype` (`1`), `data` (compiled Direct3D 9 HLSL FX binary starting with magic `01 09 FF FE`), `modified_date`.
* **`parameter`**: UI-exposed shader parameters (`info_id`, `fieldname`, `displayname`, `fieldtype`, `minvalue`, `maxvalue`, `defaultvalue`, `values` CSV), e.g., `Direction`, `BorderSoftness`, `FadeIn`, `FadeOut`.

---

## 3. Remote Control / Mobile App Protocol (`_ezwremote._tcp`)

The Remote Control Server powers the iOS/Android EasyWorship Remote apps, the Bitfocus Companion plugin, and the Elgato Stream Deck plugin (`Enable Remote Control` in Edit → Options → Advanced).

### 3.1 mDNS / Bonjour Discovery & Ephemeral Port Allocation

* **Service Type:** `_ezwremote._tcp` registered via Bonjour `dnssd.dll` `DNSServiceRegister`.
* **Instance Name:** Configured Remote Server Name (default `EasyWorship Remote (<Hostname>)` stored in Settings `Display_Name`).
* **TXT Record:** Empty (`txtLen = 0`, `txtRecord = NULL`).
* **TCP Listen Port:** **Ephemeral port in `49152–65535`** (`0xC000 + Random(0x4000)`), retried up to `101` (`0x65`) times until Indy `TIdCustomTCPServer` binds cleanly. Discovery via mDNS/Bonjour is therefore mandatory because the port changes dynamically across restarts.

### 3.2 Transport Framing & Keepalive Timers

* **Transport:** Plain TCP (`TIdCustomTCPServer`).
* **Client → Server Framing:** UTF-8 newline-delimited JSON lines (`\n` terminator, `MaxLineLength = 1,024,000` bytes).
* **Server → Client Framing:** UTF-8 JSON serialized objects terminated by `\r\n`. For binary responses (`ScheduleData`, `LiveData`, `slideImage`, `currentImage`), the JSON header (containing `"size": <bytes>`) is terminated with `\r\n`, immediately followed by `<size>` raw binary bytes on the same TCP stream.
* **Keepalive & Timeout:**
  * Server transmits `{"action":"heartbeat"}\r\n` after **`2,000,000 µs` (2.0 s)** of socket idle time.
  * Server disconnects clients after **`6,000,000 µs` (6.0 s)** of receive inactivity.

### 3.3 Pairing, Authentication & Permission Model

1. Immediately after TCP connect, the client sends a `connect` JSON object:
   ```json
   {
     "action": "connect",
     "uid": "<unique-device-id-or-hash>",
     "device_name": "Companion / Phone Name",
     "device_type": 8
   }
   ```
   * Observed `device_type` enum (`[0..8]`, masked with `& 0x7f`):
     * `0`: `phone_unknown`
     * `1`: `phone_windows`
     * `2`: `phone_apple`
     * `3`: `phone_android`
     * `4`: `mixer`
     * `5`: `mac`
     * `6`: `windows`
     * `7`: `streamdeck`
     * `8`: `companion`
2. Pairing state is stored in `RemoteControlClients.*.db` (`uid_hash`, `device_name`, `device_type`, `device_permissions`).
   * Upon first `connect` (`OnExecute`), `device_type == 2` (`phone_apple`) initializes `device_permissions` with `0x03` (`0x01 | 0x02`), while `device_type == 0` initializes `0x04`.
   * Operators pair and unlock control via the toolbar **Remote** popup (`Pair` + lock toggle).
   * Server replies to connection/pairing checks with **`"paired"`** or **`"notPaired"`** action messages. Invalid or unpaired connections are rejected with `"Invalid Connection"` / disconnect.

### 3.4 Complete Remote Action & Response Catalog

#### Client → Server JSON Commands (`"action"`)

| Action (`"action"`) | Parameters | Description |
| :--- | :--- | :--- |
| `connect` | `uid`, `device_name`, `device_type` | Handshake & device registration / pairing check |
| `heartbeat` | — | Client keepalive |
| `status` | — | Request current live/schedule status JSON |
| `prevBuild` / `nextBuild` | — | Previous / next slide text build or cue step |
| `prevSlide` / `nextSlide` | — | Previous / next slide in live item |
| `prevSchedule` / `nextSchedule` | — | Go Live with previous / next item in schedule |
| `gotoStartSlide` | — | Jump to first slide of live presentation |
| `gotoStartPresentation` | — | Jump to first item/slide of schedule |
| `gotoSlide<N>` | Regex `(?<Value>[0-9]+)` appended to action name (e.g. `gotoSlide3`) | Jump to 1-based slide index `N` |
| `gotoSchedule<N>` | Regex `(?<Value>[0-9]+)` appended to action name (e.g. `gotoSchedule5`) | Go Live with 1-based schedule item `N` |
| `Toggle` / `Play` / `Pause` | — | Media transport controls on live video/audio item |
| `GetScheduleData` | — | Request compact binary tree of schedule item IDs & revisions |
| `GetLiveData` | — | Request compact binary tree of currently live item & slide revisions |
| `getSlideInfo` | `rectype`, `pres_rowid`, `slide_rowid`, (`clientdatauid`, `requestrev`) | Fetch metadata & lyric/notes text for a slide |
| `getSlideImage` | `rectype`, `pres_rowid`, `slide_rowid`, `revision` (`clientdatauid`) | Fetch rendered `.jpg` thumbnail/preview for a specific slide |
| `getCurrentImage` | — | Fetch rendered `.jpg` snapshot of current live output |

#### Server → Client JSON & Binary Payloads

* **`status`**:
  ```json
  {
    "action": "status",
    "logo": true,
    "black": false,
    "clear": false,
    "rectype": "0",
    "pres_rowid": "12",
    "slide_rowid": "3",
    "pres_no": "1",
    "slide_no": "2",
    "schedulerev": "45",
    "liverev": "108",
    "imagehash": "<hash>",
    "permissions": 7
  }
  ```
  (Note: numeric fields `rectype`, `pres_rowid`, `slide_rowid`, `pres_no`, `slide_no`, `schedulerev`, `liverev` are formatted via `%d` strings; `permissions` is an integer.)
* **`heartbeat`** / **`paired`** / **`notPaired`**: status / session notifications (`"action"`).
* **`slideInfo`**:
  ```json
  {
    "action": "slideInfo",
    "rectype": "0",
    "pres_rowid": "12",
    "slide_rowid": "3",
    "title": "...",
    "reference_num": "...",
    "content": "...",
    "notes": "...",
    "revision": "5",
    "label_bkcolor": "7237230",
    "label_txcolor": "16777215",
    "clientdatauid": "..."
  }
  ```
* **`ScheduleData` / `LiveData` (JSON Header + Binary Index Stream)**:
  * Header: `{"action":"ScheduleData","size":<bytes>}\r\n` (or `"LiveData"`).
  * Immediately followed by `<size>` bytes written by EasyWorship's recursive schedule/slide index serializer, packed little-endian:
    ```text
    int32  item_count
    int64  container_revision
    for i in 0 .. item_count - 1:
        int64  item_rowid
        int64  item_revision
        -- One level of child slides (when outer flag == 1):
        int32  slide_count
        int64  item_slide_container_revision
        for j in 0 .. slide_count - 1:
            int64  slide_rowid
            int64  slide_revision
    ```
  * Clients diff revisions locally against cached slides and request only changed items via `getSlideInfo` / `getSlideImage`.
* **`slideImage` / `slideImageOK` / `currentImage` / `currentImageOK`**:
  * `slideImage`: `{"action":"slideImage","rectype":"...","pres_rowid":"...","slide_rowid":"...","revision":"...","imagehash":"...","size":<bytes>}\r\n` + `<size>` raw **JPEG (`.jpg`)** bytes.
  * `currentImage`: `{"action":"currentImage","imagehash":"...","size":<bytes>}\r\n` + `<size>` raw **JPEG (`.jpg`)** bytes.
  * `slideImageOK` / `currentImageOK`: sent when the client's cached revision/hash already matches.

---

## 4. MIDI Control Protocol & Ableton Live Set Export

EasyWorship integrates WinMM MIDI (`midiInOpen` / `midiOutOpen` / `midiOutShortMsg`, optionally over LAN via third-party **rtpMIDI** or macOS IAC Driver) for bidirectional cue automation and multi-computer **MIDI Sync**.

### 4.1 Wire Encoding (`MM_MIM_DATA` / `midiOutShortMsg`)

* **MIDI Input Decoder**:
  * Filters messages strictly on status high nibble **`(status & 0xF0) == 0x90`** (MIDI **Note On**).
  * `channel = status & 0x0F` (channels `0..15`, or `Any` in DB config).
  * `note = data1 & 0x7F` (`0..127`, matched against `(base_octave * 12) + note_offset` or trained note in `midicontrol`).
  * `velocity = data2 & 0x7F` (`0..127`).
* **MIDI Output Encoder**:
  * For every triggered output state/cue, transmits a **Note-On (`0x90 | channel, note & 0x7F, value & 0x7F`)** immediately followed by a matching **Note-Off (`0x80 | channel, note & 0x7F, value & 0x7F`)** via `midiOutShortMsg`.
  * When live output changes and output `permissions` bit `0x02` is enabled, broadcasts `mccLogoOn`/`Off`, `mccBlackOn`/`Off`, and `mccClearOn`/`Off`.
  * When output `permissions` bit `0x01` is enabled and live screen is active (non-blanked live state), broadcasts 1-based item/slide indices (`1..127`) as Note-On/Off velocity on the notes mapped to `mccGotoScheduleNo` and `mccGotoSlideNo`.

### 4.2 MIDI Command Inventory (`mcc*`)

Observed 17 configurable cue names (`commands_csv` ↔ `notevals_csv`) plus internal slide helpers:

| Command Name | Velocity Parameter | Behavior |
| :--- | :--- | :--- |
| `mccLogoOn` / `mccLogoOff` | Ignored | Engage / disengage Logo screen overlay |
| `mccBlackOn` / `mccBlackOff` | Ignored | Engage / disengage Black screen |
| `mccClearOn` / `mccClearOff` | Ignored | Engage / disengage Clear foreground |
| `mccPrevSchedule` / `mccNextSchedule` | Ignored | Go Live with previous / next schedule item |
| `mccPrevBuild` / `mccNextBuild` | Ignored | Previous / next slide build/cue step (internal dispatcher also defines `mccPrevSlide`/`mccNextSlide`) |
| `mccGotoStartOfPres` | Ignored | Jump to start of current live presentation |
| `mccGotoStartOfSlide` | Ignored | Jump to start of current live slide |
| `mccPlayPauseToggle` / `mccPlay` / `mccPause` | Ignored | Media transport control on live slide |
| `mccGotoScheduleNo` | `velocity` (`1..127`) | Jump live to 1-based schedule item `velocity` |
| `mccGotoSlideNo` | `velocity` (`1..127`) | Jump live to 1-based slide `velocity` |

### 4.3 Ableton Live Set (`.als`) Export

`TForm_MidiAbletonExport` generates standard gzip-compressed XML Ableton Live 10 (`MajorVersion` / `MinorVersion` `"10.0_370"`, `LiveSet`, `Tracks`, `MidiTrack`, `ClipSlotList`, `MidiClip`, `KeyTracks`, `MidiNoteEvent` with `MidiKey`, `Duration`, `Velocity`, `OffVelocity`, `IsEnabled`, and `MidiOutputRouting`) targetable for Lite, Intro, or Standard/Suite track limits:
* Combined cue file: `EasyWorshipCues.als`
* Or split sets by category: `EasyWorshipCues_Actions.als`, `EasyWorshipCues_ScheduleNo.als`, `EasyWorshipCues_SlideNo.als`
* Pre-populates `MidiOutputRouting` strings (e.g. `MidiOut/External.Dev:<Device>/<Ch>` or `IAC Driver (IAC Bus 1)`).

---

## 5. Video Outputs, NDI Output/Input, Alpha Key & Stage Foldback

### 5.1 NDI Output Streams (`SD.NewTekNDISend`)

Main Output (`Live`) and Alternate Output (`Alt`) both expose **`NDI Stream`** as an `Output Monitor` target; internal sender strings are defined for all three output targets:
* Sender Names (`p_ndi_name`, UTF-8):
  * `"EasyWorship Live"` (Main Output)
  * `"EasyWorship FoldBack"` (Foldback target string)
  * `"EasyWorship Alternate Output"` (Alternate Output)
* **NDI Connection Metadata XML:**
  ```xml
  <ndi_product long_name="EasyWorship" short_name="EasyWorship Presentation Software" manufacturer="Softouch Development, Inc." version="1.000.000" session="default" model_name="S1" serial=""/>
  ```
* **Pixel Format & Transport (`NDIlib_video_frame_v2` via `NDIlib_send_send_video_async_v2`):**
  * **FourCC:** `0x41524742` (**`BGRA`** — 32-bit RGBA/BGRA with full embedded alpha channel, `line_stride_in_bytes = width * 4`).
  * **Scan Type:** Progressive (`frame_format_type = 1`, `NDIlib_frame_format_type_progressive`).
  * **Supported Output Formats (switch table `0..6`):**

| Mode Index | Resolution (`xres x yres`) | Rational FPS (`frame_rate_N / frame_rate_D`) | Effective Rate |
| :--- | :--- | :--- | :--- |
| `0` (Default) | `1920 x 1080` | `30000 / 1001` | `29.97p` |
| `1` | `1920 x 1080` | `30000 / 1250` | `24.00p` |
| `2` | `1280 x 720` | `60000 / 1001` | `59.94p` |
| `3` | `720 x 480` | `30000 / 1001` | `29.97p` |
| `4` | `1920 x 1080` | `30000 / 1200` | `25.00p` |
| `5` | `1280 x 720` | `60000 / 1200` | `50.00p` |
| `6` | `720 x 480` | `30000 / 1200` | `25.00p` |

* **Audio (`NDIlib_send_send_audio_v2`):** `48000 Hz`, IEEE 32-bit float planar (`channel_stride_in_bytes = no_samples * 4`), clocked alongside video (`clock_video = True`, `clock_audio = True`, `NDIlib_send_timecode_synthesize`).
* **NDI Receiver Input (`SD.FeedNDI` / `SD.FeedNDIPlayer`):** EasyWorship can also ingest external NDI sources on the LAN as live media feeds (`ezMID:NDI@<source>`) using `NDIlib_find_*`, `NDIlib_recv_create_v3`, and `NDIlib_framesync_*`.

### 5.2 Hardware Dual-Output Alpha Channel Key/Fill (`TForm_AlphaOutput`)

* Both Main Output and Alternate Output support assigning an independent extended-desktop monitor for **Alpha Channel** (`Alpha_` output selector, `EWform.AlphaOutput.VCL`).
* Documented requirement: NVIDIA GeForce GTX/RTX GPU capable of 3+ simultaneous displays (Control + Fill + Key feeding a hardware video switcher external keyer).

### 5.3 Stage Display / Foldback Output (`FoldBack`)

Foldback drives a third independent display (physical monitor or custom pixel bounds `Left/Top/Width/Height`, persisted in `FoldbackSettings.db`/`Foldback.Settings.db`) without a network WebSocket stage protocol:
* **Slide Body:** Independent default font/outline/shadow/alignment and screen margins (`Screen_Margins`).
* **Next Item Info:** First 1 or 2 lines of the next slide (`Line_Count`, `Show Two Lines`) OR next schedule item title, with dedicated font & background color.
* **Foldback Clock:** Real-time 12h/24h/custom format (`hh:nn`, `hh:nn:ss`, `hh:nn am/pm`, `hh:nn:ss am/pm`, `HH:NN`, `HH:NN:SS`) positioned on screen.
* **Service Interval Countdown (`ServiceIntervals.db`):** Counts down to service `start_time` and `end_time`, switches automatically before scheduled end, supports `hh:nn{ss}`, `hh:nn:ss`, `hh:nn`, `nn:ss`, plus `Allow Overrun` (negative elapsed indicator).
* **Foldback / Nursery / Message Alerts (`Alerts.db`):** Supports ticker scroll speed (`ScrollSpeed`), screen region, background color/opacity, and alert tokens.

---

## 6. CCLI Integration, Activity Reporting & Local Configuration

### 6.1 SongSelect Integration (`sslsparser2.dll` + WebView2)

* Hosted inside Edge WebView2 (`SD.WebBrowser.WebViewExt.Win`).
* `sslsparser2.dll` injects JavaScript helpers (`GetSongSelectParserJS`) to extract lyrics, verse labels, CCLI `#`, author, and copyright metadata from SongSelect web views, returning parsed structures via `ParseJavaScriptResultForSongData` and `ParseLyrics` / `GetLabel` / `CompareLabel`.

### 6.2 CCLI Usage Auto-Reporting (`EasyWorshipHelper.exe`)

When auto-reporting is enabled, `EasyWorshipHelper.exe` runs daily/scheduled background sync (`TimerDaily`) reading `SongHistory.db` (`action` + `song` joined by `reference_number`):
* **OAuth Token Refresh:** `https://is3.easyworship.com//ccli/refreshtoken?refreshToken=<sdpc_ccliRefreshToken>` updates `sdpc_ccliAccessToken`, `sdpc_ccliRefreshToken`, and `sdpc_ccliExpires`.
* **Usage Reporting Endpoint:** `https://api.ccli.com/rpt/v1/report-usage`
  * Headers: `Authorization: Bearer <sdpc_ccliAccessToken>` and an Azure APIM subscription header `Ocp-Apim-Subscription-Key` (bundled credential omitted per clean-room policy).
  * Request / Response fields observed in `EasyWorshipHelper.exe`: `source: "EasyWorship"`, `songs`, `usage`, `date` (`yyyy-mm-dd` / `y/m/d`), `reference_number`, and response inspection paths `data.usage`, `songs.reported`, `songs.publicDomain`, `songs.unrecognized`, updating status keys `sdpc_ReportingAgentReportResponse_*` and `sdpc_ReportingAgentReportText_*`.
* **Local Song Activity Export (`TREPORT_SONGACTIVITY` / `TForm_SongActivityReportOptions`):**
  * Exports **PDF** (via `QuickReport` + `SynPdf`), **CSV** (`*.csv`), or **TXT** (`*.txt`) filtered by date range (`Current Year`, `Include All Dates`, `Custom Dates`) and mode (`All Activity`, `Manually Reported Activity`, `Auto-Reported Activity`, or added-only).
  * Columns: `Title`, `Author`, `Song #` (`reference_number`), `Add` / `Error`, `Print`, `Project`, `Provider`. Also exports `Schedule Summary` and `Schedule Details` reports.

### 6.3 Keyboard Shortcuts (`%ProgramData%\Softouch\EasyWorship.v7\Settings\HotKeys.ini`)

Documented INI format mapping Windows Virtual-Key codes (optional `C-` Ctrl prefix):

| INI Key (`[HotKeys]`) | Default Value | Action |
| :--- | :--- | :--- |
| `BlackScreenKeys` | `C-66` | Toggle Black (`Ctrl+B`) |
| `ClearScreenKeys` | `C-67` | Toggle Clear (`Ctrl+C`) |
| `LogoScreenKeys` | `C-76` | Toggle Logo (`Ctrl+L`) |
| `GoLiveNextKeys` / `GoLivePrevKeys` | `34` / `33` | Next / Previous Go Live (`PageDown` / `PageUp`) |
| `ScheduleNextKeys` / `SchedulePrevKeys` | `39` / `37` | Select Next / Previous Schedule item (`Right` / `Left`) |
| `SlideFirstKeys` / `SlideLastKeys` | `36` / `35` | First / Last Slide (`Home` / `End`) |
| `SlideNextKeys` / `SlidePrevKeys` | `78, 40, 32` / `80, 38, 8` | Next (`N`, `Down`, `Space`) / Previous Slide (`P`, `Up`, `Backspace`) |
| `JumpIntroKeys` / `JumpVerseKeys` / `JumpPreChorusKeys` / `JumpChorusKeys` / `JumpBridgeKeys` / `JumpTagKeys` / `JumpEndingKeys` / `JumpSlideKeys` | `73`/`86`/`82`/`67`/`66`/`84`/`69`/`83` | Jump to labeled song section (`I`, `V`, `R`, `C`, `B`, `T`, `E`, `S`) |

### 6.4 PowerPoint File Parsing & Hook Pipeline (`EW.PowerPoint*` / `ezwHookpp`)

* **Metadata / Thumbnail Extraction:** Parses legacy OLE2 binary `.ppt` streams (`PowerPoint Document`, `Current User`) and OpenXML `.pptx` archives (`docProps\core.xml`, `ppt\presentation.xml`, `ppt\_rels\presentation.xml.rels`, `ppt\slides\slide*.xml`, `p:sldSz`, `p:sldId`, `p:transition`, `p:childTnLst`, `p:bldLst`).
* **Live Playback Engines:** Automates installed full Microsoft PowerPoint via COM (`CLSID {91493441-5A91-11CF-8700-00AA0060263B}`, command-line `"/s /f /n<N>"`) or PowerPoint Viewer (`PPTVIEW.EXE`), injecting `sdHookpp.{32,64}.dll` + `sdHookDX.{32,64}.dll` to capture slides directly from DirectX swap chains (`EZW_SURFACE_BRIDGE`) onto EasyWorship's composite layers, NDI stream, and Alpha outputs.

---

## 7. Integration & Clean-Room Interoperability Summary for *One Ring*

1. **Schedule & Song Ingestion (Native Import/Sync):**
   * Read `.ewsx` / `.ewpx` / `.ewtx` directly as standard ZIPs (`main.db` + `media\`), and read `Songs.db` + `SongWords.db` + `PresentationLayouts.db` + `.ewb` Bibles in Python/Rust by registering a case-insensitive `UTF8_U_CI` SQLite collation.
   * For `.ewb` Bibles, decode 8-byte `verse_info` pairs (`off = v0 >> 10`, `len = v0 & 0x3FF`, `packed_ref = v1`) against raw zlib-decompressed `streams.stream`, accounting for the 2-byte big-endian `header.id` prefix.
2. **Bidirectional Remote Control Adapter (`_ezwremote._tcp`):**
   * Discover dynamic ephemeral TCP port via mDNS `_ezwremote._tcp`; connect with `{"action":"connect","uid":"...","device_name":"One Ring","device_type":8}` (`companion`).
   * Drive `prevSlide`/`nextSlide`/`prevBuild`/`nextBuild`/`prevSchedule`/`nextSchedule`/`gotoSlide<N>`/`gotoSchedule<N>`/`Play`/`Pause`/`Toggle`, consume `status` + `ScheduleData`/`LiveData` binary revision streams + JPEG `currentImage`/`slideImage`, and send/respond to 2 s `heartbeat`s.
3. **MIDI Fallback / Ableton Sync:**
   * Send/receive WinMM/rtpMIDI Note-On + Note-Off pairs on configured channels for the 17 `mcc*` commands, reading item/slide numbers (`1..127`) from velocity on `mccGotoScheduleNo`/`mccGotoSlideNo`.
4. **Broadcast Video & Audio Interop:**
   * Ingest `"EasyWorship Live"` and `"EasyWorship Alternate Output"` directly over NDI as progressive `BGRA` (`0x41524742`) alpha-capable streams with 48 kHz planar float audio, or feed NDI video into EasyWorship slides as live NDI media inputs.
