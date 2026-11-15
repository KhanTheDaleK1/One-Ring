# Clean-Room Interoperability Specification: NDI 6 (Network Device Interface) Protocols & Control APIs

> **Clean-Room Notice:** This document is a strictly clean-room interoperability specification describing wire protocols, mDNS service discovery, Discovery Server XML schemas, media/control XML messages, routing matrix mechanics, configuration file schemas, Studio Monitor HTTP Web Control endpoints, and C ABI entry points required for clean-room integration with NDI 6 networks and tools. It contains zero copied source code, decompiled functions, or proprietary assets.

---

## 1. Architecture Overview

The NDI 6 (v6.3.x) ecosystem operates across five primary protocol and API surfaces:

1. **Zero-Configuration mDNS Discovery (`_ndi._tcp.local.`):** Standard multicast DNS (`224.0.0.251:5353`) advertising NDI senders and their TCP control/media ports and group memberships.
2. **NDI Discovery Service Protocol (`TCP 5959`):** A centralized TCP XML directory and control broker (`NDI Discovery Service`) that replaces or augments multicast mDNS across routed subnets, tracks both **Senders** and **Receivers** in real time, streams telemetry events, and allows remote controllers to command any NDI 6 receiver to switch sources.
3. **NDI Media & Connection Control Plane (XML over TCP / RUDP / Multicast):** Bidirectional XML control and metadata messages exchanged over an active NDI connection for stream negotiation, tally (`on_program`, `on_preview`), PTZ camera control, remote recorder triggering, KVM input, failover, and virtual routing (`<ndi_routing>`).
4. **NDI Studio Monitor Web Control REST API:** Embedded HTTP server (`studio_monitor_web_v1`) exposing `/v1/sources`, `/v1/configuration`, `/v1/recording`, and `/v1/authorize` for remote display/monitor management.
5. **NDI Runtime C ABI (`Processing.NDI.Lib` & `Processing.NDI.Lib.Advanced`):** Standard and Advanced dynamic library interfaces (`NDIlib_v6_load` / `NDIlib_v6_3_load`) providing cross-platform C entry points for finding, sending, receiving, frame-syncing, routing, and receiver listener control.

---

## 2. Service Discovery & Global Configuration

### 2.1 mDNS Service Discovery (`224.0.0.251:5353`)
- **Service Type:** `_ndi._tcp.local.`
- **Instance Naming Convention:** `<MachineName> (<StreamName>)._ndi._tcp.local.`
- **SRV Record:** Resolves the host IP address and ephemeral TCP port of the NDI sender (commonly starting at `5960`, `5961`, `5962`, etc.).
- **TXT Record Keys:**
  - `groups=<comma-separated-group-list>` (default: `public`)
  - `company=newtek` (or OEM identifier)

### 2.2 Global Host Configuration Schema (`ndi-config.v1.json`)
NDI 6 applications and runtime libraries read host-wide network, group, and transport settings from:
- **Windows Path:** `%PROGRAMDATA%\NDI\ndi-config.v1.json` (or `%APPDATA%\NDI\ndi-config.v1.json`)
- **JSON Schema:**
  ```json
  {
    "ndi": {
      "machinename": "FOH-PRODUCTION",
      "groups": {
        "send": "public,broadcast",
        "recv": "public,stage",
        "recv_regex": ""
      },
      "networks": {
        "ips": "192.168.10.0/24",
        "discovery": "192.168.10.10,192.168.10.11",
        "preferred_adapters": []
      },
      "tcp": {
        "send": { "enable": true },
        "recv": { "enable": true }
      },
      "unicast": {
        "send": { "enable": true },
        "recv": { "enable": true }
      },
      "rudp": {
        "send": { "enable": true },
        "recv": { "enable": true }
      },
      "multicast": {
        "send": {
          "enable": false,
          "ttl": 1,
          "netprefix": "239.255.0.0",
          "netmask": "255.255.0.0",
          "congestion_control": true
        },
        "recv": {
          "enable": true,
          "subnets": []
        }
      }
    }
  }
  ```

---

## 3. NDI Discovery Service Protocol (`TCP 5959`)

The NDI Discovery Service (`NDI Discovery Service.exe`, configurable via `-port <port>` or `%PROGRAMDATA%\NDI\ndi-discovery-service.v1.json`) runs on **TCP port `5959`** by default. In NDI 6, the Discovery Service acts not only as a sender registry, but also as a **remote receiver discovery and routing control broker**.

### 3.1 Participant Roles
Clients connecting to TCP port `5959` assume one or more of six roles:
1. **Legacy Source Advertiser / Listener:** Registers and queries `<sources>` using NDI v4/v5 XML messages.
2. **Source Advertiser (`NDIlib_send_advertiser_*`):** Registers active NDI 6 senders (`UUID`, `name`, `address`, `port`, `groups`, `metadata`).
3. **Source Listener (`NDIlib_send_listener_*`):** Subscribes to real-time sender registration list and sender telemetry events.
4. **Receiver Advertiser (`NDIlib_recv_advertiser_*`):** Registers active NDI 6 receivers (e.g., Studio Monitor, OBS, hardware decoders) along with their capabilities (`metadata`, `video`, `audio`) and supported commands (`connect`).
5. **Receiver Listener (`NDIlib_recv_listener_*`):** Queries all active receivers on the network, subscribes to receiver telemetry events, and issues remote `connect` commands to switch a receiver's active NDI input.

### 3.2 Discovery Service XML Message Elements
Messages over the TCP `5959` connection are UTF-8 XML documents parsed via RapidXML using the following top-level and nested elements:

| XML Element | Role / Direction | Semantics & Child Elements |
| :--- | :--- | :--- |
| `<compatible/>` / `<compatible>...</compatible>` | Handshake | Verifies protocol compatibility between NDI 6 client and Discovery Service |
| `<advertiser/>` | Handshake | Declares connection as a Source or Receiver Advertiser |
| `<listener/>` / `<listener>...</listener>` | Handshake | Declares connection as a Source or Receiver Listener (`<listener_id>`) |
| `<add_source>...</add_source>` | Advertiser $\rightarrow$ Server | Registers a sender (`<source>`, `<source_id>`, `<name>`, `<address>`, `<port>`, `<groups><group>...</group></groups>`, `<metadata>`) |
| `<remove_source>` / `<remove_sources>` | Advertiser $\rightarrow$ Server | Unregisters one or more senders by `<source_id>` |
| `<query_sources/>` / `<query/>` | Listener $\rightarrow$ Server | Queries active `<sources>` matching group filters |
| `<sources><source>...</source></sources>` | Server $\rightarrow$ Listener | Full or incremental list of registered NDI sources |
| `<receiver>...</receiver>` | Receiver $\rightarrow$ Server | Registers an NDI receiver (`<receiver_id>` UUIDv4, `<name>`, `<input_id>`, `<input_name>`, `<address>`, `<capabilities>`, `<control_capabilities>`, `<monitor_capabilities>`) |
| `<remove_receiver>` / `<remove_receivers>` | Receiver $\rightarrow$ Server | Unregisters receiver(s) |
| `<query_receivers/>` / `<query_inputs/>` | Listener $\rightarrow$ Server | Queries all registered NDI receivers and their current input bindings |
| `<control_receiver>...</control_receiver>` | Listener $\rightarrow$ Server $\rightarrow$ Receiver | **Remote Receiver Routing Command:** Contains `<receiver_id>`, `<command>` (`connect`), and `<arg>` / `<source>` specifying the new NDI source name to connect to |
| `<control_source>...</control_source>` | Listener $\rightarrow$ Server $\rightarrow$ Sender | Sends control commands to an advertised sender |
| `<monitor_request>...</monitor_request>` | Listener $\rightarrow$ Server | Subscribes/unsubscribes to real-time telemetry properties for a `<source_id>` or `<receiver_id>` |
| `<monitor_events>...</monitor_events>` | Endpoint $\rightarrow$ Server $\rightarrow$ Listener | Carries key-value telemetry `<property><name>...</name><value>...</value></property>` updates |
| `<reconnect/>` | Server $\leftrightarrow$ Client | Requests client state resynchronization |

### 3.3 Telemetry Event Keys (`NDIlib_listener_event`)
When a controller subscribes to sender or receiver events via `NDIlib_send_listener_subscribe_events` or `NDIlib_recv_listener_subscribe_events`, the endpoint reports `<property>` events with the following keys:
- `connected-receivers`: Number of connected receivers
- `video-frames-sent`, `video-bytes-sent`
- `audio-frames-sent`, `audio-bytes-sent`
- `metadata-frames-sent`, `metadata-bytes-sent`
- `tally-on-program`, `tally-on-preview`
- Video format properties: codec (`shq2`, `shq7`, `h264`, `hevc`), resolution, frame rate (`%d/%d`), frame type, alpha presence, color primaries, transfer function, matrix coefficients, receive mode
- Audio format properties: codec, channels, sample rate, receive mode

---

## 4. NDI Connection, Routing, and Metadata XML Protocol

Once a receiver resolves a sender's IP and port (via mDNS or Discovery Server), it connects and exchanges XML control/metadata frames alongside video (`SpeedHQ` `shq0`/`shq2`/`shq7` or `H.264`/`HEVC` for NDI|HX) and audio streams.

### 4.1 Connection Handshake & Stream Selection XML
- **Version & Identity Exchange:**
  ```xml
  <ndi_version text="1" video="1" audio="1" chunk="1" sdk="6.3.2.0" platform="WIN64"/>
  <ndi_identify name="FOH-PC (OBS Output)"/>
  ```
- **Stream Enablement & Bandwidth Selection (Receiver $\rightarrow$ Sender):**
  - Enable high/low quality video, audio, and metadata:
    ```xml
    <ndi_enabled_streams video="true" audio="true" text="true" shq_skip_block="true" shq_short_dc="true"/>
    <ndi_video quality="high" quality_timestamp="5678"/>
    ```
  - Preview / Low-bandwidth proxy stream:
    ```xml
    <ndi_video quality="low" quality_timestamp="1234"/>
    ```
  - Metadata-only / Tally-only connection:
    ```xml
    <ndi_enabled_streams video="false" audio="false" text="true"/>
    ```
  - Request immediate video keyframe:
    ```xml
    <ndi_video request_keyframe="true"/>
    ```
- **Multicast v2 Stream Advertisement (Sender $\rightarrow$ Receiver):**
  ```xml
  <ndi_multicast_v2>
    <stream type="vmclq" address="239.255.x.x:port" id="..."/>
    <stream type="vmchq" address="239.255.x.x:port" id="..."/>
    <stream type="amc" address="239.255.x.x:port" id="..."/>
  </ndi_multicast_v2>
  ```
  *(where `vmclq` = Video Multicast Low Quality, `vmchq` = Video Multicast High Quality, `amc` = Audio Multicast)*
- **Failover Advertisement (Sender $\rightarrow$ Receiver):**
  ```xml
  <ndi_failover name="BACKUP-PC (Main Out)" ip="192.168.10.52:5961"/>
  ```
- **Graceful Disconnect:**
  ```xml
  <ndi_close/>
  ```

### 4.2 Virtual Routing Matrix Protocol (`<ndi_routing>`)
An NDI Routing Matrix (`NDIlib_routing_*` and the **NDI Router** application) creates virtual NDI outputs that **do not decode or re-encode video/audio**. Instead:
1. Each virtual router output registers as an NDI source on the network (`<MachineName> (<RouterOutputName>)`).
2. When any NDI receiver connects to the virtual router output, the router sends an XML redirection message instructing the receiver to connect directly to the currently routed upstream source:
   ```xml
   <ndi_routing name="CAMERA-1 (Main)" ip="192.168.10.21:5960" version="embedded_v4"/>
   ```
3. When the route is cleared (`NDIlib_routing_clear`), the router sends:
   ```xml
   <ndi_routing/>
   ```
4. When a user switches a crosspoint (`NDIlib_routing_change`), the router immediately pushes the new `<ndi_routing name="..." ip="..."/>` message to all connected receivers, causing them to seamlessly reconnect to the new upstream sender.
5. **NDI Router Persistence Files:**
   - Main configuration: `%APPDATA%\NDI\NDI_Router\Application.NDI.Router.json`
   - Presets: `%APPDATA%\NDI\NDI_Router\Router_Preset_{0}.json`

### 4.3 Tally Protocol
- **Receiver $\rightarrow$ Sender:**
  ```xml
  <ndi_tally on_program="true" on_preview="false"/>
  ```
- **Sender $\rightarrow$ Connected Receivers (Echo):**
  ```xml
  <ndi_tally_echo on_program="true" on_preview="false"/>
  ```

### 4.4 PTZ Camera Control XML Messages (Receiver $\rightarrow$ Sender)
When a sender advertises `ntk_ptz="true"` in `<ndi_capabilities>`, a receiver can control camera optics and presets by sending metadata frames with the following XML elements:

| Operation | XML Payload Format | Parameter Range / Notes |
| :--- | :--- | :--- |
| **Zoom (Absolute)** | `<ntk_ptz_zoom zoom="%f"/>` | `0.0` (wide) to `1.0` (tele) |
| **Zoom (Continuous Speed)** | `<ntk_ptz_zoom_speed zoom_speed="%f"/>` | `-1.0` (zoom out) to `+1.0` (zoom in), `0` = stop |
| **Pan / Tilt (Absolute)** | `<ntk_ptz_pan_tilt pan="%f" tilt="%f"/>` | `pan`: `-1.0` (left) to `+1.0` (right); `tilt`: `-1.0` (down) to `+1.0` (up) |
| **Pan / Tilt (Speed)** | `<ntk_ptz_pan_tilt_speed pan_speed="%f" tilt_speed="%f"/>` | `-1.0` to `+1.0` per axis, `0` = stop |
| **Store Preset** | `<ntk_ptz_store_preset index="%d"/>` | `index`: `0`..`99` (or `0`..`254`) |
| **Recall Preset** | `<ntk_ptz_recall_preset index="%d" speed="%f"/>` | `index`: preset slot; `speed`: `0.0` to `1.0` |
| **Auto Focus** | `<ntk_ptz_focus mode="auto"/>` | Enables continuous autofocus |
| **Manual Focus (Position)** | `<ntk_ptz_focus mode="manual" distance="%f"/>` | `0.0` (near) to `1.0` (infinite) |
| **Manual Focus (Speed)** | `<ntk_ptz_focus_speed mode="manual" distance="%f"/>` | `-1.0` (near) to `+1.0` (far) |
| **White Balance (Preset)** | `<ntk_ptz_white_balance mode="auto\|indoor\|outdoor\|one_shot"/>` | Standard WB modes |
| **White Balance (Manual)** | `<ntk_ptz_white_balance mode="manual" red="%f" blue="%f"/>` | `red`, `blue`: `0.0` to `1.0` |
| **Exposure (Auto)** | `<ntk_ptz_exposure mode="auto"/>` | Automatic iris/exposure |
| **Exposure (Manual)** | `<ntk_ptz_exposure mode="manual" value="%f" gain="%f" shutter="%f"/>` | `value` (iris), `gain`, `shutter`: `0.0` to `1.0` |

### 4.5 Remote Recorder Control (`ntk_record`) & KVM (`ndi_kvm`)
- **Remote Recording Control (Receiver $\rightarrow$ Sender):**
  - Start recording: `<ntk_record_start filename="%s"/>`
  - Stop recording: `<ntk_record_stop/>`
  - Set audio recording level: `<ntk_record_set_level level_dB="%f"/>` (or `level_dB="-inf"` for mute)
- **KVM Remote Control (Receiver $\rightarrow$ Sender):**
  - When a sender (such as NDI Screen Capture) advertises `ntk_kvm="true"` / `ndi_kvm="true"`, the receiver transmits mouse, keyboard, clipboard, and touch events inside `<ndi_kvm u="..."/>` metadata packets (`NDIlib_recv_kvm_send_*`).

---

## 5. NDI Studio Monitor Web Control HTTP API

When "Allow Web Control" is enabled in **NDI Studio Monitor**, it starts an embedded HTTP server (`studio_monitor_web_v1`) and advertises its URL in `<ndi_capabilities web_control="http://<ip>:<port>/"/>`.

### 5.1 REST Endpoints
All responses include `Access-Control-Allow-Origin: *`.

| Endpoint | Method | Purpose & Payload Schema |
| :--- | :--- | :--- |
| `/v1/sources` | `GET` | Returns JSON list of currently discovered NDI sources on the network:<br>`{ "ndi_sources": [ "MACHINE (Source 1)", "MACHINE (Source 2)" ] }` |
| `/v1/configuration` | `GET` | Returns current Studio Monitor state and available hardware devices:<br>`{ "studio_monitors": { ... }, "audio_devices": [...], "display_devices": [...], "controllers": [...] }` |
| `/v1/configuration` | `POST` | Updates active NDI source, overlay, video scaling, audio output device, or PTZ settings. Returns `200 OK` (`Configuration updated.`). |
| `/v1/recording` | `GET` | Returns recording status and elapsed duration:<br>`{ "recording": true, "duration": 124.5 }` |
| `/v1/recording` | `POST` | Starts or stops local `.mov` recording on the Studio Monitor host. |
| `/v1/authorize` | `POST` | Authenticates or updates `username` and `password` stored in `\NDI\Studio Monitor\authentication\`. |

---

## 6. NDI Bridge (`Application.NDI.Bridge.x64.exe` & `ProxyHX.x64.exe`)

**NDI Bridge** operates in three modes (`RuntimeMode`):
1. **Host (`1`):** Listens on a configurable UDP/QUIC WAN port (default public port `7000`, using `stun.ndi.tv`, `stun2.ndi.tv`, and `https://signal.ndi.tv/ipcheck` for public IP resolution) and accepts encrypted connections from remote Bridge Join instances.
2. **Join (`2`):** Connects to a remote Bridge Host using `IPAddressString`, `Port`, and `EncryptionKey` (16-character key), bidirectionally bridging NDI groups (`GroupNames`, `SendGroupNames`) across WAN links.
3. **Local (`3`):** Uses `Application.Network.ProxyHX.x64.exe` to transcode local high-bandwidth NDI streams (SpeedHQ) into bandwidth-efficient **NDI|HX** (`H264`, `HEVC`, or `HEVC10` 10-bit) or vice versa on the local LAN.
- **Configuration File:** `bridge_settings.json` (`BridgeLaunchConfig` / `ProxyHXRoot`).

---

## 7. NDI 6 Dynamic Library C ABI Summary

Applications integrate directly with NDI by loading `Processing.NDI.Lib.x64.dll` (or `Processing.NDI.Lib.Advanced.x64.dll`) and calling `NDIlib_v6_load()` (or `NDIlib_v6_3_load()`), or by resolving symbols directly from the PE export table:

### 7.1 Core Lifecycle & Discovery
- `NDIlib_initialize() -> bool` / `NDIlib_destroy()`
- `NDIlib_find_create_v2(const NDIlib_find_create_t*) -> NDIlib_find_instance_t`
- `NDIlib_find_create_v3(const NDIlib_find_create_t*, const char* p_config_json) -> NDIlib_find_instance_t` *(Advanced SDK)*
- `NDIlib_find_wait_for_sources(instance, timeout_in_ms) -> bool`
- `NDIlib_find_get_current_sources(instance, uint32_t* p_no_sources) -> const NDIlib_source_t*`
- `NDIlib_find_get_current_sources_v2(instance, uint32_t* p_no_sources) -> const NDIlib_source_v2_t*` *(includes `p_metadata`)*

### 7.2 Virtual Routing (`NDIlib_routing_*`)
- `NDIlib_routing_create(const NDIlib_routing_create_t*) -> NDIlib_routing_instance_t`
- `NDIlib_routing_change(instance, const NDIlib_source_t* p_source) -> bool`
- `NDIlib_routing_clear(instance) -> bool`
- `NDIlib_routing_get_no_connections(instance, timeout_in_ms) -> int`
- `NDIlib_routing_get_source_name(instance) -> const NDIlib_source_t*`

### 7.3 Remote Receiver & Sender Listener Control (NDI 6 New API)
- `NDIlib_recv_listener_create(const NDIlib_recv_listener_create_t*) -> NDIlib_recv_listener_instance_t`
- `NDIlib_recv_listener_get_receivers(instance, uint32_t* p_num_receivers) -> const NDIlib_receiver_t*`
- `NDIlib_recv_listener_wait_for_receivers(instance, timeout_in_ms) -> bool`
- `NDIlib_recv_listener_send_connect(instance, const char* p_receiver_uuid, const char* p_source_name) -> bool`
- `NDIlib_recv_listener_subscribe_events(instance, const char* p_receiver_uuid) -> bool`
- `NDIlib_recv_listener_get_events(instance, uint32_t* p_num_events, timeout_in_ms) -> const NDIlib_listener_event*`
- `NDIlib_send_listener_create(const NDIlib_send_listener_create_t*) -> NDIlib_send_listener_instance_t`
- `NDIlib_send_listener_get_senders(instance, uint32_t* p_num_senders) -> const NDIlib_sender_t*`

---

## 8. Integration Recommendations for "One Ring" Unified Church Controller

1. **Zero-Cost Virtual Video Switching (`NDIlib_routing_*`):**
   - The Unified Controller can create named virtual NDI outputs (e.g., `ONE-RING (Projector Left)`, `ONE-RING (Lobby Displays)`, `ONE-RING (Stage Confidence)`, `ONE-RING (Livestream Key)`) using `NDIlib_routing_create` and switch their upstream sources (`ProPresenter`, `OBS`, PTZ cameras) instantaneously via `NDIlib_routing_change` with **zero CPU/GPU video decoding or re-encoding overhead**.
2. **Direct Receiver Control via NDI 6 Receiver Listener (`NDIlib_recv_listener_send_connect`):**
   - By running or connecting to an NDI Discovery Service (`TCP 5959`), the Unified Controller can discover every NDI Studio Monitor and hardware NDI decoder in the building and remotely switch which NDI stream each display is showing (`NDIlib_recv_listener_send_connect` or Studio Monitor `/v1/configuration` REST API).
3. **Unified PTZ & Tally Control:**
   - Using metadata-only NDI receiver connections (`<ndi_enabled_streams video="false" audio="false" text="true"/>`), the Unified Controller can drive PTZ presets/pan/tilt/zoom (`<ntk_ptz_*>`) and tally lights (`<ndi_tally>`) on all NDI cameras without pulling video bandwidth.
