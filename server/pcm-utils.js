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

module.exports = {
  upmixMonoToStereoBuffer,
};
