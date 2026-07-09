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
    const requiredByteLength = totalSamples * 2;

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
        const left = Math.max(-1, Math.min(1, input[0][i]));
        const right = Math.max(-1, Math.min(1, input[1][i]));
        int16Array[i * 2] = left < 0 ? left * 0x8000 : left * 0x7FFF;
        int16Array[i * 2 + 1] = right < 0 ? right * 0x8000 : right * 0x7FFF;
      }
    } else {
      // Mono: downmix all available input channels (average L + R)
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

    // Transfer the buffer back to the main thread (zero-copy)
    this.port.postMessage(buffer, [buffer]);
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
