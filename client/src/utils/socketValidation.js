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
  // If we receive the optimized binary packet (ArrayBuffer or ArrayBuffer view)
  const isBinary = data instanceof ArrayBuffer || ArrayBuffer.isView(data);
  if (!isBinary) return null;

  const rawBuffer = data instanceof ArrayBuffer ? data : data.buffer;
  const byteOffset = data instanceof ArrayBuffer ? 0 : data.byteOffset;
  const byteLength = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;

  if (byteLength <= 5) return null;

  // Read header: [uint32: sampleRate][uint8: channelCount]
  const view = new DataView(rawBuffer, byteOffset, 5);
  const sampleRate = view.getUint32(0, true); // little endian
  const channelCount = view.getUint8(4);

  if (!isValidSampleRate(sampleRate)) return null;
  if (!isValidChannelCount(channelCount)) return null;

  // Extract raw PCM payload (from byte 5 onwards)
  const pcmBuffer = rawBuffer.slice(byteOffset + 5, byteOffset + byteLength);

  const frameSize = PCM_BYTES_PER_SAMPLE * channelCount;
  if (pcmBuffer.byteLength % frameSize !== 0) return null;

  return {
    buffer: pcmBuffer,
    sampleRate,
    channelCount,
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
