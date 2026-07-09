class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.isStereo = options?.processorOptions?.isStereo ?? false;
    this.reusableBuffer = null;
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const numChannels = this.isStereo ? Math.min(input.length, 2) : 1;
    const channelLength = input[0]?.length;
    if (!channelLength) return true;

    const totalSamples = channelLength * numChannels;

    if (!this.reusableBuffer || this.reusableBuffer.length !== totalSamples) {
      this.reusableBuffer = new Int16Array(totalSamples);
    }

    const int16Array = this.reusableBuffer;
    for (let i = 0; i < channelLength; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const s = Math.max(-1, Math.min(1, input[ch][i]));
        int16Array[i * numChannels + ch] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
    }

    // Transfer the buffer back to the main thread
    this.port.postMessage(int16Array.buffer.slice(0));
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
