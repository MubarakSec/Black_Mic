import { PROFILE_CLEAN, PROFILE_FAN, PROFILE_STUDIO } from '../constants';

// dBFS / millisecond-scale dynamics tuning shared by the voice profiles.
const HIGHPASS_FREQUENCY_HZ = 80;
const HIGHPASS_Q = 0.7;
const VOICE_COMPRESSOR_THRESHOLD_DB = -18;
const VOICE_COMPRESSOR_KNEE_DB = 8;
const VOICE_COMPRESSOR_RATIO = 3;
const VOICE_COMPRESSOR_ATTACK_SEC = 0.005;
const VOICE_COMPRESSOR_RELEASE_SEC = 0.18;
const LIMITER_THRESHOLD_DB = -3;
const LIMITER_KNEE_DB = 0;
const LIMITER_RATIO = 20;
const LIMITER_ATTACK_SEC = 0.002;
const LIMITER_RELEASE_SEC = 0.08;
// STUDIO: broadcast-voice tuning. HPF removes rumble, presence peak
// restores articulation that phone mics lack, air shelf rebuilds top end.
const STUDIO_HIGHPASS_HZ = 100;
const STUDIO_HIGHPASS_Q = 0.71;
const STUDIO_PRESENCE_HZ = 3200;
const STUDIO_PRESENCE_DB = 2.5;
const STUDIO_PRESENCE_Q = 1.1;
const STUDIO_AIR_HZ = 12000;
const STUDIO_AIR_DB = 3;
const STUDIO_COMP_THRESHOLD_DB = -16;
const STUDIO_COMP_KNEE_DB = 6;
const STUDIO_COMP_RATIO = 3;
const STUDIO_COMP_ATTACK_SEC = 0.01;
const STUDIO_COMP_RELEASE_SEC = 0.15;

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

    const air = audioContext.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = STUDIO_AIR_HZ;
    air.gain.value = STUDIO_AIR_DB;

    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = STUDIO_COMP_THRESHOLD_DB;
    compressor.knee.value = STUDIO_COMP_KNEE_DB;
    compressor.ratio.value = STUDIO_COMP_RATIO;
    compressor.attack.value = STUDIO_COMP_ATTACK_SEC;
    compressor.release.value = STUDIO_COMP_RELEASE_SEC;

    source.connect(highPass);
    highPass.connect(presence);
    presence.connect(air);
    air.connect(compressor);
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
