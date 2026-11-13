import { useState, useCallback, useRef } from 'react';

const MAX_LOG_ENTRIES = 7;

/**
 * Bounded ring buffer for operator-facing log lines shown in the console.
 * Keeps the most recent entries and mirrors them to the devtools console.
 */
export function useLogBuffer(maxEntries = MAX_LOG_ENTRIES) {
  const [logs, setLogs] = useState([]);
  const nextIdRef = useRef(0);

  const addLog = useCallback((msg) => {
    console.log(msg);
    setLogs((prev) => [...prev.slice(-(maxEntries - 1)), { id: nextIdRef.current++, msg }]);
  }, [maxEntries]);

  return { logs, addLog };
}
