import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { downmixStereoToMonoBuffer } = require('../../server/pcm-utils');

const PCM_BYTES_PER_SAMPLE = 2;
describe('PCM utilities', () => {
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
