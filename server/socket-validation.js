'use strict';

const config = require('./config');
const { logger } = require('./logger');
const {
  PCM_MAGIC,
  HEADER_BYTE_LENGTH,
  PCM_BYTES_PER_SAMPLE,
  ROOM_ID_REGEX,
  VALID_ROLES,
  MIN_SAMPLE_RATE,
  MAX_SAMPLE_RATE,
  MONO_CHANNEL_COUNT,
  STEREO_CHANNEL_COUNT,
  MIN_GAIN,
  MAX_GAIN,
} = require('./protocol');

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
  if (channelCount === MONO_CHANNEL_COUNT) return true;
  return channelCount === STEREO_CHANNEL_COUNT;
}

function normalizePcmChunk(chunk) {
  const buf = toBuffer(chunk);
  if (!buf) return null;
  if (buf.byteLength <= HEADER_BYTE_LENGTH) return null;
  if (buf.byteLength > config.maxSocketPayloadBytes) return null;

  // Read header: [uint16: magic][uint32: sampleRate][uint8: channelCount]
  const magic = buf.readUInt16LE(0);
  const sampleRate = buf.readUInt32LE(2);
  const channelCount = buf.readUInt8(6);

  if (magic !== PCM_MAGIC) return null;
  if (!isValidSampleRate(sampleRate)) return null;
  if (!isValidChannelCount(channelCount)) return null;

  const pcmBuffer = buf.subarray(HEADER_BYTE_LENGTH);

  const frameSize = PCM_BYTES_PER_SAMPLE * channelCount;
  if (pcmBuffer.byteLength % frameSize !== 0) {
    logger.warn(`Dropping PCM chunk: payload alignment mismatch (${pcmBuffer.byteLength} bytes, frame=${frameSize})`);
    return null;
  }

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
  PCM_MAGIC,
  HEADER_BYTE_LENGTH,
};
