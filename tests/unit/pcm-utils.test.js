import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { upmixMonoToStereoBuffer } = require('../../server/pcm-utils');

const HEADER_BYTES = 5;
const PCM_BYTES_PER_SAMPLE = 2;
const FIRST_SAMPLE = 1200;
const SECOND_SAMPLE = -1200;

function createOddOffsetMonoPcmBuffer() {
  const packet = Buffer.alloc(HEADER_BYTES + (PCM_BYTES_PER_SAMPLE * 2));
  packet.writeInt16LE(FIRST_SAMPLE, HEADER_BYTES);
  packet.writeInt16LE(SECOND_SAMPLE, HEADER_BYTES + PCM_BYTES_PER_SAMPLE);
  return packet.subarray(HEADER_BYTES);
}

describe('PCM utilities', () => {
  it('upmixes odd-offset mono Buffers without typed-array alignment errors', () => {
    const stereo = upmixMonoToStereoBuffer(createOddOffsetMonoPcmBuffer());

    expect(stereo.length).toBe(PCM_BYTES_PER_SAMPLE * 4);
    expect(stereo.readInt16LE(0)).toBe(FIRST_SAMPLE);
    expect(stereo.readInt16LE(2)).toBe(FIRST_SAMPLE);
    expect(stereo.readInt16LE(4)).toBe(SECOND_SAMPLE);
    expect(stereo.readInt16LE(6)).toBe(SECOND_SAMPLE);
  });
});
