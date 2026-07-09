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
const MIN_CAPTURE_DIMENSION = 2;
const MAX_CAPTURE_DIMENSION = 7680;
const JPEG_START_BYTE = 0xFF;
const JPEG_SOI_BYTE = 0xD8;

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
  if (!isPlainObject(chunk)) return null;
  if (!isValidSampleRate(chunk.sampleRate)) return null;
  if (!isValidChannelCount(chunk.channelCount)) return null;

  const buffer = toBuffer(chunk.buffer);
  if (!buffer) return null;
  if (buffer.byteLength === 0) return null;
  if (buffer.byteLength > config.maxSocketPayloadBytes) return null;

  const frameSize = PCM_BYTES_PER_SAMPLE * chunk.channelCount;
  if (buffer.byteLength % frameSize !== 0) return null;

  return {
    buffer,
    sampleRate: chunk.sampleRate,
    channelCount: chunk.channelCount,
  };
}

function isValidCaptureDimension(value) {
  if (!Number.isInteger(value)) return false;
  if (value < MIN_CAPTURE_DIMENSION) return false;
  if (value > MAX_CAPTURE_DIMENSION) return false;
  return value % 2 === 0;
}

function isValidRecordingOptions(opts) {
  if (!isPlainObject(opts)) return false;
  if (!isValidCaptureDimension(opts.width)) return false;
  return isValidCaptureDimension(opts.height);
}

function normalizeVideoFrame(frameBuffer) {
  const buffer = toBuffer(frameBuffer);
  if (!buffer) return null;
  if (buffer.byteLength === 0) return null;
  if (buffer.byteLength > config.maxSocketPayloadBytes) return null;
  if (buffer[0] !== JPEG_START_BYTE) return null;
  if (buffer[1] !== JPEG_SOI_BYTE) return null;
  return buffer;
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
  isValidRecordingOptions,
  isValidRole,
  isValidRoomId,
  isValidTimestamp,
  normalizePcmChunk,
  normalizeVideoFrame,
};
