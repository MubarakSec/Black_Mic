import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readClampedNumber,
  readStoredBoolean,
  readStoredPattern,
  readStoredValue,
  writeStoredValue,
} from '../../client/src/utils/storage';

const store = new Map();
const localStorageMock = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

describe('storage helpers', () => {
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = localStorageMock;
  });

  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('reads a stored number clamped to bounds', () => {
    store.set('gain', '99');
    expect(readClampedNumber('gain', 1.0, 0, 2)).toBe(2);
    store.set('gain', '-5');
    expect(readClampedNumber('gain', 1.0, 0, 2)).toBe(0);
  });

  it('returns the fallback for missing or invalid values', () => {
    expect(readClampedNumber('missing', 1.0, 0, 2)).toBe(1.0);
    store.set('gain', 'not-a-number');
    expect(readClampedNumber('gain', 1.0, 0, 2)).toBe(1.0);
  });

  it('supports integer parsing for jitter buffers', () => {
    store.set('buffer', '123.9');
    expect(readClampedNumber('buffer', 15, 0, 500, Number.parseInt)).toBe(123);
  });

  it('reads booleans with a fallback', () => {
    expect(readStoredBoolean('flag', false)).toBe(false);
    store.set('flag', 'true');
    expect(readStoredBoolean('flag', false)).toBe(true);
    store.set('flag', 'yes');
    expect(readStoredBoolean('flag', true)).toBe(false);
  });

  it('writeStoredValue does not throw when storage is unavailable', () => {
    globalThis.localStorage = {
      ...localStorageMock,
      setItem: () => { throw new Error('quota exceeded'); },
    };
    expect(() => writeStoredValue('k', 'v')).not.toThrow();
  });

  it('readStoredPattern returns whitelisted values or the fallback', () => {
    store.set('room', 'ROOM1');
    expect(readStoredPattern('room', /^[A-Z0-9]{3,12}$/, 'ROOM')).toBe('ROOM1');
    store.set('room', 'room one!');
    expect(readStoredPattern('room', /^[A-Z0-9]{3,12}$/, 'ROOM')).toBe('ROOM');
    expect(readStoredPattern('missing', /^[A-Z0-9]{3,12}$/, 'ROOM')).toBe('ROOM');
  });

  it('readStoredValue returns raw values with a fallback', () => {
    expect(readStoredValue('x', 'fb')).toBe('fb');
    store.set('x', 'hello');
    expect(readStoredValue('x', 'fb')).toBe('hello');
  });

  it('readClampedNumber falls back when storage access throws', () => {
    globalThis.localStorage = {
      ...localStorageMock,
      getItem: () => { throw new Error('denied'); },
    };
    expect(readClampedNumber('k', 1.5, 0, 2)).toBe(1.5);
  });
});
