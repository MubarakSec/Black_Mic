import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LS_INPUT_GAIN,
  LS_OUTPUT_VOLUME,
  LS_NOISE_REDUCTION,
  CHANNEL_MONO,
  CHANNEL_STEREO,
  MICROPHONE_SAMPLE_RATE,
  LATENCY_HINT,
  CALIBRATION_DURATION_MS,
  CALIBRATION_SAMPLE_INTERVAL_MS,
  NOISE_GATE_RATIO_ATTACK,
  NOISE_GATE_MAX_ATTENUATION,
  ALARM_INTERVAL_MS,
  ALARM_PITCH_HZ,
  ALARM_BEEP_DURATION_SEC,
  UNLOCK_NOTE_1_HZ,
  UNLOCK_NOTE_2_HZ,
  FFT_SIZE,
  ROLE_SENDER,
  ROLE_RECEIVER,
  CHANNEL_MODE_MONO,
  CHANNEL_MODE_STEREO,
  PROFILE_CLEAN,
  PROFILE_FAN,
  PROFILE_CALL,
} from '../constants';

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
  const [noiseFloorDb, setNoiseFloorDb] = useState(null);
  const [noiseReductionActive, setNoiseReductionActive] = useState(() => {
    return localStorage.getItem(LS_NOISE_REDUCTION) === 'true';
  });

  const canvasDimsRef = useRef({ width: 0, height: 0 });
  const localStreamRef = useRef(null);
  const noiseAnalysisAnalyserRef = useRef(null);
  const noiseGateGainRef = useRef(null);
  const noiseFloorRef = useRef(null);
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

  const requestWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        addLog('💡 Wake Lock active! Screen will stay awake.');
      } catch (err) {
        addLog(`⚠️ Wake Lock failed: ${err.message}`);
      }
    } else {
      addLog('⚠️ Wake Lock API not supported on this browser.');
    }
  }, [addLog]);

  // Visibility change to request/release wake lock
  useEffect(() => {
    const handleVisibility = async () => {
      if (role === ROLE_SENDER && document.visibilityState === 'visible' && !wakeLockRef.current) {
        await requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [role, requestWakeLock]);

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        addLog('💡 Wake Lock released.');
      } catch (err) {
        console.error(err);
      }
    }
  };

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

  const startVisualizerLoop = () => {
    if (!analyserRef.current) return;
    analyserRef.current.fftSize = FFT_SIZE;
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateVisualizer = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;

      // Adaptive noise gate: compare current RMS to calibrated noise floor
      if (noiseFloorRef.current && noiseReductionActive && role === ROLE_SENDER && noiseAnalysisAnalyserRef.current) {
        const timeData = new Uint8Array(noiseAnalysisAnalyserRef.current.fftSize);
        noiseAnalysisAnalyserRef.current.getByteTimeDomainData(timeData);
        let sumSq = 0;
        for (let i = 0; i < timeData.length; i++) {
          const norm = (timeData[i] - 128) / 128;
          sumSq += norm * norm;
        }
        const currentRMS = Math.sqrt(sumSq / timeData.length);
        const targetGain = computeNoiseGateGain(currentRMS, noiseFloorRef.current.rms);
        noiseGateGainRef.current.gain.setTargetAtTime(targetGain, audioContextRef.current.currentTime, 0.05);
      }

      // Direct DOM manipulation of the UI elements for high performance
      if (role === ROLE_SENDER && telemetryRef.current.peakDb !== -100) {
        const t = telemetryRef.current;
        const peakPct = Math.max(0, Math.min(100, (t.peakDb + 36) / 36 * 100));
        
        if (orbRef.current) {
          orbRef.current.style.transform = `scale(${1 + (peakPct / 100) * 1.3})`;
          orbRef.current.style.opacity = `${0.3 + (peakPct / 100) * 0.5}`;
        }
        if (iconRef.current) {
          iconRef.current.style.color = t.clippedSamples > 0 ? '#ff4d4d' : 'var(--accent-1)';
        }
        if (vuBarRef.current) {
          vuBarRef.current.style.width = `${peakPct}%`;
          vuBarRef.current.style.backgroundColor = t.clippedSamples > 0 ? '#ff4d4d' : 'var(--accent-1)';
        }
        if (vuLabelRef.current) {
          vuLabelRef.current.textContent = `${t.peakDb.toFixed(1)} dB`;
          vuLabelRef.current.style.color = t.clippedSamples > 0 ? '#ff4d4d' : '#fff';
        }
      } else {
        const volumePct = Math.round((average / 255) * 100);
        
        if (orbRef.current) {
          orbRef.current.style.transform = `scale(${1 + (average / 255) * 1.3})`;
          orbRef.current.style.opacity = `${0.3 + (average / 255) * 0.5}`;
        }
        if (iconRef.current) {
          iconRef.current.style.color = average > 30 ? (role === ROLE_SENDER ? 'var(--accent-1)' : 'var(--accent-2)') : '#fff';
        }
        if (vuBarRef.current) {
          vuBarRef.current.style.width = `${volumePct}%`;
          vuBarRef.current.style.backgroundColor = role === ROLE_SENDER ? 'var(--accent-1)' : 'var(--accent-2)';
        }
        if (vuLabelRef.current) {
          vuLabelRef.current.textContent = `${volumePct}%`;
          vuLabelRef.current.style.color = '#fff';
        }
      }

      // Draw real-time frequency visualizer on canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (canvasDimsRef.current.width === 0) {
          canvasDimsRef.current.width = canvas.width;
          canvasDimsRef.current.height = canvas.height;
        }
        const { width, height } = canvasDimsRef.current;
        ctx.clearRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 1.6;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          barHeight = (dataArray[i] / 255) * height;
          const activeColor = role === ROLE_SENDER ? '#00f58c' : '#00d2ff';
          ctx.fillStyle = activeColor;
          ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);
          x += barWidth;
        }

        canvas.style.opacity = average > 5 ? '1' : '0.2';
      }

      animationRef.current = requestAnimationFrame(updateVisualizer);
    };
    updateVisualizer();
  };

  const startSender = async () => {
    setStatus('Requesting microphone access...');
    addLog(`🎙️ Requesting Mic access... (Room: ${roomId})`);
    try {
      await requestWakeLock();
      const wantsNs = audioProfile === PROFILE_FAN || audioProfile === PROFILE_CALL;
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
          isStereo: channelMode === CHANNEL_MODE_STEREO
        }
      });
      processorRef.current = workletNode;

      if (audioProfile === PROFILE_CLEAN) {
        // Clean Voice DSP Chain
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
      } else {
        // Raw or Call mode
        source.connect(senderGainNodeRef.current);
      }
      
      // Noise gate gain node (inserted between sender gain and output)
      noiseGateGainRef.current = audioContextRef.current.createGain();
      noiseGateGainRef.current.gain.value = 1.0;
      noiseAnalysisAnalyserRef.current = audioContextRef.current.createAnalyser();
      noiseAnalysisAnalyserRef.current.fftSize = 256;

      senderGainNodeRef.current.connect(noiseAnalysisAnalyserRef.current);
      senderGainNodeRef.current.connect(noiseGateGainRef.current);
      noiseGateGainRef.current.connect(analyserRef.current);
      noiseGateGainRef.current.connect(workletNode);
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

      startVisualizerLoop();
      setStatus('Broadcasting lossless audio! 🔴');
      addLog('🚀 Native Int16 audio stream active over TCP socket!');
    } catch (e) {
      addLog(`❌ Mic Error: ${e.message}`);
      setStatus('Microphone access denied or unavailable.');
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

      startVisualizerLoop();
    } catch (e) {
      addLog(`❌ Receiver audio failed: ${e.message}`);
      setStatus('Receiver audio engine failed to start.');
    }
  };

  const cleanupAudio = () => {
    releaseWakeLock();
    if (calibrationTimerRef.current) {
      clearInterval(calibrationTimerRef.current);
      calibrationTimerRef.current = null;
    }
    noiseFloorRef.current = null;
    noiseGateGainRef.current = null;
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

  const computeNoiseGateGain = (currentRMS, floorRMS) => {
    const ratio = currentRMS / floorRMS;
    if (ratio <= 1) return NOISE_GATE_MAX_ATTENUATION;
    if (ratio >= NOISE_GATE_RATIO_ATTACK) return 1.0;
    const t = (ratio - 1) / (NOISE_GATE_RATIO_ATTACK - 1);
    return NOISE_GATE_MAX_ATTENUATION + t * (1.0 - NOISE_GATE_MAX_ATTENUATION);
  };

  const startNoiseCalibration = useCallback(() => {
    if (!noiseAnalysisAnalyserRef.current || !audioContextRef.current) return;
    setIsCalibrating(true);
    calibrationSamplesRef.current = [];
    addLog('🔇 Calibrating fan noise... Stay silent for 3 seconds.');
    const sampleCount = Math.floor(CALIBRATION_DURATION_MS / CALIBRATION_SAMPLE_INTERVAL_MS);
    const timer = setInterval(() => {
      const timeData = new Uint8Array(noiseAnalysisAnalyserRef.current.fftSize);
      noiseAnalysisAnalyserRef.current.getByteTimeDomainData(timeData);
      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) {
        const norm = (timeData[i] - 128) / 128;
        sumSq += norm * norm;
      }
      calibrationSamplesRef.current.push(Math.sqrt(sumSq / timeData.length));
      if (calibrationSamplesRef.current.length >= sampleCount) {
        clearInterval(timer);
        const sorted = [...calibrationSamplesRef.current].sort((a, b) => a - b);
        const noiseRms = sorted[Math.floor(sorted.length * 0.3)];
        noiseFloorRef.current = { rms: noiseRms };
        const noiseDb = 20 * Math.log10(Math.max(noiseRms, 1e-8));
        setNoiseFloorDb(Math.round(noiseDb * 10) / 10);
        setIsCalibrating(false);
        setNoiseReductionActive(true);
        addLog(`✅ Noise floor calibrated: ${noiseDb.toFixed(1)} dBFS`);
      }
    }, CALIBRATION_SAMPLE_INTERVAL_MS);
    calibrationTimerRef.current = timer;
  }, [addLog]);

  const toggleNoiseReduction = () => {
    const next = !noiseReductionActive;
    setNoiseReductionActive(next);
    if (noiseGateGainRef.current) {
      noiseGateGainRef.current.gain.value = next ? 1.0 : 1.0;
    }
    if (!next) noiseFloorRef.current = null;
    addLog(next ? '🎛️ Noise reduction activated' : '🎛️ Noise reduction deactivated');
  };

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
  };
}
