# Clean-Room Interoperability Specification: OBS Studio 33.0.1 (`obs-websocket` v5 & Output Protocols)

> **Clean-Room Notice:** This document is a strictly clean-room interoperability specification describing the `obs-websocket` v5 wire protocol, authentication handshake, opcodes, event subscription bitmasks, request/event schemas (including OBS 33 multi-canvas extensions), and streaming/output service schemas (`rtmp_common`, `rtmp_custom`, `whip_custom`, SRT, RIST). It contains zero copied source code, decompiled functions, or proprietary assets.

---

## 1. Architecture Overview

OBS Studio 33.0.1 exposes external automation, telemetry, and media output capabilities through three primary interfaces:

1. **`obs-websocket` v5 Protocol (`TCP 4455`):** Built-in WebSocket RPC & event broadcast server (`obs-websocket.dll`) supporting JSON (`obswebsocket.json`) and MessagePack (`obswebsocket.msgpack`) encodings, salted SHA-256 challenge-response authentication, atomic/serial/frame-synced request batching, and high-frequency audio peak/input metering (`InputVolumeMeters`).
2. **OBS 33 Multi-Canvas Architecture:** OBS 33 introduces first-class multi-canvas support (`obs_canvas_t`, `canvasUuid`, `GetCanvasList`, `CanvasCreated`/`Removed`/`NameChanged`) allowing independent video canvases (e.g., Main 16:9 Broadcast Canvas vs. 9:16 Vertical/Short-Form Canvas or Stage Display Canvas).
3. **Output & Streaming Services (`obs-outputs`, `rtmp-services`, `obs-webrtc`, `obs-ffmpeg`):** Modular output engine supporting RTMP/RTMPS (`rtmp_common` / `rtmp_custom`), Enhanced Broadcasting / Multitrack Video, WebRTC WHIP (`whip_custom` with Bearer token & simulcast), SRT (`srt://`), RIST (`rist://`), Virtual Camera, and Replay Buffer. Furthermore, `obs-websocket` exposes `GetOutputList`, `StartOutput`, `StopOutput`, and `SetOutputSettings` to control multiple named outputs simultaneously.

---

## 2. `obs-websocket` v5 Connection & Authentication Handshake

### 2.1 Transport & Subprotocol Negotiation
- **Default Endpoint:** `ws://<host>:4455` (configurable in `%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json` or global INI config).
- **WebSocket Subprotocols (`Sec-WebSocket-Protocol`):**
  - `obswebsocket.json` *(Default if omitted)* — All frames are UTF-8 JSON text frames.
  - `obswebsocket.msgpack` — All frames are binary MessagePack frames.

### 2.2 Envelope Format & OpCodes (`op`)
Every WebSocket message is an object with two top-level keys: `op` (integer OpCode) and `d` (payload data object):
```json
{
  "op": 0,
  "d": { ... }
}
```

| OpCode (`op`) | Name | Direction | Purpose |
| :--- | :--- | :--- | :--- |
| `0` | `Hello` | Server $\rightarrow$ Client | Sent immediately upon WebSocket connection open; provides server version, `rpcVersion`, and optional `authentication` (`challenge`, `salt`). |
| `1` | `Identify` | Client $\rightarrow$ Server | Sent by client in response to `Hello`; specifies requested `rpcVersion`, computed `authentication` string, and `eventSubscriptions` bitmask. |
| `2` | `Identified` | Server $\rightarrow$ Client | Confirms successful authentication and returns `negotiatedRpcVersion` (currently `1`). |
| `3` | `Reidentify` | Client $\rightarrow$ Server | Dynamically updates `eventSubscriptions` bitmask on an already-identified session. |
| `5` | `Event` | Server $\rightarrow$ Client | Asynchronous state change or high-frequency telemetry notification (`eventType`, `eventIntent`, `eventData`). |
| `6` | `Request` | Client $\rightarrow$ Server | Single RPC invocation (`requestType`, `requestId`, optional `requestData`). |
| `7` | `RequestResponse` | Server $\rightarrow$ Client | Reply to `Op 6` (`requestType`, `requestId`, `requestStatus: { result, code, comment }`, optional `responseData`). |
| `8` | `RequestBatch` | Client $\rightarrow$ Server | Executes an array of `requests` sequentially, on the OBS video frame tick, or in parallel (`requestId`, `haltOnFailure`, `executionType`, `variables`, `requests`). |
| `9` | `RequestBatchResponse` | Server $\rightarrow$ Client | Reply to `Op 8` (`requestId`, `results`). |

### 2.3 Salted SHA-256 Authentication Algorithm
When authentication is enabled on the server, `Op 0 (Hello)` includes:
```json
{
  "op": 0,
  "d": {
    "obsStudioVersion": "33.0.1",
    "obsWebSocketVersion": "5.x.x",
    "rpcVersion": 1,
    "authentication": {
      "challenge": "<base64_challenge>",
      "salt": "<base64_salt>"
    }
  }
}
```
To compute the `authentication` response string for `Op 1 (Identify)`:
1. Concatenate the UTF-8 password and the `salt` string: `pass_salt = password + salt`
2. Compute the binary SHA-256 digest of `pass_salt` and Base64-encode it: `secret = Base64(SHA256(pass_salt))`
3. Concatenate `secret` and the `challenge` string: `secret_challenge = secret + challenge`
4. Compute the binary SHA-256 digest of `secret_challenge` and Base64-encode it: `auth_response = Base64(SHA256(secret_challenge))`
5. Send `Op 1 (Identify)`:
   ```json
   {
     "op": 1,
     "d": {
       "rpcVersion": 1,
       "authentication": "<auth_response>",
       "eventSubscriptions": 2047
     }
   }
   ```

### 2.4 Event Subscription Bitmask (`EventSubscription`)
The `eventSubscriptions` field in `Identify` (`Op 1`) and `Reidentify` (`Op 3`) is a bitwise OR of the following intent flags:

| Bit / Value | Symbolic Name | Subscribed Event Category |
| :--- | :--- | :--- |
| `0` | `None` | Disables all events |
| `1 << 0` (`1`) | `General` | `ExitStarted`, `VendorEvent`, `CustomEvent` |
| `1 << 1` (`2`) | `Config` | Scene collection, profile, and OBS 33 canvas creation/removal/switch events |
| `1 << 2` (`4`) | `Scenes` | Scene creation, removal, rename, and Program/Preview scene switch events |
| `1 << 3` (`8`) | `Inputs` | Input creation, removal, rename, settings, mute, volume (`dB`/`mul`), balance, sync offset, audio tracks, and monitor type events |
| `1 << 4` (`16`) | `Transitions` | Transition change, duration change, and transition start/end events |
| `1 << 5` (`32`) | `Filters` | Source filter creation, removal, settings, enable/disable, and reorder events |
| `1 << 6` (`64`) | `Outputs` | Stream, Record, Replay Buffer, and VirtualCam state change events |
| `1 << 7` (`128`) | `SceneItems` | Scene item creation, removal, visibility (`sceneItemEnabled`), lock, and transform events |
| `1 << 8` (`256`) | `MediaInputs` | Media playback start, end, and action triggered events |
| `1 << 9` (`512`) | `Vendors` | Third-party plugin vendor events |
| `1 << 10` (`1024`) | `Ui` | Studio Mode toggle and Screenshot saved events |
| `(1<<11)-1` (`2047`) | `All` | All standard low-volume events (`General` through `Ui`) |
| `1 << 16` (`65536`) | `InputVolumeMeters` | *(High-Volume)* Real-time per-frame audio peak/magnitude levels (`inputLevelsMul`) for all active audio inputs |
| `1 << 17` (`131072`) | `InputActiveStateChanged` | *(High-Volume)* Input active on Program state changes |
| `1 << 18` (`262144`) | `InputShowStateChanged` | *(High-Volume)* Input showing on Preview/Program state changes |
| `1 << 19` (`524288`) | `SceneItemTransformChanged` | *(High-Volume)* Continuous position/scale/crop transform updates |

### 2.5 Request Batch Execution Modes (`RequestBatchExecutionType`)
In `Op 8 (RequestBatch)`, `executionType` controls how the array of requests is processed, and `inputVariables` / `outputVariables` allow piping fields from one request's `responseData` into subsequent requests' `requestData`:
- `-1`: `None`
- `0`: `SerialRealtime` — Executes requests sequentially as fast as possible on a worker thread; supports variable piping (`inputVariables` / `outputVariables`).
- `1`: `SerialFrame` — Executes requests sequentially synchronized to the OBS graphics/video frame tick (`obs_websocket_request_batch_frame_tick`), allowing frame-accurate scene/item choreography.
- `2`: `Parallel` — Executes requests concurrently across the thread pool (variables not supported).

---

## 3. Complete `obs-websocket` v5 Request Catalog (OBS 33.0.1)

All requests are invoked via `Op 6` (`Request`) or `Op 8` (`RequestBatch`). Sources, scenes, inputs, transitions, and canvases can be addressed by name (`sceneName`, `inputName`, `canvasName`) or by immutable UUID (`sceneUuid`, `inputUuid`, `canvasUuid`).

### 3.1 General & System Requests
- `GetVersion` $\rightarrow$ `{ obsVersion, obsWebSocketVersion, rpcVersion, availableRequests, supportedImageFormats, platform, platformDescription }`
- `GetStats` $\rightarrow$ `{ cpuUsage, memoryUsage, availableDiskSpace, activeFps, averageFrameRenderTime, renderSkippedFrames, renderTotalFrames, outputSkippedFrames, outputTotalFrames, webSocketSessionIncomingMessages, webSocketSessionOutgoingMessages }`
- `BroadcastCustomEvent` (`{ eventData }`) — Broadcasts a `CustomEvent` to all connected WebSocket clients.
- `CallVendorRequest` (`{ vendorName, requestType, requestData }`) — Invokes a registered third-party plugin vendor API (e.g., `obs-ndi`, `advanced-scene-switcher`, `aitum-multistream`).
- `GetHotkeyList` / `TriggerHotkeyByName` (`{ hotkeyName, contextName }`) / `TriggerHotkeyByKeySequence` (`{ keyId, keyModifiers: { shift, control, alt, command } }`)
- `Sleep` (`{ sleepMillis, sleepFrames }`) — Used inside `SerialRealtime` or `SerialFrame` request batches.

### 3.2 Config, Profiles, Scene Collections & Canvases (OBS 33)
- `GetPersistentData` / `SetPersistentData` (`{ realm: "OBS_WEBSOCKET_DATA_REALM_GLOBAL" | "OBS_WEBSOCKET_DATA_REALM_PROFILE", slotName, slotValue }`)
- `GetSceneCollectionList` $\rightarrow$ `{ currentSceneCollectionName, sceneCollections: string[] }`
- `SetCurrentSceneCollection` / `CreateSceneCollection` (`{ sceneCollectionName }`)
- `GetProfileList` $\rightarrow$ `{ currentProfileName, profiles: string[] }`
- `SetCurrentProfile` / `CreateProfile` / `RemoveProfile` (`{ profileName }`)
- `GetProfileParameter` / `SetProfileParameter` (`{ parameterCategory, parameterName, parameterValue }`)
- `GetVideoSettings` / `SetVideoSettings` (`{ fpsNumerator, fpsDenominator, baseWidth, baseHeight, outputWidth, outputHeight }`)
- `GetStreamServiceSettings` / `SetStreamServiceSettings` (`{ streamServiceType, streamServiceSettings }`)
- `GetRecordDirectory` / `SetRecordDirectory` (`{ recordDirectory }`)
- `GetCanvasList` *(New in OBS 33)* $\rightarrow$ `{ canvases: [{ canvasName, canvasUuid, canvasFlags: { MAIN, ACTIVATE, EPHEMERAL, SCENE_REF, MIX_AUDIO }, canvasVideoSettings }] }`

### 3.3 Scenes & Scene Items
- `GetSceneList` (`{ canvasUuid? }`) $\rightarrow$ `{ currentProgramSceneName, currentProgramSceneUuid, currentPreviewSceneName, currentPreviewSceneUuid, scenes: [...] }`
- `GetGroupList` $\rightarrow$ `{ groups: string[] }`
- `GetCurrentProgramScene` / `SetCurrentProgramScene` (`{ sceneName?, sceneUuid? }`)
- `GetCurrentPreviewScene` / `SetCurrentPreviewScene` (`{ sceneName?, sceneUuid? }`)
- `CreateScene` (`{ sceneName, canvasUuid? }`) / `RemoveScene` / `SetSceneName` (`{ sceneName?, sceneUuid?, newSceneName }`)
- `GetSceneSceneTransitionOverride` / `SetSceneSceneTransitionOverride` (`{ sceneName?, sceneUuid?, transitionName, transitionDuration }`)
- `GetSceneItemList` / `GetGroupSceneItemList` (`{ sceneName?, sceneUuid?, canvasUuid? }`)
- `GetSceneItemId` (`{ sceneName?, sceneUuid?, sourceName, searchOffset? }`) $\rightarrow$ `{ sceneItemId }`
- `GetSceneItemSource` (`{ sceneName?, sceneUuid?, sceneItemId }`) $\rightarrow$ `{ sourceName, sourceUuid }`
- `CreateSceneItem` (`{ sceneName?, sceneUuid?, sourceName?, sourceUuid?, sceneItemEnabled? }`) / `RemoveSceneItem` / `DuplicateSceneItem`
- `GetSceneItemTransform` / `SetSceneItemTransform` (`{ sceneName?, sceneUuid?, sceneItemId, sceneItemTransform: { positionX, positionY, rotation, scaleX, scaleY, alignment, boundsType, boundsAlignment, boundsWidth, boundsHeight, cropLeft, cropRight, cropTop, cropBottom, cropToBounds } }`)
- `GetSceneItemEnabled` / `SetSceneItemEnabled` (`{ sceneName?, sceneUuid?, sceneItemId, sceneItemEnabled: boolean }`)
- `GetSceneItemLocked` / `SetSceneItemLocked` (`{ sceneName?, sceneUuid?, sceneItemId, sceneItemLocked: boolean }`)
- `GetSceneItemIndex` / `SetSceneItemIndex` (`{ sceneName?, sceneUuid?, sceneItemId, sceneItemIndex: number }`)
- `GetSceneItemBlendMode` / `SetSceneItemBlendMode` (`{ sceneItemBlendMode: "OBS_BLEND_NORMAL" | "OBS_BLEND_ADDITIVE" | "OBS_BLEND_SUBTRACT" | "OBS_BLEND_SCREEN" | "OBS_BLEND_MULTIPLY" | "OBS_BLEND_LIGHTEN" | "OBS_BLEND_DARKEN" }`)

### 3.4 Inputs & Audio Mixer Control
- `GetInputList` (`{ inputKind? }`) / `GetInputKindList` (`{ unversioned? }`) / `GetSpecialInputs` $\rightarrow$ `{ desktop1, desktop2, mic1, mic2, mic3, mic4 }`
- `CreateInput` (`{ sceneName?, sceneUuid?, inputName, inputKind, inputSettings?, sceneItemEnabled? }`) / `RemoveInput` / `SetInputName`
- `GetInputDefaultSettings` (`{ inputKind }`) / `GetInputSettings` / `SetInputSettings` (`{ inputName?, inputUuid?, inputSettings, overlay?: boolean }`)
- `GetInputMute` / `SetInputMute` / `ToggleInputMute` (`{ inputName?, inputUuid?, inputMuted }`)
- `GetInputVolume` / `SetInputVolume` (`{ inputName?, inputUuid?, inputVolumeMul?, inputVolumeDb? }`)
- `GetInputAudioBalance` / `SetInputAudioBalance` (`{ inputName?, inputUuid?, inputAudioBalance: 0.0..1.0 }`)
- `GetInputAudioSyncOffset` / `SetInputAudioSyncOffset` (`{ inputName?, inputUuid?, inputAudioSyncOffset }` in milliseconds)
- `GetInputAudioMonitorType` / `SetInputAudioMonitorType` (`{ inputName?, inputUuid?, monitorType: "OBS_MONITORING_TYPE_NONE" | "OBS_MONITORING_TYPE_MONITOR_ONLY" | "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT" }`)
- `GetInputAudioTracks` / `SetInputAudioTracks` (`{ inputName?, inputUuid?, inputAudioTracks: { "1": true, "2": false, ... } }`)
- `GetInputPropertiesListPropertyItems` / `PressInputPropertiesButton` (`{ inputName?, inputUuid?, propertyName }`)

### 3.5 Transitions, Studio Mode & Filters
- `GetTransitionKindList` / `GetSceneTransitionList`
- `GetCurrentSceneTransition` / `SetCurrentSceneTransition` (`{ transitionName }`)
- `SetCurrentSceneTransitionDuration` (`{ transitionDuration }`) / `SetCurrentSceneTransitionSettings` (`{ transitionSettings, overlay? }`)
- `GetCurrentSceneTransitionCursor` $\rightarrow$ `{ transitionCursor: 0.0..1.0 }`
- `TriggerStudioModeTransition` — Executes the active transition from Preview to Program.
- `SetTBarPosition` (`{ position: 0.0..1.0, release?: boolean }`)
- `GetStudioModeEnabled` / `SetStudioModeEnabled` (`{ studioModeEnabled: boolean }`)
- `GetSourceFilterList` / `GetSourceFilter` / `CreateSourceFilter` / `RemoveSourceFilter` / `SetSourceFilterName` / `SetSourceFilterSettings` / `SetSourceFilterEnabled` / `SetSourceFilterIndex`

### 3.6 Outputs, Streaming, Recording & Multi-Output Control
- **Primary Stream Output:**
  - `GetStreamStatus` $\rightarrow$ `{ outputActive, outputReconnecting, outputTimecode, outputDuration, outputCongestion, outputBytes, outputSkippedFrames, outputTotalFrames }`
  - `StartStream` / `StopStream` / `ToggleStream`
  - `SendStreamCaption` (`{ captionText }`) — Injects CEA-608/708 closed caption text into the active stream.
- **Primary Record Output:**
  - `GetRecordStatus` $\rightarrow$ `{ outputActive, outputPaused, outputTimecode, outputDuration, outputBytes }`
  - `StartRecord` / `StopRecord` / `ToggleRecord` / `PauseRecord` / `ResumeRecord` / `ToggleRecordPause`
  - `SplitRecordFile` — Immediately splits the active recording into a new file (`RecordFileChanged`).
  - `CreateRecordChapter` (`{ chapterName? }`) — Inserts a chapter marker into Hybrid MP4 / Matroska recordings.
- **Virtual Camera & Replay Buffer:**
  - `GetVirtualCamStatus` / `StartVirtualCam` / `StopVirtualCam` / `ToggleVirtualCam`
  - `GetReplayBufferStatus` / `StartReplayBuffer` / `StopReplayBuffer` / `ToggleReplayBuffer` / `SaveReplayBuffer` / `GetLastReplayBufferReplay`
- **Generic Multi-Output Management (`GetOutputList` / `StartOutput`):**
  - `GetOutputList` $\rightarrow$ `{ outputs: [{ outputName, outputKind, outputWidth, outputHeight, outputActive, outputFlags: { OBS_OUTPUT_AUDIO, OBS_OUTPUT_VIDEO, OBS_OUTPUT_ENCODED, OBS_OUTPUT_MULTI_TRACK, OBS_OUTPUT_SERVICE } }] }`
  - `GetOutputStatus` / `StartOutput` / `StopOutput` / `ToggleOutput` (`{ outputName }`)
  - `GetOutputSettings` / `SetOutputSettings` (`{ outputName, outputSettings }`)

### 3.7 Media Inputs, Screenshots & Projectors
- `GetMediaInputStatus` / `SetMediaInputCursor` / `OffsetMediaInputCursor`
- `TriggerMediaInputAction` (`{ inputName?, inputUuid?, mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY" | "PAUSE" | "STOP" | "RESTART" | "NEXT" | "PREVIOUS" }`)
- `GetSourceScreenshot` / `SaveSourceScreenshot` (`{ sourceName?, sourceUuid?, imageFormat, imageWidth?, imageHeight?, imageCompressionQuality? }`)
- `GetMonitorList` / `OpenVideoMixProjector` (`{ videoMixType: "OBS_WEBSOCKET_VIDEO_MIX_TYPE_PREVIEW" | "PROGRAM" | "MULTIVIEW", monitorIndex?, projectorGeometry? }`) / `OpenSourceProjector`

---

## 4. Streaming Services & Simultaneous Multi-Destination Architecture

### 4.1 Built-in Stream Service Types (`SetStreamServiceSettings`)
OBS Studio 33 supports three `streamServiceType` identifiers in `SetStreamServiceSettings`:

1. **`rtmp_common` (Named Service Preset from `services.json`):**
   ```json
   {
     "streamServiceType": "rtmp_common",
     "streamServiceSettings": {
       "service": "YouTube - RTMPS",
       "server": "rtmps://a.rtmps.youtube.com:443/live2",
       "key": "<stream_key>"
     }
   }
   ```
   *(Common `service` values in `core/rtmp-services/data/services.json` include `"YouTube - RTMPS"`, `"YouTube - HLS"`, `"Facebook Live"`, `"Twitch"`, `"Restream.io"`, `"Vimeo"`, `"BoxCast"`.)*

2. **`rtmp_custom` (Custom RTMP / RTMPS / SRT / RIST Server):**
   ```json
   {
     "streamServiceType": "rtmp_custom",
     "streamServiceSettings": {
       "server": "rtmps://live-api-s.facebook.com:443/rtmp/",
       "key": "<stream_key>",
       "use_auth": false,
       "username": "",
       "password": ""
     }
   }
   ```
   *(Also accepts `srt://<host>:<port>?streamid=...` and `rist://<host>:<port>` URLs via `obs-ffmpeg`.)*

3. **`whip_custom` (WebRTC WHIP Sub-Second Streaming via `obs-webrtc.dll`):**
   ```json
   {
     "streamServiceType": "whip_custom",
     "streamServiceSettings": {
       "server": "https://<whip-endpoint>/whip",
       "bearer_token": "<token>"
     }
   }
   ```

### 4.2 Simultaneous Multi-Destination Streaming (YouTube + Facebook Live)
While OBS's primary UI stream button drives the single primary service (`adv_stream`), simultaneous streaming to **YouTube** and **Facebook Live** from OBS can be achieved cleanly via any of three mechanisms:
1. **Multiple Named Outputs via `obs-websocket` / Lua / Python Scripting (`obs_output_create`):**
   - OBS's `obspython` / `obslua` scripting engine (`obs-scripting.dll`) or a companion plugin can instantiate additional `rtmp_output` instances (`obs_output_create("rtmp_output", "youtube_stream", ...)` and `obs_output_create("rtmp_output", "facebook_stream", ...)`) sharing the active video/audio encoders (`obs_output_get_video_encoder`, `obs_output_get_audio_encoder`).
   - Once created, every secondary output automatically appears in `obs-websocket`'s `GetOutputList` and can be started, stopped, and monitored (`GetOutputStatus` $\rightarrow$ `outputBytes`, `outputCongestion`, `outputSkippedFrames`) via standard `StartOutput` / `StopOutput` WebSocket calls.
2. **FFmpeg Custom Output (`adv_ffmpeg_output`):**
   - The secondary output in OBS ("Recording $\rightarrow$ Type: Custom Output (FFmpeg)") can be pointed to a second RTMP/RTMPS URL and controlled via `StartRecord` / `StopRecord`.
3. **Local MediaMTX / NGINX-RTMP Fan-Out Relay in "One Ring":**
   - Point OBS's single primary stream to the Unified Controller's local RTMP ingest (`rtmp://127.0.0.1:1935/live/main`), and let the Unified Controller fan out the encoded H.264/AAC bitstream simultaneously to YouTube RTMPS, Facebook RTMPS, and local HLS/WebRTC confidence monitors with zero extra GPU encoding load on the OBS machine, while independently starting/stopping each platform target.
