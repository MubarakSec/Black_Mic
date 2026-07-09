// Room Identification Configuration
export const DEFAULT_ROOM_ID = 'ROOM';
export const MAX_ROOM_ID_LENGTH = 12;

// LocalStorage persistence keys
export const LS_ROOM_ID = 'bms_roomId';
export const LS_INPUT_GAIN = 'bms_inputGain';
export const LS_OUTPUT_VOLUME = 'bms_outputVolume';
export const LS_CHANNEL_MODE = 'bms_channelMode'; // 'mono' | 'stereo'

// Audio channel modes
export const CHANNEL_MONO = 1;
export const CHANNEL_STEREO = 2;
export const ROOM_ID_VALIDATOR_REGEX = /^[A-Z0-9]{3,12}$/;

// Telemetry & Watchdog Configuration
export const TELEMETRY_POLL_INTERVAL_MS = 1000;
export const WATCHDOG_CHECK_INTERVAL_MS = 1000;
export const SILENCE_THRESHOLD_MS = 2500;

// Audio Hardware Constraints
export const MICROPHONE_SAMPLE_RATE = 48000;
export const LATENCY_HINT = 'interactive';
export const RECEIVER_TARGET_BUFFER_MS = 60;

// Alarm and Unlock Sound Parameters
export const ALARM_INTERVAL_MS = 1200;
export const ALARM_PITCH_HZ = 880; // A5 Note
export const ALARM_BEEP_DURATION_SEC = 0.5;

export const UNLOCK_NOTE_1_HZ = 523.25; // C5 Note
export const UNLOCK_NOTE_2_HZ = 659.25; // E5 Note

// Visualizer Configuration
export const FFT_SIZE = 256;
export const GLOW_VOLUME_THRESHOLD = 30;
