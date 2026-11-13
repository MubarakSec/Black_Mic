# Contributing

## Setup

```bash
npm ci
(cd client && npm ci)
```

## The verification gate (run before every commit)

```bash
npm run verify
```

That is `npm run lint` (server `node --check` + client `oxlint`) plus `npm run test:unit`.
CI runs the same plus a client production build on every push/PR — see `.github/workflows/ci.yml`.

- **Client lint must be zero-warning.** Disable a rule only inline, with a justification comment (see `useMicrophoneDevices.js`).
- **Local machine is memory-constrained.** Don't run the whole Playwright suite during development; use targeted unit tests: `npx vitest run tests/unit/<file>.test.js`.
- Full test suite (unit + e2e) before releases: `npm test`.

## Commit style

Conventional commits (`feat:`, `fix:`, `refactor:`, `perf:`, `chore:`, `docs:`, `test:`),
scoped to a single logical change. See `git log` for examples.

## Project rules

- Max 800 lines per file; components under ~200 lines of JSX.
- No nested ternaries; early returns over if/else.
- New socket payloads must be validated on the server (see `server/socket-validation.js`) and re-validated on the client (`client/src/utils/socketValidation.js`).
- Protocol constants live in exactly one place per side: `server/protocol.js` / `client/src/utils/protocol.js`. If you change the wire format, change both plus `server/README.md`.
- AudioWorklet only — never `ScriptProcessorNode`.
- No magic numbers in new code; name constants.

## Testing notes

- Unit tests run in vitest (node env). Import server CommonJS via `createRequire` (see `tests/unit/pcm-utils.test.js`), client ESM directly.
- Client storage helpers must stay testable without a DOM — they catch storage failures rather than propagating them.

## Definition of done

1. `npm run verify` passes.
2. New util logic has unit tests.
3. No new lint warnings; protocol changes reflected in docs.
