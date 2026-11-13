import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isOriginAllowed } = require('../../server/origin-check');

describe('socket origin validation', () => {
  it('allows missing Origin headers (non-browser clients)', () => {
    expect(isOriginAllowed(undefined, 'localhost:3001', false)).toBe(true);
  });

  it('allows any origin when CORS is fully open', () => {
    expect(isOriginAllowed('https://evil.example', 'localhost:3001', true)).toBe(true);
  });

  it('allows origins in the explicit allowlist', () => {
    const list = ['https://studio.example.com'];
    expect(isOriginAllowed('https://studio.example.com', 'localhost:3001', list)).toBe(true);
    expect(isOriginAllowed('https://evil.example.com', 'localhost:3001', list)).toBe(false);
  });

  it('requires same-host origin when CORS is closed', () => {
    expect(isOriginAllowed('http://localhost:3001', 'localhost:3001', false)).toBe(true);
    expect(isOriginAllowed('https://localhost:3001', 'localhost:3001', false)).toBe(true);
    expect(isOriginAllowed('https://evil.example', 'localhost:3001', false)).toBe(false);
  });

  it('rejects unparsable origins when CORS is closed', () => {
    expect(isOriginAllowed(':::not-a-url', 'localhost:3001', false)).toBe(false);
  });
});
