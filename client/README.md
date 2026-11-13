# Black Mic Studio — Client

React 19 + Vite single-page app. It is **not** a standalone project — see the
[root README](../README.md) for setup and [ARCHITECTURE.md](./ARCHITECTURE.md)
for the module map and data flow.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server (https when `../server.key`+`../server.cert` exist); proxies `/socket.io`, `/usb-status`, `/healthz` to `127.0.0.1:$PORT` (env `BMS_SERVER_URL` overrides) |
| `npm run build` | Production bundle → `dist/` |
| `npm run preview` | Serve `dist/` locally (used by CI's smoke check) |
| `npm run lint` | oxlint (zero-warning policy; also enforced in CI) |

## Conventions

- Protocol constants mirror `server/protocol.js` — change both together.
- `localStorage` access goes through `src/utils/storage.js`, never raw calls.
- React 19: no setState-in-effect for derivable values; refs never read during render.
- `AudioWorklet` only; the visualizer writes the DOM directly at 20 fps and skips
  rendering entirely under `prefers-reduced-motion`.

## Environment

`BMS_SERVER_URL`, `PORT` (shared with the server, default 3001). See root README's
environment table.
