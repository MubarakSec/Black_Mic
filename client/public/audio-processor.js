const PCM_NEGATIVE_SCALE = 0x8000;
const PCM_POSITIVE_SCALE = 0x7FFF;
const SAMPLE_MIN = -1;
const SAMPLE_MAX = 1;
const PCM_BYTES_PER_SAMPLE = 2;
const MS_PER_SECOND = 1000;
const NOISE_GATE_OPEN_RMS = 0.008;
const NOISE_GATE_CLOSE_RMS = 0.003;
const NOISE_GATE_HOLD_MS = 180;
const NOISE_GATE_ATTACK_RATE = 0.08;
const NOISE_GATE_RELEASE_RATE = 0.0012;

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
    this.gateOpen = false;
    this.gateGain = 0;
    this.gateHoldFrames = Math.round((sampleRate * NOISE_GATE_HOLD_MS) / MS_PER_SECOND);
    this.gateHoldRemainingFrames = 0;
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
    const rms = this.calculateRms(input, channelLength);
    const targetGateGain = this.getTargetGateGain(rms, channelLength);

    if (isStereoActive) {
      // Stereo: interleave channels L[0], R[0], L[1], R[1]...
      for (let i = 0; i < channelLength; i++) {
        const gateGain = this.updateGateGain(targetGateGain);
        int16Array[i * 2] = floatToInt16(input[0][i] * gateGain);
        int16Array[i * 2 + 1] = floatToInt16(input[1][i] * gateGain);
      }
    } else {
      // Mono: downmix all available input channels (average L + R)
      const numChannels = input.length;
      for (let i = 0; i < channelLength; i++) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          sum += input[ch][i];
        }
        const gateGain = this.updateGateGain(targetGateGain);
        int16Array[i] = floatToInt16((sum / numChannels) * gateGain);
      }
    }

    // Transfer the buffer back to the main thread (zero-copy)
    this.port.postMessage(buffer, [buffer]);
    return true;
  }

  calculateRms(input, channelLength) {
    let sumSquares = 0;
    const channelCount = input.length;

    for (let i = 0; i < channelLength; i++) {
      let frameSum = 0;
      for (let ch = 0; ch < channelCount; ch++) {
        frameSum += input[ch][i];
      }
      const sample = frameSum / channelCount;
      sumSquares += sample * sample;
    }

    return Math.sqrt(sumSquares / channelLength);
  }

  getTargetGateGain(rms, channelLength) {
    if (rms >= NOISE_GATE_OPEN_RMS) {
      this.gateOpen = true;
      this.gateHoldRemainingFrames = this.gateHoldFrames;
      return 1;
    }
    if (rms > NOISE_GATE_CLOSE_RMS) return this.gateOpen ? 1 : 0;

    this.gateHoldRemainingFrames = Math.max(0, this.gateHoldRemainingFrames - channelLength);
    if (this.gateHoldRemainingFrames > 0) return this.gateOpen ? 1 : 0;

    if (rms <= NOISE_GATE_CLOSE_RMS) {
      this.gateOpen = false;
      return 0;
    }
    return 0;
  }

  updateGateGain(targetGateGain) {
    const rate = targetGateGain > this.gateGain ? NOISE_GATE_ATTACK_RATE : NOISE_GATE_RELEASE_RATE;
    this.gateGain += (targetGateGain - this.gateGain) * rate;
    return this.gateGain;
  }
}

registerProcessor('audio-processor', AudioProcessor);
