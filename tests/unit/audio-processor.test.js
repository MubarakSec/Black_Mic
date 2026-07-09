import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const WORKLET_URL = new URL('../../client/public/audio-processor.js', import.meta.url);
const TEST_SAMPLE_RATE = 48000;
const QUANTUM_FRAMES = 128;
const IDLE_NOISE_SAMPLE = 0.002;
const VOICE_SAMPLE = 0.1;
const PCM_VOICE_FLOOR = 1000;
const PCM_QUIET_TAIL_FLOOR = 10;

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
    sampleRate: TEST_SAMPLE_RATE,
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

function processMonoSample(processor, sample) {
  const input = [new Float32Array(QUANTUM_FRAMES).fill(sample)];

  processor.process([input], [], {});

  const [buffer] = processor.port.postMessage.mock.calls.at(-1);
  return new Int16Array(buffer);
}

describe('AudioProcessor noise gate', () => {
  it('mutes low-level idle noise', () => {
    const pcm = processMonoSample(createProcessor(), IDLE_NOISE_SAMPLE);

    expect(Math.max(...pcm.map(Math.abs))).toBe(0);
  });

  it('passes voice-level input', () => {
    const pcm = processMonoSample(createProcessor(), VOICE_SAMPLE);

    expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(PCM_VOICE_FLOOR);
  });

  it('keeps a quiet tail open after voice starts', () => {
    const processor = createProcessor();

    processMonoSample(processor, VOICE_SAMPLE);
    const pcm = processMonoSample(processor, IDLE_NOISE_SAMPLE);

    expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(PCM_QUIET_TAIL_FLOOR);
  });
});
