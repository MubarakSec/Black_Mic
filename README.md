# Black Mic Studio

Black Mic Studio is a personal Linux utility for using your phone as a high-quality microphone, connected over USB. It streams uncompressed Int16 PCM audio from a phone browser to a PC and bridges it directly into a virtual PipeWire/PulseAudio system input for OBS or any other desktop app.

This makes your phone's microphone available system-wide on your PC, allowing you to select it as an input device in applications like **Discord, Zoom, OBS Studio, Audacity, and browser calls**.

---

## Features

- **Uncompressed Audio Streaming:** Captures raw microphone input from the phone and streams Int16 PCM directly to the PC — no codec latency, no transcoding artifacts.
- **Low-Latency Voice Bridge:** Relays PCM chunks over WebSockets and maps them to a virtual PipeWire null-sink with a small receiver jitter buffer for smoother speech.
- **System-Wide Input:** Automatically registers the virtual device on your PC so you can select the phone mic in external applications.
- **Browser Audio Recording:** Receiver-side takes with **128 kbps Opus**, plus one-click **lossless WAV (Int16) export** — same-quality masters from every recorded take.
- **STUDIO Broadcast Profile:** Default voice chain for the phone mic — 100 Hz HPF, +2.5 dB presence bump @ 3.2 kHz, +3 dB air shelf @ 12 kHz, gentle 3:1 compressor, plus the optional calibrated noise gate.
- **Adaptive Jitter Buffer:** The receiver automatically raises the playback buffer in 10 ms steps when underruns spike and relaxes toward your floor when stable (never below your setting).
- **TPDF Dithered Capture:** Float→Int16 conversion with ±1 LSB triangular dither — no quantization grit in quiet passages.
- **Voice Telemetry:** Displays real-time round-trip latency, bitrate, and receiver underruns.
- **No Video Capture:** OBS handles video; this tool only provides the phone microphone audio path.

---

## Requirements

- **Linux OS** (with PulseAudio or PipeWire-Pulse compatibility layer).
- **Node.js** (>= 18) and **npm** installed.
- **`pactl`** command-line utility (`pulseaudio-utils`).
- **ADB** (`android-tools-adb`) — required for the default USB mode.
- A modern phone browser with `AudioWorklet` support.
- A USB cable and **USB debugging** enabled on the phone (Developer Options).

No HTTPS certificates are needed in USB mode: the phone reaches the app as
`localhost` via `adb reverse`, and browsers treat that as a secure context.

---

## Quick Start (USB)

1. **Install Dependencies:**
   ```bash
   npm ci
   (cd client && npm ci)
   ```

2. **Plug in your phone** and enable **Developer Options → USB debugging**.
   Accept the "Allow USB debugging" popup when it appears.

3. **Build and Launch:**
   ```bash
   ./start.sh
   ```
   The launcher verifies node/pactl/adb, binds the server to **localhost only**,
   and sets `adb reverse tcp:3001 tcp:3001` for every attached device.

4. **Open the App:**
   On the phone's browser, open the same URL printed by the launcher:
   ```text
   http://localhost:3001
   ```
   Because of `adb reverse`, that URL resolves to your PC — and because it is
   localhost, the browser grants microphone access without any certificates.
   Open the same URL on your PC.

5. **Connect Devices:**
   - Enter the same **Room ID** code on both devices.
   - Tap **Phone (Microphone)** on the phone.
   - Tap **PC (Receiver)** on the PC.

6. **Cleanup when done (optional):**
   ```bash
   ./start.sh --unreverse   # remove the adb reverse tunnel
   ```

### Fallback: LAN mode

Prefer Wi-Fi over USB? `./start.sh --lan` binds on all interfaces. Note that
over plain HTTP the phone **will refuse microphone access** — you must place
`server.key`/`server.cert` next to `server.js` (the launcher then serves
HTTPS) or accept that USB is the supported path.

### Diagnostics

- `GET /healthz` → `{ ok, uptimeSec, activeRooms }`
- `GET /usb-status` → adb availability and per-device state
  (`device` / `unauthorized` / `none` / `missing`, plus `ready`)

---

## Using with OBS Studio & Discord

Because this tool maps the phone microphone into a PipeWire virtual device, external PC applications recognize it as a real, system-wide microphone:

1. Connect your phone mic to the PC room.
2. Open **OBS Studio**, **Discord**, or **Zoom**.
3. Navigate to the app's **Audio/Microphone Input Settings**.
4. Select **"Monitor of Black"** (or `BMS_ROOM.monitor`) as the active input device.
5. In OBS, keep your normal video capture setup and use this virtual device only as the microphone source.

---

## Audio Profiles

| Profile | Chain | Use it for |
| --- | --- | --- |
| **STUDIO** (default) | 100 Hz HPF → presence peak (+2.5 dB @ 3.2 kHz) → air shelf (+3 dB @ 12 kHz) → 3:1 compressor → limiter; noise gate available | Broadcast-voice sound from the phone mic |
| RAW | No browser/Android DSP, unity gain path, soft limiter bypassed for full fidelity | External processing, archival |
| CLEAN | 80 Hz HPF → gentle compressor → limiter | General calls |
| FAN | HPF + calibrated noise-floor expander (quiet room required) | Fan/environment noise |
| CALL | Browser echo cancellation + noise suppression | Open-speaker echo situations |

The noise gate calibration (Capture → 🎯 Calibrate) applies to **FAN and STUDIO** — ruler-flat noise floor, opened instantly by voice.

---

## Configuration

Defaults match a standard local setup, but everything important is overridable:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP/HTTPS listen port |
| `BMS_HOST` | `127.0.0.1` in USB mode, `0.0.0.0` with `--lan` | Explicit bind address override |
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

`GET /healthz` and `GET /usb-status` power monitoring and USB diagnostics.

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
