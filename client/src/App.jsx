import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import AudioLockOverlay from './components/AudioLockOverlay';
import RoomSelector from './components/RoomSelector';
import SignalLostOverlay from './components/SignalLostOverlay';
import StudioConsole from './components/StudioConsole';
import { useRecording } from './hooks/useRecording';
import { isValidRemoteCommand, isValidRoomId, normalizePcmPayload } from './utils/socketValidation';
import {
  DEFAULT_ROOM_ID,
  LS_ROOM_ID,
  LS_INPUT_GAIN,
  LS_OUTPUT_VOLUME,
  LS_CHANNEL_MODE,
  CHANNEL_MONO,
  CHANNEL_STEREO,
  TELEMETRY_POLL_INTERVAL_MS,
  WATCHDOG_CHECK_INTERVAL_MS,
  SILENCE_THRESHOLD_MS,
  MICROPHONE_SAMPLE_RATE,
  LATENCY_HINT,
  ALARM_INTERVAL_MS,
  ALARM_PITCH_HZ,
  ALARM_BEEP_DURATION_SEC,
  UNLOCK_NOTE_1_HZ,
  UNLOCK_NOTE_2_HZ,
  FFT_SIZE,
} from './constants';
import './index.css';
import './components.css';

function App() {
  const [role, setRole] = useState(null);
  const [roomId, setRoomId] = useState(() => localStorage.getItem(LS_ROOM_ID) || DEFAULT_ROOM_ID);
  const [status, setStatus] = useState('Waiting to connect...');
  const [operatorIssue, setOperatorIssue] = useState(null);
  const [roomState, setRoomState] = useState(null);
  const [volume, setVolume] = useState(0);
  const [logs, setLogs] = useState([]);
  const [isMonitoring, setIsMonitoring] = useState(false);

  const [inputGain, setInputGain] = useState(() => parseFloat(localStorage.getItem(LS_INPUT_GAIN) || '1.0'));
  const [outputVolume, setOutputVolume] = useState(() => parseFloat(localStorage.getItem(LS_OUTPUT_VOLUME) || '1.0'));

  const [channelMode, setChannelMode] = useState(() => localStorage.getItem(LS_CHANNEL_MODE) || 'mono');

  const [remotePhoneGain, setRemotePhoneGain] = useState(1.0);
  const [isPhoneMuted, setIsPhoneMuted] = useState(false);
  const [remoteAckMsg, setRemoteAckMsg] = useState(null);

  const [latency, setLatency] = useState(null);
  const [bitrate, setBitrate] = useState(null);
  const [packetLoss] = useState(0);

  const [isAudioLocked, setIsAudioLocked] = useState(false);
  const [isSignalLost, setIsSignalLost] = useState(false);

  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const processorRef = useRef(null);
  const animationRef = useRef(null);
  const roleRef = useRef(null);
  const canvasRef = useRef(null);
  const cleanupAudioRef = useRef(() => {});

  const senderGainNodeRef = useRef(null);
  const receiverGainNodeRef = useRef(null);

  const nextPlayTimeRef = useRef(null);

  const destRef = useRef(null);

  const bytesCountRef = useRef(0);

  const lastChunkTimeRef = useRef(0);
  const hasConnectedOnceRef = useRef(false);

  const roomIdRef = useRef(roomId);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  const wakeLockRef = useRef(null);

  const addLog = (msg) => {
    console.log(msg);
    setLogs(prev => [...prev.slice(-6), msg]);
  };

  const getRemoteAckMessage = (cmd) => {
    if (cmd.type === 'gain') return `✅ Phone confirmed gain: ${Math.round(cmd.value * 100)}%`;
    if (cmd.value) return '🔇 Phone confirmed: Muted';
    return '🔊 Phone confirmed: Unmuted';
  };

  const {
    isAudioRecording, isVaapiRecording, recordings,
    startAudioOnlyRecording, stopAudioOnlyRecording,
    startVaapiRecording, stopVaapiRecording,
    clearRecordings,
  } = useRecording({ socketRef, roomIdRef, destRef, addLog });

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    socketRef.current = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: Infinity });

    socketRef.current.on('connect', () => {
      addLog('✅ Connected to Node Server');
      setOperatorIssue(null);
      if (roleRef.current) {
        socketRef.current.emit('join-room', roomIdRef.current, roleRef.current);
        addLog(`🔄 Auto-rejoined room: ${roomIdRef.current}`);
        setStatus(roleRef.current === 'sender' ? 'Broadcasting lossless audio! 🔴' : 'Connected! Audio streaming perfectly. 🔴');
        setIsSignalLost(false);
      }
    });

    socketRef.current.on('disconnect', (reason) => {
      addLog(`⚠️ Socket disconnected: ${reason}`);
    });

    socketRef.current.on('reconnect', (attempt) => {
      addLog(`✅ Reconnected after ${attempt} attempt(s)`);
    });

    socketRef.current.on('room-state', (state) => {
      if (!state || state.roomId !== roomIdRef.current) return;
      setRoomState({
        senders: Number.isInteger(state.senders) ? state.senders : 0,
        receivers: Number.isInteger(state.receivers) ? state.receivers : 0,
      });
    });

    socketRef.current.on('server-warning', (payload) => {
      if (!payload || typeof payload.message !== 'string') return;
      setOperatorIssue(payload.message);
      addLog(`⚠️ ${payload.message}`);
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.off('room-state');
        socketRef.current.off('server-warning');
        socketRef.current.disconnect();
      }
      cleanupAudioRef.current();
    };
  }, []);

  // Persist settings to localStorage whenever they change
  useEffect(() => { localStorage.setItem(LS_ROOM_ID, roomId); }, [roomId]);
  useEffect(() => { localStorage.setItem(LS_INPUT_GAIN, inputGain); }, [inputGain]);
  useEffect(() => { localStorage.setItem(LS_OUTPUT_VOLUME, outputVolume); }, [outputVolume]);
  useEffect(() => { localStorage.setItem(LS_CHANNEL_MODE, channelMode); }, [channelMode]);

  // Update sender gain node dynamically when slider moves
  useEffect(() => {
    if (senderGainNodeRef.current) {
      senderGainNodeRef.current.gain.value = inputGain;
    }
  }, [inputGain]);

  // Update receiver volume node dynamically when slider moves
  useEffect(() => {
    if (receiverGainNodeRef.current) {
      receiverGainNodeRef.current.gain.value = outputVolume;
    }
  }, [outputVolume]);

  // Periodic Telemetry calculation (bitrate and ping)
  useEffect(() => {
    if (!role || !socketRef.current) return;
    
    // RTT Ping handler
    socketRef.current.on('pong-rtt', (startTime) => {
      const rtt = Date.now() - startTime;
      setLatency(rtt);
    });

    // Remote control listener (only active on the phone sender)
    if (role === 'sender') {
      socketRef.current.on('remote-control', (cmd) => {
        if (!isValidRemoteCommand(cmd)) return;
        const { type, value } = cmd;
        if (type === 'gain') {
          setInputGain(value);
          if (senderGainNodeRef.current) {
            senderGainNodeRef.current.gain.value = value;
          }
          addLog(`🎛️ Remote Gain set to ${Math.round(value * 100)}%`);
          // Send ACK back to PC
          socketRef.current.emit('remote-control-ack', { type: 'gain', value }, roomIdRef.current);
          return;
        }
        if (type === 'mute') {
          setIsPhoneMuted(value);
          if (senderGainNodeRef.current) {
            senderGainNodeRef.current.gain.value = value ? 0 : inputGain;
          }
          addLog(value ? '🔇 Remote Muted by PC' : '🔊 Remote Unmuted by PC');
          socketRef.current.emit('remote-control-ack', { type: 'mute', value }, roomIdRef.current);
        }
      });
    }

    // ACK listener on PC receiver side
    if (role === 'receiver') {
      socketRef.current.on('remote-control-ack', (cmd) => {
        if (!isValidRemoteCommand(cmd)) return;
        const msg = getRemoteAckMessage(cmd);
        setRemoteAckMsg(msg);
        setTimeout(() => setRemoteAckMsg(null), 2500);
      });
    }

    const interval = setInterval(() => {
      if (socketRef.current && socketRef.current.connected) {
        // Measure ping
        socketRef.current.emit('ping-rtt', Date.now());
        
        // Calculate bitrate from byte counter
        const kbps = Math.round((bytesCountRef.current * 8) / 1000);
        setBitrate(kbps);
        bytesCountRef.current = 0;
      }
    }, TELEMETRY_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (socketRef.current) {
        socketRef.current.off('pong-rtt');
        socketRef.current.off('remote-control');
        socketRef.current.off('remote-control-ack');
      }
    };
  }, [role, inputGain]);

  // Disconnection Watchdog (checks if chunks stop arriving)
  useEffect(() => {
    if (role !== 'receiver') return;
    
    const watchdog = setInterval(() => {
      if (hasConnectedOnceRef.current && roleRef.current === 'receiver') {
        const silenceDuration = Date.now() - lastChunkTimeRef.current;
        if (silenceDuration > SILENCE_THRESHOLD_MS) {
          if (!isSignalLost) {
            setIsSignalLost(true);
            setStatus('⚠️ Microphone disconnected!');
          }
        } else {
          if (isSignalLost) {
            setIsSignalLost(false);
            setStatus('Connected! Audio streaming perfectly. 🔴');
          }
        }
      }
    }, WATCHDOG_CHECK_INTERVAL_MS);

    return () => {
      clearInterval(watchdog);
      setIsSignalLost(false);
    };
  }, [role, isSignalLost]);

  // Alarm sound effect when signal is lost
  useEffect(() => {
    if (!isSignalLost || role !== 'receiver') return;

    // Play initial alert beep
    playAlarmBeep();

    // Pulse alarm sound every ALARM_INTERVAL_MS
    const alarmInterval = setInterval(() => {
      playAlarmBeep();
    }, ALARM_INTERVAL_MS);

    return () => clearInterval(alarmInterval);
  }, [isSignalLost, role]);

  // Screen Wake Lock visibility listener
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (role === 'sender' && document.visibilityState === 'visible' && !wakeLockRef.current) {
        await requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [role]);

  // Helper: Request Screen Wake Lock (keeps phone active)
  const requestWakeLock = async () => {
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
  };

  // Helper: Release Screen Wake Lock
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

  // Helper: Play alert alarm sound
  const playAlarmBeep = () => {
    if (!audioContextRef.current) return;
    try {
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sawtooth'; // piercing synthesizer alert sound
      osc.frequency.setValueAtTime(ALARM_PITCH_HZ, ctx.currentTime);
      
      // Fast fade out to create a pulsing beep
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ALARM_BEEP_DURATION_SEC - 0.1));
      
      osc.connect(gain);
      // Connect directly to destination speakers (bypass fader so user always hears alarm)
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + ALARM_BEEP_DURATION_SEC);
    } catch (e) {
      console.error('Failed to play alarm beep:', e);
    }
  };

  // Helper: Play unlock double-beep confirmation
  const playUnlockBeep = () => {
    if (!audioContextRef.current) return;
    try {
      const ctx = audioContextRef.current;
      
      // Beep 1 (C5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.frequency.setValueAtTime(UNLOCK_NOTE_1_HZ, ctx.currentTime); 
      gain1.gain.setValueAtTime(0.08, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.2);
      
      // Beep 2 (E5, delayed by 100ms)
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

  const cleanupAudio = () => {
    releaseWakeLock();
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    stopVaapiRecording();
  };

  useEffect(() => {
    cleanupAudioRef.current = cleanupAudio;
  });

  const handleDisconnect = () => {
    addLog('🔌 Disconnecting from studio room...');
    cleanupAudio();
    if (socketRef.current) {
      socketRef.current.emit('leave-room', roomId);
      socketRef.current.off('pcm-chunk');
    }
    
    clearRecordings();

    setRole(null);
    setStatus('Waiting to connect...');
    setOperatorIssue(null);
    setRoomState(null);
    setIsMonitoring(false);
    setVolume(0);
    setLatency(null);
    setBitrate(null);
    setIsAudioLocked(false);
    setIsSignalLost(false);
    hasConnectedOnceRef.current = false;
  };

  const handleRemoteGainChange = (e) => {
    const val = parseFloat(e.target.value);
    setRemotePhoneGain(val);
    if (socketRef.current) {
      socketRef.current.emit('remote-control', { type: 'gain', value: val }, roomId);
    }
  };

  const toggleRemoteMute = () => {
    const newMuted = !isPhoneMuted;
    setIsPhoneMuted(newMuted);
    if (socketRef.current) {
      socketRef.current.emit('remote-control', { type: 'mute', value: newMuted }, roomId);
    }
    addLog(newMuted ? '🔇 Sent Remote Mute command to phone' : '🔊 Sent Remote Unmute command to phone');
  };

  const validateRoomBeforeStart = () => {
    if (isValidRoomId(roomId)) return true;
    setStatus('Room ID must be 3-12 uppercase letters or numbers.');
    addLog('⚠️ Room ID must be 3-12 uppercase letters or numbers.');
    return false;
  };

  const startSender = async () => {
    if (!validateRoomBeforeStart()) return;
    setOperatorIssue(null);
    setRole('sender');
    socketRef.current.emit('join-room', roomId, 'sender');
    setStatus('Requesting microphone access...');
    addLog(`🎙️ Requesting Mic access... (Room: ${roomId})`);

    try {
      // Request Screen Wake Lock to keep phone display from auto-sleeping
      await requestWakeLock();

      // Audio capture constraints
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: false, 
          autoGainControl: false, 
          noiseSuppression: false,
          latency: 0,
          sampleRate: MICROPHONE_SAMPLE_RATE,
          channelCount: channelMode === 'stereo' ? CHANNEL_STEREO : CHANNEL_MONO
        } 
      });
      localStreamRef.current = stream;
      setStatus('Microphone active. Processing audio...');
      addLog(`✅ Mic active! Mode: ${channelMode.toUpperCase()} | Initializing Web Audio...`);
      
      // Enforce 44.1kHz or 48kHz depending on device default
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      
      addLog('📡 Loading audio worklet module...');
      await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
      addLog('✅ Audio worklet module loaded!');

      const source = audioContextRef.current.createMediaStreamSource(stream);
      
      // Gain node for slider control
      senderGainNodeRef.current = audioContextRef.current.createGain();
      senderGainNodeRef.current.gain.value = inputGain;
      
      // Visualizer connection
      analyserRef.current = audioContextRef.current.createAnalyser();
      
      // Create AudioWorkletNode running our audio-processor processor
      const workletNode = new AudioWorkletNode(audioContextRef.current, 'audio-processor', {
        channelCount: channelMode === 'stereo' ? CHANNEL_STEREO : CHANNEL_MONO,
        channelCountMode: 'explicit',
        processorOptions: {
          isStereo: channelMode === 'stereo'
        }
      });
      processorRef.current = workletNode;
      
      // Connect chain: Mic source -> Gain Node -> Visualizer Analyser -> AudioWorkletNode
      source.connect(senderGainNodeRef.current);
      senderGainNodeRef.current.connect(analyserRef.current);
      senderGainNodeRef.current.connect(workletNode);
      
      // Node must connect to output destination to activate processing
      workletNode.connect(audioContextRef.current.destination);
      
      workletNode.port.onmessage = (e) => {
        if (roleRef.current !== 'sender') return;
        const processedBuffer = e.data;
        
        // Track byte telemetry
        bytesCountRef.current += processedBuffer.byteLength;
        
        // Stream PCM chunk over Socket.io — include channelCount so server configures audio bridge correctly
        socketRef.current.emit('pcm-chunk', {
          buffer: processedBuffer,
          sampleRate: audioContextRef.current.sampleRate,
          channelCount: channelMode === 'stereo' ? CHANNEL_STEREO : CHANNEL_MONO,
        }, roomId);
      };
      
      startVisualizerLoop();
      setStatus('Broadcasting lossless audio! 🔴');
      addLog('🚀 Native Int16 audio stream active over TCP socket!');
      
    } catch (e) {
      addLog(`❌ Mic Error: ${e.message}`);
      setStatus('Microphone access denied or unavailable.');
    }
  };

  useEffect(() => {
    if (role === 'sender' && localStreamRef.current) {
      addLog(`🔄 Channel mode changed to ${channelMode.toUpperCase()}. Restarting mic stream...`);
      cleanupAudio();
      startSender();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelMode]);

  const startReceiver = () => {
    if (!validateRoomBeforeStart()) return;
    setOperatorIssue(null);
    setRole('receiver');
    socketRef.current.emit('join-room', roomId, 'receiver');
    setStatus('Waiting for audio stream...');
    addLog(`🎧 Receiver initialized. Waiting for stream in Room: ${roomId}`);
    socketRef.current.emit('receiver-ready', roomId);
    setupSocketReceiver();
  };

  const setupSocketReceiver = () => {
    audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: LATENCY_HINT });
    nextPlayTimeRef.current = 0;
    
    analyserRef.current = audioContextRef.current.createAnalyser();
    
    // Create a destination for the built-in screen recorder
    destRef.current = audioContextRef.current.createMediaStreamDestination();
    analyserRef.current.connect(destRef.current);

    // Output volume gain node
    receiverGainNodeRef.current = audioContextRef.current.createGain();
    receiverGainNodeRef.current.gain.value = outputVolume;
    
    analyserRef.current.connect(receiverGainNodeRef.current);
    
    // If live feedback is enabled, pipe to hardware speakers
    if (isMonitoring) {
      receiverGainNodeRef.current.connect(audioContextRef.current.destination);
    }

    // Check if browser blocked audio autoplay
    if (audioContextRef.current.state === 'suspended') {
      setIsAudioLocked(true);
    }

    startVisualizerLoop();
    
    let isFirstChunk = true;

    // Listen for compressed audio chunks over Socket.io
    socketRef.current.on('pcm-chunk', (data) => {
      if (roleRef.current !== 'receiver') return;
      if (!audioContextRef.current) return;
      const pcmData = normalizePcmPayload(data);
      if (!pcmData) return;
      const { buffer, sampleRate, channelCount } = pcmData;

      // Update watchdog packet arrival timestamp
      lastChunkTimeRef.current = Date.now();

      // Track byte telemetry
      bytesCountRef.current += buffer.byteLength;

      if (isFirstChunk) {
         hasConnectedOnceRef.current = true;
         setStatus('Connected! Audio streaming perfectly. 🔴');
         addLog(`🔊 Receiving lossless Int16 audio at ${sampleRate}Hz!`);
         isFirstChunk = false;
         
         // Unblock suspended audio contexts
         if (audioContextRef.current.state === 'suspended') {
            setIsAudioLocked(true);
         }
      }
      
      // Decode 16-bit Int PCM back to Float32
      const intData = new Int16Array(buffer);
      const floatData = new Float32Array(intData.length);
      for (let i = 0; i < intData.length; i++) {
        floatData[i] = intData[i] / 32768.0;
      }
      
      const channels = channelCount;
      const samplesPerChannel = floatData.length / channels;
      const audioBuffer = audioContextRef.current.createBuffer(channels, samplesPerChannel, sampleRate);
      
      if (channels === 2) {
        const leftData = new Float32Array(samplesPerChannel);
        const rightData = new Float32Array(samplesPerChannel);
        for (let i = 0; i < samplesPerChannel; i++) {
          leftData[i] = floatData[i * 2];
          rightData[i] = floatData[i * 2 + 1];
        }
        audioBuffer.copyToChannel(leftData, 0);
        audioBuffer.copyToChannel(rightData, 1);
      } else {
        audioBuffer.copyToChannel(floatData, 0);
      }
      
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(analyserRef.current); 
      
      const currentTime = audioContextRef.current.currentTime;
      if (nextPlayTimeRef.current < currentTime) {
         // Jitter buffer underrun safety (40ms buffer offset)
         nextPlayTimeRef.current = currentTime + 0.04; 
      }
      
      source.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += audioBuffer.duration;
    });
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

  const startVisualizerLoop = () => {
    if (!analyserRef.current) return;
    analyserRef.current.fftSize = FFT_SIZE;
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateVisualizer = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      setVolume(average);

      // Draw real-time frequency visualizer on canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        ctx.clearRect(0, 0, width, height);

        // Draw frequency columns
        const barWidth = (width / bufferLength) * 1.6;
        let barHeight;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
          // Normalize height to canvas height
          barHeight = (dataArray[i] / 255) * height;
          
          const activeColor = roleRef.current === 'sender' ? '#00f58c' : '#00d2ff';
          
          // Draw spectral bars
          ctx.fillStyle = activeColor;
          ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);
          
          x += barWidth;
        }
      }
      
      animationRef.current = requestAnimationFrame(updateVisualizer);
    };
    updateVisualizer();
  };

  // Old browser MediaRecorder recording removed.
  // Recording is now handled by useRecording hook (VAAPI via server, audio-only via MediaRecorder).


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

  if (!role) {
    return (
      <div className="container">
        <RoomSelector 
          roomId={roomId} 
          setRoomId={setRoomId} 
          onStartSender={startSender} 
          onStartReceiver={startReceiver} 
        />
      </div>
    );
  }

  return (
    <div className="container">
      {isAudioLocked && <AudioLockOverlay onUnlock={unlockAudio} />}
      {isSignalLost && <SignalLostOverlay />}
      <StudioConsole
        role={role}
        roomId={roomId}
        status={status}
        roomState={roomState}
        operatorIssue={operatorIssue}
        isPhoneMuted={isPhoneMuted}
        latency={latency}
        bitrate={bitrate}
        packetLoss={packetLoss}
        volume={volume}
        canvasRef={canvasRef}
        inputGain={inputGain}
        setInputGain={setInputGain}
        channelMode={channelMode}
        setChannelMode={setChannelMode}
        outputVolume={outputVolume}
        setOutputVolume={setOutputVolume}
        remotePhoneGain={remotePhoneGain}
        remoteAckMsg={remoteAckMsg}
        isMonitoring={isMonitoring}
        isAudioRecording={isAudioRecording}
        isVaapiRecording={isVaapiRecording}
        recordings={recordings}
        logs={logs}
        onRemoteGainChange={handleRemoteGainChange}
        onToggleRemoteMute={toggleRemoteMute}
        onToggleMonitoring={toggleMonitoring}
        onStartAudioRecording={startAudioOnlyRecording}
        onStopAudioRecording={stopAudioOnlyRecording}
        onStartVaapiRecording={startVaapiRecording}
        onStopVaapiRecording={stopVaapiRecording}
        onDisconnect={handleDisconnect}
      />
    </div>
  );
}

export default App;
