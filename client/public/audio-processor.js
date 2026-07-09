const PCM_NEGATIVE_SCALE = 0x8000;
const PCM_POSITIVE_SCALE = 0x7FFF;
const SAMPLE_MIN = -1;
const SAMPLE_MAX = 1;
const PCM_BYTES_PER_SAMPLE = 2;

function clampSample(sample) {
  if (sample < SAMPLE_MIN) return SAMPLE_MIN;
  if (sample > SAMPLE_MAX) return SAMPLE_MAX;
  return sample;
}

function floatToInt16(sample) {
  const clamped = clampSample(sample);
  return clamped < 0 ? clamped * PCM_NEGATIVE_SCALE : clamped * PCM_POSITIVE_SCALE;
}

class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.isStereo = options?.processorOptions?.isStereo ?? false;
    this.bufferPool = [];

    // Listen for returned buffers from the main thread to recycle them
    this.port.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        this.bufferPool.push(e.data);
      }
    };
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelLength = input[0]?.length;
    if (!channelLength) return true;

    const isStereoActive = this.isStereo && input.length >= 2;
    const totalSamples = isStereoActive ? channelLength * 2 : channelLength;
    const requiredByteLength = totalSamples * PCM_BYTES_PER_SAMPLE;

    // Retrieve or allocate an ArrayBuffer from the pool to avoid GC overhead
    let buffer = null;
    for (let i = 0; i < this.bufferPool.length; i++) {
      if (this.bufferPool[i].byteLength === requiredByteLength) {
        buffer = this.bufferPool.splice(i, 1)[0];
        break;
      }
    }
    if (!buffer) {
      buffer = new ArrayBuffer(requiredByteLength);
    }

    const int16Array = new Int16Array(buffer);

    if (isStereoActive) {
      // Stereo: interleave channels L[0], R[0], L[1], R[1]...
      for (let i = 0; i < channelLength; i++) {
        int16Array[i * 2] = floatToInt16(input[0][i]);
        int16Array[i * 2 + 1] = floatToInt16(input[1][i]);
      }
    } else {
      // Mono: downmix all available input channels (average L + R)
      const numChannels = input.length;
      for (let i = 0; i < channelLength; i++) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          sum += input[ch][i];
        }
        int16Array[i] = floatToInt16(sum / numChannels);
      }
    }

    // Transfer the buffer back to the main thread (zero-copy)
    this.port.postMessage(buffer, [buffer]);
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
