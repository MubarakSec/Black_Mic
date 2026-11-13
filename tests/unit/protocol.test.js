import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const protocol = require('../../server/protocol');

describe('wire protocol constants', () => {
  it('defines the PCM magic and header layout', () => {
    expect(protocol.PCM_MAGIC).toBe(0xBC4D);
    expect(protocol.HEADER_BYTE_LENGTH).toBe(7);
    expect(protocol.PCM_BYTES_PER_SAMPLE).toBe(2);
  });

  it('accepts valid room ids', () => {
    expect(protocol.ROOM_ID_REGEX.test('ROOM')).toBe(true);
    expect(protocol.ROOM_ID_REGEX.test('ABC123')).toBe(true);
    expect(protocol.ROOM_ID_REGEX.test('A1')).toBe(false);
    expect(protocol.ROOM_ID_REGEX.test('room')).toBe(false);
    expect(protocol.ROOM_ID_REGEX.test('WAYTOOLONGROOMID1')).toBe(false);
    expect(protocol.ROOM_ID_REGEX.test('BAD-ID!')).toBe(false);
  });

  it('bounds sample rates and gain', () => {
    expect(protocol.MIN_SAMPLE_RATE).toBe(8000);
    expect(protocol.MAX_SAMPLE_RATE).toBe(96000);
    expect(protocol.MIN_GAIN).toBe(0);
    expect(protocol.MAX_GAIN).toBe(2);
    expect(protocol.MONO_CHANNEL_COUNT).toBe(1);
    expect(protocol.STEREO_CHANNEL_COUNT).toBe(2);
  });

  it('defines the sender/receiver role set', () => {
    expect(protocol.VALID_ROLES.has('sender')).toBe(true);
    expect(protocol.VALID_ROLES.has('receiver')).toBe(true);
    expect(protocol.VALID_ROLES.has('admin')).toBe(false);
  });
});
