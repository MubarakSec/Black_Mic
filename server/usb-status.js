'use strict';

const { spawn } = require('child_process');

const ADB_TIMEOUT_MS = 2000;
const CACHE_TTL_MS = 5000;
const STATE_DEVICE = 'device';
const STATE_UNAUTHORIZED = 'unauthorized';
const STATE_MISSING = 'missing';
const STATE_NONE = 'none';

function parseAdbDevices(output) {
  const lines = String(output || '').split('\n').slice(1);
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return { serial: parts[0] || '', state: parts.slice(1).join(' ') };
    })
    .filter((entry) => entry.serial.length > 0);
}

function summarizeDevices(devices) {
  if (devices.some((d) => d.state === STATE_DEVICE)) return STATE_DEVICE;
  if (devices.some((d) => d.state === STATE_UNAUTHORIZED)) return STATE_UNAUTHORIZED;
  if (devices.length === 0) return STATE_NONE;
  return devices[0].state || STATE_NONE;
}

function runAdbDevices(spawnImpl, timeoutMs) {
  return new Promise((resolve, reject) => {
    let out = '';
    let settled = false;
    const child = spawnImpl('adb', ['devices']);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('adb devices timed out'));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ available: false, devices: [] });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ available: false, devices: [] });
        return;
      }
      resolve({ available: true, devices: parseAdbDevices(out) });
    });
  });
}

function createUsbStatus({
  spawnImpl = spawn,
  timeoutMs = ADB_TIMEOUT_MS,
  cacheTtlMs = CACHE_TTL_MS,
  now = () => Date.now(),
} = {}) {
  let cache = null;
  let cacheTime = 0;

  async function getStatus({ fresh = false } = {}) {
    const age = now() - cacheTime;
    if (!fresh && cache && age < cacheTtlMs) return cache;

    let result;
    try {
      const { available, devices } = await runAdbDevices(spawnImpl, timeoutMs);
      result = {
        available,
        state: available ? summarizeDevices(devices) : STATE_MISSING,
        devices,
        ready: available && devices.some((d) => d.state === STATE_DEVICE),
        checkedAt: new Date(now()).toISOString(),
      };
    } catch (err) {
      result = {
        available: false,
        state: STATE_MISSING,
        devices: [],
        ready: false,
        error: err.message,
        checkedAt: new Date(now()).toISOString(),
      };
    }
    cache = result;
    cacheTime = now();
    return result;
  }

  return { getStatus };
}

module.exports = {
  createUsbStatus,
  parseAdbDevices,
  summarizeDevices,
  ADB_TIMEOUT_MS,
  CACHE_TTL_MS,
};
