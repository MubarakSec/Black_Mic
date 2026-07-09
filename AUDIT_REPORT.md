# Black Mic Studio — Audit Report

## Critical Issues

### 1. Deprecated Audio API (`ScriptProcessorNode`)
**File:** `client/src/App.jsx:383`
The core audio pipeline uses `ScriptProcessorNode`, which is deprecated and will be removed by browsers. Must migrate to `AudioWorklet`.

### 2. No Security
- **CORS wide open** (`server.js:14`): `origin: "*"` allows any site to connect.
- **No room authentication** (`server.js:22-25`): anyone can join any room by guessing a 12-char ID.
- **No rate limiting** on socket events — susceptible to spam.
- **No TLS/HTTPS**: `getUserMedia` and Wake Lock API require a secure context.

### 3. No TypeScript
Entire codebase is plain JSX. No type safety for socket events, refs, or audio buffers — leads to silent runtime errors.

### 4. No Tests or CI
Zero test files. No lint CI, no build CI, no deployment pipeline.

### 5. No Version Control
The project is not a git repository — no history, no rollback, no collaboration.

### 6. No HTTPS/WSS Configuration
Browser audio APIs require secure contexts. The app will not work on HTTPS-only browsers without configuration.

---

## Medium Issues

| Issue | Location | Detail |
|---|---|---|
| **1018-line component** | `App.jsx` | Single monolithic component — should be split into smaller modules |
| **Fake telemetry metric** | `App.jsx:23` | `packetLoss` is hardcoded to `0` but displayed as live data |
| **No root `.gitignore`** | root dir | `node_modules` would be tracked without it |
| **README doesn't describe project** | `client/README.md` | Still the default Vite template README |
| **`package.json` `main` misconfigured** | `package.json:5` | Points to `index.js` instead of `server.js` |

---

## Minor Issues

| Issue | Location | Detail |
|---|---|---|
| **Page title is "client"** | `client/index.html:7` | Default Vite title, not updated |
| **184 lines of dead CSS** | `client/src/App.css` | Unused boilerplate from Vite template |
| **Port 3001 hardcoded** | `server.js:56`, `vite.config.js:10` | Should use environment variable |
| **Background process in dev script** | `package.json:8-9` | `npm run dev` leaves orphan processes |
| **Hardcoded sample rate** | `App.jsx:359` | Assumes 48kHz — may not match all devices |

---

## Recommendations

1. Initialize git repo immediately
2. Migrate `ScriptProcessorNode` → `AudioWorklet`
3. Add HTTPS/WSS and room authentication
4. Add TypeScript
5. Extract components from `App.jsx` (at minimum: `RoomSelector`, `Visualizer`, `TelemetryStrip`, `RecordingLibrary`)
6. Add unit tests for the PCM conversion and socket logic
7. Add environment config for port, sample rate, etc.
