import { describe, expect, it } from 'vitest';
import {
  audioBufferToWav,
  buildWavFile,
  floatToInt16WithDither,
} from '../../client/src/utils/wavEncoder';

const NO_DITHER = () => 0.5; // rng() - rng() === 0
const SAMPLE_RATE = 48000;

function fakeAudioBuffer({ channels = 1, frames = 4, sampleRate = SAMPLE_RATE, fill = 0.25 } = {}) {
  const data = Array.from({ length: channels }, (_unused, ch) => {
    const channel = new Float32Array(frames);
    for (let i = 0; i < frames; i++) channel[i] = fill * (ch === 0 ? 1 : -1);
    return channel;
  });
  return {
    numberOfChannels: channels,
    length: frames,
    sampleRate,
    getChannelData: (ch) => data[ch],
  };
}

function readAscii(view, offset, length) {
  let text = '';
  for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint8(offset + i));
  return text;
}

describe('floatToInt16WithDither', () => {
  it('scales exactly when dither is zero', () => {
    expect(floatToInt16WithDither(0, NO_DITHER)).toBe(0);
    expect(floatToInt16WithDither(0.5, NO_DITHER)).toBe(Math.round(0.5 * 0x7FFF));
    expect(floatToInt16WithDither(-0.5, NO_DITHER)).toBe(Math.round(-0.5 * 0x8000));
    expect(floatToInt16WithDither(1, NO_DITHER)).toBe(0x7FFF);
    expect(floatToInt16WithDither(-1, NO_DITHER)).toBe(-0x8000);
  });

  it('keeps dithered output within ±1 LSB of the undithered value', () => {
    const rng = () => (Math.random() < 0.5 ? 0 : 1);
    for (let i = 0; i < 200; i++) {
      const sample = (Math.random() * 2) - 1;
      const withDither = floatToInt16WithDither(sample, rng);
      const without = floatToInt16WithDither(sample, NO_DITHER);
      expect(Math.abs(withDither - without)).toBeLessThanOrEqual(1);
    }
  });
});

describe('buildWavFile', () => {
  it('writes a valid RIFF header and PCM payload', () => {
    const int16Samples = new Int16Array([0, 1000, -1000, 32767]);
    const buffer = buildWavFile({ int16Samples, numChannels: 1, sampleRate: SAMPLE_RATE });
    const view = new DataView(buffer);

    expect(buffer.byteLength).toBe(44 + int16Samples.length * 2);
    expect(readAscii(view, 0, 4)).toBe('RIFF');
    expect(readAscii(view, 8, 4)).toBe('WAVE');
    expect(readAscii(view, 12, 4)).toBe('fmt ');
    expect(readAscii(view, 36, 4)).toBe('data');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint32(28, true)).toBe(SAMPLE_RATE * 2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(int16Samples.length * 2);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(1000);
    expect(view.getInt16(50, true)).toBe(32767);
  });

  it('rejects empty PCM data', () => {
    expect(() => buildWavFile({ int16Samples: new Int16Array(0), numChannels: 1, sampleRate: SAMPLE_RATE })).toThrow();
  });

  it('rejects invalid channel counts and sample rates', () => {
    const pcm = new Int16Array([1]);
    expect(() => buildWavFile({ int16Samples: pcm, numChannels: 3, sampleRate: SAMPLE_RATE })).toThrow();
    expect(() => buildWavFile({ int16Samples: pcm, numChannels: 1, sampleRate: 0 })).toThrow();
  });
});

describe('audioBufferToWav', () => {
  it('interleaves stereo channels', () => {
    const buffer = audioBufferToWav(
      fakeAudioBuffer({ channels: 2, frames: 2, fill: 0.25 }),
      NO_DITHER,
    );
    const view = new DataView(buffer);

    expect(buffer.byteLength).toBe(44 + 2 /* frames */ * 2 /* ch */ * 2 /* bytes */);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint16(32, true)).toBe(4); // blockAlign
    // Frame 0: left (+) then right (−)
    const left = floatToInt16WithDither(0.25, NO_DITHER);
    const right = floatToInt16WithDither(-0.25, NO_DITHER);
    expect(view.getInt16(44, true)).toBe(left);
    expect(view.getInt16(46, true)).toBe(right);
  });

  it('handles mono buffers', () => {
    const buffer = audioBufferToWav(fakeAudioBuffer({ channels: 1, frames: 8 }), NO_DITHER);
    const view = new DataView(buffer);
    expect(view.getUint16(22, true)).toBe(1);
    expect(buffer.byteLength).toBe(44 + 8 * 2);
  });
});
