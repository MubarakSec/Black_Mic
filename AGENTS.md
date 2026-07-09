# Project Rules

## File & Structure

- Maximum 800 lines per file. If a file exceeds this, split it.
- No monolithic components. Extract:
  - Custom hooks for business logic (`useAudio`, `useSocket`, `useRecording`)
  - Utility functions for pure logic (`pcm-utils.ts`)
  - Separate components for UI sections (`Visualizer`, `TelemetryStrip`, `RecordingLibrary`)
- One component per file, one hook per file, one util per file.
- Names are PascalCase for components, camelCase for hooks/utils.

## Code Style

- No if-else chains. Use early returns, guard clauses, switch, or lookup maps.
- No nested ternaries beyond 1 level.
- No magic numbers or strings — extract to named constants.
- No deprecated browser APIs (no `ScriptProcessorNode`, use `AudioWorklet`).
- Prefer `const` over `let`. Prefer functional patterns over imperative.

## TypeScript

- All new files must be `.ts` / `.tsx`.
- Socket events must have typed payloads.
- All refs and audio buffers must have proper types.
- `any` is forbidden unless absolutely unavoidable (document why).

## Security

- Never trust socket data — validate shapes and ranges on receive.
- No open CORS in production — use allowlist.
- No hardcoded secrets or ports — use env vars.

## Testing

- Unit tests for all utility functions.
- Integration tests for audio processing pipeline.
- At minimum, no regression on the PCM Int16 conversion.

## Patterns

- Use React hooks for all side effects (audio, socket, timers).
- Clean up all subscriptions, intervals, and streams in `useEffect` returns.
- Use `useRef` for mutable values that shouldn't trigger re-renders.
- Use `React.memo` on pure presentational components.
