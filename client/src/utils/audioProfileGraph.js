import { PROFILE_CLEAN, PROFILE_FAN } from '../constants';

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

export function connectProfileInput({ audioContext, source, gainNode, audioProfile }) {
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
