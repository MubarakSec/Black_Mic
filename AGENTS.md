# Project Rules

## File & Structure

- Maximum 800 lines per file. If a file exceeds this, split it.
- No monolithic components (>200 lines of JSX). Extract:
  - Custom hooks for business logic (e.g. `useAudio`, `useSocket`, `useRecording`)
  - Utility functions for pure logic (e.g. `pcm-utils`)
  - Separate components for UI sections (e.g. `Visualizer`, `TelemetryStrip`, `RecordingLibrary`)
- One component per file, one hook per file, one util per file.
- Components 15 lines or shorter can stay in a parent file (no trivial files).
- Names are PascalCase for components, camelCase for hooks/utils.

## Code Style

- No if/else without early return. Prefer:
  ```ts
  // Good
  if (!condition) return fallback;
  return doThing();

  // Bad
  if (condition) { doThing(); } else { doOther(); }
  ```
- No nested ternaries. `a ? b : (c ? d : e)` is banned. Use a lookup map or if/return instead.
- No magic numbers or strings — extract to named constants.
- No deprecated browser APIs (no `ScriptProcessorNode`, use `AudioWorklet`). Fix existing usage when touched; never introduce new.
- Prefer `const` over `let`. Prefer functional patterns over imperative.

## TypeScript

- All new files must be `.ts` / `.tsx`.
- Socket events must have typed payloads (define interfaces for every event shape).
- All refs and audio buffers must have proper types.
- `any` is forbidden unless absolutely unavoidable (document why with a `// eslint-disable-next-line` comment).

## Security

- Never trust socket data — validate shapes and ranges on receive.
  - e.g. `sampleRate` must be 44100 or 48000; `roomId` must match `/^[A-Z0-9]{3,12}$/`
- No open CORS in production — use allowlist.
- No hardcoded secrets or ports — use env vars. Fix existing hardcoded values when touched.

## Testing

- Unit tests for all utility functions.
- Integration tests for audio processing pipeline.
- When adding or changing PCM conversion logic, add a test for it. Do not break existing conversion behavior.

## Patterns

- Use React hooks for all side effects (audio, socket, timers).
- Clean up all subscriptions, intervals, and streams in `useEffect` returns.
- Use `useRef` for mutable values that shouldn't trigger re-renders.
- Use `React.memo` on pure presentational components.
