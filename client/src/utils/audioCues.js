'use strict';

import {
  ALARM_PITCH_HZ,
  ALARM_BEEP_DURATION_SEC,
  UNLOCK_NOTE_1_HZ,
  UNLOCK_NOTE_2_HZ,
} from '../constants';

const ALARM_GAIN_VALUE = 0.15;
const ALARM_RAMP_OFFSET_SEC = 0.1;
const EXPONENTIAL_RAMP_FLOOR = 0.001;
const UNLOCK_GAIN_VALUE = 0.08;
const UNLOCK_NOTE_1_RAMP_SEC = 0.15;
const UNLOCK_NOTE_1_STOP_SEC = 0.2;
const UNLOCK_NOTE_2_DELAY_SEC = 0.1;
const UNLOCK_NOTE_2_RAMP_SEC = 0.25;
const UNLOCK_NOTE_2_STOP_SEC = 0.3;

export function playAlarmBeep(audioContext) {
  if (!audioContext || audioContext.state === 'closed') return;
  try {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(ALARM_PITCH_HZ, audioContext.currentTime);
    gain.gain.setValueAtTime(ALARM_GAIN_VALUE, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      EXPONENTIAL_RAMP_FLOOR,
      audioContext.currentTime + (ALARM_BEEP_DURATION_SEC - ALARM_RAMP_OFFSET_SEC),
    );
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + ALARM_BEEP_DURATION_SEC);
  } catch (e) {
    console.error('[BMS] Failed to play alarm beep:', e);
  }
}

export function playUnlockBeep(audioContext) {
  if (!audioContext || audioContext.state === 'closed') return;
  try {
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.frequency.setValueAtTime(UNLOCK_NOTE_1_HZ, audioContext.currentTime);
    gain1.gain.setValueAtTime(UNLOCK_GAIN_VALUE, audioContext.currentTime);
    gain1.gain.exponentialRampToValueAtTime(
      EXPONENTIAL_RAMP_FLOOR,
      audioContext.currentTime + UNLOCK_NOTE_1_RAMP_SEC,
    );
    osc1.connect(gain1);
    gain1.connect(audioContext.destination);
    osc1.start();
    osc1.stop(audioContext.currentTime + UNLOCK_NOTE_1_STOP_SEC);

    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.frequency.setValueAtTime(
      UNLOCK_NOTE_2_HZ,
      audioContext.currentTime + UNLOCK_NOTE_2_DELAY_SEC,
    );
    gain2.gain.setValueAtTime(
      UNLOCK_GAIN_VALUE,
      audioContext.currentTime + UNLOCK_NOTE_2_DELAY_SEC,
    );
    gain2.gain.exponentialRampToValueAtTime(
      EXPONENTIAL_RAMP_FLOOR,
      audioContext.currentTime + UNLOCK_NOTE_2_RAMP_SEC,
    );
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);
    osc2.start();
    osc2.stop(audioContext.currentTime + UNLOCK_NOTE_2_STOP_SEC);
  } catch (e) {
    console.error('[BMS] Failed to play unlock beep:', e);
  }
}
