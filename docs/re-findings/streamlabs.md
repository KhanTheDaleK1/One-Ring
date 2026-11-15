# Streamlabs Desktop 1.21.9 Clean-Room Protocol & Interoperability Specification

> **Clean-Room IP Notice:** This specification was produced through clean-room black-box/gray-box interoperability analysis of Streamlabs Desktop v1.21.9 (`slobs-client`, Electron + `obs-studio-node`). It contains **zero copied source code, zero decompiled JavaScript/C++ bodies, and zero disassembled instructions**. It documents only wire protocols, transport endpoints, JSON-RPC 2.0 schemas, resource/event contracts, and media/IPC boundaries required to build an independent, interoperable controller (`one-ring-to-rule-them-all`).

---

## 1. Architectural Overview & Process Boundaries

Streamlabs Desktop (`Streamlabs OBS.exe`, v1.21.9) is an Electron application built around a three-process architecture coupled with an out-of-process native media engine (`obs64.exe`):

1. **Main Process (`main.js`):** Manages native OS windows, life-cycle events, crash reporting, and Electron IPC routing.
2. **Worker Window Process (`index.html?windowId=worker`):** The headless/background renderer process that owns all core application state (`ServicesManager`), loads the native Node.js addon `obs-studio-node` (`obs_studio_client.node`), and hosts the **External API Server (`TcpServerService` / `ExternalApiService`)**, **Internal IPC Server (`IpcServerService`)**, and **Mobile/Cloud Remote Control bridge (`RemoteControlService`)**.
   - Attempting to access `obs-studio-node` from any window whose URL query parameter is not `windowId=worker` throws an immediate access violation error via a guard proxy.
3. **UI Renderer Windows (`windowId=main`, `windowId=child`, `windowId=oneOff`):** React/Vue frontend views that invoke worker services over Electron IPC (`services-request` / `services-response` / `services-ready`) using the same JSON-RPC 2.0 envelope as external network clients.
4. **Out-of-Process Native OBS Engine (`obs64.exe`):** Spawned by `obs_studio_client.node` and controlled over a high-throughput local Windows Named Pipe IPC channel (`\\.\pipe\<uuid>`). Includes bundled native plugins (`obs-ndi.dll` requiring NDI Runtime $\ge$ 6.0.0, `win-spout.dll` + `Spout.dll`, `mediasoup-connector.dll` for WebRTC Guest Cam / Collab Cam, and `obs-webrtc.dll`).

---

## 2. External Remote Control Transport Layer (`TcpServerService`)

Streamlabs Desktop exposes a unified **JSON-RPC 2.0 over streaming transport** protocol managed by `TcpServerService` and dispatched through `ExternalApiService` (with fallback delegation to `InternalApiService`).

### 2.1 Supported Transports & Default Binding State

| Transport | Endpoint / Binding | Default State | Authentication Requirement | Framing |
| :--- | :--- | :--- | :--- | :--- |
| **Local Loopback TCP** | `127.0.0.1:28194` | **Always Enabled** | **Auto-Authorized** (when `remoteAddress` matches an internal/loopback interface) | Newline-delimited JSON (`\n`, ASCII `0x0A`) |
| **Windows Named Pipe** | `\\.\pipe\slobs` | **Enabled** (`namedPipe.enabled = true`, `pipeName = "slobs"`) | **Auto-Authorized** (`namedPipe === server.type`) | Newline-delimited JSON (`\n`, ASCII `0x0A`) |
| **SockJS / WebSocket** | `http://<host>:59650/api` (`ws://<host>:59650/api/<server_id>/<session_id>/websocket`) | **Disabled** (`websockets.enabled = false`, `port = 59650`, `allowRemote = false`) | **Token Required** (`TcpServerService.auth`) | SockJS WebSocket framing (inner payload is newline-delimited JSON) |
| **Mobile / Cloud Socket.IO Relay** | `https://streamlabs.com/api/v5/slobs/modules/mobile-remote-io/config?device_name=<hostname>` | **Disabled** (`RemoteControlService.state.enabled = false`) | Streamlabs OAuth API Token + Socket.IO session token (`?token=<token>`) | Socket.IO `message` event with ACK callback |

> **Integration Advantage for `one-ring-to-rule-them-all`:**
> Even when the user has **not** enabled WebSockets in *Settings $\rightarrow$ Remote Control / API*, a local agent running on the same Windows host can connect directly to **`\\.\pipe\slobs`** or **`127.0.0.1:28194`** with **zero configuration and no authentication token required**. For LAN control from a separate machine, enabling Remote Connections in Streamlabs Desktop binds the SockJS server to `0.0.0.0:59650` under prefix `/api` and generates a 40-hex-character random token (20 random bytes).

---

## 3. JSON-RPC 2.0 Wire Protocol & Message Schemas

### 3.1 Request Envelope
Every client request must be a valid JSON object terminated by a single Line Feed (`\n`, `0x0A`). If multiple requests are sent in a single TCP/pipe write, they must be separated by `\n`. Sending malformed JSON causes the server to return `-32600 INVALID_REQUEST` and immediately disconnect the client socket.

```json
{
  "jsonrpc": "2.0",
  "id": "req-uuid-or-integer",
  "method": "<methodOrPropertyGetterName>",
  "params": {
    "resource": "<ResourceId>",
    "args": [],
    "fetchMutations": false,
    "compactMode": false
  }
}
```

#### Request Validation Rules (`validateRequest`)
- `id`: **Required** (non-empty string or non-zero number). Missing `id` returns `-32602 INVALID_PARAMS: "id is required;"`.
- `params`: **Required** object. Missing `params` returns `-32602 INVALID_PARAMS: "params is required;"`.
- `params.resource`: **Required** string identifying either a singleton service name (e.g., `"ScenesService"`) or a parameterized helper instance (e.g., `"Scene[\"scene_123\"]"` or `"SceneItem[\"scene_123\", \"item_456\", \"source_789\"]"`).
- `params.args`: Optional array of positional arguments passed to `resource[method](...args)`.
- **Blocked Resources:** Any request targeting `"FileManagerService"` over `TcpServerService` is rejected with `-32603 INTERNAL_JSON_RPC_ERROR: "The requested resource is not available."`.

### 3.2 Authentication Handshake (WebSocket / Non-Local Clients)
Clients connecting via SockJS/WebSocket (`port 59650`) start with `isAuthorized = false`. Any request sent prior to authorization returns `-32603 INTERNAL_JSON_RPC_ERROR: "Authorization required. Use TcpServerService.auth method"`.

**Authentication Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "auth",
  "params": {
    "resource": "TcpServerService",
    "args": ["<api-token-string>"]
  }
}
```
**Authentication Success Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": true
}
```

### 3.3 Response & Resource Serialization Rules (`RpcApi.serializePayload`)
Depending on the return value of `resource[method](...args)`:

1. **Primitive or Plain Data Object:** Returned directly in `result`.
2. **Helper / Resource Object (`_type: "HELPER"`):** When a service method returns a domain object (such as a `Scene`, `SceneItem`, `Source`, `AudioSource`, or `Selection`), the serializer returns its serialized model merged with a `_type: "HELPER"` descriptor and its callable `resourceId`:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 2,
     "result": {
       "_type": "HELPER",
       "resourceId": "Scene[\"scene_a1b2c3\"]",
       "id": "scene_a1b2c3",
       "name": "Main Camera",
       "nodes": []
     }
   }
   ```
   Subsequent calls can invoke methods directly on that helper by passing `"resource": "Scene[\"scene_a1b2c3\"]"`.
3. **RxJS Observable Subscription (`_type: "SUBSCRIPTION"`):** When a client invokes a property getter that returns an RxJS `Subject`/`Observable` (e.g., `ScenesService.sceneSwitched`, `StreamingService.streamingStatusChange`), the server registers the client for that event stream and replies:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 3,
     "result": {
       "_type": "SUBSCRIPTION",
       "resourceId": "ScenesService.sceneSwitched",
       "emitter": "STREAM"
     }
   }
   ```
4. **Asynchronous Promise (`emitter: "PROMISE"`):** When an invoked method returns a `Promise`, the immediate JSON-RPC reply returns a `SUBSCRIPTION` with `"emitter": "PROMISE"` and a `resourceId`, followed by an asynchronous `EVENT` frame when the promise resolves or rejects.

### 3.4 Asynchronous Event Frame (`_type: "EVENT"`)
Whenever a subscribed stream emits or a forced lifecycle event occurs (`collectionWillSwitch`, `collectionAdded`, `collectionRemoved`, `collectionSwitched`, `collectionUpdated`, `studioModeChanged`), the server pushes a notification frame with `id: null`:

```json
{
  "jsonrpc": "2.0",
  "id": null,
  "result": {
    "_type": "EVENT",
    "emitter": "STREAM",
    "resourceId": "StreamingService.streamingStatusChange",
    "data": "live"
  }
}
```

For resolved promises (`emitter: "PROMISE"`):
```json
{
  "jsonrpc": "2.0",
  "id": null,
  "result": {
    "_type": "EVENT",
    "emitter": "PROMISE",
    "resourceId": "<promise-resource-id>",
    "data": {},
    "isRejected": false
  }
}
```

### 3.5 Error Codes (`E_JSON_RPC_ERROR`)
| Code | Constant Name | Meaning |
| :--- | :--- | :--- |
| `-32700` | `PARSE_ERROR` | Invalid JSON syntax |
| `-32600` | `INVALID_REQUEST` | Malformed request frame or rate limit exceeded (`ExternalApiLimitsService`) |
| `-32601` | `METHOD_NOT_FOUND` | Method does not exist on the target resource |
| `-32602` | `INVALID_PARAMS` | Missing `id`, `params`, `params.resource`, or unknown `resourceId` |
| `-32603` | `INTERNAL_JSON_RPC_ERROR` | Unauthorized client, invalid token, blocked resource, or server busy |
| `-32000` | `INTERNAL_SERVER_ERROR` | Uncaught exception during service execution (includes error message & stack) |

### 3.6 Rate Limiting (`ExternalApiLimitsService`)
`ExternalApiService` maintains a token bucket (`this.points = 2`, refilled to `2` every `1000 ms`). Expensive methods decorated with `@lock()` / `@limit()` (such as `SceneCollectionsService.fetchSceneCollectionsSchema`) deduct points per second; exceeding the budget returns `-32600 INVALID_REQUEST: 'Reached the limit of calls for "<Resource>.<method>"'`. Standard scene, source, audio, and streaming methods have zero cost (`costPerSecond = 0`).

---

## 4. External API Resource & Method Reference

The `ExternalApiService` registry exports 19 primary resource classes, and automatically proxies any non-overridden properties/methods to the underlying internal service via its `@Fallback()` (`_fallback`) decorator.

### 4.1 `StreamingService` (Singleton)
Controls live streaming, recording, and replay buffer outputs.

| Method / Event | Type | Parameters | Return / Payload Schema |
| :--- | :--- | :--- | :--- |
| `getModel()` | Method | `[]` | `{ streamingStatus: "offline" \| "starting" \| "live" \| "ending" \| "reconnecting", recordingStatus: "offline" \| "starting" \| "recording" \| "stopping" \| "wrote", replayBufferStatus: "offline" \| "running" \| "saving" \| "stopping", selectiveRecording: boolean }` |
| `toggleStreaming()` | Method (Async) | `[]` | Starts or stops streaming |
| `toggleRecording()` | Method | `[]` | Starts or stops recording |
| `startReplayBuffer()` | Method | `[]` | Starts the replay buffer |
| `stopReplayBuffer()` | Method | `[]` | Stops the replay buffer |
| `saveReplay()` | Method | `[]` | Saves the current replay buffer |
| `streamingStatusChange` | Event Stream | `[]` | Emits `EStreamingState` string (`"offline"`, `"starting"`, `"live"`, `"ending"`, `"reconnecting"`) |
| `recordingStatusChange` | Event Stream | `[]` | Emits `ERecordingState` string (`"offline"`, `"starting"`, `"recording"`, `"stopping"`, `"wrote"`) |
| `replayBufferStatusChange` | Event Stream | `[]` | Emits `EReplayBufferState` string |
| `streamErrorCreated` | Event Stream | `[]` | Emits stream error details |

### 4.2 `ScenesService` (Singleton) & `Scene` / `SceneItem` / `SceneItemFolder` Helpers

#### `ScenesService` Methods & Events
| Method / Event | Type | Parameters | Return / Payload Schema |
| :--- | :--- | :--- | :--- |
| `activeScene` | Getter | `[]` | `Scene` helper object for the active scene |
| `activeSceneId` | Getter | `[]` | `string` ID of the active scene |
| `getScenes()` | Method | `[]` | `Array<Scene>` |
| `getScene(id)` | Method | `[sceneId: string]` | `Scene \| null` |
| `getSceneNames()` | Method | `[]` | `Array<string>` |
| `createScene(name)` | Method | `[name: string]` | Newly created `Scene` helper |
| `removeScene(id)` | Method | `[sceneId: string]` | Removed `ISceneModel` |
| `makeSceneActive(id)` | Method | `[sceneId: string]` | `boolean` (switches live scene) |
| `sceneSwitched` | Event Stream | `[]` | Emits `ISceneModel` (`{ id, name, nodes }`) |
| `sceneAdded` | Event Stream | `[]` | Emits `ISceneModel` |
| `sceneRemoved` | Event Stream | `[]` | Emits `ISceneModel` |
| `itemAdded` | Event Stream | `[]` | Emits `ISceneItemModel` |
| `itemRemoved` | Event Stream | `[]` | Emits `ISceneItemModel` |
| `itemUpdated` | Event Stream | `[]` | Emits `ISceneItemModel` |

#### `Scene["<sceneId>"]` Helper Methods
- `getModel()` $\rightarrow$ `{ id: string, name: string, nodes: Array<ISceneNodeModel> }`
- `getNode(sceneNodeId)` / `getNodeByName(name)` $\rightarrow$ `SceneItem | SceneItemFolder | null`
- `getItem(sceneItemId)` / `getItems()` / `getFolder(sceneFolderId)` / `getFolders()` / `getNodes()` / `getRootNodes()`
- `createAndAddSource(name, type, settings?, options?)` $\rightarrow$ `SceneItem`
- `addSource(sourceId, options?)` $\rightarrow$ `SceneItem`
- `addFile(path, folderId?)` $\rightarrow$ `SceneNode`
- `createFolder(name)` $\rightarrow$ `SceneItemFolder`
- `removeFolder(folderId)` / `removeItem(sceneItemId)` / `clear()` / `setName(newName)` / `makeActive()`

#### `SceneItem["<sceneId>", "<sceneItemId>", "<sourceId>"]` Helper Methods & Model
- **Model (`getModel()`):**
  ```json
  {
    "id": "item_123",
    "sceneItemId": "item_123",
    "sceneId": "scene_abc",
    "sourceId": "source_xyz",
    "name": "NDI Camera 1",
    "sceneNodeType": "item",
    "parentId": "",
    "resourceId": "SceneItem[\"scene_abc\", \"item_123\", \"source_xyz\"]",
    "visible": true,
    "locked": false,
    "streamVisible": true,
    "recordingVisible": true,
    "scaleFilter": 0,
    "blendingMode": 0,
    "blendingMethod": 0,
    "output": null,
    "display": "horizontal",
    "transform": {
      "position": { "x": 0, "y": 0 },
      "scale": { "x": 1.0, "y": 1.0 },
      "crop": { "top": 0, "bottom": 0, "left": 0, "right": 0 },
      "rotation": 0
    }
  }
  ```
- **Methods:** `getSource()`, `setSettings(patch)`, `setVisibility(visible)`, `setTransform(transformPatch)`, `resetTransform()`, `flipX()`, `flipY()`, `stretchToScreen()`, `fitToScreen()`, `centerOnScreen()`, `rotate(deg)`, `setScale(newScaleModel, origin)`, `setContentCrop()`, `remove()`.

### 4.3 `SourcesService` (Singleton) & `Source` Helper
- **`SourcesService` Methods:**
  - `getSources()` $\rightarrow$ `Array<Source>`
  - `getSource(sourceId)` $\rightarrow$ `Source | null`
  - `getSourcesByName(name)` $\rightarrow$ `Array<Source>`
  - `getAvailableSourcesTypesList()` $\rightarrow$ `Array<{ value: string, description: string }>`
  - `createSource(name, type, settings?, options?)` $\rightarrow$ `Source`
  - `removeSource(id)` / `addFile(path)` / `showSourceProperties(sourceId)` / `showShowcase()` / `showAddSource(sourceType)`
  - **Events:** `sourceAdded`, `sourceUpdated`, `sourceRemoved`
- **`Source["<sourceId>"]` Helper Methods:**
  - `getModel()` $\rightarrow$ `{ sourceId, id, name, type, audio, video, async, muted, width, height, doNotDuplicate, channel, resourceId }`
  - `getSettings()` / `updateSettings(settings)`
  - `getPropertiesFormData()` / `setPropertiesFormData(properties)`
  - `hasProps()` / `setName(newName)` / `refresh()` / `duplicate()`

### 4.4 `AudioService` (Singleton) & `AudioSource` Helper
- **`AudioService` Methods:**
  - `getSources()` $\rightarrow$ `Array<AudioSource>`
  - `getSource(sourceId)` $\rightarrow$ `AudioSource | null`
  - `getSourcesForCurrentScene()` $\rightarrow$ `Array<AudioSource>`
  - `getSourcesForScene(sceneId)` $\rightarrow$ `Array<AudioSource>`
- **`AudioSource["<sourceId>"]` Helper Methods & Model:**
  - `getModel()` $\rightarrow$
    ```json
    {
      "name": "Mic/Aux",
      "sourceId": "source_mic",
      "fader": { "db": 0.0, "deflection": 1.0, "mul": 1.0 },
      "audioMixers": 63,
      "monitoringType": 0,
      "forceMono": false,
      "syncOffset": 0,
      "muted": false,
      "mixerHidden": false
    }
    ```
  - `setDeflection(deflection: number)` (`0.0` to `1.0`)
  - `setMuted(muted: boolean)`

### 4.5 `TransitionsService` (Singleton)
- `getModel()` $\rightarrow$ `{ studioMode: boolean }`
- `enableStudioMode()` / `disableStudioMode()` / `executeStudioModeTransition()`
- **Event:** `studioModeChanged` (emits `boolean`)

### 4.6 `SceneCollectionsService` (Singleton)
- `activeCollection` $\rightarrow$ `{ id: string, name: string }`
- `collections` $\rightarrow$ `Array<{ id: string, name: string, deleted: boolean, modified: string }>`
- `fetchSceneCollectionsSchema()` (rate-limited; returns complete scene/source/item graph for all collections)
- `create(options: { name: string })` / `load(id: string)` / `rename(newName: string, id?: string)` / `delete(id?: string)`
- **Events:** `collectionAdded`, `collectionRemoved`, `collectionWillSwitch`, `collectionSwitched`, `collectionUpdated`

### 4.7 `PerformanceService` (Singleton)
- `getModel()` $\rightarrow$ `{ CPU: number, bandwidth: number, frameRate: number, numberDroppedFrames: number, percentageDroppedFrames: number }`

### 4.8 `NotificationsService`, `CustomizationService`, `GameOverlayService`, `RecentEventsService`, `SelectionService`
- **`NotificationsService`:** `push(notifyInfo)`, `getAll(type)`, `getUnread(type)`, `getRead(type)`, `getNotification(id)`, `markAsRead(id)`, `markAllAsRead()`, `applyAction(notificationId)`, `getSettings()`, `setSettings(patch)`
- **`CustomizationService`:** `getModel()`, `setSettings(settingsPatch)`, `settingsChanged` event
- **`RecentEventsService`:** `getModel()` (`{ isSafeModeEnabled: boolean }`), `enableSafeMode()`, `disableSafeMode()`, `safeModeStatusChanged` event
- **`SelectionService`:** Global selection helper inheriting `Selection` methods (`add`, `select`, `deselect`, `reset`, `invert`, `selectAll`, `getItems`, `getFolders`, `setVisibility`, `setStreamVisible`, `setRecordingVisible`, `remove`, etc.)

---

## 5. Dual Output & Multi-Canvas Architecture (`DualOutputService`)

Streamlabs Desktop 1.21.9 supports simultaneous **Horizontal (`"horizontal"`)** and **Vertical (`"vertical"`)** canvases in `DualOutputService` + `obs-studio-node`:

1. **Scene Node Mapping (`sceneNodeMaps`):** Each `SceneCollection` maintains a `sceneNodeMaps: Record<sceneId, Record<horizontalNodeId, verticalNodeId>>` dictionary pairing horizontal scene items with their vertical canvas counterparts.
2. **Display Tagging (`display: "horizontal" | "vertical"`):** Every `SceneItem` and `SceneItemFolder` carries a `display` property (`"horizontal"` or `"vertical"`) and an `output` context binding.
3. **`obs-studio-node` Multi-Canvas Bindings (`obs_studio_client.node`):**
   - Exposes `OBS_service_resetVideoContext`, `AddVideoContext`, `RemoveVideoContext`, `GetVideoContext`, `SetVideoContext`, `GetVideoCanvas`, `SetVideoCanvas`, `GetAdditionalVideoCanvas`, and `SetAdditionalVideoCanvas` over the Named Pipe IPC to `obs64.exe`.
4. **Control via RPC:** Because `ExternalApiService` delegates unknown resources to `InternalApiService.getResource(resourceId)` (except `FileManagerService`), a local controller can also query or invoke `DualOutputService` directly (`"resource": "DualOutputService"`, methods `setDualOutputModeIfPossible`, `toggleDisplay(status, display)`).

---

## 6. Native Media Interop Plugins (`obs64.exe` / `obs-plugins/64bit`)

Streamlabs Desktop bundles specialized native plugins inside `resources/app.asar.unpacked/node_modules/obs-studio-node/obs-plugins/64bit/`:

1. **`obs-ndi.dll` (NDI 6 Input/Output):**
   - Dynamically loads `Processing.NDI.Lib.x64.dll` via `NDIlib_v5_load` and enforces **NDI Runtime $\ge$ 6.0.0** (`"An older NDI Runtime is installed; 6.0.0 or newer is required."`).
   - Registers OBS source type `ndi_source` (properties: `ndi_source_name`, `ndi_bw_mode` [`Highest`, `Lowest`, `AudioOnly`], `ndi_behavior` [`KeepActive`, `StopResumeBlank`, `StopResumeLastFrame`], `ndi_sync` [`NDITimestamp`, `NDISourceTimecode`], `ndi_framesync`, `ndi_hw_accel`) and output filter/main output.
2. **`win-spout.dll` + `Spout.dll` (DirectX Shared Texture Interop):**
   - Registers `spout_capture` source (`SpoutSenders` property) to receive zero-copy GPU textures from local VJ/projection/graphics tools.
3. **`mediasoup-connector.dll` & `obs-webrtc.dll`:**
   - Provides WebRTC media engine transport for Streamlabs Collab Cam (`GuestCamService`) and WebRTC output streaming.
