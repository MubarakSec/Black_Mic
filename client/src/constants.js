// Room Identification Configuration
export const DEFAULT_ROOM_ID = 'ROOM';
export const MAX_ROOM_ID_LENGTH = 12;

// LocalStorage persistence keys
export const LS_ROOM_ID = 'bms_roomId';
export const LS_INPUT_GAIN = 'bms_inputGain';
export const LS_OUTPUT_VOLUME = 'bms_outputVolume';
export const LS_CHANNEL_MODE = 'bms_channelMode'; // 'mono' | 'stereo'
export const LS_AUDIO_PROFILE = 'bms_audioProfile';
export const LS_RECEIVER_BUFFER_MS = 'bms_receiverBufferMs';

// Audio channel modes
export const CHANNEL_MONO = 1;
export const CHANNEL_STEREO = 2;
export const ROOM_ID_VALIDATOR_REGEX = /^[A-Z0-9]{3,12}$/;

// Role constants
export const ROLE_SENDER = 'sender';
export const ROLE_RECEIVER = 'receiver';

// Channel mode strings
export const CHANNEL_MODE_MONO = 'mono';
export const CHANNEL_MODE_STEREO = 'stereo';

// Audio profile constants
export const PROFILE_RAW = 'raw';
export const PROFILE_CLEAN = 'clean';
export const PROFILE_FAN = 'fan';
export const PROFILE_CALL = 'call';

// Telemetry & Watchdog Configuration
export const TELEMETRY_POLL_INTERVAL_MS = 1000;
export const WATCHDOG_CHECK_INTERVAL_MS = 1000;
export const SILENCE_THRESHOLD_MS = 2500;
export const JOIN_TIMEOUT_MS = 5000;

// Audio Hardware Constraints
export const MICROPHONE_SAMPLE_RATE = 48000;
export const LATENCY_HINT = 'interactive';
export const DEFAULT_RECEIVER_BUFFER_MS = 15;

// Alarm and Unlock Sound Parameters
export const ALARM_INTERVAL_MS = 1200;
export const ALARM_PITCH_HZ = 880; // A5 Note
export const ALARM_BEEP_DURATION_SEC = 0.5;

export const UNLOCK_NOTE_1_HZ = 523.25; // C5 Note
export const UNLOCK_NOTE_2_HZ = 659.25; // E5 Note

// Visualizer Configuration
export const FFT_SIZE = 256;
export const GLOW_VOLUME_THRESHOLD = 30;

// Noise reduction
export const LS_NOISE_REDUCTION = 'bms_noiseReduction';
export const LS_NOISE_FLOOR = 'bms_noiseFloor';
export const CALIBRATION_DURATION_MS = 3000;
export const CALIBRATION_SAMPLE_INTERVAL_MS = 100;
export const MIN_NOISE_FLOOR_DB = -100;
export const MAX_NOISE_FLOOR_DB = -6;
