import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createUsbStatus,
  parseAdbDevices,
  summarizeDevices,
} = require('../../server/usb-status');

const ADB_OUTPUT = `List of devices attached
SERIAL1\tdevice
SERIAL2\tunauthorized

`;

function fakeSpawn({ stdout = '', code = 0, error = null } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => {
      if (error) {
        child.emit('error', error);
        return;
      }
      child.stdout.emit('data', stdout);
      child.emit('close', code);
    });
    return child;
  };
}

describe('adb devices parsing', () => {
  it('parses serials and states, skipping the header', () => {
    const devices = parseAdbDevices(ADB_OUTPUT);
    expect(devices).toEqual([
      { serial: 'SERIAL1', state: 'device' },
      { serial: 'SERIAL2', state: 'unauthorized' },
    ]);
  });

  it('handles empty device lists and garbage lines', () => {
    expect(parseAdbDevices('List of devices attached\n\n')).toEqual([]);
    expect(parseAdbDevices('')).toEqual([]);
  });

  it('summarizes device over unauthorized over none', () => {
    expect(summarizeDevices([{ serial: 'A', state: 'unauthorized' }, { serial: 'B', state: 'device' }])).toBe('device');
    expect(summarizeDevices([{ serial: 'A', state: 'unauthorized' }])).toBe('unauthorized');
    expect(summarizeDevices([])).toBe('none');
  });
});

describe('createUsbStatus', () => {
  it('reports ready when a device is attached', async () => {
    const status = createUsbStatus({ spawnImpl: fakeSpawn({ stdout: ADB_OUTPUT }) });
    const result = await status.getStatus();
    expect(result.available).toBe(true);
    expect(result.state).toBe('device');
    expect(result.ready).toBe(true);
    expect(result.devices).toHaveLength(2);
  });

  it('reports adb as missing when the process errors', async () => {
    const status = createUsbStatus({ spawnImpl: fakeSpawn({ error: new Error('spawn adb ENOENT') }) });
    const result = await status.getStatus();
    expect(result.available).toBe(false);
    expect(result.state).toBe('missing');
    expect(result.ready).toBe(false);
  });

  it('reports missing on non-zero exit codes', async () => {
    const status = createUsbStatus({ spawnImpl: fakeSpawn({ code: 1 }) });
    const result = await status.getStatus();
    expect(result.available).toBe(false);
    expect(result.state).toBe('missing');
  });

  it('caches results within the TTL and refreshes when forced', async () => {
    let spawnCalls = 0;
    const countingSpawn = (() => {
      const inner = fakeSpawn({ stdout: ADB_OUTPUT });
      return () => {
        spawnCalls += 1;
        return inner();
      };
    })();

    const status = createUsbStatus({ spawnImpl: countingSpawn, cacheTtlMs: 5000 });
    await status.getStatus();
    await status.getStatus();
    expect(spawnCalls).toBe(1);

    await status.getStatus({ fresh: true });
    expect(spawnCalls).toBe(2);
  });

  it('re-queries after the cache TTL expires', async () => {
    let spawnCalls = 0;
    let clock = 1000;
    const countingSpawn = (() => {
      const inner = fakeSpawn({ stdout: ADB_OUTPUT });
      return () => {
        spawnCalls += 1;
        return inner();
      };
    })();

    const status = createUsbStatus({ spawnImpl: countingSpawn, cacheTtlMs: 5000, now: () => clock });
    await status.getStatus();
    clock += 6000;
    await status.getStatus();
    expect(spawnCalls).toBe(2);
  });
});
