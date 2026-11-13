// Lossless WAV encoding for recorded takes.
// floatToInt16WithDither: TPDF dither (same decorrelation as the capture
// worklet); buildWavFile: classic 44-byte RIFF header + interleaved Int16.

const WAV_RIFF_HEADER_BYTES = 44;
const WAV_FORMAT_PCM = 1;
const WAV_BITS_PER_SAMPLE = 16;
const BYTES_PER_INT16 = 2;
const PCM_POSITIVE_SCALE = 0x7FFF;
const PCM_NEGATIVE_SCALE = 0x8000;
const PCM_LSB = 1 / 0x8000;
const SAMPLE_CLAMP_MAX = 1;
const SAMPLE_CLAMP_MIN = -1;

export function floatToInt16WithDither(sample, rng = Math.random) {
  const dither = (rng() - rng()) * PCM_LSB;
  const clamped = Math.max(SAMPLE_CLAMP_MIN, Math.min(SAMPLE_CLAMP_MAX, sample + dither));
  return clamped < 0
    ? Math.round(clamped * PCM_NEGATIVE_SCALE)
    : Math.round(clamped * PCM_POSITIVE_SCALE);
}

export function buildWavFile({ int16Samples, numChannels, sampleRate }) {
  if (!int16Samples || int16Samples.length === 0) {
    throw new Error('Cannot build a WAV file from empty PCM data.');
  }
  if (!Number.isInteger(numChannels) || numChannels < 1 || numChannels > 2) {
    throw new Error(`Unsupported channel count: ${numChannels}`);
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(`Unsupported sample rate: ${sampleRate}`);
  }

  const dataBytes = int16Samples.length * BYTES_PER_INT16;
  const buffer = new ArrayBuffer(WAV_RIFF_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const byteRate = sampleRate * numChannels * BYTES_PER_INT16;
  const blockAlign = numChannels * BYTES_PER_INT16;

  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, WAV_FORMAT_PCM, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, WAV_BITS_PER_SAMPLE, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < int16Samples.length; i++) {
    view.setInt16(WAV_RIFF_HEADER_BYTES + (i * BYTES_PER_INT16), int16Samples[i], true);
  }
  return buffer;
}

/** Duck-typed AudioBuffer → interleaved Int16 WAV ArrayBuffer. */
export function audioBufferToWav(audioBuffer, rng = Math.random) {
  if (!audioBuffer) throw new Error('Missing AudioBuffer.');
  const numChannels = Math.min(2, Math.max(1, audioBuffer.numberOfChannels || 1));
  const frameCount = audioBuffer.length || 0;
  const sampleRate = audioBuffer.sampleRate;
  const interleaved = new Int16Array(frameCount * numChannels);
  const channelData = Array.from({ length: numChannels }, (_unused, ch) => audioBuffer.getChannelData(ch));

  for (let frame = 0; frame < frameCount; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      interleaved[frame * numChannels + ch] = floatToInt16WithDither(channelData[ch][frame], rng);
    }
  }
  return buildWavFile({ int16Samples: interleaved, numChannels, sampleRate });
}
