import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Volume2, CheckCircle2, Activity, Video, Square, RefreshCw, AlertTriangle, Mic } from 'lucide-react';
import fixWebmDuration from 'fix-webm-duration';
import RoomSelector from './components/RoomSelector';
import TelemetryStrip from './components/TelemetryStrip';
import VisualizerPanel from './components/VisualizerPanel';
import LoggerPanel from './components/LoggerPanel';
import RecordingLibrary from './components/RecordingLibrary';
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
  RECORDING_FRAME_RATE,
  RECORDING_WIDTH,
  RECORDING_HEIGHT,
  RECORDING_BIT_RATE
} from './constants';
import './index.css';

function App() {
  const [role, setRole] = useState(null);
  const [roomId, setRoomId] = useState(() => localStorage.getItem(LS_ROOM_ID) || DEFAULT_ROOM_ID);
  const [status, setStatus] = useState('Waiting to connect...');
  const [volume, setVolume] = useState(0);
  const [logs, setLogs] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isAudioRecording, setIsAudioRecording] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);

  // Volume state — persisted
  const [inputGain, setInputGain] = useState(() => parseFloat(localStorage.getItem(LS_INPUT_GAIN) || '1.0'));
  const [outputVolume, setOutputVolume] = useState(() => parseFloat(localStorage.getItem(LS_OUTPUT_VOLUME) || '1.0'));

  // Channel mode state — persisted
  const [channelMode, setChannelMode] = useState(() => localStorage.getItem(LS_CHANNEL_MODE) || 'mono');

  // Remote control states
  const [remotePhoneGain, setRemotePhoneGain] = useState(1.0);
  const [isPhoneMuted, setIsPhoneMuted] = useState(false);
  const [remoteAckMsg, setRemoteAckMsg] = useState(null); // PC-side confirmation badge

  // Connection Telemetry state
  const [latency, setLatency] = useState(null);
  const [bitrate, setBitrate] = useState(null);
  const [packetLoss] = useState(0); // 0% on TCP socket level

  // Audio Lock & Disconnect Alarm states
  const [isAudioLocked, setIsAudioLocked] = useState(false);
  const [isSignalLost, setIsSignalLost] = useState(false);

  // Recording Library state
  const [recordings, setRecordings] = useState([]);

  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const processorRef = useRef(null);
  const animationRef = useRef(null);
  const roleRef = useRef(null);
  const canvasRef = useRef(null);
  
  // Dynamic nodes
  const senderGainNodeRef = useRef(null);
  const receiverGainNodeRef = useRef(null);
  
  // Audio Queue refs
  const nextPlayTimeRef = useRef(0);

  // Screen recording refs
  const destRef = useRef(null);
  const screenRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startTimeRef = useRef(0);
  const mixedContextRef = useRef(null);
  const screenStreamRef = useRef(null);

  // Telemetry counting refs
  const bytesCountRef = useRef(0);


  // Audio-only recording refs
  const audioRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Connection loss watchdog refs
  const lastChunkTimeRef = useRef(0);
  const hasConnectedOnceRef = useRef(false);

  // Keep roomId accessible inside socket callbacks without dependency issues
  const roomIdRef = useRef(roomId);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  // Screen Wake Lock ref (keeps phone screen awake while streaming)
  const wakeLockRef = useRef(null);

  const addLog = (msg) => {
    console.log(msg);
    setLogs(prev => [...prev.slice(-6), msg]);
  };

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    socketRef.current = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: Infinity });

    socketRef.current.on('connect', () => {
      addLog('✅ Connected to Node Server');
      if (roleRef.current) {
        socketRef.current.emit('join-room', roomIdRef.current);
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

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      cleanupAudio();
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
        const { type, value } = cmd;
        if (type === 'gain') {
          setInputGain(value);
          if (senderGainNodeRef.current) {
            senderGainNodeRef.current.gain.value = value;
          }
          addLog(`🎛️ Remote Gain set to ${Math.round(value * 100)}%`);
          // Send ACK back to PC
          socketRef.current.emit('remote-control-ack', { type: 'gain', value }, roomIdRef.current);
        } else if (type === 'mute') {
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
        const msg = cmd.type === 'mute'
          ? (cmd.value ? '🔇 Phone confirmed: Muted' : '🔊 Phone confirmed: Unmuted')
          : `✅ Phone confirmed gain: ${Math.round(cmd.value * 100)}%`;
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
    if (mixedContextRef.current) {
      mixedContextRef.current.close().catch(() => {});
      mixedContextRef.current = null;
    }
    stopScreenRecording();
  };

  const handleDisconnect = () => {
    addLog('🔌 Disconnecting from studio room...');
    cleanupAudio();
    if (socketRef.current) {
      socketRef.current.emit('leave-room', roomId);
      socketRef.current.off('pcm-chunk');
    }
    
    // Revoke all recording object URLs to release memory
    recordings.forEach(rec => {
      URL.revokeObjectURL(rec.url);
    });
    setRecordings([]);

    setRole(null);
    setStatus('Waiting to connect...');
    setIsMonitoring(false);
    setIsRecording(false);
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

  const startSender = async () => {
    setRole('sender');
    socketRef.current.emit('join-room', roomId);
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
      const workletNode = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
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
        
        // Stream compressed audio chunk over Socket.io TCP
        socketRef.current.emit('pcm-chunk', {
          buffer: processedBuffer,
          sampleRate: audioContextRef.current.sampleRate
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

  const startReceiver = () => {
    setRole('receiver');
    socketRef.current.emit('join-room', roomId);
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
      const { buffer, sampleRate } = data;

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
      
      // Reconstruct buffer at the native captured sample rate
      const audioBuffer = audioContextRef.current.createBuffer(1, floatData.length, sampleRate);
      audioBuffer.copyToChannel(floatData, 0);
      
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

  const startAudioOnlyRecording = () => {
    if (!destRef.current) return;
    const audioStream = destRef.current.stream;
    if (!audioStream || audioStream.getAudioTracks().length === 0) {
      addLog('❌ No audio stream available to record.');
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    audioChunksRef.current = [];
    audioRecorderRef.current = new MediaRecorder(audioStream, { mimeType });
    audioRecorderRef.current.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    audioRecorderRef.current.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toLocaleTimeString();
      const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
      setRecordings(prev => [{ id: Date.now(), url, timestamp, duration: 'Audio only', size: `${sizeMB} MB`, mimeType, filename: `bms-audio-${Date.now()}` }, ...prev]);
      addLog(`💾 Audio-only take saved! Size: ${sizeMB} MB`);
      // Auto-download
      const a = document.createElement('a');
      a.href = url;
      a.download = `bms-audio-${Date.now()}.webm`;
      a.click();
    };
    audioRecorderRef.current.start(1000);
    setIsAudioRecording(true);
    addLog('🎙️ Audio-only recording ACTIVE!');
  };

  const stopAudioOnlyRecording = () => {
    if (audioRecorderRef.current && audioRecorderRef.current.state !== 'inactive') {
      audioRecorderRef.current.stop();
    }
    setIsAudioRecording(false);
  };

  const startScreenRecording = async () => {
    try {
      addLog('⏺️ Requesting screen share...');
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          frameRate: { ideal: RECORDING_FRAME_RATE, max: RECORDING_FRAME_RATE },
          width: { ideal: RECORDING_WIDTH, max: RECORDING_WIDTH },
          height: { ideal: RECORDING_HEIGHT, max: RECORDING_HEIGHT },
          displaySurface: 'monitor' 
        },
        audio: true
      });
      screenStreamRef.current = screenStream;
      
      const micAudioTracks = destRef.current?.stream.getAudioTracks() || [];
      const screenAudioTracks = screenStream.getAudioTracks() || [];
      
      const mixedContext = new (window.AudioContext || window.webkitAudioContext)();
      const mixedDest = mixedContext.createMediaStreamDestination();
      
      if (micAudioTracks.length > 0) {
        mixedContext.createMediaStreamSource(new MediaStream(micAudioTracks)).connect(mixedDest);
      }
      if (screenAudioTracks.length > 0) {
        mixedContext.createMediaStreamSource(new MediaStream(screenAudioTracks)).connect(mixedDest);
      }

      const combinedStream = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...mixedDest.stream.getAudioTracks()
      ]);
      
      mixedContextRef.current = mixedContext;

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=h264,opus') 
          ? 'video/webm;codecs=h264,opus' 
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
            ? 'video/webm;codecs=vp8,opus'
            : 'video/webm';

      try {
        screenRecorderRef.current = new MediaRecorder(combinedStream, { 
          mimeType, 
          videoBitsPerSecond: RECORDING_BIT_RATE
        });
      } catch (e1) {
        addLog(`⚠️ Premium recorder failed (${e1.message}), trying standard WebM...`);
        try {
          screenRecorderRef.current = new MediaRecorder(combinedStream, { mimeType: 'video/webm' });
        } catch (e2) {
          addLog(`⚠️ WebM recorder failed (${e2.message}), trying default browser recorder...`);
          screenRecorderRef.current = new MediaRecorder(combinedStream);
        }
      }
      
      screenRecorderRef.current.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      screenRecorderRef.current.onstop = () => {
        addLog('💾 Processing and saving recording...');
        const duration = Date.now() - startTimeRef.current;
        const recordedMime = screenRecorderRef.current.mimeType || 'video/webm';
        const blob = new Blob(chunksRef.current, { type: recordedMime });
        chunksRef.current = [];
        
        const processRecording = (finalBlob) => {
          const url = URL.createObjectURL(finalBlob);
          const sizeMB = (finalBlob.size / (1024 * 1024)).toFixed(2) + ' MB';
          const durationSec = Math.round(duration / 1000);
          const durationFormatted = `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;
          const timeStr = new Date().toLocaleTimeString();

          const newRecording = {
            id: Date.now(),
            url,
            mimeType: recordedMime,
            filename: `BlackMic_Take_${new Date().toISOString().replace(/:/g, '-')}`,
            size: sizeMB,
            duration: durationFormatted,
            timestamp: timeStr
          };

          // Store in recordings library state
          setRecordings(prev => [newRecording, ...prev]);

          // Attempt automatic download (convenience trigger)
          try {
            const a = document.createElement('a');
            a.href = url;
            const ext = recordedMime.includes('mp4') ? 'mp4' : 'webm';
            a.download = `${newRecording.filename}.${ext}`;
            a.click();
            addLog('✅ Video auto-download started!');
          } catch (downloadErr) {
            addLog(`⚠️ Auto-download blocked (${downloadErr.message}). Use Library below.`);
          }

          setIsRecording(false);
          
          if (mixedContextRef.current) {
            mixedContextRef.current.close().catch(() => {});
            mixedContextRef.current = null;
          }
        };

        if (recordedMime.includes('webm')) {
          fixWebmDuration(blob, duration, (fixedBlob) => {
            processRecording(fixedBlob);
          });
        } else {
          processRecording(blob);
        }
      };

      screenStream.getVideoTracks()[0].onended = () => {
        stopScreenRecording();
      };

      startTimeRef.current = Date.now();
      screenRecorderRef.current.start(1000);
      setIsRecording(true);
      addLog('⏺️ Recording ACTIVE!');
    } catch (e) {
      addLog(`❌ Recording Error: ${e.message}`);
    }
  };

  const stopScreenRecording = () => {
    if (screenRecorderRef.current && screenRecorderRef.current.state !== 'inactive') {
      screenRecorderRef.current.stop();
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
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
      {/* Autoplay Audio Block Screen Overlay */}
      {isAudioLocked && (
        <div className="audio-lock-overlay" onClick={unlockAudio}>
          <div className="audio-lock-content">
            <Volume2 size={64} className="pulse-icon" />
            <h2 style={{ letterSpacing: '-0.02em', fontWeight: 700 }}>AUDIO OUTPUT LOCKED</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              The browser blocked auto-playback. Click anywhere on this screen to unlock the audio stream.
            </p>
            <button className="btn-control mt-8">Unlock Audio</button>
          </div>
        </div>
      )}

      {/* Disconnection Warning Alarm Overlay */}
      {isSignalLost && (
        <div className="alarm-overlay">
          <div className="alarm-content">
            <AlertTriangle size={48} color="var(--danger-color)" style={{ margin: '0 auto 0.75rem auto' }} />
            <h2 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>
              MICROPHONE DISCONNECTED!
            </h2>
            <p style={{ color: '#ffb3b3', fontSize: '0.85rem', margin: 0 }}>
              The audio stream stopped. Check your phone's USB connection.
            </p>
          </div>
        </div>
      )}

      <div className="console-panel text-center">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '1rem' }}>
          <h1 className="title" style={{ fontSize: '1.5rem', textAlign: 'left', margin: 0 }}>
            {role === 'sender' ? 'Broadcasting Console' : 'Studio Monitor'}
          </h1>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontFamily: 'JetBrains Mono', color: 'var(--text-secondary)' }}>ROOM:</span>
            <span style={{ fontSize: '0.85rem', fontFamily: 'JetBrains Mono', fontWeight: 'bold', color: '#fff', background: 'rgba(255,255,255,0.05)', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)' }}>
              {roomId}
            </span>
          </div>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div className="status-badge">
            {status.includes('Connected') || status.includes('Streaming') || status.includes('Broadcasting') ? (
              <CheckCircle2 color="var(--success-color)" size={16} />
            ) : (
              <Activity color="var(--warning-color)" size={16} />
            )}
            <span>{status}</span>
          </div>
        </div>

        {/* Phone Muted Warning Banner */}
        {role === 'sender' && isPhoneMuted && (
          <div className="status-badge" style={{ background: 'rgba(255, 59, 48, 0.1)', color: '#ff3b30', borderColor: 'rgba(255, 59, 48, 0.2)', width: '100%', padding: '0.75rem', marginTop: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', animation: 'flash-alarm 1s infinite alternate ease-in-out' }}>
            <AlertTriangle size={16} /> MICROPHONE MUTED BY PC
          </div>
        )}

        {/* Keep Phone Tab Visible Warning Banner */}
        {role === 'sender' && (
          <div className="status-badge" style={{ background: 'rgba(255, 204, 0, 0.05)', color: 'var(--warning-color)', borderColor: 'rgba(255, 204, 0, 0.15)', width: '100%', padding: '0.75rem', marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', textAlign: 'center' }}>
            <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', fontSize: '0.85rem' }}>
              <AlertTriangle size={14} /> KEEP THIS TAB VISIBLE
            </div>
            <div style={{ fontSize: '0.7rem', opacity: 0.8, fontWeight: 500 }}>
              Switching browser tabs or locking the screen will pause audio capture.
            </div>
          </div>
        )}

        {/* Real-time Connection Telemetry Strip */}
        <TelemetryStrip latency={latency} bitrate={bitrate} packetLoss={packetLoss} />

        {/* Visualizer Panel (VU Meter & Spectrum Canvas) */}
        <VisualizerPanel role={role} volume={volume} canvasRef={canvasRef} />

        {role === 'sender' && (
          <>
            <div className="slider-container">
              <div className="slider-label">
                <span>🎙️ Microphone Input Gain</span>
                <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--accent-1)' }}>{Math.round(inputGain * 100)}%</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="2" 
                step="0.05" 
                value={inputGain} 
                onChange={(e) => setInputGain(parseFloat(e.target.value))}
                className="slider-input accent-sender"
              />
            </div>
            <div className="slider-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem' }}>
              <span style={{ fontSize: '0.85rem' }}>🎵 Channel Mode</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn-control"
                  style={{ padding: '0.35rem 0.85rem', fontSize: '0.78rem', background: channelMode === 'mono' ? 'rgba(0, 245, 140, 0.1)' : 'rgba(255,255,255,0.02)', color: channelMode === 'mono' ? 'var(--accent-1)' : '#fff', borderColor: channelMode === 'mono' ? 'var(--accent-1)' : 'var(--panel-border)' }}
                  onClick={() => setChannelMode('mono')}
                >
                  MONO
                </button>
                <button
                  className="btn-control"
                  style={{ padding: '0.35rem 0.85rem', fontSize: '0.78rem', background: channelMode === 'stereo' ? 'rgba(0, 210, 255, 0.1)' : 'rgba(255,255,255,0.02)', color: channelMode === 'stereo' ? 'var(--accent-2)' : '#fff', borderColor: channelMode === 'stereo' ? 'var(--accent-2)' : 'var(--panel-border)' }}
                  onClick={() => setChannelMode('stereo')}
                >
                  STEREO
                </button>
              </div>
            </div>
          </>
        )}

        {role === 'receiver' && (
          <div className="slider-container">
            <div className="slider-label">
              <span>🔊 Speaker Output Volume</span>
              <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--accent-2)' }}>{Math.round(outputVolume * 100)}%</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="2" 
              step="0.05" 
              value={outputVolume} 
              onChange={(e) => setOutputVolume(parseFloat(e.target.value))}
              className="slider-input accent-receiver"
            />
          </div>
        )}

        {/* Remote Phone Control Center on PC */}
        {role === 'receiver' && (
          <div className="slider-container" style={{ background: 'rgba(255, 255, 255, 0.01)', border: '1px solid var(--panel-border)', padding: '1.25rem', borderRadius: '8px', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>🎙️ Remote Phone Controls Centre</span>
              <button 
                className="btn-control" 
                style={{ 
                  padding: '0.35rem 0.75rem', 
                  fontSize: '0.75rem', 
                  background: isPhoneMuted ? 'rgba(255, 59, 48, 0.1)' : 'rgba(255,255,255,0.02)',
                  color: isPhoneMuted ? '#ff3b30' : '#fff',
                  borderColor: isPhoneMuted ? '#ff3b30' : 'var(--panel-border)'
                }}
                onClick={toggleRemoteMute}
              >
                {isPhoneMuted ? '🔇 Phone Mic Muted' : '🔊 Mute Phone Mic'}
              </button>
            </div>
            <div className="slider-label" style={{ fontSize: '0.75rem' }}>
              <span>Remote Microphone Gain</span>
              <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--accent-1)' }}>{Math.round(remotePhoneGain * 100)}%</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="2" 
              step="0.05" 
              value={remotePhoneGain} 
              onChange={handleRemoteGainChange}
              className="slider-input accent-sender"
            />
            {/* ACK confirmation badge */}
            {remoteAckMsg && (
              <div style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: 'var(--success-color)', fontFamily: 'JetBrains Mono', animation: 'fadeIn 0.2s ease' }}>
                {remoteAckMsg}
              </div>
            )}
          </div>
        )}

        {/* System Telemetry Log panel */}
        <LoggerPanel logs={logs} />

        {role === 'receiver' && (
          <div className="control-row">
            <button 
              className="btn-control" 
              style={{ 
                background: isMonitoring ? 'rgba(0, 210, 255, 0.1)' : 'rgba(255, 255, 255, 0.02)', 
                color: isMonitoring ? 'var(--accent-2)' : '#fff', 
                borderColor: isMonitoring ? 'var(--accent-2)' : 'var(--panel-border)' 
              }} 
              onClick={toggleMonitoring}
            >
              {isMonitoring ? '🔊 Feedback Active' : '🔇 Enable Live Feedback'}
            </button>

            {/* Audio-only recording button */}
            {!isAudioRecording ? (
              <button 
                className="btn-control" 
                style={{ background: 'rgba(0, 245, 140, 0.06)', color: 'var(--accent-1)', borderColor: 'rgba(0, 245, 140, 0.2)', display: 'flex', alignItems: 'center', gap: '0.5rem' }} 
                onClick={startAudioOnlyRecording}
              >
                <Mic size={16} /> Record Audio Only
              </button>
            ) : (
              <button 
                className="btn-control" 
                style={{ background: 'rgba(255, 204, 0, 0.08)', color: '#ffcc00', borderColor: 'rgba(255, 204, 0, 0.2)', display: 'flex', alignItems: 'center', gap: '0.5rem' }} 
                onClick={stopAudioOnlyRecording}
              >
                <Square size={16} /> Stop Audio Recording
              </button>
            )}

            {!isRecording ? (
              <button 
                className="btn-control" 
                style={{ background: 'rgba(255, 59, 48, 0.08)', color: '#ff3b30', borderColor: 'rgba(255, 59, 48, 0.2)', display: 'flex', alignItems: 'center', gap: '0.5rem' }} 
                onClick={startScreenRecording}
              >
                <Video size={16} /> Record Screen + Mic
              </button>
            ) : (
              <button 
                className="btn-control" 
                style={{ background: 'rgba(255, 204, 0, 0.08)', color: '#ffcc00', borderColor: 'rgba(255, 204, 0, 0.2)', display: 'flex', alignItems: 'center', gap: '0.5rem' }} 
                onClick={stopScreenRecording}
              >
                <Square size={16} /> Stop Screen Recording
              </button>
            )}
          </div>
        )}

        {/* Recording Library Section */}
        {role === 'receiver' && recordings.length > 0 && (
          <RecordingLibrary recordings={recordings} />
        )}

        <button className="btn-danger mt-8" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', margin: '2rem auto 0 auto' }} onClick={handleDisconnect}>
          <RefreshCw size={14} /> Disconnect / Restart
        </button>
      </div>
    </div>
  );
}

export default App;
