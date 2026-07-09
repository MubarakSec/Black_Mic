class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.isStereo = options?.processorOptions?.isStereo ?? false;
    this.reusableBuffer = null;
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelLength = input[0]?.length;
    if (!channelLength) return true;

    if (this.isStereo && input.length >= 2) {
      // Stereo: interleave channels L[0], R[0], L[1], R[1]...
      const totalSamples = channelLength * 2;
      if (!this.reusableBuffer || this.reusableBuffer.length !== totalSamples) {
        this.reusableBuffer = new Int16Array(totalSamples);
      }
      const int16Array = this.reusableBuffer;
      for (let i = 0; i < channelLength; i++) {
        const left = Math.max(-1, Math.min(1, input[0][i]));
        const right = Math.max(-1, Math.min(1, input[1][i]));
        int16Array[i * 2] = left < 0 ? left * 0x8000 : left * 0x7FFF;
        int16Array[i * 2 + 1] = right < 0 ? right * 0x8000 : right * 0x7FFF;
      }
    } else {
      // Mono: downmix all available input channels (average L + R)
      const totalSamples = channelLength;
      if (!this.reusableBuffer || this.reusableBuffer.length !== totalSamples) {
        this.reusableBuffer = new Int16Array(totalSamples);
      }
      const int16Array = this.reusableBuffer;
      const numChannels = input.length;
      for (let i = 0; i < channelLength; i++) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          sum += input[ch][i];
        }
        const avg = Math.max(-1, Math.min(1, sum / numChannels));
        int16Array[i] = avg < 0 ? avg * 0x8000 : avg * 0x7FFF;
      }
    }

    // Transfer the buffer back to the main thread
    this.port.postMessage(this.reusableBuffer.buffer.slice(0));
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
