import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isOriginAllowed } = require('../../server/origin-check');

describe('socket origin validation', () => {
  it('allows missing Origin headers (non-browser clients)', () => {
    expect(isOriginAllowed(undefined, 'localhost:3001', false)).toBe(true);
    expect(isOriginAllowed(undefined, 'localhost:3001', false, '127.0.0.1', 3001)).toBe(true);
  });

  it('allows any origin when CORS is fully open', () => {
    expect(isOriginAllowed('https://evil.example', 'localhost:3001', true)).toBe(true);
  });

  it('allows origins in the explicit allowlist', () => {
    const list = ['https://studio.example.com'];
    expect(isOriginAllowed('https://studio.example.com', 'localhost:3001', list)).toBe(true);
    expect(isOriginAllowed('https://evil.example.com', 'localhost:3001', list)).toBe(false);
  });

  it('requires same-host origin when CORS is closed on a LAN bind', () => {
    expect(isOriginAllowed('http://192.168.1.5:3001', '192.168.1.5:3001', false, '0.0.0.0', 3001)).toBe(true);
    expect(isOriginAllowed('https://evil.example', '192.168.1.5:3001', false, '0.0.0.0', 3001)).toBe(false);
  });

  it('rejects rebinding origins when the server is bound to loopback', () => {
    expect(isOriginAllowed('http://localhost:3001', 'attacker.com:3001', false, '127.0.0.1', 3001)).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:3001', 'attacker.com:3001', false, '127.0.0.1', 3001)).toBe(true);
    expect(isOriginAllowed('http://attacker.com:3001', 'attacker.com:3001', false, '127.0.0.1', 3001)).toBe(false);
  });

  it('rejects loopback origins on the wrong port', () => {
    expect(isOriginAllowed('http://localhost:9999', 'localhost:9999', false, '127.0.0.1', 3001)).toBe(false);
  });

  it('rejects non-http(s) loopback origins', () => {
    expect(isOriginAllowed('null', 'localhost:3001', false, '127.0.0.1', 3001)).toBe(false);
  });
});
