import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { upmixMonoToStereoBuffer, downmixStereoToMonoBuffer } = require('../../server/pcm-utils');

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

  it('downmixes stereo interleaved PCM to mono by averaging channels', () => {
    const stereo = Buffer.alloc(PCM_BYTES_PER_SAMPLE * 4);
    stereo.writeInt16LE(1000, 0);  // L0
    stereo.writeInt16LE(2000, 2);  // R0
    stereo.writeInt16LE(-1000, 4); // L1
    stereo.writeInt16LE(-2000, 6); // R1

    const mono = downmixStereoToMonoBuffer(stereo);

    expect(mono.length).toBe(PCM_BYTES_PER_SAMPLE * 2);
    expect(mono.readInt16LE(0)).toBe(1500);  // (1000 + 2000) / 2
    expect(mono.readInt16LE(2)).toBe(-1500); // (-1000 + -2000) / 2
  });

  it('returns empty buffer for non-Buffer input', () => {
    const result = downmixStereoToMonoBuffer(null);
    expect(result.length).toBe(0);
  });

  it('returns empty buffer for misaligned stereo data', () => {
    const odd = Buffer.alloc(PCM_BYTES_PER_SAMPLE * 2 + 1); // 5 bytes
    const result = downmixStereoToMonoBuffer(odd);
    expect(result.length).toBe(0);
  });
});
