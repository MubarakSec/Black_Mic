# Changelog

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
