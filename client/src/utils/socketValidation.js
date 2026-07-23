const PCM_MAGIC = 0xBC4D;
const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 96000;
const MIN_GAIN = 0;
const MAX_GAIN = 2;
const MONO_CHANNELS = 1;
const STEREO_CHANNELS = 2;
const PCM_BYTES_PER_SAMPLE = 2;
const HEADER_BYTE_LENGTH = 7;
const ROOM_ID_REGEX = /^[A-Z0-9]{3,12}$/;
const MAX_SERVER_MESSAGE_LENGTH = 240;
const MAX_SERVER_CODE_LENGTH = 40;
const MAX_SOURCE_NAME_LENGTH = 64;

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

export function normalizeJoinResponse(payload) {
  if (!isPlainObject(payload)) return null;
  if (payload.ok === true) return { ok: true };
  if (payload.ok !== false) return null;
  if (typeof payload.code !== 'string' || payload.code.length === 0) return null;
  if (payload.code.length > MAX_SERVER_CODE_LENGTH) return null;
  if (typeof payload.message !== 'string' || payload.message.length === 0) return null;
  if (payload.message.length > MAX_SERVER_MESSAGE_LENGTH) return null;
  return {
    ok: false,
    code: payload.code,
    message: payload.message,
  };
}

export function normalizeRoomState(payload, roomId) {
  if (!isPlainObject(payload)) return null;
  if (payload.roomId !== roomId) return null;
  if (!Number.isInteger(payload.senders) || payload.senders < 0 || payload.senders > 1) return null;
  if (!Number.isInteger(payload.receivers) || payload.receivers < 0 || payload.receivers > 1) return null;
  return {
    senders: payload.senders,
    receivers: payload.receivers,
  };
}

export function normalizeVirtualMicState(payload, roomId) {
  if (!isPlainObject(payload)) return null;
  if (payload.roomId !== roomId) return null;
  if (typeof payload.ready !== 'boolean') return null;
  if (payload.ready) {
    if (typeof payload.sourceName !== 'string' || payload.sourceName.length === 0) return null;
    if (payload.sourceName.length > MAX_SOURCE_NAME_LENGTH) return null;
    return { ready: true, sourceName: payload.sourceName };
  }
  if (typeof payload.message !== 'string' || payload.message.length === 0) return null;
  if (payload.message.length > MAX_SERVER_MESSAGE_LENGTH) return null;
  return { ready: false, message: payload.message };
}

export function normalizePcmPayload(data) {
  const isBinary = data instanceof ArrayBuffer || ArrayBuffer.isView(data);
  if (!isBinary) return null;

  const rawBuffer = data instanceof ArrayBuffer ? data : data.buffer;
  const byteOffset = data instanceof ArrayBuffer ? 0 : data.byteOffset;
  const byteLength = data.byteLength;

  if (byteLength <= HEADER_BYTE_LENGTH) return null;

  // Read header: [uint16: magic][uint32: sampleRate][uint8: channelCount]
  const view = new DataView(rawBuffer, byteOffset, HEADER_BYTE_LENGTH);
  const magic = view.getUint16(0, true);
  const sampleRate = view.getUint32(2, true);
  const channelCount = view.getUint8(6);

  if (magic !== PCM_MAGIC) return null;
  if (!isValidSampleRate(sampleRate)) return null;
  if (!isValidChannelCount(channelCount)) return null;

  const pcmBuffer = rawBuffer.slice(byteOffset + HEADER_BYTE_LENGTH, byteOffset + byteLength);

  const frameSize = PCM_BYTES_PER_SAMPLE * channelCount;
  if (pcmBuffer.byteLength % frameSize !== 0) {
    console.warn(`[BMS] Dropping PCM chunk: payload alignment mismatch (${pcmBuffer.byteLength} bytes, frame=${frameSize})`);
    return null;
  }

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
