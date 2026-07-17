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
    registerProcessor: (_name, processorClass) => {
      ProcessorClass = processorClass;
    },
  };

  vm.runInNewContext(fs.readFileSync(WORKLET_URL, 'utf8'), context);
  return ProcessorClass;
}

function createProcessor() {
  const ProcessorClass = loadProcessorClass();
  return new ProcessorClass({ processorOptions: { isStereo: false } });
}

const BATCH_FRAMES = 512;
const CALLS_TO_FILL_BATCH = BATCH_FRAMES / QUANTUM_FRAMES;

function processMonoSample(processor, sample) {
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
});
