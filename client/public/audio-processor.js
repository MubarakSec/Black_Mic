const PCM_NEGATIVE_SCALE = 0x8000;
const PCM_POSITIVE_SCALE = 0x7FFF;
const SAMPLE_MIN = -1;
const SAMPLE_MAX = 1;
const PCM_BYTES_PER_SAMPLE = 2;
const BATCH_FRAMES = 512; // ~10.7ms at 48kHz
const DEFAULT_SAMPLE_RATE = 48000;
const MIN_REDUCTION_GAIN = 0.35;
const REDUCTION_START_RATIO = 1.1;
const REDUCTION_END_RATIO = 3;
const REDUCTION_ATTACK_SEC = 0.003;
const REDUCTION_RELEASE_SEC = 0.3;

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
    this.noiseReductionEnabled = options?.processorOptions?.noiseReductionEnabled ?? false;
    this.noiseFloorRms = this.validateNoiseFloor(options?.processorOptions?.noiseFloorRms);
    this.reductionGain = 1;
    this.contextSampleRate = typeof sampleRate === 'number' ? sampleRate : DEFAULT_SAMPLE_RATE;
    this.bufferPool = [];
    this.frameOffset = 0;
    
    this.requiredByteLength = BATCH_FRAMES * (this.isStereo ? 2 : 1) * PCM_BYTES_PER_SAMPLE;
    this.currentBuffer = new ArrayBuffer(this.requiredByteLength);
    this.currentInt16Array = new Int16Array(this.currentBuffer);

    this.peak = 0;
    this.sumSquares = 0;
    this.clippedSamples = 0;

    // Listen for returned buffers from the main thread to recycle them
    this.port.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        this.bufferPool.push(e.data);
        return;
      }
      if (e.data?.type !== 'configure-noise-reduction') return;
      this.noiseReductionEnabled = e.data.enabled === true;
      this.noiseFloorRms = this.validateNoiseFloor(e.data.noiseFloorRms);
    };
  }

  validateNoiseFloor(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 0 || value > SAMPLE_MAX) return null;
    return value;
  }

  computeReductionTarget(input, channelLength) {
    if (!this.noiseReductionEnabled || !this.noiseFloorRms) return 1;

    let sumSquares = 0;
    let sampleCount = 0;
    for (let channelIndex = 0; channelIndex < input.length; channelIndex++) {
      const channel = input[channelIndex];
      for (let frameIndex = 0; frameIndex < channelLength; frameIndex++) {
        sumSquares += channel[frameIndex] * channel[frameIndex];
      }
      sampleCount += channelLength;
    }

    const rms = Math.sqrt(sumSquares / sampleCount);
    const ratio = rms / this.noiseFloorRms;
    if (ratio <= REDUCTION_START_RATIO) return MIN_REDUCTION_GAIN;
    if (ratio >= REDUCTION_END_RATIO) return 1;

    const position = (ratio - REDUCTION_START_RATIO) / (REDUCTION_END_RATIO - REDUCTION_START_RATIO);
    const smoothPosition = position * position * (3 - (2 * position));
    return MIN_REDUCTION_GAIN + (smoothPosition * (1 - MIN_REDUCTION_GAIN));
  }

  applySmoothedReduction(sample, targetGain) {
    const timeConstant = targetGain > this.reductionGain
      ? REDUCTION_ATTACK_SEC
      : REDUCTION_RELEASE_SEC;
    const coefficient = 1 - Math.exp(-1 / (this.contextSampleRate * timeConstant));
    this.reductionGain += (targetGain - this.reductionGain) * coefficient;
    return sample * this.reductionGain;
  }

  getBufferFromPool() {
    for (let i = 0; i < this.bufferPool.length; i++) {
      if (this.bufferPool[i].byteLength === this.requiredByteLength) {
        return this.bufferPool.splice(i, 1)[0];
      }
    }
    return new ArrayBuffer(this.requiredByteLength);
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelLength = input[0]?.length;
    if (!channelLength) return true;

    const isStereoActive = this.isStereo && input.length >= 2;
    const reductionTarget = this.computeReductionTarget(input, channelLength);

    // Merge encoding + telemetry into a single loop
    const monoInput = input[0];

    if (isStereoActive) {
      const stereoInput1 = input[1];
      for (let i = 0; i < channelLength; i++) {
        const offset = (this.frameOffset + i) * 2;
        const sample = this.applySmoothedReduction(monoInput[i], reductionTarget);
        const stereoSample = stereoInput1[i] * this.reductionGain;
        this.currentInt16Array[offset] = floatToInt16(sample);
        this.currentInt16Array[offset + 1] = floatToInt16(stereoSample);
        const abs = Math.abs(sample);
        if (abs > this.peak) this.peak = abs;
        this.sumSquares += sample * sample;
        if (abs >= 0.999) this.clippedSamples++;
      }
    } else {
      for (let i = 0; i < channelLength; i++) {
        const sample = this.applySmoothedReduction(monoInput[i], reductionTarget);
        this.currentInt16Array[this.frameOffset + i] = floatToInt16(sample);
        const abs = Math.abs(sample);
        if (abs > this.peak) this.peak = abs;
        this.sumSquares += sample * sample;
        if (abs >= 0.999) this.clippedSamples++;
      }
    }

    this.frameOffset += channelLength;

    // Once we hit our batch size, send it and swap buffers
    if (this.frameOffset >= BATCH_FRAMES) {
      const bufferToSend = this.currentBuffer;
      const actualFrames = this.frameOffset;
      
      this.currentBuffer = this.getBufferFromPool();
      this.currentInt16Array = new Int16Array(this.currentBuffer);
      this.frameOffset = 0;

      const rms = Math.sqrt(this.sumSquares / actualFrames);
      const peakDb = 20 * Math.log10(Math.max(this.peak, 1e-8));
      const rmsDb = 20 * Math.log10(Math.max(rms, 1e-8));
      const clipped = this.clippedSamples;

      // Transfer the buffer back to the main thread (zero-copy)
      this.port.postMessage({
        buffer: bufferToSend,
        peakDb,
        rmsDb,
        clippedSamples: clipped
      }, [bufferToSend]);

      this.peak = 0;
      this.sumSquares = 0;
      this.clippedSamples = 0;
    }

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
