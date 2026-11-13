# Black Mic Studio — Client Architecture

React 19 + Vite SPA (ES modules). UI is a single screen with two roles: **sender** (phone, captures mic) and **receiver** (PC, plays + records). Bundled by Vite to `client/dist` and served by the Node server; in dev, Vite proxies Socket.IO to `PORT` (default 3001).

## Module map

| Path | Responsibility |
| --- | --- |
| `App.jsx` | Role state, room id, settings persistence, hook wiring, disconnect cleanup |
| `hooks/useAudioEngine.js` | Audio graph, wake lock, calibration, mic/receiver control, unlock overlay state |
| `hooks/useSocketConnection.js` | Socket.IO lifecycle, join/rejoin, telemetry (RTT/bitrate), remote-control relay + acks |
| `hooks/useRecording.js` | Receiver-side MediaRecorder capture → webm download + in-app library |
| `hooks/useMicrophoneDevices.js` | Device enumeration + ranking, preferred device persistence |
| `hooks/useLogBuffer.js` | Bounded operator log ring buffer |
| `utils/visualizerEngine.js` | 20 fps direct-DOM/canvas visualizer (no React re-renders) |
| `utils/audioProfileGraph.js` | RAW/CLEAN/FAN/CALL input chain + peak limiter wiring |
| `utils/protocol.js` | Wire-protocol constants (mirror of `server/protocol.js`) |
| `utils/socketValidation.js` | Runtime validation of everything arriving over the socket |
| `utils/storage.js` | localStorage helpers: clamped reads, boolean reads, failure-tolerant writes |
| `utils/micRecommendation.js`, `micDevices` | Label-based mic ranking heuristics |
| `utils/audioCues.js`, `audioKeepalive.js`, `getAudioSetupError.js` | Alarm/unlock tones, iOS keepalive, mic-error translation |
| `public/audio-processor.js` | Capture AudioWorklet: batch Int16 encode, noise gate, telemetry |
| `public/receiver-playback-processor.js` | Playback AudioWorklet: jitter buffer, resampling, underrun counter |

## Data flow (sender)

```
getUserMedia → MediaStreamSource → profile graph (RAW/CLEAN/FAN/CALL)
  → GainNode (inputGain) → DynamicsCompressor (limiter, skipped for RAW)
  → Analyser → AudioWorkletNode('audio-processor')
  → postMessage Int16 batch → main thread packs [magic|rate|channels]
  → socket.emit('pcm-chunk') → server relay → receiver
```

Worklets communicate via transferable buffers with a recycle pool — zero steady-state allocation in the hot path.

## Data flow (receiver)

```
socket 'pcm-chunk' → normalizePcmPayload (validates magic/rate/channels/alignment)
  → receiver-playback-processor (jitter buffer target = jitterBufferMs)
  → Analyser → MediaStreamDestination (recording) + optional monitor gain
```

## Persistence keys (`bms_*`)

`roomId`, `channelMode`, `audioProfile`, `receiverBufferMs`, `inputGain`,
`outputVolume`, `noiseReduction`, `noiseFloor`, `micDeviceId` — all read through
`utils/storage.js` with bounds/whitelists and written failure-tolerantly.

## Constraints

- **No setState in effects** for values derivable during render (fan-noise floor pattern).
- Refs are never read during render; side effects live in hooks' effects.
- Visualizer/metering bypass React entirely (direct DOM writes at 20 fps).
- `AudioWorklet` everywhere — no `ScriptProcessorNode`.
- New utils get unit tests in `tests/unit/` (vitest, ESM).
