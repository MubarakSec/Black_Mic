# Changelog

## 1.3.0 — 2026-11-13

Studio voice milestone.

### Added
- **STUDIO profile** (new default for fresh installs): 100 Hz HPF → presence peak (+2.5 dB @ 3.2 kHz) → air shelf (+3 dB @ 12 kHz) → 3:1 compressor → peak limiter. Browser DSP intentionally bypassed for control. Noise-gate calibration now applies to STUDIO as well.
- **Lossless WAV export** for recorded takes: webm/opus is decoded via Web Audio and re-encoded as interleaved Int16 WAV with TPDF dither (`utils/wavEncoder.js`); per-take WAV button in the Recording Library.
- **Adaptive jitter buffer** on the receiver: +10 ms steps (max 120 ms) on underrun spikes, −5 ms relax toward the user's floor when stable; changes are logged.
- WAV encoder unit tests.

### Fixed
- Float→Int16 capture conversion now applies ±1 LSB TPDF dither (quantization noise becomes smooth, not gritty).
- Stereo noise-reduction envelope no longer double-progresses per sample; gain smoothing is per frame and applied identically to both channels.

### Changed
- Webm recording bitrate raised to 128 kbps Opus.
- Audio profile segmented control gains the STUDIO option; noise-gate UI generalized (FAN/STUDIO) with updated copy.

## 1.2.0 — 2026-11-13

USB-first mode. The phone now connects exclusively over USB by default.

### Added
- `GET /usb-status` endpoint (`server/usb-status.js`): adb availability, per-device state (`device`/`unauthorized`/`none`/`missing`), ready flag, 5 s cache. Unit-tested.
- `start.sh` USB mode is now the default: binds `127.0.0.1`, runs `adb reverse` per attached device, guides through unauthorized/missing-phone states, `--unreverse` cleanup flag, `--lan` opt-out with plain-HTTP mic warning, `.server.log` rotation at 1 MB.
- Client: `useUsbStatus` hook + live USB badge in the console header (green/amber/red). Secure-context banner when the page is opened over non-HTTPS LAN origins.
- vite dev proxy now covers `/usb-status` and `/healthz`.

### Changed
- README quick start rewritten for USB: adb + `adb reverse` gives the phone `localhost` access as a secure context — phone mic works with **no HTTPS certificates**.
- `start.sh --help` output; launcher opens the browser at `localhost:3001` in USB mode.

## 1.1.0 — 2026-11-13

Hardening, performance, and tooling milestone. No protocol changes.

### Fixed
- Persisted `inputGain`/`outputVolume`/jitter buffer now clamped to valid ranges on load (previously a stored `999` reached a GainNode).
- Remote (PC-side) gain/mute commands applied with 10 ms smoothing instead of instant `gain.value` writes — no more clicks.
- Socket telemetry effect no longer re-registers all listeners on every gain slider tick.
- `unhandledRejection` now triggers the same graceful shutdown as `uncaughtException`.
- Wake lock guarded against double-request and stale refs; remote leave-room emit cleaned up.
- `pacat` audio bridge resets itself on write/spawn failure instead of writing into a dead process.
- `BMS_EASYEFFECTS_ROOM` validated against room-id rules with fallback to default.
- Fan-noise floor input derives from props during render (no setState-in-effect).

### Performance
- Room registry lookups (join occupancy, member count, room state) are now O(1) via a room→role→socket index instead of full scans.
- PCM relay uses uninitialised buffers (dropped per-packet zero-fill).
- Default socket.io payload cap reduced 5 MiB → 1 MiB.

### Added
- `/healthz` endpoint (`ok`, `uptimeSec`, `activeRooms`).
- Per-socket `join-room` rate limiting (10 attempts / 10 s, `RATE_LIMITED` ack code).
- `BMS_HOST` bind address configuration; `BMS_LOG_LEVEL` leveled logging (`server/logger.js`).
- Shared protocol constants per side (`server/protocol.js`, `client/src/utils/protocol.js`).
- `client/src/utils/storage.js` (clamped/tolerant localStorage), `visualizerEngine.js`, `audioProfileGraph.js`, `useLogBuffer` hook.
- Unit tests for protocol and storage helpers; CI workflow (lint, unit tests, client build).
- Docs: `server/README.md` (protocol & lifecycle), `client/ARCHITECTURE.md`, `CONTRIBUTING.md`, `LICENSE` (ISC), `.editorconfig`.

### Changed
- `useAudioEngine` split down (~731 → ~560 lines); visualizer and profile-graph logic extracted.
- Client oxlint is at zero warnings.
- Removed dead code: `upmixMonoToStereoBuffer`, unused assets, `ffmpeg` requirement, lossless-audio wording corrected.
- Version bumped to 1.1.0.
