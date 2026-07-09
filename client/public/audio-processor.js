class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.reusableBuffer = null;
  }

  process(inputs, _outputs, _parameters) {
    // inputs[0] represents the first audio source (microphone stream)
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    
    // channelData represents mono channel 0
    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    const length = channelData.length;
    
    // Pre-allocate buffer in the worklet thread to prevent garbage collection churn
    if (!this.reusableBuffer || this.reusableBuffer.length !== length) {
      this.reusableBuffer = new Int16Array(length);
    }
    
    const int16Array = this.reusableBuffer;
    for (let i = 0; i < length; i++) {
      // Clamp values between [-1.0, 1.0]
      const s = Math.max(-1, Math.min(1, channelData[i]));
      // Map to 16-bit signed integer range
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    // Send the raw binary array buffer back to the main thread
    this.port.postMessage(int16Array.buffer.slice(0));
    
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
