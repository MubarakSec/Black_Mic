'use strict';

const PCM_BYTES_PER_SAMPLE = 2;
const STEREO_BYTES_PER_MONO_SAMPLE = 4;

function upmixMonoToStereoBuffer(pcmBuffer) {
  if (!Buffer.isBuffer(pcmBuffer)) return Buffer.alloc(0);
  if (pcmBuffer.byteLength % PCM_BYTES_PER_SAMPLE !== 0) return Buffer.alloc(0);

  const stereoBuffer = Buffer.allocUnsafe((pcmBuffer.byteLength / PCM_BYTES_PER_SAMPLE) * STEREO_BYTES_PER_MONO_SAMPLE);

  for (
    let inputOffset = 0, outputOffset = 0;
    inputOffset < pcmBuffer.byteLength;
    inputOffset += PCM_BYTES_PER_SAMPLE, outputOffset += STEREO_BYTES_PER_MONO_SAMPLE
  ) {
    const sample = pcmBuffer.readInt16LE(inputOffset);
    stereoBuffer.writeInt16LE(sample, outputOffset);
    stereoBuffer.writeInt16LE(sample, outputOffset + PCM_BYTES_PER_SAMPLE);
  }

  return stereoBuffer;
}

function downmixStereoToMonoBuffer(pcmBuffer) {
  if (!Buffer.isBuffer(pcmBuffer)) return Buffer.alloc(0);
  if (pcmBuffer.byteLength < STEREO_BYTES_PER_MONO_SAMPLE) return Buffer.alloc(0);
  if (pcmBuffer.byteLength % STEREO_BYTES_PER_MONO_SAMPLE !== 0) return Buffer.alloc(0);

  const frameCount = pcmBuffer.byteLength / STEREO_BYTES_PER_MONO_SAMPLE;
  const monoBuffer = Buffer.allocUnsafe(frameCount * PCM_BYTES_PER_SAMPLE);

  for (let i = 0; i < frameCount; i++) {
    const left = pcmBuffer.readInt16LE(i * STEREO_BYTES_PER_MONO_SAMPLE);
    const right = pcmBuffer.readInt16LE(i * STEREO_BYTES_PER_MONO_SAMPLE + PCM_BYTES_PER_SAMPLE);
    const mono = Math.round((left + right) / 2);
    monoBuffer.writeInt16LE(mono, i * PCM_BYTES_PER_SAMPLE);
  }

  return monoBuffer;
}

module.exports = {
  upmixMonoToStereoBuffer,
  downmixStereoToMonoBuffer,
};
