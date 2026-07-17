const PCM_NEGATIVE_SCALE = 0x8000;
const PCM_POSITIVE_SCALE = 0x7FFF;
const SAMPLE_MIN = -1;
const SAMPLE_MAX = 1;
const PCM_BYTES_PER_SAMPLE = 2;
const BATCH_FRAMES = 512; // ~10.7ms at 48kHz

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
      }
    };
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

    if (isStereoActive) {
      // Stereo: interleave channels L[0], R[0], L[1], R[1]...
      for (let i = 0; i < channelLength; i++) {
        const offset = (this.frameOffset + i) * 2;
        this.currentInt16Array[offset] = floatToInt16(input[0][i]);
        this.currentInt16Array[offset + 1] = floatToInt16(input[1][i]);
      }
    } else {
      // Mono: just use channel 0 to avoid phase issues from averaging
      for (let i = 0; i < channelLength; i++) {
        this.currentInt16Array[this.frameOffset + i] = floatToInt16(input[0][i]);
      }
    }

    // Telemetry
    for (let i = 0; i < channelLength; i++) {
      const sample = input[0][i];
      this.peak = Math.max(this.peak, Math.abs(sample));
      this.sumSquares += sample * sample;
      if (Math.abs(sample) >= 0.999) {
        this.clippedSamples++;
      }
    }

    this.frameOffset += channelLength;

    // Once we hit our batch size, send it and swap buffers
    if (this.frameOffset >= BATCH_FRAMES) {
      const bufferToSend = this.currentBuffer;
      
      this.currentBuffer = this.getBufferFromPool();
      this.currentInt16Array = new Int16Array(this.currentBuffer);
      this.frameOffset = 0;

      const rms = Math.sqrt(this.sumSquares / BATCH_FRAMES);
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
