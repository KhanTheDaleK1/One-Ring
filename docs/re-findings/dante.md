# Clean-Room Interoperability Specification: Audinate Dante Network & Host Control Protocols

> **Clean-Room Notice:** This document is a strictly clean-room interoperability specification describing wire protocols, multicast/UDP addressing, mDNS discovery records, state machines, and local JSON WebSocket IPC schemas required for external controller and host integration with Dante networks and host software. It contains zero copied source code, decompiled C/C++/Java/C# snippets, or proprietary assets.

---

## 1. Architecture Overview

A Dante audio/video network operates across four distinct protocol layers:

1. **Zero-Configuration Service Discovery (mDNS / DNS-SD):** UDP port `5353` multicast (`224.0.0.251`) used to advertise device control ports, transmitted media channels, Conmon endpoints, Dante Via instances, and Dante Domain Manager (DDM) services.
2. **Conmon (Connection & Monitoring Protocol):** A UDP control and monitoring plane (primarily multicast on `224.0.0.230`–`224.0.0.233` and unicast/local IPC) used for device discovery, clocking/PTP status, interface statistics, device identification (LED flash), sample rate/encoding configuration, system reset, peak audio metering, and topology change notifications.
3. **ARC (Audio Routing Control Protocol):** A per-device unicast UDP request/response protocol (port advertised via `_netaudio-arc._udp.local.`) used to query device capabilities, configure device/channel names, create/delete RX channel subscriptions, manage multicast TX flows, and adjust latency/RTP/AES67 properties.
4. **Host Software Local Control Planes (WebSocket JSON IPC):**
   - **Dante Via ("Rialto"):** Localhost WebSocket server hosted by `DanteViaService` exposing application/soundcard audio discovery, mix groups, endpoint routing, and gain control.
   - **Dante Studio (`video_manager`):** Localhost WebSocket server (`ws://127.0.0.1:4778`, subprotocol `UserInterface`) controlling screen/display video capture, H.264/H.265/JPEG2000 TX encoding, RX resolution, and hardware decoder selection.

---

## 2. mDNS / DNS-SD Service Discovery (`224.0.0.251:5353`)

Dante devices and host services register and browse the following DNS-SD service types in the `.local.` domain:

| Service Type | Transport | Purpose | Key SRV / TXT Record Semantics |
| :--- | :--- | :--- | :--- |
| `_netaudio-arc._udp.local.` | UDP | **Audio Routing Control (ARC)** endpoint per Dante device | SRV target gives device hostname/IP and unicast UDP ARC port (commonly `4440`, `4455`, `8800`, or dynamic). TXT keys include `id`, `model`, `mf`, `arcp` (protocol version), `router_vers`, `nchan`. |
| `_netaudio-chan._udp.local.` | UDP | **Transmit (TX) Channel** advertisement | Each advertised TX channel or channel group publishes its canonical `<channel>@<device>` identity, sample rate, encoding, and flow parameters. |
| `_netaudio-cmc._udp.local.` | UDP | **Conmon Client / Server** endpoint advertisement | Advertises Connection & Monitoring participation and MAC/EUI-64 identity. |
| `_netaudio-bund._udp.local.` | UDP | **Multicast Flow / Bundle** advertisement | Advertises configured TX multicast media bundles/flows. |
| `_netaudio-via._tcp.local.` | TCP | **Dante Via** host instance discovery | Advertises Dante Via host instances on the LAN. |
| `_dante-safe._udp.local.` | UDP | **Failsafe / Recovery Mode** | Indicates a Dante device booted into recovery/failsafe mode. |
| `_dante-upgr._udp.local.` | UDP | **Firmware Upgrade Service** | Advertises firmware upgrade endpoint capability. |
| `_dante-ddm-d._udp.local.` | UDP | **DDM Device Discovery** | Used by Dante devices to locate a Dante Domain Manager instance. |
| `_dante-ddm-c._tcp.local.` | TCP | **DDM Controller Discovery** | Used by controllers (e.g., Dante Controller) to locate the DDM TLS/WebSocket broker. |

### 2.1 Naming & Validation Rules
All compliant controllers must enforce the following naming rules before sending rename requests over ARC or Conmon:
- **Device Name:** ASCII alphanumeric start character followed by up to 30 ASCII alphanumeric or hyphen (`-`) characters:
  - Regex: `^[A-Za-z0-9][A-Za-z0-9-]{0,30}$`
  - Maximum length: `31` characters (`32` bytes including NUL terminator).
- **Channel / Label Name:** 1 to 31 UTF-8 characters excluding control characters, `.`, `=`, `@`, `\n`, and `\r`:
  - Regex: `^[^\p{Cntrl}.=@\n\r]{1,31}$`
  - Maximum length: `31` characters (`32` bytes including NUL terminator).

---

## 3. Conmon (Connection & Monitoring Protocol)

### 3.1 Framing & Packet Limits
Conmon messages are carried inside UDP datagrams (network multicast/unicast) or local IPC datagrams between the local Conmon daemon (`conmon_server`) and local clients:
- **Maximum UDP Payload Size:** `1472` bytes (`0x05C0`)
- **Conmon Fixed Header Size:** `24` bytes (`0x18`)
- **Maximum Conmon Body Size:** `1448` bytes (`0x05A8`)
- **Byte Order:** Network byte order (Big-Endian) for all wire multi-byte integers.

### 3.2 Conmon Logical Channels, Multicast Groups, and UDP Ports
Conmon multiplexes traffic across 9 logical channel types (`0` through `8`):

| Channel ID | Symbolic Name | Multicast IPv4 Group | UDP Port (Hex) | UDP Port (Dec) | Direction / Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `0` | `CONTROL` | Unicast / Device IP | Device port | Dynamic / `8700` | Directed Conmon control requests and replies |
| `1` | `METERING` | `224.0.0.232` (or Unicast) | `0x222F` (`0x2230` interop) | `8751` (`8752` interop) | Real-time TX/RX audio peak metering datagrams |
| `2` | `STATUS` | `224.0.0.231` | `0x21FE` | `8702` | Asynchronous device status announcements |
| `3` | `BROADCAST` | `224.0.0.230` | `0x21FF` | `8703` | Network-wide Conmon broadcast discovery & queries |
| `4` | `LOCAL` | `127.0.0.1` | Ephemeral / Local | Local IPC | Local host IPC between `conmon_server` and DAPI/CMM clients |
| `5` | `SERIAL` | Device-specific | — | — | Serial port / HA remote bridging |
| `6` | `KEEPALIVE` | `224.0.0.231` / Unicast | `0x21FE` | `8702` | Periodic liveness heartbeats |
| `7` | `VENDOR_BROADCAST` | `224.0.0.230` | `0x21FF` | `8703` | Vendor-specific broadcast notifications |
| `8` | `MONITORING` | `224.0.0.233` | `0x2204` | `8708` | Extended monitoring & telemetry multicast |

### 3.3 Conmon Message Classes & Vendor IDs
- **Message Classes (`uint16`):**
  - `0xFFFE` (`65534`): Standard Core / Guppy Message Class
  - `0xFFFF` (`65535`): Vendor-Specific Message Class
- **Vendor IDs (within Vendor-Specific payloads):**
  - `0`: Audinate (`VENDOR_ID_AUDINATE`)
  - `1`: Avid (`VENDOR_ID_AVID`)

### 3.4 Audinate Conmon Message Types (Opcodes)
Inside the Audinate Conmon payload, each message specifies a 16-bit Message Type. Odd/Even pairs generally represent `CONTROL`/`QUERY` vs. `STATUS`/`RESPONSE`:

| Opcode (Dec) | Opcode (Hex) | Message Name | Description |
| :--- | :--- | :--- | :--- |
| `16` | `0x0010` | `TOPOLOGY_CHANGE` | Network/switch topology change notification |
| `17` / `19` | `0x0011` / `0x0013` | `INTERFACE_STATUS` / `INTERFACE_CONTROL` | Primary/Secondary network interface link speed, MAC, IP, redundancy mode |
| `20` / `21` | `0x0014` / `0x0015` | `SWITCH_VLAN_STATUS` / `SWITCH_VLAN_CONTROL` | Integrated switch VLAN configuration and port status |
| `32` / `33` | `0x0020` / `0x0021` | `CLOCKING_STATUS` / `CLOCKING_CONTROL` | PTP clock lock state, preferred leader, external word-clock sync, mute state |
| `34` / `35` | `0x0022` / `0x0023` | `MASTER_STATUS` / `MASTER_QUERY` | PTP grandmaster / boundary clock election status |
| `36` / `37` | `0x0024` / `0x0025` | `UNICAST_CLOCKING_STATUS` / `CONTROL` | Unicast PTP delay request/response configuration |
| `38` / `39` | `0x0026` / `0x0027` | `NAME_ID_STATUS` / `NAME_ID_CONTROL` | Conmon device name & identity status/control |
| `40` / `41` | `0x0028` / `0x0029` | `PTP_LOGGING_STATUS` / `CONTROL` | PTP clock drift/offset logging control |
| `42` | `0x002A` | `CLOCKING_UNMUTE` | Force audio clock unmute |
| `64` / `65` | `0x0040` / `0x0041` | `IFSTATS_STATUS` / `IFSTATS_QUERY` | Network interface packet/error counters and link utilization |
| `80` / `81` | `0x0050` / `0x0051` | `IGMP_VERS_STATUS` / `IGMP_VERS_CONTROL` | IGMPv2 / IGMPv3 snooping version configuration |
| `96` / `97` | `0x0060` / `0x0061` | `VERSIONS_STATUS` / `VERSIONS_QUERY` | Dante firmware, bootloader, API, and capability versions |
| `98` / `99` | `0x0062` / `0x0063` | `IDENTIFY_STATUS` / `IDENTIFY_QUERY` | **Device Identify** (flashes front-panel LEDs on hardware) |
| `112` / `113` / `117` | `0x0070` / `0x0071` / `0x0075` | `UPGRADE_STATUS` / `CONTROL` / `CONFIG` | Firmware update progress and control |
| `115` | `0x0073` | `CONFIG_CONTROL` | Persistent configuration save/apply |
| `119` / `120` | `0x0077` / `0x0078` | `CLEAR_CONFIG_CONTROL` / `STATUS` | Clear device routing/network configuration to defaults |
| `128` / `129` | `0x0080` / `0x0081` | `SRATE_STATUS` / `SRATE_CONTROL` | Sample rate status/change (`44100`, `48000`, `88200`, `96000`, `176400`, `192000` Hz) |
| `130` / `131` | `0x0082` / `0x0083` | `ENC_STATUS` / `ENC_CONTROL` | PCM bit depth / encoding (`16`, `24`, `32` bit) |
| `132` / `133` | `0x0084` / `0x0085` | `PULLUP_STATUS` / `PULLUP_CONTROL` | Video pull-up/pull-down rate (`+4.1667%`, `+0.1%`, `0%`, `-0.1%`, `-4.0%`) |
| `134` / `135` | `0x0086` / `0x0087` | `AUDIO_INTERFACE_STATUS` / `QUERY` | Hardware audio interface framing status |
| `144` / `146` | `0x0090` / `0x0092` | `SYS_RESET_STATUS` / `SYS_RESET_CONTROL` | Device reboot / reset (`0 = SOFT`, `1 = FACTORY`) |
| `160` / `161` | `0x00A0` / `0x00A1` | `EDK_BOARD_STATUS` / `CONTROL` | Embedded board peripheral status/control |
| `176` / `177` | `0x00B0` / `0x00B1` | `ACCESS_STATUS` / `ACCESS_CONTROL` | Device access control status/update |
| `192` / `193` | `0x00C0` / `0x00C1` | `MANF_VERSIONS_STATUS` / `QUERY` | OEM manufacturer model/version metadata |
| `208` / `209` | `0x00D0` / `0x00D1` | `LED_STATUS` / `LED_QUERY` | Front-panel indicator LED states |
| `224` / `225` | `0x00E0` / `0x00E1` | `METERING_STATUS` / `METERING_CONTROL` | Enable/disable real-time UDP peak metering stream to a target IP/port |
| `240` / `241` | `0x00F0` / `0x00F1` | `SERIAL_PORT_STATUS` / `CONTROL` | Serial bridge baud rate, parity, and framing |
| `256` / `271` | `0x0100` / `0x010F` | `ROUTING_READY` / `ROUTING_QUERY` | ARC routing subsystem readiness state |
| `257`–`261` | `0x0101`–`0x0105` | `RX_CHAN_CHANGE` / `TX_CHAN_CHANGE` / `TX_LABEL_CHANGE` / `FLOW_CHANGE` / `PROPERTY_CHANGE` | Asynchronous routing table invalidation events (triggers controller to re-read affected ARC table) |
| `262`–`269` | `0x0106`–`0x010D` | `RX_FLOW_CHANGE` / `TX_FLOW_CHANGE` / `RX_CHANNELS_SET` / `TX_CHANNELS_SET` / `TX_LABELS_SET` / `RX_FLOWS_SET` / `TX_FLOWS_SET` / `PROPERTIES_SET` | Granular routing state mutation notifications |
| `272`–`275` | `0x0110`–`0x0113` | `RX_ERROR_STATUS` / `CONTROL` / `THRESHOLD_STATUS` / `THRESHOLD_CONTROL` | Packet loss / late packet error counters and threshold alarms |
| `288` | `0x0120` | `ROUTING_DEVICE_CHANGE` | Aggregate device routing configuration changed event |
| `304` / `305` | `0x0130` / `0x0131` | `DANTE_READY` / `DANTE_READY_QUERY` | Device boot completion notification |
| `320` / `321` | `0x0140` / `0x0141` | `GPIO_STATUS` / `GPIO_CONTROL` | General-purpose I/O pin states |
| `512` / `514` | `0x0200` / `0x0202` | `LOCK_QUERY` / `POLICY_STATUS` | Security lock & DDM policy state |
| `4096`–`4101` | `0x1000`–`0x1005` | `HAREMOTE_*` | High-Availability (HA) remote bridge messages & stats |
| `4102` / `4103` | `0x1006` / `0x1007` | `AES67_CONTROL` / `AES67_STATUS` | Enable/disable AES67 interoperability mode and multicast prefix |
| `4104` / `4105` | `0x1008` / `0x1009` | `DEVICE_LOCK_CONTROL` / `STATUS` | 4-digit PIN device lock/unlock |
| `4106` / `4107` | `0x100A` / `0x100B` | `CODEC_CONTROL` / `CODEC_STATUS` | Audio/video codec configuration |
| `4108` | `0x100C` | `TX_CHAN_LABEL_CHANGE` | Combined TX channel and label change event |
| `4109` / `4110` | `0x100D` / `0x100E` | `VIDEO_CONTROL` / `VIDEO_STATUS` | Dante AV video subsystem control/status |
| `4111` / `4112` | `0x100F` / `0x1010` | `ARGO_BOOTSTRAP_CONTROL` / `STATUS` | Dante AV ("Argo") bootstrap configuration |
| `4129`–`4131` | `0x1021`–`0x1023` | `OEM_READONLY_*` | OEM read-only lock status/control |
| `65286` / `65287` | `0xFF06` / `0xFF07` | `ENROLMENT_CONFIG_CONTROL` / `STATUS` | Dante Domain Manager (DDM) domain enrolment & credentials |

### 3.5 Real-Time Audio Metering Protocol (`UDP 8751` / `224.0.0.232`)
To subscribe to real-time audio levels from a device:
1. Send a Conmon `METERING_CONTROL` (`0x00E1`) message instructing the target device to emit metering packets (either multicast to `224.0.0.232:8751` or unicast to the controller's UDP port, default firewall port `8751`, legacy port `8752`) at the requested update rate.
2. Each metering payload encodes per-channel TX and RX peak levels as 1 byte (`uint8`) per channel:
   - `255` (`0xFF`): `PEAK_START_OF_MESSAGE` delimiter
   - `254` (`0xFE`): `PEAK_MUTE` (Channel muted / silent)
   - `0` (`0x00`): `PEAK_CLIP` (Digital clipping at or above 0 dBFS)
   - `1` (`0x01`): `0 dBFS`
   - `2`..`121`: `-0.5 dBFS` per step (`121` = `-60.0 dBFS`)
   - `123`..`253`: `-0.5 dBFS` per step (`123` = `-61.0 dBFS`, `253` = `-126.0 dBFS`)

---

## 4. ARC (Audio Routing Control Protocol)

ARC runs over unicast UDP to the port advertised in the device's `_netaudio-arc._udp.local.` SRV record (or standard ports `4440`, `4455`, `8800`).

### 4.1 Media Types
Dante devices support heterogeneous media channels identified by a Media Type enumeration:
- `0`: `UNDEF`
- `1`: `ALL`
- `2`: `OTHER`
- `3`: `AUDIO` (Uncompressed PCM audio)
- `4`: `VIDEO` (Dante AV JPEG2000 / H.264 / H.265 video)
- `5`: `ANCIL` (Ancillary data, e.g., RS-422/VISCA PTZ, HDCP/EDID metadata, timecode)

### 4.2 Router State Components
ARC exposes 7 primary tables on each device:
1. `0 = TXCHANNELS`: Physical/virtual transmit channels (`id`, `name`, `mediaType`, `sampleRate`, `encoding`, `flags`, `group`).
2. `1 = RXCHANNELS`: Physical/virtual receive channels (`id`, `name`, `mediaType`, `subscribedChannel`, `subscribedDevice`, `status`, `flowId`).
3. `2 = TXLABELS`: Friendly aliases/labels mapped onto `TXCHANNELS` (allowing multiple logical labels or re-patching without changing downstream RX subscriptions).
4. `3 = TXFLOWS`: Active transmit media flows (`unicast` or `multicast`, `destIp`, `destPort`, `fpp` frames per packet, `latency`, assigned TX channel slots).
5. `4 = RXFLOWS`: Active receive media flows and per-interface (`primary`/`secondary`) packet reception status.
6. `5 = PROPERTIES`: Device-level routing and media transport parameters (see Section 4.4).
7. `6 = DISPLAYGROUPS`: Logical channel groupings for multi-essence (e.g., Dante AV video + audio + ancillary groups).

### 4.3 Crosspoint Subscription State Machine (`RXSTATUS`)
To route audio/video from `SourceChannel@SourceDevice` to `DestRxChannel` on `DestDevice`, the controller sends an ARC RX Channel Subscription command to `DestDevice` specifying `(DestRxChannelId, SourceChannelName, SourceDeviceName)`.
The receiving device resolves `SourceChannel@SourceDevice` via mDNS (`_netaudio-chan._udp.local.` / `_netaudio-arc._udp.local.`), negotiates a unicast flow (or joins an existing multicast bundle), and transitions the RX channel's `RXSTATUS` field through the following states:

| Status Code | Symbolic Name | Meaning |
| :--- | :--- | :--- |
| `0` | `NONE` | Unsubscribed (no route configured) |
| `1` | `PREPARING` | Subscription initiated; resolving mDNS and negotiating flow |
| `2` | `RESOLVED` | Target mDNS record resolved; awaiting flow establishment |
| `16` | `UNRESOLVED` | Target `Channel@Device` could not be found on the network |
| `17` | `UNICAST` | **Active Route:** Receiving media via dynamically negotiated unicast flow |
| `18` | `MULTICAST` | **Active Route:** Receiving media via multicast flow |
| `257` | `COMMS_ERROR` | Communication error while negotiating flow with transmitter |
| `258` | `NO_CONNECTION` | Transmitter reachable via mDNS but flow connection failed/timed out |
| `259` | `INVALID_REPLY` | Transmitter returned an invalid or incompatible flow response |

To **unsubscribe** (clear a crosspoint), the controller sends an ARC RX Channel Subscription command with an empty `SourceChannelName` (`""`) and empty `SourceDeviceName` (`""`).

### 4.4 Router Properties (`PROPERTY_*`)
ARC exposes the following configurable device properties:

| Property ID | Name | Description & Defaults |
| :--- | :--- | :--- |
| `0` | `DEFAULT_RX_LATENCY` | Default target receive latency in microseconds (e.g., `1000` us = 1.0 ms) |
| `1` | `NETWORK_RX_LATENCY` | Configured network RX latency |
| `2` | `MAX_RX_LATENCY` | Maximum supported RX latency by hardware buffer |
| `3` | `MIN_TX_LATENCY` | Minimum supported TX latency |
| `4` | `DEFAULT_TX_FPP` | Default TX Frames Per Packet (`FPP`, e.g., `4`, `8`, `16`, `32`, `48`) |
| `5` | `MIN_RX_FPP` | Minimum supported RX Frames Per Packet |
| `6` | `MAX_UNICAST_PORT` | Upper bound of manual unicast RTP/UDP media port range |
| `7` | `MIN_UNICAST_PORT` | Lower bound of manual unicast RTP/UDP media port range |
| `8` | `RX_FLOW_DEFAULT_SLOTS` | Default number of channel slots allocated per dynamic RX flow |
| `9` | `CLOCK_SUBDOMAIN_NAME` | PTP clock subdomain identifier |
| `10` | `DEFAULT_UNICAST_PORT` | Default base UDP port for unicast media flows |
| `11` | `MIN_RX_LATENCY` | Minimum supported RX latency |
| `12` | `AES67_CURRENT` | Current active AES67 state |
| `13` | `AES67_CONFIGURED` | Configured AES67 state (takes effect after reboot) |
| `14` | `AES67_PREFIX` | IPv4 multicast prefix (`239.x.x.x`) for AES67 SAP/SDP flows |
| `15` | `RTP_FLAGS` | RTP header/transport flags |
| `16` | `RTP_FORMAT` | RTP media format identifier |
| `17` | `RTP_PORT` | RTP destination UDP port (`5004` standard for AES67) |
| `18` | `AUDIO_SYNC_DELAY` | Audio lip-sync delay offset |
| `19` | `INTEROP_LATENCY` | AES67 / SMPTE ST 2110 interoperability latency (default RTP latency `2000` us, payload type `97`) |
| `20` | `CLEAR_CONFIG` | Trigger router configuration reset |

---

## 5. Dante Via ("Rialto") Host Control Protocol

Dante Via (`DanteViaService.exe`) runs a local WebSocket server (built on WebSocket++ on `127.0.0.1`) that speaks a JSON-over-WebSocket protocol internally codenamed **Rialto**.

### 5.1 Envelope Structure
- **Client-to-Server Request:**
  ```json
  {
    "requestId": 101,
    "action": "SET_WANT_TO_RUN",
    "params": {
      "wantToRun": true
    }
  }
  ```
- **Server-to-Client Response / Asynchronous Event:**
  ```json
  {
    "requestId": 101,
    "model": { ... },
    "config": { ... },
    "options": { ... },
    "userError": null,
    "systemError": null
  }
  ```

### 5.2 Supported User Actions (`RialtoModelUserActionType`)
| Action | Purpose |
| :--- | :--- |
| `SET_WANT_TO_RUN` | Start or stop the Dante Via audio engine (`true` / `false`) |
| `SET_PRIMARY_ENDPOINT_PUBLIC` | Expose or unpublish a local soundcard/application endpoint on the Dante network |
| `SET_PRIMARY_ENDPOINT_HIDDEN` | Hide/unhide an endpoint in the UI |
| `SET_PRIMARY_ENDPOINT_GAIN` | Adjust endpoint trim/gain level |
| `CREATE_MIX_GROUP` | Create an application audio mix group |
| `RESIZE_MIX_GROUP` | Change channel count of a mix group |
| `DELETE_MIX_GROUP` | Remove a mix group |
| `SUBSCRIBE_ENDPOINT` | Route an entire source endpoint (application, soundcard, or network device) to a destination endpoint |
| `SUBSCRIBE_CHANNELS` | Route individual channels to a destination |
| `SET_ENDPOINT_SUBSCRIPTION_GAIN` | Adjust crosspoint gain for an endpoint subscription |
| `SET_CHANNELS_SUBSCRIPTION_GAIN` | Adjust crosspoint gain for a channel subscription |
| `SET_MIX_INPUT_SUBSCRIPTION_GAIN` | Adjust input gain within a mix group |
| `SET_GLOBAL_MUTE` | Mute/unmute all Dante Via audio |
| `SET_INTERFACE` | Select the host network interface (`iface`) for Dante traffic |
| `SET_AUTOPUBLISH_APPLICATIONS` | Toggle automatic network publishing of newly launched audio applications |
| `SET_AUTOPUBLISH_SOUNDCARDS` | Toggle automatic network publishing of connected USB/PCIe soundcards |
| `SET_SCAN_FOR_ASIO_SOUNDCARDS` | Enable/disable ASIO driver scanning |
| `SCAN_NOW_FOR_ASIO` | Trigger immediate ASIO driver scan |
| `SET_SYSTEM_PERFORMANCE_LEVEL` | Adjust host audio buffer/latency profile |
| `ACCESS_CONTROL_ENABLED` / `ACCESS_CONTROL_RESET` / `SET_DEVICE_ACCESS_ALLOWED` / `ADD_ACCESS_CONTROL_RULE` | Manage local host endpoint access permissions |
| `ACTIVATE_LICENSE` / `DEACTIVATE_LICENSE` / `REACTIVATE_LICENSE` / `SET_LICENSE` | Manage host activation state |
| `CLEAR_DOMAIN_CREDENTIALS` | Clear saved Dante Domain Manager credentials |
| `DUMP_STATE` / `CLEAR_THE_WORLD` | Export diagnostic state or clear all routes |

### 5.3 Asynchronous Model Events (`RialtoModelEventType`)
The service pushes incremental state updates tagged with:
- `RESET`, `STATE_CHANGED`, `APEC_DEVICE_NAME_CHANGED`, `INTERFACE_UPDATED`
- `ENDPOINT_DISCOVERED`, `ENDPOINT_CREATED`, `ENDPOINT_DELETED`, `ENDPOINT_CHANGED`
- `CHANNEL_CHANGED`, `ENDPOINT_SUBSCRIPTION_CHANGED`, `CHANNEL_SUBSCRIPTION_CHANGED`
- `ACCESS_CONTROL_QUERY_ADDED`, `ACCESS_CONTROL_QUERY_REMOVED`, `ACCESS_CONTROL_ENABLED_CHANGED`
- `LICENSE_INFORMATION_CHANGED`, `LICENSE_DEVICE_INFO_CHANGED`

---

## 6. Dante Studio (`video_manager`) Local WebSocket Control Protocol

Dante Studio's background service (`video_manager.exe`) exposes a local WebSocket server for controlling Dante AV video RX/TX on the host PC:
- **Endpoint URL:** `ws://127.0.0.1:4778`
- **Required WebSocket Subprotocol Header:** `Sec-WebSocket-Protocol: UserInterface`
- **Keepalive / Reconnect:** Client reconnects every `2000` ms on disconnect.

### 6.1 Request & Response Message Schemas
All messages are UTF-8 JSON objects dispatched by a `message_type` string field:

| Client Request (`message_type`) | Request Fields | Server Response (`message_type` or key) | Response Fields |
| :--- | :--- | :--- | :--- |
| `"query_manager"` | `{ "message_type": "query_manager" }` | `"manager_state"` | `rx_resolution` (`"2160p"`, `"1080p"`, `"720p"`), `avh_decoder_mode` (`"auto"`, `"intel"`, `"nvidia"`), `tx_subtype` (`"JPEG2000"`, `"H264"`, `"H265"`), `network: { available_interfaces: string[], current_interface: string }`, `license: { is_licensed, serial_number, status, rx_video_channels, tx_video_channels }` |
| `"screens"` | `{ "message_type": "screens" }` | `"enumerated_displays"` | `screens: [{ name: string, monitor_handle: number, resolution: string }]` |
| `"get_tx_state"` | `{ "message_type": "get_tx_state" }` | `"tx_state"` | `is_started: boolean`, `monitor_handle: number` |
| `"start_capture"` | `{ "message_type": "start_capture", "monitor_handle": number, "show_cursor": boolean }` | `"start_capture_status"` | `status_code: 0 | 1` (`0` = success, `1` = failure) |
| `"stop_capture"` | `{ "message_type": "stop_capture" }` | `"stop_capture_status"` | `status_code: 0 | 1` |
| `"interface_select"` | `{ "message_type": "interface_select", "interface_name": string }` | `"interface_select_status"` | `status_code: 0 | 1` |
| `"rx_resolution_selected"` | `{ "message_type": "rx_resolution_selected", "rx_resolution": "2160p"|"1080p"|"720p" }` | `"rx_resolution_status"` | `status_code: 0 | 1` |
| `"avh_decoder_mode_selected"` | `{ "message_type": "avh_decoder_mode_selected", "avh_decoder_mode": "auto"|"intel"|"nvidia" }` | `"avh_decoder_mode_status"` | `status_code: 0 | 1` |
| `"tx_subtype_selected"` | `{ "message_type": "tx_subtype_selected", "tx_subtype": "JPEG2000"|"H264"|"H265" }` | `"tx_subtype_status"` | `status_code: 0 | 1` |
| `"open_video_viewer"` | `{ "message_type": "open_video_viewer" }` | — | Launches standalone Dante Video Viewer window |
| `"clear_domain_credentials"` | `{ "message_type": "clear_domain_credentials" }` | — | Clears cached DDM credentials |
| *(Server Push)* | — | `"capture_force_stop"` | `{ "message_type": "capture_force_stop" }` — emitted when display mode change or error halts TX capture |

---

## 7. Integration Recommendations for "One Ring" Unified Church Controller

1. **Direct Network Control (Zero Host Dependency):**
   - The Unified Controller can discover, monitor, and route **any hardware or software Dante endpoint on the church LAN** directly via UDP using:
     - **mDNS (`224.0.0.251:5353`)** for `_netaudio-arc._udp.local.` and `_netaudio-chan._udp.local.` discovery.
     - **ARC (`UDP <arc_port>`)** for crosspoint routing (subscribing FOH console, broadcast mix, ProPresenter audio, and amp racks), channel labeling, and latency inspection.
     - **Conmon (`224.0.0.230:8703`, `224.0.0.231:8702`, `224.0.0.232:8751`)** for real-time audio peak meters across all channels, PTP clock lock verification, sample-rate mismatch alerts, and hardware "Identify" LED flashing.
2. **Optional Host Agent Integration:**
   - When running on a machine with **Dante Studio**, connect to `ws://127.0.0.1:4778` (`Sec-WebSocket-Protocol: UserInterface`) to toggle screen capture TX or switch H.264/H.265/JPEG2000 codecs.
   - When running on a machine with **Dante Via**, connect to the local Rialto WebSocket service to auto-route application audio sources (e.g., Spotify, Zoom, OBS, ProPresenter) onto the Dante network.
