// Shared wire-protocol constants for the Black Mic PCM stream.
// Mirror of server/protocol.js — keep both in sync.
// Layout: [uint16 magic][uint32 sampleRate][uint8 channelCount][Int16 PCM payload]

export const PCM_MAGIC = 0xBC4D;
export const HEADER_BYTE_LENGTH = 7;
export const PCM_BYTES_PER_SAMPLE = 2;

export const ROOM_ID_REGEX = /^[A-Z0-9]{3,12}$/;

export const MIN_SAMPLE_RATE = 8000;
export const MAX_SAMPLE_RATE = 96000;
export const MONO_CHANNELS = 1;
export const STEREO_CHANNELS = 2;
export const MIN_GAIN = 0;
export const MAX_GAIN = 2;
