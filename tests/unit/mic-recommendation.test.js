import { describe, expect, it } from 'vitest';
import {
  classifyMicrophone,
  rankMicrophones,
} from '../../client/src/utils/micRecommendation';

describe('micRecommendation', () => {
  it('identifies external and USB microphones with highest rank', () => {
    const mic = { deviceId: 'usb-1', label: 'USB Audio Codec Microphone', kind: 'audioinput' };
    const classified = classifyMicrophone(mic);

    expect(classified.isRecommended).toBe(true);
    expect(classified.badge).toBe('External Mic');
    expect(classified.displayName).toContain('⭐ External Mic');
    expect(classified.rank).toBe(1);
  });

  it('identifies primary/bottom microphone as best for voice', () => {
    const mic = { deviceId: 'bottom-1', label: 'Built-in Bottom Microphone', kind: 'audioinput' };
    const classified = classifyMicrophone(mic);

    expect(classified.isRecommended).toBe(true);
    expect(classified.badge).toBe('Bottom Mic');
    expect(classified.displayName).toContain('⭐ Best for Voice');
    expect(classified.rank).toBe(2);
  });

  it('identifies ambient and top microphones as avoid for voice', () => {
    const mic = { deviceId: 'top-1', label: 'Top Ambient Noise Cancellation Mic', kind: 'audioinput' };
    const classified = classifyMicrophone(mic);

    expect(classified.isRecommended).toBe(false);
    expect(classified.badge).toBe('Ambient/Top Mic');
    expect(classified.displayName).toContain('⚠️ Ambient Mic');
    expect(classified.rank).toBe(5);
  });

  it('handles default and built-in microphones', () => {
    const mic = { deviceId: 'default', label: 'Default - Built-in Audio', kind: 'audioinput' };
    const classified = classifyMicrophone(mic);

    expect(classified.isRecommended).toBe(true);
    expect(classified.badge).toBe('Default Mic');
    expect(classified.rank).toBe(3);
  });

  it('ranks external and primary voice mics above ambient mics in rankMicrophones', () => {
    const devices = [
      { deviceId: 'top', label: 'Top Microphone', kind: 'audioinput' },
      { deviceId: 'bottom', label: 'Handset Bottom Mic', kind: 'audioinput' },
      { deviceId: 'usb', label: 'Wired Headset Mic', kind: 'audioinput' },
      { deviceId: 'speaker', label: 'Speaker Output', kind: 'audiooutput' }, // Should be filtered out
    ];

    const ranked = rankMicrophones(devices);

    expect(ranked).toHaveLength(3);
    expect(ranked[0].deviceId).toBe('usb');
    expect(ranked[1].deviceId).toBe('bottom');
    expect(ranked[2].deviceId).toBe('top');
  });

  it('falls back cleanly for devices without labels (before permission)', () => {
    const device = { deviceId: 'id-1', label: '', kind: 'audioinput' };
    const classified = classifyMicrophone(device, 0);

    expect(classified.label).toBe('Microphone 1');
    expect(classified.isRecommended).toBe(true);
  });
});
