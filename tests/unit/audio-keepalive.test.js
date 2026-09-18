import { describe, expect, it, vi } from 'vitest';
import { createAudioKeepalive } from '../../client/src/utils/audioKeepalive';

describe('audioKeepalive', () => {
  it('starts and stops cleanly with mock AudioContext', () => {
    const mockOscillator = {
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    };
    const mockGain = {
      gain: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const mockAudioContext = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(() => mockOscillator),
      createGain: vi.fn(() => mockGain),
    };

    const keepalive = createAudioKeepalive();
    expect(keepalive.isActive()).toBe(false);

    keepalive.start(mockAudioContext);
    expect(keepalive.isActive()).toBe(true);
    expect(mockAudioContext.createOscillator).toHaveBeenCalledOnce();
    expect(mockOscillator.start).toHaveBeenCalledOnce();

    keepalive.stop();
    expect(keepalive.isActive()).toBe(false);
    expect(mockOscillator.stop).toHaveBeenCalledOnce();
    expect(mockOscillator.disconnect).toHaveBeenCalledOnce();
  });

  it('safely ignores multiple start calls', () => {
    const mockAudioContext = {
      state: 'running',
      destination: {},
      createOscillator: vi.fn(() => ({
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: { value: 0 },
        connect: vi.fn(),
      })),
    };

    const keepalive = createAudioKeepalive();
    keepalive.start(mockAudioContext);
    keepalive.start(mockAudioContext);

    expect(mockAudioContext.createOscillator).toHaveBeenCalledOnce();
  });

  it('handles stop when not started', () => {
    const keepalive = createAudioKeepalive();
    expect(() => keepalive.stop()).not.toThrow();
  });
});
