# Black Mic Studio — Server Internals

Node.js + Socket.IO + Express server (CommonJS). Serves the built client from `client/dist`, relays validated PCM audio phone → PC, and bridges each room into a system-wide PipeWire/PulseAudio virtual microphone.

## Module map

| File | Responsibility |
| --- | --- |
| `server.js` | HTTP(S) + Socket.IO bootstrap, room join/leave, PCM relay, remote-control relay, `/healthz` |
| `config.js` | Env parsing: `PORT`, `BMS_HOST`, `BMS_ALLOWED_ORIGINS`, `BMS_MAX_SOCKET_PAYLOAD_MB` |
| `protocol.js` | Shared wire-protocol constants (magic bytes, header layout, bounds, regex) |
| `socket-validation.js` | Runtime validation of every inbound socket payload |
| `room-registry.js` | `socketId → { roomId, role }` index plus `room → role → Set(socketId)` index |
| `recording.js` | Virtual PipeWire sink lifecycle, `pacat` audio bridge, PCM queue + backpressure |
| `easyeffects-router.js` | Optional EasyEffects RNNoise routing for the default room |
| `shutdown-handler.js` | Graceful SIGINT/SIGTERM/fatal-error shutdown (unload modules, close server) |
| `logger.js` | Leveled logging (`BMS_LOG_LEVEL=debug|info|warn|error`, default `info`) |
| `pcm-utils.js` | Stereo→mono downmix for the virtual sink |

## Wire protocol (phone → server → PC)

Binary frames:

```
[uint16 LE magic 0xBC4D][uint32 LE sampleRate][uint8 channelCount][Int16 PCM little-endian]
```

- Header length: 7 bytes. Payload must align to `2 * channelCount` bytes.
- `sampleRate` ∈ [8000, 96000]. `channelCount` ∈ {1, 2}. Room id ∈ `^[A-Z0-9]{3,12}$`.
- Server **only relays validated frames**, reconstructing the header itself.
- Client→server `pcm-chunk` is accepted only from sockets whose registered role is `sender` and whose socket is in the target room.

## Room lifecycle

1. Both devices `join-room(roomId, role, ack)`. Exactly one `sender` and one `receiver` per room; the second claimant gets `{ ok: false, code: 'ROLE_TAKEN' }`.
2. Joins are rate-limited per socket (10 attempts / 10 s sliding window). Repeated offenders get `RATE_LIMITED`.
3. On `receiver` join, the server provisions a virtual PipeWire null-sink (`BMS_<room>_Sink`) + remap source (`BlackMic_<room>`) and emits `virtual-mic-state`.
4. `sender` PCM frames are relayed to the room and written into a `pacat` child process feeding the null-sink. If the pipe fills, frames are dropped (never buffered) to keep latency bounded.
5. Generation counters cancel stale sink setups when a receiver leaves mid-init. Room teardown unloads PipeWire modules on last leave.

## Operational notes

- **HTTPS:** if `server.key` + `server.cert` exist next to `server.js`, HTTPS is used (required for phone mic access over LAN). Otherwise plain HTTP.
- **Graceful shutdown:** on fatal process errors or signals, sockets close, the HTTP server drains, and all virtual sinks are unloaded.
- **Health:** `GET /healthz` → `{ ok, uptimeSec, activeRooms }`.
- **Logs:** set `BMS_LOG_LEVEL=debug` for pacat/init tracing.
- **Environment:** see the README "Environment variables" table for the full `BMS_*` list.
