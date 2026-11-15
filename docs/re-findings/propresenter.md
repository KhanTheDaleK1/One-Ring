# ProPresenter 22.0.1 Clean-Room Protocol & Interoperability Specification

> **Clean-Room IP Notice:** This specification was derived from clean-room black-box/gray-box interoperability analysis of ProPresenter v22.0.1 (`ProPresenter.app`). It contains **zero copied source code, zero decompiled function bodies, and zero disassembled instructions**. It documents only wire protocols, mDNS service types, HTTP/REST OpenAPI routes, chunked streaming framing, WebSocket endpoints, ProLink multicast synchronization schemas, and broadcast hardware communication interfaces required to build an independent, interoperable controller (`one-ring-to-rule-them-all`).

---

## 1. Architectural Overview & Multi-Process Topology

ProPresenter 22.0.1 is a hybrid Swift/Objective-C++ and Rust application structured around a central media/presentation engine (`ProPresenter` + `ProCore.framework`) and four specialized out-of-process helper executables coordinated over a custom local IPC layer (`libRVIPCCore.dylib` + Protocol Buffers v31.1.0):

1. **`ProPresenter` & `ProCore.framework`:**
   - Houses the core presentation state machine, timeline engine, slide/cue renderer, broadcast device communications (`Communications_MIDI.bundle`, `Communications_DMX.bundle`), and 169 Protocol Buffer (`rv.data.*`) schemas.
   - Connects to **NDI** (`libndi.dylib`, `TYPE_NDI`) and **Syphon** (`Syphon.framework` / `ssAPI.framework`, `TYPE_SYPHON`) for multi-screen video + key/alpha output.
2. **`ProPresenter Helper (Network)` (`control-tower`):**
   - A standalone Rust (`actix-web` 2.6 + `tokio` 1.52) network gateway binary that communicates with `ProCore.framework` over `libRVIPCCore.dylib` (`IPCChannel` wrapping `rv.data.ProApiIn` and `rv.data.ProApiOut` protobuf messages).
   - Hosts the **Public HTTP/REST v1 API (`/v1/*`)**, **OpenAPI documentation UI (`/doc`)**, **Web Control UI (`/control/*`)**, **WebSocket servers (`/remote`, `/stagedisplay`, `/v1/ws`)**, **ProLink multi-machine synchronization server (`/group`, `/heartbeat`, `/preroll`)**, **TCP Stream Server**, and **Embedded AirPlay/RAOP Receiver (`pro/api/airplay`)**.
3. **`ProPresenter Helper (Workspaces)` / `(Snapshots)` / `(Privileged)` & `HelperRunner`:**
   - Isolate local/cloud workspace synchronization (`loro` CRDT oplog + `workspace.remote` / `workspace.local`), crash/state snapshots, and privileged OS operations.

---

## 2. Service Discovery (mDNS / Bonjour & ProLink UDP Multicast)

### 2.1 mDNS / Bonjour Service Types (`pro/api/mdns` & `control-tower::zeroconf`)
When network features are enabled in `ProApiNetworkConfiguration`, `ProPresenter Helper (Network)` registers the following DNS-SD services on the configured HTTP/WebSocket port:

| mDNS Service Type | Internal Name | Purpose |
| :--- | :--- | :--- |
| `_proapiv1._tcp.local.` | `proapiv1` | **Public REST & Streaming API v1** (`/v1/*`, `/version`, `/v1/ws`) |
| `_pro7proremote._tcp.local.` | `pro7proremote` | **ProPresenter Remote WebSocket** (`/remote`) when `remote_enable` / `proremote_websocket_enable` is active |
| `_pro7stagedsply._tcp.local.` | `pro7stagedsply` | **ProPresenter Stage Display WebSocket** (`/stagedisplay`) when `stage_enable` is active |
| `_airplay._tcp.local.` / `_raop._tcp.local.` | `airplay` | **Embedded AirPlay Mirroring & Audio Receiver** (`AirTunes/220.68`, model `AppleTV2,1`, TXT keys: `deviceid`, `features`, `flags`, `model`, `pk`, `pi`, `srcvers`, `vv`, `pw`) when `AirplayConfiguration.enable` is active |

> **Port Binding Behavior:** All HTTP, REST `/v1/*`, `/remote`, `/stagedisplay`, `/v1/ws`, and `/control/*` endpoints share the single TCP port configured in `ProApiNetworkConfiguration.port`. If `auto_reselect_port_on_failure` is true and the configured port is in use, `control-tower` automatically binds to an available ephemeral port and advertises the actual bound port via mDNS.

### 2.2 ProLink / Network Link Multicast Discovery (`224.0.0.90:18514`)
For multi-machine ProPresenter synchronization (**Network Link** / `ProLink`), `control-tower` binds a UDP socket on `0.0.0.0:18514` and joins multicast group **`224.0.0.90:18514`**:
- Periodically multicasts a serialized `rv.data.ProLink.ZeroConfig.MulticastPacket` containing:
  - `group` (`GroupDefinition`: `timestamp`, `secret`, `name`, `members[]`, `group_identifier` UUID)
  - `device` (`MemberStatus`: `ip`, `port`, `name`, `platform` [`mac` / `win`], `os_version`, `host_description`, `api_version`, `connection_status`)

---

## 3. Public HTTP REST & Real-Time Streaming API (`/v1/*`)

The public ProPresenter API is an **OpenAPI 3.0.0 (`version: "1.0"`)** HTTP/JSON interface served by `ProPresenter Helper (Network)` with permissive CORS (`actix_cors::middleware`) and **no authentication required** for `/v1/*` endpoints.

### 3.1 Real-Time State Subscription Mechanisms
ProPresenter v1 supports three distinct real-time push mechanisms so external controllers never need to poll:

1. **Chunked-Transfer HTTP Streaming (`?chunked=true`):**
   - Appending `?chunked=true` to supported `GET` endpoints (or calling dedicated `/updates` endpoints such as `/v1/playlist/{playlist_id}/updates`, `/v1/audio/playlist/{playlist_id}/updates`, `/v1/media/playlist/{playlist_id}/updates`, `/v1/presentation/chord_chart/updates`, `/v1/status/slide?chunked=true`, `/v1/timers/current?chunked=true`, `/v1/transport/{layer}/time?chunked=true`) keeps the HTTP connection open with `Transfer-Encoding: chunked`.
   - Whenever the underlying state changes in ProPresenter, `PendingQueue::send_streaming_update` emits a new JSON chunk terminated by `\r\n\r\n`.
2. **Aggregated Multiplexed Status Stream (`POST /v1/status/updates`):**
   - Accepts a JSON array of relative `/v1/*` endpoint strings in the `POST` body (for example, `["status/slide", "timers/current", "transport/presentation/time", "playlist/active"]`).
   - Returns a single long-lived chunked HTTP response (`Transfer-Encoding: chunked` / `text/event-stream`) where every state change on any subscribed path emits an envelope:
     ```json
     {
       "url": "status/slide",
       "data": { ... }
     }
     ```
3. **WebSocket API Bridge (`ws://<host>:<port>/v1/ws`):**
   - Upgrades to a bidirectional WebSocket (`control_tower::api_websocket`) that accepts JSON request envelopes `{"url": "<v1-path>", "method": "GET|POST|PUT|DELETE", "body": ...}` and streams back responses and subscribed updates over a single socket.

---

## 4. Complete `/v1/*` Endpoint Catalog (205 OpenAPI Routes)

### 4.1 System, Version & Real-Time Status (`status.rs`)
| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/version` | Returns general instance info (`name`, `platform`, `os_version`, `host_description`, `api_version`) |
| `GET` | `/v1/find_my_mouse` | Flashes the cursor indicator on the ProPresenter operator display |
| `GET` | `/v1/status/layers` | Returns active state (`true`/`false`) of all 7 layers: `video_input`, `media`, `slide`, `announcements`, `props`, `messages`, `audio` |
| `GET`, `PUT` | `/v1/status/audience_screens` | Gets or sets (`boolean`) whether Audience screens are active |
| `GET`, `PUT` | `/v1/status/stage_screens` | Gets or sets (`boolean`) whether Stage screens are active |
| `GET` | `/v1/status/screens` | Returns configuration and resolution (`size: {width, height}`, `screen_type`) of all screens |
| `GET` | `/v1/status/slide` | Returns `current` and `next` slide `{ text, notes, uuid }` (supports `?chunked=true`) |
| `POST` | `/v1/status/updates` | Multiplexes multiple streaming `/v1/*` endpoints into a single chunked response |

### 4.2 Global Triggers & Clear Layer/Group Controls (`trigger.rs`, `clear.rs`)
| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/v1/trigger/next` | Triggers the next cue or item in the currently active playlist or library |
| `GET` | `/v1/trigger/previous` | Triggers the previous cue or item in the currently active playlist or library |
| `GET` | `/v1/trigger/media/next` | Triggers the next item in the active media playlist |
| `GET` | `/v1/trigger/media/previous` | Triggers the previous item in the active media playlist |
| `GET` | `/v1/trigger/audio/next` | Triggers the next item in the active audio playlist |
| `GET` | `/v1/trigger/audio/previous` | Triggers the previous item in the active audio playlist |
| `GET` | `/v1/clear/layer/{layer}` | Clears `{layer}` $\in$ `{audio, props, messages, announcements, slide, media, video_input}` |
| `GET`, `POST` | `/v1/clear/groups` | Lists all clear groups or creates a new clear group |
| `GET`, `PUT`, `DELETE` | `/v1/clear/group/{id}` | Gets, updates, or deletes clear group `{id}` (`icon`, `tint`, `layers[]`, `stop_timeline_announcements`, `stop_timeline_presentation`, `clear_next_presentation`) |
| `GET`, `PUT` | `/v1/clear/group/{id}/icon` | Gets or sets custom image icon for clear group `{id}` |
| `GET` | `/v1/clear/group/{id}/trigger` | Triggers clear group `{id}` |

### 4.3 Presentations & Libraries (`presentation.rs`, `library.rs`, `groups.rs`)
| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/v1/libraries` | Lists all configured libraries (`{ uuid, name, index }`) |
| `GET` | `/v1/library/{library_id}` | Lists all presentation items in `{library_id}` |
| `GET` | `/v1/library/{library_id}/{presentation_id}/trigger` | Triggers the first cue of `{presentation_id}` in `{library_id}` |
| `GET` | `/v1/library/{library_id}/{presentation_id}/{index}/trigger` | Triggers cue `{index}` of `{presentation_id}` in `{library_id}` |
| `GET` | `/v1/presentation/active` | Returns full details of the active presentation (`id`, `has_timeline`, `presentation_path`, `destination`, `groups[]`, `arrangements[]`, `current_arrangement`) |
| `GET` | `/v1/presentation/focused` | Returns full details of the currently focused presentation in the UI |
| `GET` | `/v1/presentation/{uuid}` | Returns full details of presentation `{uuid}` |
| `GET` | `/v1/presentation/slide_index` | Returns `{ presentation_index: { index, presentation_id } }` (supports `?chunked=true`) |
| `GET` | `/v1/presentation/chord_chart` | Returns current chord chart image (`?quality=<int>`) |
| `GET` | `/v1/presentation/chord_chart/updates` | Streams chunked updates whenever the chord chart changes |
| `GET` | `/v1/presentation/{uuid}/thumbnail/{index}` | Returns JPEG/PNG thumbnail of cue `{index}` in presentation `{uuid}` |
| `GET` | `/v1/presentation/{target}/focus` | Moves UI focus (`{target}` $\in$ `next`, `previous`, `active`, `{uuid}`) |
| `GET` | `/v1/presentation/{scope}/trigger` | Triggers presentation from start (`{scope}` $\in$ `focused`, `active`, `{uuid}`) |
| `GET` | `/v1/presentation/{scope}/next/trigger` | Triggers next cue (`{scope}` $\in$ `focused`, `active`, `{uuid}`) |
| `GET` | `/v1/presentation/{scope}/previous/trigger` | Triggers previous cue (`{scope}` $\in$ `focused`, `active`, `{uuid}`) |
| `GET` | `/v1/presentation/{scope}/{index}/trigger` | Triggers cue `{index}` (`{scope}` $\in$ `focused`, `active`, `{uuid}`) |
| `GET` | `/v1/presentation/{scope}/group/{group_id}/trigger` | Triggers slide group `{group_id}` (`{scope}` $\in$ `focused`, `active`, `{uuid}`) |
| `GET` | `/v1/presentation/{scope}/timeline` | Gets timeline status (`{ is_running, current_time }`) for `active` or `focused` |
| `GET` | `/v1/presentation/{scope}/timeline/{operation}` | Performs `{operation}` $\in$ `{play, pause, rewind}` on `active`, `focused`, or `{uuid}` |
| `GET` | `/v1/groups` | Lists all configured global slide groups (`{ id, color, hotkey, ... }`) |

### 4.4 Playlists (`playlist.rs`)
| Method | Path | Description |
| :--- | :--- | :--- |
| `GET`, `POST` | `/v1/playlists` | Lists all playlists (tree of folders & playlists) or creates a new playlist |
| `GET`, `PUT`, `POST` | `/v1/playlist/{playlist_id}` | Gets items in `{playlist_id}`, replaces items (`PUT`), or creates child playlist (`POST`) |
| `GET` | `/v1/playlist/active` | Returns active playlist & item state for both `presentation` and `announcement` destinations |
| `GET` | `/v1/playlist/focused` | Returns currently focused playlist |
| `GET` | `/v1/playlist/{playlist_id}/updates` | Chunked stream emitted whenever `{playlist_id}` items change |
| `GET` | `/v1/playlist/{target}/focus` | Focuses playlist (`{target}` $\in$ `next`, `previous`, `active/presentation`, `active/announcement`, `{playlist_id}`) |
| `GET` | `/v1/playlist/{scope}/trigger` | Triggers first item (`{scope}` $\in$ `focused`, `active/presentation`, `active/announcement`, `{playlist_id}`) |
| `GET` | `/v1/playlist/focused/next` / `previous` | Previews the playlist item that will be triggered next/previous |
| `GET` | `/v1/playlist/{scope}/next/trigger` / `previous/trigger` | Triggers next/previous item in `focused` or `{playlist_id}` |
| `GET` | `/v1/playlist/{scope}/{index}/trigger` | Triggers item `{index}` (`{scope}` $\in$ `focused`, `active/presentation`, `active/announcement`, `{playlist_id}`) |
| `GET` | `/v1/playlist/{scope}/{index}/{cue_index}/trigger` | Triggers cue `{cue_index}` inside item `{index}` |
| `GET` | `/v1/playlist/{scope}/{index}/thumbnail/{cue_index}` | Returns thumbnail for cue `{cue_index}` of playlist item `{index}` |
| `GET` | `/v1/playlist/{scope}/{index}/timeline` | Gets timeline status for playlist item `{index}` |
| `GET` | `/v1/playlist/{scope}/{index}/timeline/{operation}` | Executes `{play, pause, rewind}` on playlist item `{index}` |

### 4.5 Announcements (`announcement.rs`)
| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/v1/announcement/active` | Returns currently active announcement presentation |
| `GET` | `/v1/announcement/slide_index` | Returns current cue index in the active announcement |
| `GET` | `/v1/announcement/active/focus` | Focuses the active announcement presentation |
| `GET` | `/v1/announcement/active/trigger` | Retriggers active announcement from start |
| `GET` | `/v1/announcement/active/next/trigger` / `previous/trigger` | Triggers next or previous cue in active announcement |
| `GET` | `/v1/announcement/active/{index}/trigger` | Triggers cue `{index}` in active announcement |
| `GET` | `/v1/announcement/active/timeline` | Returns timeline state of active announcement |
| `GET` | `/v1/announcement/active/timeline/{operation}` | Executes `{play, pause, rewind}` on active announcement timeline |

### 4.6 Media, Audio & Video Inputs (`media.rs`, `audio.rs`, `video_inputs.rs`)
| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/v1/media/playlists` | Lists all configured media playlists |
| `GET` | `/v1/media/playlist/{playlist_id}` | Lists all media items in `{playlist_id}` |
| `GET` | `/v1/media/playlist/{playlist_id}/updates` | Chunked stream of updates to media playlist `{playlist_id}` |
| `GET` | `/v1/media/{uuid}/thumbnail` | Returns thumbnail image for media asset `{uuid}` (`?quality=<int>`) |
| `GET` | `/v1/media/playlist/{scope}` | Gets `focused` or `active` media playlist identifier |
| `GET` | `/v1/media/playlist/{target}/focus` | Focuses `next`, `previous`, `active`, or `{playlist_id}` media playlist |
| `GET` | `/v1/media/playlist/{scope}/trigger` | Triggers first item, `next/trigger`, `previous/trigger`, or `{media_id}/trigger` (`{scope}` $\in$ `focused`, `active`, `{playlist_id}`) |
| `GET` | `/v1/audio/playlists` | Lists all configured audio playlists |
| `GET` | `/v1/audio/playlist/{playlist_id}` | Lists all audio tracks in `{playlist_id}` |
| `GET` | `/v1/audio/playlist/{playlist_id}/updates` | Chunked stream of updates to audio playlist `{playlist_id}` |
| `GET` | `/v1/audio/playlist/{scope}` | Gets `focused` or `active` audio playlist |
| `GET` | `/v1/audio/playlist/{target}/focus` | Focuses `next`, `previous`, `active`, or `{playlist_id}` audio playlist |
| `GET` | `/v1/audio/playlist/{scope}/trigger` | Triggers first track, `next/trigger`, `previous/trigger`, or `{id}/trigger` (`{scope}` $\in$ `focused`, `active`, `{playlist_id}`) |
| `GET` | `/v1/video_inputs` | Lists all configured video input sources |
| `GET` | `/v1/video_inputs/{id}/trigger` | Triggers video input `{id}` onto the video input layer |

### 4.7 Layer Transport Controls (`transport.rs`)
For `{layer}` $\in$ `{presentation, announcement, audio}`:

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/v1/transport/{layer}/play` | Plays content on `{layer}` |
| `GET` | `/v1/transport/{layer}/pause` | Pauses content on `{layer}` |
| `GET` | `/v1/transport/{layer}/skip_backward/{time}` | Skips backward by `{time}` seconds |
| `GET` | `/v1/transport/{layer}/skip_forward/{time}` | Skips forward by `{time}` seconds |
| `GET` | `/v1/transport/{layer}/go_to_end` | Jumps to end (with optional preroll seconds) |
| `GET`, `PUT` | `/v1/transport/{layer}/time` | Gets current playback time (`?chunked=true`) or seeks (`PUT`) to `{time}` seconds |
| `GET`, `DELETE` | `/v1/transport/{layer}/auto_advance` | Gets or cancels (`DELETE`) auto-advance on `presentation` or `announcement` |
| `GET` | `/v1/transport/{layer}/current` | Returns `{ is_playing, uuid, name, artist, audio_only, duration }` on `{layer}` |

### 4.8 Timers, Messages, Props, Stage, Looks, Macros, Masks, Themes & Capture
| Subsystem | Endpoints |
| :--- | :--- |
| **Timers (`timers.rs`)** | `GET/POST /v1/timers`, `GET /v1/timers/current` (`?chunked=true`), `GET /v1/timers/{operation}` (`start`, `stop`, `reset`), `GET/PUT/DELETE /v1/timer/{id}`, `GET/PUT /v1/timer/{id}/{operation}`, `GET /v1/timer/{id}/increment/{time}`, `GET /v1/timer/system_time`, `GET /v1/timer/video_countdown` |
| **Messages (`messages.rs`)** | `GET/POST /v1/messages`, `GET/PUT/DELETE /v1/message/{id}`, `POST /v1/message/{id}/trigger` (accepts token value array `[{name, value}]`), `GET /v1/message/{id}/clear` |
| **Props (`props.rs`)** | `GET /v1/props`, `GET/PUT/DELETE /v1/prop/{id}`, `GET /v1/prop/{id}/trigger`, `GET /v1/prop/{id}/clear`, `GET /v1/prop/{id}/auto_clear/pause`, `GET /v1/prop/{id}/auto_clear/resume`, `GET /v1/prop/{id}/thumbnail`, `GET/POST /v1/prop_collections`, `GET/PUT/DELETE /v1/prop_collection/{id}` |
| **Stage (`stage.rs`)** | `GET/PUT/DELETE /v1/stage/message`, `GET/PUT /v1/stage/layout_map`, `GET /v1/stage/screens`, `GET /v1/stage/screen/{id}/layout`, `GET /v1/stage/screen/{id}/layout/{layout_id}`, `GET /v1/stage/layouts`, `DELETE /v1/stage/layout/{id}`, `GET /v1/stage/layout/{id}/thumbnail` |
| **Audience Looks (`looks.rs`)** | `GET/POST /v1/looks`, `GET/PUT /v1/look/current`, `GET/PUT/DELETE /v1/look/{id}`, `GET /v1/look/{id}/trigger` |
| **Macros (`macros.rs`)** | `GET /v1/macros`, `GET/PUT/DELETE /v1/macro/{id}`, `GET /v1/macro/{id}/trigger`, `GET/PUT /v1/macro/{id}/icon`, `GET/POST /v1/macro_collections`, `GET/PUT/DELETE /v1/macro_collection/{id}` |
| **Masks & Themes (`masks.rs`, `themes.rs`)** | `GET /v1/masks`, `GET /v1/mask/{id}`, `GET /v1/mask/{id}/thumbnail`, `GET /v1/themes`, `GET /v1/theme/{id}`, `GET/PUT /v1/theme/{id}/slides/{theme_slide}`, `GET /v1/theme/{id}/slides/{theme_slide}/thumbnail` |
| **Capture / Streaming (`capture.rs`)** | `GET /v1/capture/status`, `GET /v1/capture/{operation}` (`start`, `stop`), `GET /v1/capture/settings` (`source`, `audio_routing`, `disk`, `rtmp`, `resi`), `GET /v1/capture/encodings/{type}` (`disk`, `rtmp`, `resi`) |

---

## 5. Companion WebSocket, Web UI & ProLink Synchronization Protocols

### 5.1 Built-in Web UI & WebSocket Endpoints (`control-tower`)
In addition to `/v1/*`, `ProPresenter Helper (Network)` mounts:
- `GET /doc` $\rightarrow$ Interactive OpenAPI documentation viewer.
- `GET /control/` and `GET /control/{filename:.*}` $\rightarrow$ Built-in React Web Remote application (`activePlaylistUUID`, `chunkDataChangeURLs`, live slide/playlist/timer/stage control).
- `GET /html/pages/messages` and `/html/assets/{filename:.*}` $\rightarrow$ Built-in Web Messages operator page.
- `ws://<host>:<port>/remote` $\rightarrow$ ProPresenter Remote WebSocket (`pro7proremote`).
- `ws://<host>:<port>/stagedisplay` $\rightarrow$ Stage Display WebSocket (`pro7stagedsply`).
  - Both `/remote` and `/stagedisplay` authenticate via `RemoteAuthenticationMessage` (`password`, `protocol` / `controller` / `stageDisplay`) and bridge frames between `control_tower::socket::WebSocket` and `ProCore` via `IpcToWebSocketMessage`.

### 5.2 ProLink Multi-Instance Synchronization Protocol (`proApi.proto`)
When two or more ProPresenter instances are linked in a **ProLink Group**, `control-tower` coordinates frame-accurate cue execution across machines using a **Two-Step Preroll + Render-Time Trigger** protocol:
1. **Group Membership & Heartbeat:**
   - `/group`, `/status` (`TowerStatusRequest` / `TowerStatusResponse`), `/add_member` (`TowerAddMemberRequest` / `TowerAddMemberResponse`), `/remove_member` (`TowerRemoveMemberRequest`), `/heartbeat` (`TowerHeartbeatRequest` / `TowerHeartbeatResponse`).
2. **Two-Step Preroll & Synchronized Execution (`/preroll`):**
   - **Step 1 (`PrerollRequest` / `API_TwoStepTrigger`):** Sponsor sends `PrerollRequest` (`operation: "preroll"`, target item/cue path, `preroll_id`) to all group members.
   - **Step 2 (`PrerollComplete` / `PrerollReady`):** Each member loads media/slides into GPU memory and replies with `PrerollComplete` (`latency`, `render_time`, `failed`).
   - **Step 3 (`ActivatePrerollItem`):** Sponsor computes the maximum member latency and broadcasts `ActivatePrerollItem` (`operation: "activate"`, scheduled `render_time` timestamp) so all machines transition on the exact same video frame.

---

## 6. Broadcast Hardware, MIDI, DMX & Video Output Interop (`communications.proto`)

ProPresenter's `ProCore.framework` (`communications.proto`, `dmxProfiles.proto`, `timecode.proto`) includes native controller/device drivers for 22 external broadcast and production protocols:

### 6.1 Supported `CommunicationDevice.DeviceType` Protocols
- **Lighting & Show Control:** `DEVICE_TYPE_DMX` (Art-Net via `ArtnetHardware`), `DEVICE_TYPE_MIDI` (`MIDIHardware` CoreMIDI/WinMM sources & destinations, `MidiCommand` Note On/Off, Control Change, Program Change), `DEVICE_TYPE_CITP`.
- **Broadcast Switchers & Video Servers:** `DEVICE_TYPE_ROSSTALK` (Ross Carbonite/Acuity over TCP/Serial), `DEVICE_TYPE_AMP` (Grass Valley / Odetics AMP), `DEVICE_TYPE_GVG100` (Grass Valley 100), `DEVICE_TYPE_SONY_BVS`, `DEVICE_TYPE_SONY_BVW` (RS-422 9-pin), `DEVICE_TYPE_VDCP` (Video Disk Control Protocol), `DEVICE_TYPE_GLOBAL_CACHE`.
- **Scoreboards:** `ALL_AMERICAN_8000`, `ALL_AMERICAN_9000`, `DAKTRONICS`, `DAKTRONICS_TV`, `ELECTRO_MECH`, `EVERSAN`, `FAIR_PLAY_MP70`, `HARRIS`, `JUGS`, `OES` (`OESProMode`), `SCOREBIRD`, `SCOREBOT`, `STALKER`, `STAT_CREW`.

### 6.2 Video/Audio IP & GPU Outputs
- **NDI (`libndi.dylib`, `TYPE_NDI`):** Outputs Audience and Stage screens over NDI with embedded alpha channel (`Matte.Alpha` / straight or premultiplied) and multi-channel routed audio buses.
- **Syphon (`Syphon.framework`, `TYPE_SYPHON`):** Shares zero-copy Metal/OpenGL GPU framebuffers (`ssMLViewController syphonServer` / `ssGLViewController syphonServer`) with local macOS broadcast software (such as OBS Studio or VDMX/Resolume).
