# Live Adapters (Phase 2)

The Tauri backend runs the **simulator by default**. Live hardware/software adapters are opt-in so
the app remains demoable on any machine.

## Enabling live mode

```bash
RING_LIVE=1 npm run tauri dev
# or: ONE_RING_LIVE=1
```

When live mode starts, `mock_mode` is set to `false` and the frontend hydrates `get_app_state`
once, then applies pushed events (no more 1 s snapshot polling).

### Endpoint overrides

| Adapter | Variables | Default |
| :--- | :--- | :--- |
| Behringer X32 | `RING_X32_HOST`, `RING_X32_PORT` | disabled unless `RING_X32_HOST` is set, port `10023` |
| OBS Studio (obs-websocket v5) | `RING_OBS_URL`, `RING_OBS_PASSWORD` | `ws://127.0.0.1:4455`, no password |
| Streamlabs Desktop | `RING_SLOBS_ADDR` | `127.0.0.1:28194` |
| ProPresenter v1 | `RING_PP_HOST`, `RING_PP_PORT` | `127.0.0.1:50000` |

The Streamlabs adapter uses the auto-authorized loopback TCP endpoint. On Windows the transport
can additionally target `\\.\pipe\slobs`; the named-pipe transport is intentionally not wired in
this slice.

## Event contract

Emitted with camelCase JSON (`src-tauri/src/runtime/events.rs`, consumed by `src/bridge.ts`):

| Channel | Payload | Semantics |
| :--- | :--- | :--- |
| `device://health` | `HealthEvent` | Transition-only (`connecting`, `ok`, `warn`, `error`, `offline`). |
| `meter://x32`, `meter://dante` | `MeterEvent` | Coalesced latest-wins frames, capped at 20 Hz. |
| `state://x32`, `state://obs`, `state://slides`, `state://streamlabs`, `state://log` | `StatePatch` | Partial domain patches with a monotonic `revision`. |
| `cue://progress` | `CueProgressEvent` | Per-step cue telemetry (`running`, `applied`, `rehearsal`, `drift`, `failed`). |

State patches are **partial** (`{ "dcas": [...] }`, `{ "slides": {...} }`, …) and must be merged,
never treated as a full `AppStateSnapshot`. `state://log` carries a single `eventLogEntry` line.

## Live behaviour per adapter

- **X32** — sends `/xinfo` + `/xremote`, refreshes `/xremote` every 8 s, parses `/meters/1`,
  maps DCA faders/mutes both ways, and retries with capped exponential backoff. Writes are applied
  optimistically and reconciled by the `/xremote` echo.
- **OBS** — WebSocket `obswebsocket.json` subprotocol, salted SHA-256 `Identify`, then
  `GetCanvasList` / `GetSceneList` / `GetOutputList` / stream + record status. Scene, stream,
  record, and canvas events patch `state://obs`.
- **Streamlabs** — newline-delimited JSON-RPC 2.0; subscribes `StreamingService`,
  `ScenesService`, and `DualOutputService`, maps `streamingStatusChange` /
  `recordingStatusChange` onto the broadcast strip.
- **ProPresenter** — one long-lived `POST /v1/status/updates` multiplexed stream (slide, active
  playlist, timers, transport time, layers). `next` / `previous` / clear-layer use separate
  short-lived HTTP connections so the stream is never interrupted. A `/version` probe detects a
  silently dead hub.

## Calibration caveats

These values are correct per the clean-room findings but must be confirmed against the actual
firmware/versions in the building before a service:

1. **X32 `/meters/1` DCA offset** — defaults to `32` (32 channel meters first, then DCAs). If the
   console firmware orders the bank differently, adjust `X32Config::dca_meter_offset`.
2. **X32 fader law** — `dB = 80.04 * log10(fader / 0.75)` (unity at `0.75`), with `-90 dB` floor.
   Verify against the console's displayed fader values.
3. **Meter byte mapping** — treated as linear peak magnitude (`20 * log10(byte / 255)`); `0` is
   silence, `255` is clip. Confirm against the mixer's meter scale.
4. **ProPresenter ports/endpoints** — API on port `50000` by default; the status-stream request
   body uses the five church-default topics. Confirm the local API is enabled.
5. **OBS canvas API** — multi-canvas calls require OBS 33+ with obs-websocket 5.x. Older OBS will
   return request errors (logged, non-fatal); the app still tracks scenes/outputs.

## Verification

```bash
cd src-tauri && cargo test   # 56 protocol + 24 runtime tests
npm run build                # tsc + vite
```
