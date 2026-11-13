'use strict';

// Shared wire-protocol constants for the Black Mic PCM stream.
// Layout: [uint16 magic][uint32 sampleRate][uint8 channelCount][Int16 PCM payload]

const PCM_MAGIC = 0xBC4D;
const HEADER_BYTE_LENGTH = 7;
const PCM_BYTES_PER_SAMPLE = 2;

const ROOM_ID_REGEX = /^[A-Z0-9]{3,12}$/;
const VALID_ROLES = new Set(['sender', 'receiver']);

const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 96000;
const MONO_CHANNEL_COUNT = 1;
const STEREO_CHANNEL_COUNT = 2;
const MIN_GAIN = 0;
const MAX_GAIN = 2;

module.exports = {
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
};
