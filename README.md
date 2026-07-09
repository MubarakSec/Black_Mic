# Black Mic Studio

Black Mic Studio is a personal Linux utility for using your phone as a high-quality wireless microphone. It streams lossless audio from a phone browser to a PC and bridges it directly into a virtual PipeWire/PulseAudio system input for OBS or any other desktop app.

This makes your phone's microphone available system-wide on your PC, allowing you to select it as an input device in applications like **Discord, Zoom, OBS Studio, Audacity, and browser calls**.

---

## Features

- **Lossless Audio Streaming:** Captures raw microphone input from the phone and streams it directly to the PC.
- **Low-Latency Voice Bridge:** Relays PCM chunks over WebSockets and maps them to a virtual PipeWire null-sink with a small receiver jitter buffer for smoother speech.
- **System-Wide Input:** Automatically registers the virtual device on your PC so you can select the phone mic in external applications.
- **Browser Audio Recording:** Enables receiver-side local audio-only takes.
- **Voice Telemetry:** Displays real-time round-trip latency, bitrate, and receiver underruns.
- **No Video Capture:** OBS handles video; this tool only provides the phone microphone audio path.

---

## Requirements

- **Linux OS** (with PulseAudio or PipeWire-Pulse compatibility layer).
- **Node.js** and **npm** installed.
- **ffmpeg** installed.
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

Defaults match a standard local setup, but you can override configurations with environment variables:

```bash
PORT=3001
BMS_SERVER_URL=https://localhost:3001
BMS_MAX_SOCKET_PAYLOAD_MB=5
BMS_ALLOWED_ORIGINS=https://your-host.example
```

For example, to run on a custom port:
```bash
PORT=4000 ./start.sh
```

---

## Project Structure

- `server.js` - Express and Socket.IO server.
- `server/recording.js` - PipeWire/PulseAudio virtual sink setup and audio bridge routing.
- `server/pcm-utils.js` - PCM conversion helpers used by the server audio bridge.
- `server/config.js` - Environment-backed server configuration.
- `client/src/App.jsx` - Main React application logic.
- `client/src/components/` - Presentational UI console panels.
- `client/public/audio-processor.js` - Sender AudioWorklet PCM encoder.
- `client/public/receiver-playback-processor.js` - Receiver AudioWorklet PCM playback buffer.
