'use strict';

const RANK_EXTERNAL = 1;
const RANK_PRIMARY = 2;
const RANK_DEFAULT = 3;
const RANK_STANDARD = 4;
const RANK_AMBIENT = 5;

const EXTERNAL_KEYWORDS = ['usb', 'headset', 'headphone', 'wired', 'external', 'lavalier', 'wireless'];
const PRIMARY_KEYWORDS = ['bottom', 'handset', 'primary', 'main'];
const AMBIENT_KEYWORDS = ['top', 'back', 'rear', 'secondary', 'ambient', 'camera', 'telephoto', 'camcorder'];
const DEFAULT_KEYWORDS = ['default', 'built-in', 'internal'];

function matchKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

export function classifyMicrophone(device, index = 0) {
  const rawLabel = (device?.label || '').trim();
  const labelLower = rawLabel.toLowerCase();
  const displayLabel = rawLabel || `Microphone ${index + 1}`;

  if (matchKeyword(labelLower, EXTERNAL_KEYWORDS)) {
    return {
      deviceId: device.deviceId,
      label: displayLabel,
      displayName: `${displayLabel} — ⭐ External Mic (Recommended)`,
      badge: 'External Mic',
      isRecommended: true,
      rank: RANK_EXTERNAL,
      explanation: 'External microphone detected. Best choice when plugged in.',
    };
  }

  if (matchKeyword(labelLower, PRIMARY_KEYWORDS)) {
    return {
      deviceId: device.deviceId,
      label: displayLabel,
      displayName: `${displayLabel} — ⭐ Best for Voice (Primary/Bottom)`,
      badge: 'Bottom Mic',
      isRecommended: true,
      rank: RANK_PRIMARY,
      explanation: 'Primary bottom microphone. Positioned for vocal clarity and close proximity.',
    };
  }

  if (matchKeyword(labelLower, AMBIENT_KEYWORDS)) {
    return {
      deviceId: device.deviceId,
      label: displayLabel,
      displayName: `${displayLabel} — ⚠️ Ambient Mic (Avoid for Voice)`,
      badge: 'Ambient/Top Mic',
      isRecommended: false,
      rank: RANK_AMBIENT,
      explanation: 'Top/rear microphone. Tuned for room noise cancellation and sounds hollow for voice.',
    };
  }

  if (matchKeyword(labelLower, DEFAULT_KEYWORDS)) {
    return {
      deviceId: device.deviceId,
      label: displayLabel,
      displayName: `${displayLabel} — ⭐ Recommended for Voice`,
      badge: 'Default Mic',
      isRecommended: true,
      rank: RANK_DEFAULT,
      explanation: 'System default microphone. Standard high-quality voice input.',
    };
  }

  return {
    deviceId: device.deviceId,
    label: displayLabel,
    displayName: `${displayLabel} — Standard Input`,
    badge: 'Standard',
    isRecommended: index === 0,
    rank: RANK_STANDARD,
    explanation: 'Standard audio input device.',
  };
}

export function rankMicrophones(devices = []) {
  if (!Array.isArray(devices)) return [];
  const audioInputs = devices.filter((d) => d.kind === 'audioinput' || !d.kind);

  const classified = audioInputs.map((device, index) => classifyMicrophone(device, index));
  return classified.sort((a, b) => a.rank - b.rank);
}
