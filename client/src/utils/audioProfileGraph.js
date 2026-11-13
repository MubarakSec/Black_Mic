import { PROFILE_CLEAN, PROFILE_FAN, PROFILE_STUDIO } from '../constants';

// dBFS / millisecond-scale dynamics tuning shared by the voice profiles.
const HIGHPASS_FREQUENCY_HZ = 80;
const HIGHPASS_Q = 0.7;
const VOICE_COMPRESSOR_THRESHOLD_DB = -20;
const VOICE_COMPRESSOR_KNEE_DB = 12;
const VOICE_COMPRESSOR_RATIO = 2;
const VOICE_COMPRESSOR_ATTACK_SEC = 0.005;
const VOICE_COMPRESSOR_RELEASE_SEC = 0.18;
const LIMITER_THRESHOLD_DB = -1.5;
const LIMITER_KNEE_DB = 0;
const LIMITER_RATIO = 20;
const LIMITER_ATTACK_SEC = 0.002;
const LIMITER_RELEASE_SEC = 0.08;
// Transparent voice tuning: subtract problems, add almost nothing.
// HPF removes rumble; a whisper of presence lift glues artication;
// the 12 kHz shelf CUTS codec hiss phone mics carry. No boost where
// the phone can't already produce real signal.
const STUDIO_HIGHPASS_HZ = 80;
const STUDIO_HIGHPASS_Q = 0.71;
const STUDIO_PRESENCE_HZ = 3200;
const STUDIO_PRESENCE_DB = 1;
const STUDIO_PRESENCE_Q = 1.1;
const STUDIO_DEHISS_HZ = 12000;
const STUDIO_DEHISS_DB = -2;
const STUDIO_COMP_THRESHOLD_DB = -20;
const STUDIO_COMP_KNEE_DB = 12;
const STUDIO_COMP_RATIO = 2;
const STUDIO_COMP_ATTACK_SEC = 0.015;
const STUDIO_COMP_RELEASE_SEC = 0.18;

export function connectProfileInput({ audioContext, source, gainNode, audioProfile }) {
  if (audioProfile === PROFILE_STUDIO) {
    const highPass = audioContext.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = STUDIO_HIGHPASS_HZ;
    highPass.Q.value = STUDIO_HIGHPASS_Q;

    const presence = audioContext.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = STUDIO_PRESENCE_HZ;
    presence.gain.value = STUDIO_PRESENCE_DB;
    presence.Q.value = STUDIO_PRESENCE_Q;

    const dehiss = audioContext.createBiquadFilter();
    dehiss.type = 'highshelf';
    dehiss.frequency.value = STUDIO_DEHISS_HZ;
    dehiss.gain.value = STUDIO_DEHISS_DB;

    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = STUDIO_COMP_THRESHOLD_DB;
    compressor.knee.value = STUDIO_COMP_KNEE_DB;
    compressor.ratio.value = STUDIO_COMP_RATIO;
    compressor.attack.value = STUDIO_COMP_ATTACK_SEC;
    compressor.release.value = STUDIO_COMP_RELEASE_SEC;

    source.connect(highPass);
    highPass.connect(presence);
    presence.connect(dehiss);
    dehiss.connect(compressor);
    compressor.connect(gainNode);
    return;
  }
  if (audioProfile === PROFILE_CLEAN) {
    const highPass = audioContext.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = HIGHPASS_FREQUENCY_HZ;
    highPass.Q.value = HIGHPASS_Q;

    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = VOICE_COMPRESSOR_THRESHOLD_DB;
    compressor.knee.value = VOICE_COMPRESSOR_KNEE_DB;
    compressor.ratio.value = VOICE_COMPRESSOR_RATIO;
    compressor.attack.value = VOICE_COMPRESSOR_ATTACK_SEC;
    compressor.release.value = VOICE_COMPRESSOR_RELEASE_SEC;

    source.connect(highPass);
    highPass.connect(compressor);
    compressor.connect(gainNode);
    return;
  }
  if (audioProfile === PROFILE_FAN) {
    const highPass = audioContext.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = HIGHPASS_FREQUENCY_HZ;
    highPass.Q.value = HIGHPASS_Q;

    source.connect(highPass);
    highPass.connect(gainNode);
    return;
  }
  source.connect(gainNode);
}

export function createPeakLimiter(audioContext) {
  const limiter = audioContext.createDynamicsCompressor();
  limiter.threshold.value = LIMITER_THRESHOLD_DB;
  limiter.knee.value = LIMITER_KNEE_DB;
  limiter.ratio.value = LIMITER_RATIO;
  limiter.attack.value = LIMITER_ATTACK_SEC;
  limiter.release.value = LIMITER_RELEASE_SEC;
  return limiter;
}
