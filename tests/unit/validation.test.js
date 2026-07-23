import { describe, it, expect } from 'vitest';
import {
  isValidRoomId,
  isValidRemoteCommand,
  normalizeJoinResponse,
  normalizePcmPayload,
  normalizeRoomState,
  normalizeVirtualMicState,
} from '../../client/src/utils/socketValidation';
import { normalizePcmChunk } from '../../server/socket-validation';

const PCM_MAGIC = 0xBC4D;
const PCM_HEADER_BYTES = 7;
const TEST_SAMPLE_RATE = 48000;
const MONO_CHANNELS = 1;
const INVALID_CHANNEL_COUNT = 3;
const PCM_PAYLOAD_BYTES = 2048;
const INVALID_SAMPLE_RATE = 500;

function createPcmPacket({ sampleRate = TEST_SAMPLE_RATE, channelCount = MONO_CHANNELS } = {}) {
  const packet = new ArrayBuffer(PCM_HEADER_BYTES + PCM_PAYLOAD_BYTES);
  const view = new DataView(packet, 0, PCM_HEADER_BYTES);
  view.setUint16(0, PCM_MAGIC, true);
  view.setUint32(2, sampleRate, true);
  view.setUint8(6, channelCount);
  return packet;
}

describe('Room ID Validation', () => {
  it('should accept valid room IDs', () => {
    expect(isValidRoomId('ROOM')).toBe(true);
    expect(isValidRoomId('A123')).toBe(true);
  });

  it('should reject invalid room IDs', () => {
    expect(isValidRoomId('ro')).toBe(false); // Too short
    expect(isValidRoomId('ROOMIDISWAYTOOLOG')).toBe(false); // Too long
    expect(isValidRoomId('room')).toBe(false); // Lowercase not allowed by regex
    expect(isValidRoomId(null)).toBe(false);
  });
});

describe('Remote Command Validation', () => {
  it('should validate mute commands', () => {
    expect(isValidRemoteCommand({ type: 'mute', value: true })).toBe(true);
    expect(isValidRemoteCommand({ type: 'mute', value: false })).toBe(true);
    expect(isValidRemoteCommand({ type: 'mute', value: 'yes' })).toBe(false);
  });

  it('should validate gain commands', () => {
    expect(isValidRemoteCommand({ type: 'gain', value: 1.0 })).toBe(true);
    expect(isValidRemoteCommand({ type: 'gain', value: 0.0 })).toBe(true);
    expect(isValidRemoteCommand({ type: 'gain', value: 2.0 })).toBe(true);
    expect(isValidRemoteCommand({ type: 'gain', value: 2.5 })).toBe(false); // Too high
    expect(isValidRemoteCommand({ type: 'gain', value: -0.5 })).toBe(false); // Negative
  });
});

describe('Server State Validation', () => {
  it('should normalize valid join acknowledgements', () => {
    expect(normalizeJoinResponse({ ok: true })).toEqual({ ok: true });
    expect(normalizeJoinResponse({
      ok: false,
      code: 'ROLE_TAKEN',
      message: 'A phone is already connected.',
    })).toEqual({
      ok: false,
      code: 'ROLE_TAKEN',
      message: 'A phone is already connected.',
    });
  });

  it('should reject malformed join acknowledgements', () => {
    expect(normalizeJoinResponse({ ok: 'yes' })).toBe(null);
    expect(normalizeJoinResponse({ ok: false, code: 'ROLE_TAKEN' })).toBe(null);
  });

  it('should accept only the expected single-user room shape', () => {
    expect(normalizeRoomState({ roomId: 'ROOM', senders: 1, receivers: 1 }, 'ROOM')).toEqual({
      senders: 1,
      receivers: 1,
    });
    expect(normalizeRoomState({ roomId: 'OTHER', senders: 1, receivers: 1 }, 'ROOM')).toBe(null);
    expect(normalizeRoomState({ roomId: 'ROOM', senders: 2, receivers: 1 }, 'ROOM')).toBe(null);
  });

  it('should validate virtual microphone readiness', () => {
    expect(normalizeVirtualMicState({
      roomId: 'ROOM',
      ready: true,
      sourceName: 'BlackMic_ROOM',
    }, 'ROOM')).toEqual({
      ready: true,
      sourceName: 'BlackMic_ROOM',
    });
    expect(normalizeVirtualMicState({
      roomId: 'ROOM',
      ready: false,
      message: 'PipeWire is unavailable.',
    }, 'ROOM')).toEqual({
      ready: false,
      message: 'PipeWire is unavailable.',
    });
    expect(normalizeVirtualMicState({ roomId: 'ROOM', ready: true }, 'ROOM')).toBe(null);
  });
});

describe('PCM Chunk Normalization (Client)', () => {
  it('should reject non-objects', () => {
    expect(normalizePcmPayload(null)).toBe(null);
    expect(normalizePcmPayload('data')).toBe(null);
  });

  it('should normalize valid payloads', () => {
    const payload = createPcmPacket();
    const result = normalizePcmPayload(payload);
    expect(result).not.toBe(null);
    expect(result.sampleRate).toBe(TEST_SAMPLE_RATE);
    expect(result.channelCount).toBe(MONO_CHANNELS);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
    expect(result.buffer.byteLength).toBe(PCM_PAYLOAD_BYTES);
  });

  it('should reject invalid sample rates and channels', () => {
    const payload = createPcmPacket({ sampleRate: INVALID_SAMPLE_RATE });
    expect(normalizePcmPayload(payload)).toBe(null);

    const payload2 = createPcmPacket({ channelCount: INVALID_CHANNEL_COUNT });
    expect(normalizePcmPayload(payload2)).toBe(null);
  });
});
