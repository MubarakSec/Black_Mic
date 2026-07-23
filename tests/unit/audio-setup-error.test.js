import { describe, expect, it } from 'vitest';
import { getAudioSetupError } from '../../client/src/utils/getAudioSetupError';

describe('audio setup error messaging', () => {
  it('explains how to recover from denied microphone permission', () => {
    const message = getAudioSetupError({ name: 'NotAllowedError' });

    expect(message).toContain('Allow microphone access');
  });

  it('explains when another app is using the microphone', () => {
    const message = getAudioSetupError({ name: 'NotReadableError' });

    expect(message).toContain('busy in another app');
  });

  it('uses a safe fallback for unknown errors', () => {
    expect(getAudioSetupError({ name: 'UnknownError' })).toContain('could not start');
    expect(getAudioSetupError(null)).toContain('could not start');
  });
});
