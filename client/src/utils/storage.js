/**
 * localStorage helpers that tolerate private-mode/quota failures and
 * validate numeric values on read. All writers and readers should funnel
 * through these so a single bad stored value can never reach the audio graph.
 */

export function readClampedNumber(key, fallback, min, max, parser = Number.parseFloat) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = parser(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  } catch {
    return fallback;
  }
}

export function readStoredBoolean(key, fallback = false) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

export function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Private browsing or quota exceeded — the app still works, state just isn't persisted.
  }
}
