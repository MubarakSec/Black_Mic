import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const WORKLET_URL = new URL('../../client/public/audio-processor.js', import.meta.url);
const QUANTUM_FRAMES = 128;
const IDLE_NOISE_SAMPLE = 0.002;
const VOICE_SAMPLE = 0.1;
const PCM_VOICE_FLOOR = 1000;

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

function processMonoSample(sample) {
  const ProcessorClass = loadProcessorClass();
  const processor = new ProcessorClass({ processorOptions: { isStereo: false } });
  const input = [new Float32Array(QUANTUM_FRAMES).fill(sample)];

  processor.process([input], [], {});

  const [buffer] = processor.port.postMessage.mock.calls.at(-1);
  return new Int16Array(buffer);
}

describe('AudioProcessor noise gate', () => {
  it('mutes low-level idle noise', () => {
    const pcm = processMonoSample(IDLE_NOISE_SAMPLE);

    expect(Math.max(...pcm.map(Math.abs))).toBe(0);
  });

  it('passes voice-level input', () => {
    const pcm = processMonoSample(VOICE_SAMPLE);

    expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(PCM_VOICE_FLOOR);
  });
});
