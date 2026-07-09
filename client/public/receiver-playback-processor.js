const PCM_SAMPLE_SCALE = 32768;
const DEFAULT_TARGET_BUFFER_MS = 60;
const MAX_BUFFER_MS = 250;
const MS_PER_SECOND = 1000;
const STEREO_CHANNELS = 2;

function clampSample(sample) {
  if (sample < -1) return -1;
  if (sample > 1) return 1;
  return sample;
}

function getOutputFrameCount(inputFrames, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) return inputFrames;
  return Math.max(1, Math.round((inputFrames * outputSampleRate) / inputSampleRate));
}

function interpolate(y1, y2, fraction) {
  return y1 + (y2 - y1) * fraction;
}

class ReceiverPlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const targetBufferMs = options?.processorOptions?.targetBufferMs || DEFAULT_TARGET_BUFFER_MS;
    
    this.targetBufferFrames = Math.round((sampleRate * targetBufferMs) / MS_PER_SECOND);
    this.maxBufferFrames = Math.round((sampleRate * MAX_BUFFER_MS) / MS_PER_SECOND);
    
    // Allocate a circular ring buffer that is twice the max latency size (allocation-free playback)
    this.ringBufferSize = this.maxBufferFrames * 2;
    this.ringBufferL = new Float32Array(this.ringBufferSize);
    this.ringBufferR = new Float32Array(this.ringBufferSize);
    
    this.readIndex = 0;
    this.writeIndex = 0;
    this.hasStarted = false;
    this.underruns = 0;

    this.port.onmessage = (event) => {
      const message = event.data;
      if (message?.type === 'reset') {
        this.reset();
        return;
      }
      if (message?.type !== 'pcm') return;
      this.enqueuePcm(message);
    };
  }

  reset() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.hasStarted = false;
  }

  getBufferedFrames() {
    if (this.writeIndex >= this.readIndex) {
      return this.writeIndex - this.readIndex;
    }
    return (this.ringBufferSize - this.readIndex) + this.writeIndex;
  }

  enqueuePcm(message) {
    const { buffer, sampleRate: inputSampleRate, channelCount } = message;
    if (!buffer) return;

    try {
      const pcm = new Int16Array(buffer);
      const inputFrames = Math.floor(pcm.length / channelCount);
      const outputFrames = getOutputFrameCount(inputFrames, inputSampleRate, sampleRate);
      
      // Prevent overflow: if new frames push us past max capacity, drop the oldest frames
      const currentBuffered = this.getBufferedFrames();
      const overflow = (currentBuffered + outputFrames) - this.maxBufferFrames;
      if (overflow > 0) {
        this.readIndex = (this.readIndex + overflow) % this.ringBufferSize;
      }

      const ratio = inputFrames / outputFrames;

      for (let i = 0; i < outputFrames; i++) {
        const exactIndex = i * ratio;
        const indexLow = Math.floor(exactIndex);
        const indexHigh = Math.min(inputFrames - 1, indexLow + 1);
        const fraction = exactIndex - indexLow;

        // Perform linear interpolation resampling for premium rate translation
        const leftSample1 = pcm[indexLow * channelCount] / PCM_SAMPLE_SCALE;
        const leftSample2 = pcm[indexHigh * channelCount] / PCM_SAMPLE_SCALE;
        const leftSample = interpolate(leftSample1, leftSample2, fraction);

        const rightSample1 = channelCount === STEREO_CHANNELS
          ? pcm[indexLow * channelCount + 1] / PCM_SAMPLE_SCALE
          : leftSample1;
        const rightSample2 = channelCount === STEREO_CHANNELS
          ? pcm[indexHigh * channelCount + 1] / PCM_SAMPLE_SCALE
          : leftSample2;
        const rightSample = channelCount === STEREO_CHANNELS
          ? interpolate(rightSample1, rightSample2, fraction)
          : leftSample;

        const idx = (this.writeIndex + i) % this.ringBufferSize;
        this.ringBufferL[idx] = clampSample(leftSample);
        this.ringBufferR[idx] = clampSample(rightSample);
      }

      this.writeIndex = (this.writeIndex + outputFrames) % this.ringBufferSize;
    } catch (e) {
      console.error('[BMS Worklet] Error during enqueuePcm ring buffer write:', e.message);
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.length) return true;

    const leftOutput = output[0];
    const rightOutput = output[1] || output[0];

    const currentBuffered = this.getBufferedFrames();

    // Enforce pre-buffering (jitter mitigation)
    if (!this.hasStarted) {
      if (currentBuffered >= this.targetBufferFrames) {
        this.hasStarted = true;
      } else {
        // Output silence until buffer targets are met
        for (let frame = 0; frame < leftOutput.length; frame++) {
          leftOutput[frame] = 0;
          rightOutput[frame] = 0;
        }
        return true;
      }
    }

    let hitUnderrun = false;

    // Pull samples directly from the pre-allocated circular ring buffer
    for (let frame = 0; frame < leftOutput.length; frame++) {
      const available = this.getBufferedFrames();
      if (available === 0) {
        leftOutput[frame] = 0;
        rightOutput[frame] = 0;
        hitUnderrun = true;
        continue;
      }

      leftOutput[frame] = this.ringBufferL[this.readIndex];
      rightOutput[frame] = this.ringBufferR[this.readIndex];
      this.readIndex = (this.readIndex + 1) % this.ringBufferSize;
    }

    if (hitUnderrun) {
      this.underruns += 1;
      this.port.postMessage({ type: 'underrun', count: this.underruns });
    }

    return true;
  }
}

registerProcessor('receiver-playback-processor', ReceiverPlaybackProcessor);
