const AUDIO_ERROR_MESSAGES = {
  NotAllowedError: 'Microphone permission was denied. Allow microphone access in your browser, then try again.',
  NotFoundError: 'No microphone was found on this device.',
  NotReadableError: 'The microphone is busy in another app. Close that app, then try again.',
  SecurityError: 'Microphone access requires HTTPS or localhost.',
  AbortError: 'Microphone startup was interrupted. Please try again.',
};

const DEFAULT_AUDIO_ERROR_MESSAGE = 'The audio engine could not start. Check the device connection and try again.';

export function getAudioSetupError(error) {
  if (!error || typeof error !== 'object') return DEFAULT_AUDIO_ERROR_MESSAGE;
  if (typeof error.name !== 'string') return DEFAULT_AUDIO_ERROR_MESSAGE;
  return AUDIO_ERROR_MESSAGES[error.name] || DEFAULT_AUDIO_ERROR_MESSAGE;
}
