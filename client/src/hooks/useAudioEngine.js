import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LS_INPUT_GAIN,
  LS_OUTPUT_VOLUME,
  LS_NOISE_REDUCTION,
  LS_NOISE_FLOOR,
  CHANNEL_MONO,
  CHANNEL_STEREO,
  GAIN_MIN,
  GAIN_MAX,
  MICROPHONE_SAMPLE_RATE,
  LATENCY_HINT,
  CALIBRATION_DURATION_MS,
  CALIBRATION_SAMPLE_INTERVAL_MS,
  MIN_NOISE_FLOOR_DB,
  MAX_NOISE_FLOOR_DB,
  ALARM_INTERVAL_MS,
  ROLE_SENDER,
  ROLE_RECEIVER,
  CHANNEL_MODE_STEREO,
  PROFILE_RAW,
  PROFILE_FAN,
  PROFILE_CALL,
} from '../constants';
import { getAudioSetupError } from '../utils/getAudioSetupError';
import { createAudioKeepalive } from '../utils/audioKeepalive';
import { playAlarmBeep, playUnlockBeep } from '../utils/audioCues';
import { startVisualizerLoop } from '../utils/visualizerEngine';
import { connectProfileInput, createPeakLimiter } from '../utils/audioProfileGraph';
import { PCM_MAGIC, HEADER_BYTE_LENGTH } from '../utils/protocol';
import { readClampedNumber, readStoredBoolean, writeStoredValue } from '../utils/storage';

export function useAudioEngine({
  role,
  channelMode,
  audioProfile,
  addLog,
  setStatus,
  socketRef,
  roomId,
  jitterBufferMs,
  selectedDeviceId,
  onMicStarted,
}) {
  const [inputGain, setInputGain] = useState(() => readClampedNumber(LS_INPUT_GAIN, 1.0, GAIN_MIN, GAIN_MAX));
  const [outputVolume, setOutputVolume] = useState(() => readClampedNumber(LS_OUTPUT_VOLUME, 1.0, GAIN_MIN, GAIN_MAX));
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [underruns, setUnderruns] = useState(0);
  const [isAudioLocked, setIsAudioLocked] = useState(false);
  const [isSignalLost, setIsSignalLost] = useState(false);
  const [micSettings, setMicSettings] = useState(null);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [noiseFloorDb, setNoiseFloorDb] = useState(() => {
    const value = readClampedNumber(LS_NOISE_FLOOR, NaN, MIN_NOISE_FLOOR_DB, MAX_NOISE_FLOOR_DB);
    return Number.isNaN(value) ? null : value;
  });
  const [noiseReductionActive, setNoiseReductionActive] = useState(() => readStoredBoolean(LS_NOISE_REDUCTION, false));

  const canvasDimsRef = useRef({ width: 0, height: 0 });
  const localStreamRef = useRef(null);
  const noiseAnalysisAnalyserRef = useRef(null);
  const calibrationSamplesRef = useRef([]);
  const calibrationTimerRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const processorRef = useRef(null);
  const receiverPlaybackNodeRef = useRef(null);
  const animationRef = useRef(null);
  const senderGainNodeRef = useRef(null);
  const receiverGainNodeRef = useRef(null);
  const destRef = useRef(null);
  const wakeLockRef = useRef(null);
  const lastChunkTimeRef = useRef(0);
  const hasConnectedOnceRef = useRef(false);
  const hasSentFirstChunkRef = useRef(false);
  const telemetryRef = useRef({ peakDb: -100, rmsDb: -100, clippedSamples: 0 });
  const [keepalive] = useState(() => createAudioKeepalive());

  // Visualizer DOM element refs for high-performance direct rendering
  const canvasRef = useRef(null);
  const orbRef = useRef(null);
  const iconRef = useRef(null);
  const vuBarRef = useRef(null);
  const vuLabelRef = useRef(null);

  const startVisualizer = (activeRole) => startVisualizerLoop({
    analyserRef,
    canvasRef,
    orbRef,
    iconRef,
    vuBarRef,
    vuLabelRef,
    telemetryRef,
    animationRef,
    canvasDimsRef,
    activeRole,
  });

  // Persist settings
  useEffect(() => { writeStoredValue(LS_INPUT_GAIN, inputGain); }, [inputGain]);
  useEffect(() => { writeStoredValue(LS_OUTPUT_VOLUME, outputVolume); }, [outputVolume]);
  useEffect(() => { writeStoredValue(LS_NOISE_REDUCTION, noiseReductionActive); }, [noiseReductionActive]);
  useEffect(() => { if (noiseFloorDb !== null) writeStoredValue(LS_NOISE_FLOOR, noiseFloorDb); }, [noiseFloorDb]);

  useEffect(() => {
    if (!processorRef.current) return;
    const hasNoiseFloor = noiseFloorDb !== null && Number.isFinite(noiseFloorDb);
    processorRef.current.port.postMessage({
      type: 'configure-noise-reduction',
      enabled: audioProfile === PROFILE_FAN && noiseReductionActive && hasNoiseFloor,
      noiseFloorRms: hasNoiseFloor ? Math.pow(10, noiseFloorDb / 20) : null,
    });
  }, [audioProfile, noiseFloorDb, noiseReductionActive]);

  // Update sender gain dynamically
  useEffect(() => {
    if (senderGainNodeRef.current && audioContextRef.current) {
      senderGainNodeRef.current.gain.setTargetAtTime(
        inputGain,
        audioContextRef.current.currentTime,
        0.01
      );
    }
  }, [inputGain]);

  // Update receiver volume dynamically
  useEffect(() => {
    if (receiverGainNodeRef.current && audioContextRef.current) {
      receiverGainNodeRef.current.gain.setTargetAtTime(
        outputVolume,
        audioContextRef.current.currentTime,
        0.01
      );
    }
  }, [outputVolume]);

  // Send jitter buffer changes to the worklet live (no restart needed)
  useEffect(() => {
    if (role !== 'receiver' || !receiverPlaybackNodeRef.current) return;
    receiverPlaybackNodeRef.current.port.postMessage({
      type: 'set-target-buffer',
      targetBufferMs: jitterBufferMs,
    });
  }, [jitterBufferMs, role]);

  // Alarm sound effect when signal is lost
  useEffect(() => {
    if (!isSignalLost || role !== ROLE_RECEIVER) return;
    playAlarmBeep(audioContextRef.current);
    const alarmInterval = setInterval(() => playAlarmBeep(audioContextRef.current), ALARM_INTERVAL_MS);
    return () => clearInterval(alarmInterval);
  }, [isSignalLost, role]);

  const releaseWakeLock = useCallback(async () => {
    if (!wakeLockRef.current) return;
    try {
      await wakeLockRef.current.release();
      addLog('💡 Wake Lock released.');
    } catch (err) {
      console.error(err);
    } finally {
      wakeLockRef.current = null;
    }
  }, [addLog]);

  const requestWakeLock = useCallback(async () => {
    if (wakeLockRef.current) return;
    if (!('wakeLock' in navigator)) {
      addLog('⚠️ Wake Lock API not supported on this browser.');
      return;
    }
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      addLog('💡 Wake Lock active! Screen will stay awake.');
    } catch (err) {
      addLog(`⚠️ Wake Lock failed: ${err.message}`);
    }
  }, [addLog]);

  // Reacquire the wake lock when the sender becomes visible again.
  useEffect(() => {
    const handleVisibility = async () => {
      if (role !== ROLE_SENDER || document.visibilityState !== 'visible') return;
      if (wakeLockRef.current) return;
      await requestWakeLock();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [role, requestWakeLock]);

  const resumeAudioContext = async () => {
    if (!audioContextRef.current) return;
    if (audioContextRef.current.state !== 'suspended') return;
    await audioContextRef.current.resume();
  };

  const startSender = async () => {
    setStatus('Requesting microphone access...');
    addLog(`🎙️ Requesting Mic access... (Room: ${roomId})`);
    try {
      await requestWakeLock();
      const wantsNs = audioProfile === PROFILE_CALL;
      const wantsEc = audioProfile === PROFILE_CALL;
      const audioConstraints = {
        echoCancellation: wantsEc,
        autoGainControl: false,
        noiseSuppression: wantsNs,
        latency: 0,
        sampleRate: MICROPHONE_SAMPLE_RATE,
        channelCount: channelMode === CHANNEL_MODE_STEREO ? CHANNEL_STEREO : CHANNEL_MONO,
        advanced: [{
          echoCancellation: wantsEc,
          autoGainControl: false,
          noiseSuppression: wantsNs,
          latency: 0,
        }],
      };
      if (selectedDeviceId) {
        audioConstraints.deviceId = { exact: selectedDeviceId };
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      localStreamRef.current = stream;

      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings();
      setMicSettings({
        sampleRate: settings.sampleRate,
        channelCount: settings.channelCount,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
        deviceId: settings.deviceId,
        label: track.label
      });

      setStatus('Microphone active. Processing audio...');
      addLog(`✅ Mic active! Mode: ${channelMode.toUpperCase()} | Initializing Web Audio...`);

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      await resumeAudioContext();
      keepalive.start(audioContextRef.current);
      if (typeof onMicStarted === 'function') {
        onMicStarted();
      }
      addLog('📡 Loading audio worklet module...');
      await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
      addLog('✅ Audio worklet module loaded!');

      const source = audioContextRef.current.createMediaStreamSource(stream);
      
      senderGainNodeRef.current = audioContextRef.current.createGain();
      senderGainNodeRef.current.gain.setValueAtTime(inputGain, audioContextRef.current.currentTime);
      analyserRef.current = audioContextRef.current.createAnalyser();

      const workletNode = new AudioWorkletNode(audioContextRef.current, 'audio-processor', {
        channelCount: channelMode === CHANNEL_MODE_STEREO ? CHANNEL_STEREO : CHANNEL_MONO,
        channelCountMode: 'explicit',
        processorOptions: {
          isStereo: channelMode === CHANNEL_MODE_STEREO,
          noiseReductionEnabled: audioProfile === PROFILE_FAN && noiseReductionActive && noiseFloorDb !== null,
          noiseFloorRms: noiseFloorDb === null ? null : Math.pow(10, noiseFloorDb / 20),
        }
      });
      processorRef.current = workletNode;

      connectProfileInput({
        audioContext: audioContextRef.current,
        source,
        gainNode: senderGainNodeRef.current,
        audioProfile,
      });

      // Keep RAW untouched for external processing; other profiles get peak protection.
      const limiter = createPeakLimiter(audioContextRef.current);
      noiseAnalysisAnalyserRef.current = audioContextRef.current.createAnalyser();
      noiseAnalysisAnalyserRef.current.fftSize = 256;

      senderGainNodeRef.current.connect(noiseAnalysisAnalyserRef.current);
      const outputNode = audioProfile === PROFILE_RAW ? senderGainNodeRef.current : limiter;
      if (audioProfile !== PROFILE_RAW) senderGainNodeRef.current.connect(limiter);
      outputNode.connect(analyserRef.current);
      outputNode.connect(workletNode);
      workletNode.connect(audioContextRef.current.destination);

      workletNode.port.onmessage = (e) => {
        const payload = e.data;
        const processedBuffer = payload.buffer || payload;

        if (payload.peakDb !== undefined) {
          telemetryRef.current = {
            peakDb: payload.peakDb,
            rmsDb: payload.rmsDb,
            clippedSamples: payload.clippedSamples
          };
        }

        if (!socketRef.current || !socketRef.current.connected) {
          // Recycle the buffer even if socket is disconnected
          workletNode.port.postMessage(processedBuffer, [processedBuffer]);
          return;
        }

        // Pack into raw binary: [uint16: magic][uint32: sampleRate][uint8: channelCount][PCM data]
        const sampleRateVal = audioContextRef.current.sampleRate;
        const channelCountVal = channelMode === CHANNEL_MODE_STEREO ? CHANNEL_STEREO : CHANNEL_MONO;

        const packedBuffer = new ArrayBuffer(HEADER_BYTE_LENGTH + processedBuffer.byteLength);
        const headerView = new DataView(packedBuffer, 0, HEADER_BYTE_LENGTH);
        headerView.setUint16(0, PCM_MAGIC, true);
        headerView.setUint32(2, sampleRateVal, true);
        headerView.setUint8(6, channelCountVal);

        const pcmDestView = new Uint8Array(packedBuffer, HEADER_BYTE_LENGTH);
        pcmDestView.set(new Uint8Array(processedBuffer));

        socketRef.current.emit('pcm-chunk', packedBuffer, roomId);
        if (!hasSentFirstChunkRef.current) {
          hasSentFirstChunkRef.current = true;
          addLog('📦 First PCM packet sent to receiver.');
        }
        
        // Recycle the buffer back to the worklet pool (zero allocations!)
        workletNode.port.postMessage(processedBuffer, [processedBuffer]);
      };

      startVisualizer(ROLE_SENDER);
      setStatus('Broadcasting uncompressed audio! 🔴');
      addLog('🚀 Native Int16 audio stream active over TCP socket!');
      return { ok: true };
    } catch (e) {
      const message = getAudioSetupError(e);
      cleanupAudio();
      addLog(`❌ Mic Error: ${message}`);
      setStatus(message);
      return { ok: false, message };
    }
  };

  const startReceiver = async () => {
    setStatus('Waiting for audio stream...');
    addLog(`🎧 Receiver initialized. Waiting for stream in Room: ${roomId}`);
    try {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: LATENCY_HINT });
      await audioContextRef.current.audioWorklet.addModule('/receiver-playback-processor.js');

      analyserRef.current = audioContextRef.current.createAnalyser();
      receiverPlaybackNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'receiver-playback-processor', {
        outputChannelCount: [CHANNEL_STEREO],
        processorOptions: {
          targetBufferMs: jitterBufferMs,
        },
      });

      receiverPlaybackNodeRef.current.port.onmessage = (event) => {
        if (event.data?.type !== 'underrun') return;
        if (!Number.isInteger(event.data.count)) return;
        setUnderruns(event.data.count);
      };

      receiverPlaybackNodeRef.current.connect(analyserRef.current);

      destRef.current = audioContextRef.current.createMediaStreamDestination();
      analyserRef.current.connect(destRef.current);

      receiverGainNodeRef.current = audioContextRef.current.createGain();
      receiverGainNodeRef.current.gain.value = outputVolume;
      analyserRef.current.connect(receiverGainNodeRef.current);

      if (isMonitoring) {
        receiverGainNodeRef.current.connect(audioContextRef.current.destination);
      }

      if (audioContextRef.current.state === 'suspended') {
        setIsAudioLocked(true);
      }

      startVisualizer(ROLE_RECEIVER);
      return { ok: true };
    } catch (e) {
      const message = 'Receiver audio could not start. Reload the page or try another browser.';
      cleanupAudio();
      addLog(`❌ Receiver audio failed: ${e.message}`);
      setStatus(message);
      return { ok: false, message };
    }
  };

  const cleanupAudio = () => {
    releaseWakeLock();
    keepalive.stop();
    if (calibrationTimerRef.current) {
      clearInterval(calibrationTimerRef.current);
      calibrationTimerRef.current = null;
    }
    setIsCalibrating(false);
    noiseAnalysisAnalyserRef.current = null;
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (receiverPlaybackNodeRef.current) {
      receiverPlaybackNodeRef.current.port.postMessage({ type: 'reset' });
      receiverPlaybackNodeRef.current.disconnect();
      receiverPlaybackNodeRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    hasSentFirstChunkRef.current = false;
    setMicSettings(null);
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  const unlockAudio = () => {
    if (audioContextRef.current) {
      audioContextRef.current.resume().then(() => {
        setIsAudioLocked(false);
        playUnlockBeep(audioContextRef.current);
        addLog('🔊 Audio Context unlocked successfully!');
      }).catch(err => {
        addLog(`❌ Audio unlock failed: ${err.message}`);
      });
    }
  };

  const startNoiseCalibration = useCallback(() => {
    if (!noiseAnalysisAnalyserRef.current || !audioContextRef.current) {
      addLog('⚠️ Start the microphone before calibrating fan noise.');
      return;
    }
    if (calibrationTimerRef.current) clearInterval(calibrationTimerRef.current);
    setIsCalibrating(true);
    calibrationSamplesRef.current = [];
    addLog('🔇 Calibrating fan noise... Stay silent for 3 seconds.');
    const sampleCount = Math.floor(CALIBRATION_DURATION_MS / CALIBRATION_SAMPLE_INTERVAL_MS);
    const timer = setInterval(() => {
      const timeData = new Float32Array(noiseAnalysisAnalyserRef.current.fftSize);
      noiseAnalysisAnalyserRef.current.getFloatTimeDomainData(timeData);
      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) {
        sumSq += timeData[i] * timeData[i];
      }
      calibrationSamplesRef.current.push(Math.sqrt(sumSq / timeData.length));
      if (calibrationSamplesRef.current.length >= sampleCount) {
        clearInterval(timer);
        const sorted = [...calibrationSamplesRef.current].sort((a, b) => a - b);
        const noiseRms = sorted[Math.floor(sorted.length * 0.5)];
        const noiseDb = 20 * Math.log10(Math.max(noiseRms, 1e-8));
        const safeNoiseDb = Math.max(MIN_NOISE_FLOOR_DB, Math.min(MAX_NOISE_FLOOR_DB, noiseDb));
        setNoiseFloorDb(Math.round(safeNoiseDb * 10) / 10);
        setIsCalibrating(false);
        setNoiseReductionActive(true);
        calibrationTimerRef.current = null;
        addLog(`✅ Noise floor calibrated: ${noiseDb.toFixed(1)} dBFS`);
      }
    }, CALIBRATION_SAMPLE_INTERVAL_MS);
    calibrationTimerRef.current = timer;
  }, [addLog]);

  const toggleNoiseReduction = () => {
    const next = !noiseReductionActive;
    setNoiseReductionActive(next);
    addLog(next ? '🎛️ Smooth fan reduction activated' : '🎛️ Fan reduction deactivated');
  };

  const setManualNoiseFloor = useCallback((dbValue) => {
    const safeDbValue = Math.max(MIN_NOISE_FLOOR_DB, Math.min(MAX_NOISE_FLOOR_DB, dbValue));
    setNoiseFloorDb(Math.round(safeDbValue * 10) / 10);
    addLog(`🎛️ Noise floor manually set to ${safeDbValue.toFixed(1)} dBFS`);
  }, [addLog]);

  const toggleMonitoring = () => {
    if (!audioContextRef.current || !analyserRef.current) return;
    if (isMonitoring) {
      if (receiverGainNodeRef.current) {
        receiverGainNodeRef.current.disconnect(audioContextRef.current.destination);
      }
      addLog('🔇 PC Speakers Muted (Mic is still being recorded)');
      setIsMonitoring(false);
    } else {
      const confirmFeedback = window.confirm(
        "⚠️ WARNING: Playing live audio on your PC speakers can create a loud, screeching feedback loop if your microphone (phone) is nearby.\n\nPlease ensure you are using HEADPHONES on your PC before enabling this.\n\nDo you want to enable feedback anyway?"
      );
      if (!confirmFeedback) return;
      if (receiverGainNodeRef.current) {
        receiverGainNodeRef.current.connect(audioContextRef.current.destination);
      }
      addLog('🔊 PC Speakers Unmuted (You will hear yourself)');
      setIsMonitoring(true);
    }
  };

  return {
    inputGain,
    setInputGain,
    outputVolume,
    setOutputVolume,
    isMonitoring,
    setIsMonitoring,
    underruns,
    setUnderruns,
    isAudioLocked,
    setIsAudioLocked,
    isSignalLost,
    setIsSignalLost,
    micSettings,
    isCalibrating,
    noiseFloorDb,
    noiseReductionActive,
    destRef,
    lastChunkTimeRef,
    hasConnectedOnceRef,
    canvasRef,
    orbRef,
    iconRef,
    vuBarRef,
    vuLabelRef,
    senderGainNodeRef,
    receiverPlaybackNodeRef,
    startSender,
    startReceiver,
    cleanupAudio,
    unlockAudio,
    toggleMonitoring,
    startNoiseCalibration,
    toggleNoiseReduction,
    setManualNoiseFloor,
  };
}
