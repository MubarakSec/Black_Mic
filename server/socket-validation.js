'use strict';

const config = require('./config');

const ROOM_ID_REGEX = /^[A-Z0-9]{3,12}$/;
const VALID_ROLES = new Set(['sender', 'receiver']);
const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 96000;
const MIN_GAIN = 0;
const MAX_GAIN = 2;
const MONO_CHANNELS = 1;
const STEREO_CHANNELS = 2;
const PCM_BYTES_PER_SAMPLE = 2;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function isValidRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_ID_REGEX.test(roomId);
}

function isValidRole(role) {
  return VALID_ROLES.has(role);
}

function isValidSampleRate(sampleRate) {
  if (!Number.isInteger(sampleRate)) return false;
  if (sampleRate < MIN_SAMPLE_RATE) return false;
  return sampleRate <= MAX_SAMPLE_RATE;
}

function isValidChannelCount(channelCount) {
  if (channelCount === MONO_CHANNELS) return true;
  return channelCount === STEREO_CHANNELS;
}

function normalizePcmChunk(chunk) {
  // If the client sent raw binary Buffer/ArrayBuffer
  const buffer = toBuffer(chunk);
  if (!buffer) return null;
  if (buffer.byteLength <= 5) return null;
  if (buffer.byteLength > config.maxSocketPayloadBytes) return null;

  // Extract header: [uint32: sampleRate][uint8: channelCount]
  const sampleRate = buffer.readUint32LE(0);
  const channelCount = buffer.readUint8(4);

  if (!isValidSampleRate(sampleRate)) return null;
  if (!isValidChannelCount(channelCount)) return null;

  // Extract PCM payload (from byte 5 onwards)
  const pcmBuffer = buffer.subarray(5);

  const frameSize = PCM_BYTES_PER_SAMPLE * channelCount;
  if (pcmBuffer.byteLength % frameSize !== 0) return null;

  return {
    buffer: pcmBuffer,
    sampleRate,
    channelCount,
  };
}

function isValidRemoteCommand(cmd) {
  if (!isPlainObject(cmd)) return false;

  if (cmd.type === 'mute') {
    return typeof cmd.value === 'boolean';
  }

  if (cmd.type !== 'gain') return false;
  if (!Number.isFinite(cmd.value)) return false;
  if (cmd.value < MIN_GAIN) return false;
  return cmd.value <= MAX_GAIN;
}

function isValidTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) return false;
  return timestamp > 0;
}

module.exports = {
  isValidRemoteCommand,
  isValidRole,
  isValidRoomId,
  isValidTimestamp,
  normalizePcmChunk,
};
