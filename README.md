# Black Mic Studio

Black Mic Studio is a personal Linux utility for using your phone as a high-quality wireless microphone. It streams uncompressed Int16 PCM audio from a phone browser to a PC and bridges it directly into a virtual PipeWire/PulseAudio system input for OBS or any other desktop app.

This makes your phone's microphone available system-wide on your PC, allowing you to select it as an input device in applications like **Discord, Zoom, OBS Studio, Audacity, and browser calls**.

---

## Features

- **Uncompressed Audio Streaming:** Captures raw microphone input from the phone and streams Int16 PCM directly to the PC — no codec latency, no transcoding artifacts.
- **Low-Latency Voice Bridge:** Relays PCM chunks over WebSockets and maps them to a virtual PipeWire null-sink with a small receiver jitter buffer for smoother speech.
- **System-Wide Input:** Automatically registers the virtual device on your PC so you can select the phone mic in external applications.
- **Browser Audio Recording:** Enables receiver-side local audio-only takes.
- **Voice Telemetry:** Displays real-time round-trip latency, bitrate, and receiver underruns.
- **No Video Capture:** OBS handles video; this tool only provides the phone microphone audio path.

---

## Requirements

- **Linux OS** (with PulseAudio or PipeWire-Pulse compatibility layer).
- **Node.js** and **npm** installed.
- **`pactl`** command-line utility.
- A modern phone browser with `AudioWorklet` support.
- HTTPS or localhost access (needed for browser microphone permission).
- *Optional:* ADB installed for reverse USB tunneling.

---

## Quick Start

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Build and Launch:**
   ```bash
   ./start.sh
   ```

3. **Open the App:**
   Open the URL printed by the launcher on both your PC and your phone. With local cert files present, this is usually:
   ```text
   https://localhost:3001
   ```

4. **Connect Devices:**
   - Enter the same **Room ID** code on both devices.
   - Tap **Phone (Microphone)** on the phone.
   - Tap **PC (Receiver)** on the PC.

---

## Using with OBS Studio & Discord

Because this tool maps the phone microphone into a PipeWire virtual device, external PC applications recognize it as a real, system-wide microphone:

1. Connect your phone mic to the PC room.
2. Open **OBS Studio**, **Discord**, or **Zoom**.
3. Navigate to the app's **Audio/Microphone Input Settings**.
4. Select **"Monitor of Black"** (or `BMS_ROOM.monitor`) as the active input device.
5. In OBS, keep your normal video capture setup and use this virtual device only as the microphone source.

---

## Configuration

Defaults match a standard local setup, but everything important is overridable:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP/HTTPS listen port |
| `BMS_HOST` | all interfaces | Explicit bind address (e.g. `127.0.0.1` or your LAN IP) |
| `BMS_ALLOWED_ORIGINS` | dev: any, prod: same-origin only | Comma-separated CORS allowlist for socket.io and the API |
| `BMS_MAX_SOCKET_PAYLOAD_MB` | `1` | Max socket.io payload size in MiB |
| `BMS_EASYEFFECTS_ROOM` | `ROOM` | Room id that triggers automatic EasyEffects RNNoise routing |
| `BMS_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `BMS_SERVER_URL` | derived | Vite dev-server proxy target (read by `client/vite.config.js`) |
| `NODE_ENV` | — | `production` disables permissive CORS defaults |

For example, to run on a custom port:
```bash
PORT=4000 ./start.sh
```

`GET /healthz` returns `{ ok, uptimeSec, activeRooms }` for monitoring.

---

## Project Structure

- `server.js` - Express and Socket.IO server entry (relay, lifecycle, `/healthz`).
- `server/` - `config.js` (env), `protocol.js` (wire format), `socket-validation.js`, `room-registry.js`, `recording.js` (virtual sink/bridge), `easyeffects-router.js`, `shutdown-handler.js`, `logger.js`, `pcm-utils.js` — see [`server/README.md`](server/README.md).
- `client/src/App.jsx` - Main React application logic.
- `client/src/hooks/` - `useAudioEngine`, `useSocketConnection`, `useRecording`, `useMicrophoneDevices`, `useLogBuffer`.
- `client/src/utils/` - `protocol.js` (wire mirror), `socketValidation.js`, `storage.js`, `visualizerEngine.js`, `audioProfileGraph.js`, and cue/mic helpers.
- `client/src/components/` - Presentational UI console panels.
- `client/public/audio-processor.js` - Sender AudioWorklet PCM encoder.
- `client/public/receiver-playback-processor.js` - Receiver AudioWorklet PCM playback buffer.
- See [`client/ARCHITECTURE.md`](client/ARCHITECTURE.md) for the client module map and data flow.
