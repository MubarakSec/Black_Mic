import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const WORKLET_URL = new URL('../../client/public/audio-processor.js', import.meta.url);
const QUANTUM_FRAMES = 128;
const IDLE_NOISE_SAMPLE = 0.002;
const VOICE_SAMPLE = 0.1;
const PCM_VOICE_FLOOR = 1000;
const PCM_IDLE_NOISE_FLOOR = 10;

function loadProcessorClass() {
  let ProcessorClass = null;

  class AudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage: vi.fn(),
      };
    }
  }

  const context = {
    AudioWorkletProcessor,
    ArrayBuffer,
    Int16Array,
    Math,
    sampleRate: 48000,
    registerProcessor: (_name, processorClass) => {
      ProcessorClass = processorClass;
    },
  };

  vm.runInNewContext(fs.readFileSync(WORKLET_URL, 'utf8'), context);
  return ProcessorClass;
}

function createProcessor(overrides = {}) {
  const ProcessorClass = loadProcessorClass();
  return new ProcessorClass({ processorOptions: { isStereo: false, ...overrides } });
}

const BATCH_FRAMES = 512;
const CALLS_TO_FILL_BATCH = BATCH_FRAMES / QUANTUM_FRAMES;
const STEREO_BUFFER_BYTES = BATCH_FRAMES * 2 * 2;

function processMonoSample(processor, sample) {
  const input = [new Float32Array(QUANTUM_FRAMES).fill(sample)];

  for (let i = 0; i < CALLS_TO_FILL_BATCH; i++) {
    processor.process([input], [], {});
  }

  const lastCallArgs = processor.port.postMessage.mock.calls.at(-1);
  return new Int16Array(lastCallArgs[0].buffer);
}

function configureNoiseReduction(processor, enabled, noiseFloorRms) {
  processor.port.onmessage({
    data: {
      type: 'configure-noise-reduction',
      enabled,
      noiseFloorRms,
    },
  });
}

function processStereoSample(processor, sample) {
  const input = [new Float32Array(QUANTUM_FRAMES).fill(sample)];

  for (let i = 0; i < CALLS_TO_FILL_BATCH; i++) {
    processor.process([input], [], {});
  }

  const lastCallArgs = processor.port.postMessage.mock.calls.at(-1);
  return new Int16Array(lastCallArgs[0].buffer);
}

describe('AudioProcessor PCM encoding', () => {

  it('preserves low-level input without chopping it', () => {
    const pcm = processMonoSample(createProcessor(), IDLE_NOISE_SAMPLE);

    expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(PCM_IDLE_NOISE_FLOOR);
  });

  it('passes voice-level input', () => {
    const pcm = processMonoSample(createProcessor(), VOICE_SAMPLE);

    expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(PCM_VOICE_FLOOR);
  });

  it('keeps low-level input after voice without gate re-entry chopping', () => {
    const processor = createProcessor();

    processMonoSample(processor, VOICE_SAMPLE);
    const pcm = processMonoSample(processor, IDLE_NOISE_SAMPLE);

    expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(PCM_IDLE_NOISE_FLOOR);
  });

  it('duplicates mono input into stereo when stereo is configured but the device delivers mono', () => {
    const processor = createProcessor({ isStereo: true });
    const pcm = processStereoSample(processor, VOICE_SAMPLE);

    expect(pcm.buffer.byteLength).toBe(STEREO_BUFFER_BYTES);
    // Interleaved L/R samples are the same mono sample ±1 LSB of independent dither
    expect(Math.abs(pcm[0] - pcm[1])).toBeLessThanOrEqual(1);
    expect(Math.abs(pcm[2] - pcm[3])).toBeLessThanOrEqual(1);
    expect(Math.abs(pcm[0])).toBeGreaterThan(PCM_VOICE_FLOOR);
  });

  it('smoothly attenuates audio at the calibrated fan-noise floor', () => {
    const processor = createProcessor();
    configureNoiseReduction(processor, true, IDLE_NOISE_SAMPLE);

    for (let batch = 0; batch < 40; batch++) {
      processMonoSample(processor, IDLE_NOISE_SAMPLE);
    }
    const pcm = processMonoSample(processor, IDLE_NOISE_SAMPLE);

    expect(Math.max(...pcm.map(Math.abs))).toBeLessThan(40);
    expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(PCM_IDLE_NOISE_FLOOR);
  });

  it('opens quickly for voice after reducing fan noise', () => {
    const processor = createProcessor();
    configureNoiseReduction(processor, true, IDLE_NOISE_SAMPLE);

    for (let batch = 0; batch < 40; batch++) {
      processMonoSample(processor, IDLE_NOISE_SAMPLE);
    }
    const pcm = processMonoSample(processor, VOICE_SAMPLE);

    expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(PCM_VOICE_FLOOR);
  });

  it('bypasses fan reduction when it is disabled at runtime', () => {
    const processor = createProcessor();
    configureNoiseReduction(processor, true, IDLE_NOISE_SAMPLE);

    for (let batch = 0; batch < 40; batch++) {
      processMonoSample(processor, IDLE_NOISE_SAMPLE);
    }
    configureNoiseReduction(processor, false, IDLE_NOISE_SAMPLE);
    const pcm = processMonoSample(processor, IDLE_NOISE_SAMPLE);

    expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(PCM_IDLE_NOISE_FLOOR);
  });
});
