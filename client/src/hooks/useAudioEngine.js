import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LS_INPUT_GAIN,
  LS_OUTPUT_VOLUME,
  LS_NOISE_REDUCTION,
  LS_NOISE_FLOOR,
  CHANNEL_MONO,
  CHANNEL_STEREO,
  MICROPHONE_SAMPLE_RATE,
  LATENCY_HINT,
  CALIBRATION_DURATION_MS,
  CALIBRATION_SAMPLE_INTERVAL_MS,
  MIN_NOISE_FLOOR_DB,
  MAX_NOISE_FLOOR_DB,
  ALARM_INTERVAL_MS,
  ALARM_PITCH_HZ,
  ALARM_BEEP_DURATION_SEC,
  UNLOCK_NOTE_1_HZ,
  UNLOCK_NOTE_2_HZ,
  FFT_SIZE,
  GLOW_VOLUME_THRESHOLD,
  VISUALIZER_FPS,
  ROLE_SENDER,
  ROLE_RECEIVER,
  CHANNEL_MODE_STEREO,
  PROFILE_RAW,
  PROFILE_CLEAN,
  PROFILE_FAN,
  PROFILE_CALL,
} from '../constants';
import { getAudioSetupError } from '../utils/getAudioSetupError';

const MILLISECONDS_PER_SECOND = 1000;
const VISUALIZER_FRAME_INTERVAL_MS = MILLISECONDS_PER_SECOND / VISUALIZER_FPS;
const VISUALIZER_DB_FLOOR = -36;
const VISUALIZER_ORB_BASE_SCALE = 1;
const VISUALIZER_ORB_SCALE_RANGE = 1.3;
const VISUALIZER_ORB_BASE_OPACITY = 0.3;
const VISUALIZER_ORB_OPACITY_RANGE = 0.5;
const VISUALIZER_CANVAS_ACTIVE_THRESHOLD = 5;
const VISUALIZER_BAR_GAP_PX = 2;
const VISUALIZER_CLIP_COLOR = '#ff4d4d';
const VISUALIZER_IDLE_COLOR = '#fff';
const VISUALIZER_SENDER_COLOR = '#00f58c';
const VISUALIZER_RECEIVER_COLOR = '#00d2ff';

export function useAudioEngine({ role, channelMode, audioProfile, addLog, setStatus, socketRef, roomId, jitterBufferMs }) {
  const MAX_INPUT_GAIN = 2.0;
  const [inputGain, setInputGain] = useState(() => {
    const stored = parseFloat(localStorage.getItem(LS_INPUT_GAIN) || '1.0');
    return Number.isFinite(stored) ? Math.min(stored, MAX_INPUT_GAIN) : 1.0;
  });
  const [outputVolume, setOutputVolume] = useState(() => {
    const stored = parseFloat(localStorage.getItem(LS_OUTPUT_VOLUME) || '1.0');
    return Number.isFinite(stored) ? stored : 1.0;
  });
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [underruns, setUnderruns] = useState(0);
  const [isAudioLocked, setIsAudioLocked] = useState(false);
  const [isSignalLost, setIsSignalLost] = useState(false);
  const [micSettings, setMicSettings] = useState(null);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [noiseFloorDb, setNoiseFloorDb] = useState(() => {
    const stored = localStorage.getItem(LS_NOISE_FLOOR);
    const parsed = stored ? parseFloat(stored) : null;
    if (!Number.isFinite(parsed)) return null;
    return Math.max(MIN_NOISE_FLOOR_DB, Math.min(MAX_NOISE_FLOOR_DB, parsed));
  });
  const [noiseReductionActive, setNoiseReductionActive] = useState(() => {
    return localStorage.getItem(LS_NOISE_REDUCTION) === 'true';
  });

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

  // Visualizer DOM element refs for high-performance direct rendering
  const canvasRef = useRef(null);
  const orbRef = useRef(null);
  const iconRef = useRef(null);
  const vuBarRef = useRef(null);
  const vuLabelRef = useRef(null);

  // Persist settings
  useEffect(() => { localStorage.setItem(LS_INPUT_GAIN, inputGain); }, [inputGain]);
  useEffect(() => { localStorage.setItem(LS_OUTPUT_VOLUME, outputVolume); }, [outputVolume]);
  useEffect(() => { localStorage.setItem(LS_NOISE_REDUCTION, noiseReductionActive); }, [noiseReductionActive]);
  useEffect(() => { if (noiseFloorDb !== null) localStorage.setItem(LS_NOISE_FLOOR, noiseFloorDb); }, [noiseFloorDb]);

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
    playAlarmBeep();
    const alarmInterval = setInterval(playAlarmBeep, ALARM_INTERVAL_MS);
    return () => clearInterval(alarmInterval);
  }, [isSignalLost, role]);

  const releaseWakeLock = useCallback(async () => {
    if (!wakeLockRef.current) return;
    try {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      addLog('💡 Wake Lock released.');
    } catch (err) {
      console.error(err);
    }
  }, [addLog]);

  const requestWakeLock = useCallback(async () => {
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

  const playAlarmBeep = () => {
    if (!audioContextRef.current) return;
    try {
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(ALARM_PITCH_HZ, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ALARM_BEEP_DURATION_SEC - 0.1));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + ALARM_BEEP_DURATION_SEC);
    } catch (e) {
      console.error('Failed to play alarm beep:', e);
    }
  };

  const playUnlockBeep = () => {
    if (!audioContextRef.current) return;
    try {
      const ctx = audioContextRef.current;
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.frequency.setValueAtTime(UNLOCK_NOTE_1_HZ, ctx.currentTime);
      gain1.gain.setValueAtTime(0.08, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.2);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.frequency.setValueAtTime(UNLOCK_NOTE_2_HZ, ctx.currentTime + 0.1);
      gain2.gain.setValueAtTime(0.08, ctx.currentTime + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.error('Failed to play unlock beep:', e);
    }
  };

  const resumeAudioContext = async () => {
    if (!audioContextRef.current) return;
    if (audioContextRef.current.state !== 'suspended') return;
    await audioContextRef.current.resume();
  };

  const startVisualizerLoop = (activeRole = role) => {
    if (!analyserRef.current) return;
    analyserRef.current.fftSize = FFT_SIZE;
    analyserRef.current.smoothingTimeConstant = 0.8;
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const canvas = canvasRef.current;
    const canvasContext = canvas?.getContext('2d');
    const activeColor = activeRole === ROLE_SENDER
      ? VISUALIZER_SENDER_COLOR
      : VISUALIZER_RECEIVER_COLOR;
    const visualState = {
      iconColor: null,
      barColor: null,
      label: null,
      labelColor: null,
      canvasOpacity: null,
    };
    let lastFrameTime = -VISUALIZER_FRAME_INTERVAL_MS;

    const updateVisualizer = (frameTime) => {
      if (!analyserRef.current) return;
      animationRef.current = requestAnimationFrame(updateVisualizer);
      if (document.visibilityState !== 'visible') return;
      if (frameTime - lastFrameTime < VISUALIZER_FRAME_INTERVAL_MS) return;
      lastFrameTime = frameTime;

      analyserRef.current.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;

      // Direct DOM manipulation of the UI elements for high performance
      if (activeRole === ROLE_SENDER && telemetryRef.current.peakDb !== -100) {
        const t = telemetryRef.current;
        const peakPct = Math.max(
          0,
          Math.min(100, ((t.peakDb - VISUALIZER_DB_FLOOR) / -VISUALIZER_DB_FLOOR) * 100),
        );
        const normalizedPeak = peakPct / 100;
        const isClipped = t.clippedSamples > 0;
        const levelColor = isClipped ? VISUALIZER_CLIP_COLOR : activeColor;
        
        if (orbRef.current) {
          orbRef.current.style.transform = `scale(${VISUALIZER_ORB_BASE_SCALE + (normalizedPeak * VISUALIZER_ORB_SCALE_RANGE)})`;
          orbRef.current.style.opacity = `${VISUALIZER_ORB_BASE_OPACITY + (normalizedPeak * VISUALIZER_ORB_OPACITY_RANGE)}`;
        }
        if (iconRef.current) {
          if (visualState.iconColor !== levelColor) {
            iconRef.current.style.color = levelColor;
            visualState.iconColor = levelColor;
          }
        }
        if (vuBarRef.current) {
          vuBarRef.current.style.transform = `scaleX(${normalizedPeak})`;
          if (visualState.barColor !== levelColor) {
            vuBarRef.current.style.backgroundColor = levelColor;
            visualState.barColor = levelColor;
          }
        }
        if (vuLabelRef.current) {
          const label = `${t.peakDb.toFixed(1)} dB`;
          if (visualState.label !== label) {
            vuLabelRef.current.textContent = label;
            visualState.label = label;
          }
          const labelColor = isClipped ? VISUALIZER_CLIP_COLOR : VISUALIZER_IDLE_COLOR;
          if (visualState.labelColor !== labelColor) {
            vuLabelRef.current.style.color = labelColor;
            visualState.labelColor = labelColor;
          }
        }
      } else {
        const volumePct = Math.round((average / 255) * 100);
        const normalizedVolume = volumePct / 100;
        const iconColor = average > GLOW_VOLUME_THRESHOLD
          ? activeColor
          : VISUALIZER_IDLE_COLOR;
        
        if (orbRef.current) {
          orbRef.current.style.transform = `scale(${VISUALIZER_ORB_BASE_SCALE + (normalizedVolume * VISUALIZER_ORB_SCALE_RANGE)})`;
          orbRef.current.style.opacity = `${VISUALIZER_ORB_BASE_OPACITY + (normalizedVolume * VISUALIZER_ORB_OPACITY_RANGE)}`;
        }
        if (iconRef.current) {
          if (visualState.iconColor !== iconColor) {
            iconRef.current.style.color = iconColor;
            visualState.iconColor = iconColor;
          }
        }
        if (vuBarRef.current) {
          vuBarRef.current.style.transform = `scaleX(${normalizedVolume})`;
          if (visualState.barColor !== activeColor) {
            vuBarRef.current.style.backgroundColor = activeColor;
            visualState.barColor = activeColor;
          }
        }
        if (vuLabelRef.current) {
          const label = `${volumePct}%`;
          if (visualState.label !== label) {
            vuLabelRef.current.textContent = label;
            visualState.label = label;
          }
          if (visualState.labelColor !== VISUALIZER_IDLE_COLOR) {
            vuLabelRef.current.style.color = VISUALIZER_IDLE_COLOR;
            visualState.labelColor = VISUALIZER_IDLE_COLOR;
          }
        }
      }

      // Draw real-time frequency visualizer on canvas
      if (canvas && canvasContext) {
        if (canvasDimsRef.current.width === 0) {
          canvasDimsRef.current.width = canvas.width;
          canvasDimsRef.current.height = canvas.height;
        }
        const { width, height } = canvasDimsRef.current;
        canvasContext.clearRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 1.6;
        const drawableBarWidth = Math.max(1, barWidth - VISUALIZER_BAR_GAP_PX);
        let x = 0;

        canvasContext.beginPath();
        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * height;
          canvasContext.rect(x, height - barHeight, drawableBarWidth, barHeight);
          x += barWidth;
        }
        canvasContext.fillStyle = activeColor;
        canvasContext.fill();

        const canvasOpacity = average > VISUALIZER_CANVAS_ACTIVE_THRESHOLD ? '1' : '0.2';
        if (visualState.canvasOpacity !== canvasOpacity) {
          canvas.style.opacity = canvasOpacity;
          visualState.canvasOpacity = canvasOpacity;
        }
      }
    };
    animationRef.current = requestAnimationFrame(updateVisualizer);
  };

  const startSender = async () => {
    setStatus('Requesting microphone access...');
    addLog(`🎙️ Requesting Mic access... (Room: ${roomId})`);
    try {
      await requestWakeLock();
      const wantsNs = audioProfile === PROFILE_CALL;
      const wantsEc = audioProfile === PROFILE_CALL;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
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
          }]
        }
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

      const connectProfileInput = () => {
        if (audioProfile === PROFILE_CLEAN) {
          const highPass = audioContextRef.current.createBiquadFilter();
          highPass.type = 'highpass';
          highPass.frequency.value = 80;
          highPass.Q.value = 0.7;

          const compressor = audioContextRef.current.createDynamicsCompressor();
          compressor.threshold.value = -18;
          compressor.knee.value = 8;
          compressor.ratio.value = 3;
          compressor.attack.value = 0.005;
          compressor.release.value = 0.18;

          source.connect(highPass);
          highPass.connect(compressor);
          compressor.connect(senderGainNodeRef.current);
          return;
        }
        if (audioProfile === PROFILE_FAN) {
          const highPass = audioContextRef.current.createBiquadFilter();
          highPass.type = 'highpass';
          highPass.frequency.value = 80;
          highPass.Q.value = 0.7;

          source.connect(highPass);
          highPass.connect(senderGainNodeRef.current);
          return;
        }
        source.connect(senderGainNodeRef.current);
      };
      connectProfileInput();
      
      // Keep RAW untouched for external processing; other profiles get peak protection.
      const limiter = audioContextRef.current.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.08;
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
        const HEADER_BYTE_LENGTH = 7;
        const PCM_MAGIC = 0xBC4D;

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

      startVisualizerLoop(ROLE_SENDER);
      setStatus('Broadcasting lossless audio! 🔴');
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
      await audioContextRef.current.audioWorklet.addModule(`/receiver-playback-processor.js?t=${Date.now()}`);

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

      startVisualizerLoop(ROLE_RECEIVER);
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
        playUnlockBeep();
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
