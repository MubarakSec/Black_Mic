const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 96000;
const MIN_GAIN = 0;
const MAX_GAIN = 2;
const MONO_CHANNELS = 1;
const STEREO_CHANNELS = 2;
const PCM_BYTES_PER_SAMPLE = 2;
const ROOM_ID_REGEX = /^[A-Z0-9]{3,12}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (!ArrayBuffer.isView(value)) return null;
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
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

export function isValidRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_ID_REGEX.test(roomId);
}

export function normalizePcmPayload(data) {
  if (!isPlainObject(data)) return null;
  if (!isValidSampleRate(data.sampleRate)) return null;
  if (!isValidChannelCount(data.channelCount)) return null;

  const buffer = toArrayBuffer(data.buffer);
  if (!buffer) return null;
  if (buffer.byteLength === 0) return null;

  const frameSize = PCM_BYTES_PER_SAMPLE * data.channelCount;
  if (buffer.byteLength % frameSize !== 0) return null;

  return {
    buffer,
    sampleRate: data.sampleRate,
    channelCount: data.channelCount,
  };
}

export function isValidRemoteCommand(cmd) {
  if (!isPlainObject(cmd)) return false;

  if (cmd.type === 'mute') {
    return typeof cmd.value === 'boolean';
  }

  if (cmd.type !== 'gain') return false;
  if (!Number.isFinite(cmd.value)) return false;
  if (cmd.value < MIN_GAIN) return false;
  return cmd.value <= MAX_GAIN;
}
