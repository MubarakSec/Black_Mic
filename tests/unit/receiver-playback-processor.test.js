import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const WORKLET_URL = new URL('../../client/public/receiver-playback-processor.js', import.meta.url);
const TEST_SAMPLE_RATE = 48000;
const TEST_BUFFER_MS = 1;
const QUANTUM_FRAMES = 128;
const PCM_POSITIVE_HALF = 16384;
const PCM_NEGATIVE_HALF = -16384;

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
    Float32Array,
    Int16Array,
    ArrayBuffer,
    Math,
    Number,
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
  return new ProcessorClass({
    processorOptions: {
      targetBufferMs: TEST_BUFFER_MS,
    },
  });
}

function renderFirstFrame(processor) {
  const left = new Float32Array(QUANTUM_FRAMES);
  const right = new Float32Array(QUANTUM_FRAMES);
  processor.process([], [[left, right]]);
  return { left: left[0], right: right[0] };
}

describe('ReceiverPlaybackProcessor', () => {
  it('duplicates mono PCM into both output channels', () => {
    const processor = createProcessor();
    const buffer = new Int16Array(QUANTUM_FRAMES).fill(PCM_POSITIVE_HALF).buffer;

    processor.port.onmessage({
      data: {
        type: 'pcm',
        buffer,
        sampleRate: TEST_SAMPLE_RATE,
        channelCount: 1,
      },
    });

    expect(renderFirstFrame(processor)).toEqual({
      left: 0.5,
      right: 0.5,
    });
  });

  it('preserves interleaved stereo PCM channels', () => {
    const processor = createProcessor();
    const pcm = new Int16Array(QUANTUM_FRAMES * 2);
    for (let frame = 0; frame < QUANTUM_FRAMES; frame++) {
      pcm[frame * 2] = PCM_POSITIVE_HALF;
      pcm[frame * 2 + 1] = PCM_NEGATIVE_HALF;
    }

    processor.port.onmessage({
      data: {
        type: 'pcm',
        buffer: pcm.buffer,
        sampleRate: TEST_SAMPLE_RATE,
        channelCount: 2,
      },
    });

    expect(renderFirstFrame(processor)).toEqual({
      left: 0.5,
      right: -0.5,
    });
  });
});
