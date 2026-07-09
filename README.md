# Black Mic Studio

Black Mic Studio is a personal Linux tool for using a phone as a microphone, streaming that audio to a PC browser, optionally bridging it into a PipeWire/PulseAudio virtual sink, and recording screen plus phone audio through ffmpeg/VAAPI.

This project was built for one local setup first. If it helps someone else, good, but expect to adjust the audio stack, GPU driver, or environment variables for another machine.

## What It Does

- Phone browser captures microphone audio.
- PC browser receives and plays the stream.
- Socket.IO relays PCM chunks between devices in a room.
- The server can create a virtual Pulse/PipeWire sink for the phone mic.
- The receiver can record audio-only takes in the browser.
- The receiver can record screen frames plus phone audio to `~/Videos` using ffmpeg and VAAPI.
- The UI shows room state, telemetry, logs, recording controls, and server warnings.

## Requirements

- Linux
- Node.js and npm
- ffmpeg
- `pactl` with PulseAudio or PipeWire Pulse compatibility
- A modern browser with `AudioWorklet` support
- HTTPS or localhost access for microphone and screen permissions
- Optional: ADB reverse tunnel for phone-to-PC localhost access over USB
- Optional: VAAPI-capable GPU for hardware screen recording

## Quick Start

Install dependencies:

```bash
npm install
cd client
npm install
cd ..
```

Build and launch:

```bash
./start.sh
```

Open the URL printed by the launcher. With local cert files present, this is usually:

```text
https://localhost:3001
```

Use the same room ID on both devices. Start the phone as `Phone (Microphone)` and the PC as `PC (Receiver)`.

## Configuration

Defaults match the original personal setup, but they can be overridden with environment variables:

```bash
PORT=3001
BMS_SERVER_URL=https://localhost:3001
BMS_VAAPI_DEVICE=/dev/dri/renderD129
BMS_LIBVA_DRIVER=i965
BMS_VIDEOS_DIR="$HOME/Videos"
BMS_RECORD_FPS=20
BMS_VIDEO_BITRATE=4M
BMS_AUDIO_BITRATE=192k
BMS_MAX_SOCKET_PAYLOAD_MB=5
```

Examples:

```bash
PORT=4000 ./start.sh
```

```bash
BMS_VAAPI_DEVICE=/dev/dri/renderD128 BMS_LIBVA_DRIVER=iHD ./start.sh
```

## Recording Notes

Before relying on a recording, make a short 10-second take and play the saved file back. This is more useful for this kind of audio/video tool than trusting a generic green test result.

VAAPI recording depends on your GPU, driver, ffmpeg build, and render device. If recording fails, check the in-app warning first, then `.server.log`.

## Phone Connection

For Android over USB, the launcher tries:

```bash
adb reverse tcp:$PORT tcp:$PORT
```

If ADB is not connected, the PC side still starts. You can connect the phone another way as long as it can reach the server URL.

## Project Shape

- `server.js` - Express and Socket.IO server.
- `server/recording.js` - PipeWire/PulseAudio bridge and ffmpeg recording.
- `server/config.js` - environment-backed server configuration.
- `client/src/App.jsx` - main app behavior.
- `client/src/components/` - UI sections.
- `client/public/audio-processor.js` - AudioWorklet PCM conversion.

## Scope

This is a personal tool, not a commercial multi-user service. It intentionally keeps local-use assumptions. If publishing or adapting it, document your own audio stack and hardware settings clearly.
