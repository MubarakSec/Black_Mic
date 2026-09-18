'use strict';

const SAMPLE_RATE = 8000;
const HEADER_SIZE_BYTES = 44;
const PCM_SILENCE_VALUE = 128; // 8-bit unsigned PCM center
const SILENT_DURATION_FRAMES = 8000; // 1 second
const INAUDIBLE_VOLUME = 0.001;
const INAUDIBLE_FREQ_HZ = 10;
const SUBCHUNK_PCM_SIZE = 16;
const PCM_FORMAT = 1;
const MONO_CHANNELS = 1;
const BITS_PER_SAMPLE = 8;

function generateSilentWavBlob() {
  const totalLength = HEADER_SIZE_BYTES + SILENT_DURATION_FRAMES;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  // "RIFF" chunk descriptor
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + SILENT_DURATION_FRAMES, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, SUBCHUNK_PCM_SIZE, true);
  view.setUint16(20, PCM_FORMAT, true);
  view.setUint16(22, MONO_CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE, true);
  view.setUint16(32, MONO_CHANNELS, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, SILENT_DURATION_FRAMES, true);

  const pcmData = new Uint8Array(buffer, HEADER_SIZE_BYTES);
  pcmData.fill(PCM_SILENCE_VALUE);

  return new Blob([buffer], { type: 'audio/wav' });
}

export function createAudioKeepalive() {
  let audioElement = null;
  let objectUrl = null;
  let oscillator = null;
  let gainNode = null;
  let active = false;

  function start(audioContext) {
    if (active) return;
    active = true;

    // 1. HTML5 audio loop (primary Android power management keepalive)
    if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
      try {
        const blob = generateSilentWavBlob();
        objectUrl = URL.createObjectURL(blob);
        audioElement = new Audio(objectUrl);
        audioElement.loop = true;
        audioElement.volume = INAUDIBLE_VOLUME;
        audioElement.play().catch(() => {});
      } catch (err) {
        console.warn('[BMS] HTML5 audio keepalive failed to start:', err);
      }
    }

    // 2. WebAudio inaudible oscillator connected to destination
    if (audioContext && audioContext.state !== 'closed') {
      try {
        oscillator = audioContext.createOscillator();
        gainNode = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = INAUDIBLE_FREQ_HZ;
        gainNode.gain.value = INAUDIBLE_VOLUME;
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start();
      } catch (err) {
        console.warn('[BMS] WebAudio oscillator keepalive failed to start:', err);
      }
    }
  }

  function stop() {
    if (!active) return;
    active = false;

    if (audioElement) {
      audioElement.pause();
      audioElement.src = '';
      audioElement = null;
    }

    if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }

    if (oscillator) {
      try {
        oscillator.stop();
        oscillator.disconnect();
      } catch (_) {}
      oscillator = null;
    }

    if (gainNode) {
      try {
        gainNode.disconnect();
      } catch (_) {}
      gainNode = null;
    }
  }

  return {
    start,
    stop,
    isActive: () => active,
  };
}
