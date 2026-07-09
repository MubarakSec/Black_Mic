import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Mic, Volume2, Activity, CheckCircle2, Video, Square, RefreshCw, AlertTriangle } from 'lucide-react';
import fixWebmDuration from 'fix-webm-duration';
import './index.css';

function App() {
  const [role, setRole] = useState(null); // 'sender' | 'receiver'
  const [roomId, setRoomId] = useState('ROOM');
  const [status, setStatus] = useState('Waiting to connect...');
  const [volume, setVolume] = useState(0);
  const [logs, setLogs] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false); // Default false to prevent echo
  
  // Volume state
  const [inputGain, setInputGain] = useState(1.0);
  const [outputVolume, setOutputVolume] = useState(1.0);

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


  // Connection loss watchdog refs
  const lastChunkTimeRef = useRef(0);
  const hasConnectedOnceRef = useRef(false);

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
    // Initialize Socket.io connection (pointing to origin, works through Vite proxy!)
    socketRef.current = io();

    socketRef.current.on('connect', () => {
      addLog('✅ Connected to Node Server');
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      cleanupAudio();
    };
  }, []);

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

    const interval = setInterval(() => {
      if (socketRef.current && socketRef.current.connected) {
        // Measure ping
        socketRef.current.emit('ping-rtt', Date.now());
        
        // Calculate bitrate from byte counter
        const kbps = Math.round((bytesCountRef.current * 8) / 1000);
        setBitrate(kbps);
        bytesCountRef.current = 0;
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      if (socketRef.current) {
        socketRef.current.off('pong-rtt');
      }
    };
  }, [role]);

  // Disconnection Watchdog (checks if chunks stop arriving)
  useEffect(() => {
    if (role !== 'receiver') return;
    
    const watchdog = setInterval(() => {
      if (hasConnectedOnceRef.current && roleRef.current === 'receiver') {
        const silenceDuration = Date.now() - lastChunkTimeRef.current;
        if (silenceDuration > 2500) {
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
    }, 1000);

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

    // Pulse alarm sound every 1.2 seconds
    const alarmInterval = setInterval(() => {
      playAlarmBeep();
    }, 1200);

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
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
      
      // Fast fade out to create a pulsing beep
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      
      osc.connect(gain);
      // Connect directly to destination speakers (bypass fader so user always hears alarm)
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
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
      osc1.frequency.setValueAtTime(523.25, ctx.currentTime); 
      gain1.gain.setValueAtTime(0.08, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.2);
      
      // Beep 2 (E5, delayed by 100ms)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); 
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

  const startSender = async () => {
    setRole('sender');
    socketRef.current.emit('join-room', roomId);
    setStatus('Requesting microphone access...');
    addLog(`🎙️ Requesting Mic access... (Room: ${roomId})`);

    try {
      // Request Screen Wake Lock to keep phone display from auto-sleeping
      await requestWakeLock();

      // Audio capture constraints (disabled echo cancellation/noise suppression for studio capture)
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: false, 
          autoGainControl: false, 
          noiseSuppression: false,
          latency: 0,
          sampleRate: 48000,
          channelCount: 1
        } 
      });
      localStreamRef.current = stream;
      setStatus('Microphone active. Processing audio...');
      addLog('✅ Mic active! Initializing Web Audio...');
      
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
    audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
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
    analyserRef.current.fftSize = 256;
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

  const startScreenRecording = async () => {
    try {
      addLog('⏺️ Requesting screen share...');
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
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
          videoBitsPerSecond: 8000000 // Boosted to 8 Mbps for ultra-smooth 1080p 60fps
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
        <div className="console-panel text-center">
          <h1 className="title">Black Mic Studio</h1>
          <p className="subtitle">Select device console role</p>
          
          <div className="room-input-container">
            <label className="room-input-label">Studio Room ID</label>
            <input 
              type="text" 
              value={roomId} 
              maxLength={12}
              onChange={(e) => setRoomId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              className="room-input"
              aria-label="Studio Room Identification Code"
            />
            <span className="room-input-hint">Use the same ID on both devices to pair.</span>
          </div>
          
          <div className="card-grid">
            <button className="role-card" onClick={startSender} aria-label="Use this device as the phone microphone">
              <div className="icon-wrapper">
                <Mic size={36} color="var(--accent-1)" />
              </div>
              <h2>Phone (Microphone)</h2>
              <p>Stream compressed voice</p>
            </button>
            
            <button className="role-card" onClick={startReceiver} aria-label="Use this device as the PC audio receiver">
              <div className="icon-wrapper">
                <Volume2 size={36} color="var(--accent-2)" />
              </div>
              <h2>PC (Receiver)</h2>
              <p>Receive and play audio</p>
            </button>
          </div>
        </div>
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

        {/* Real-time Connection Telemetry Strip */}
        <div className="telemetry-strip">
          <div className="telemetry-stat">
            <span className="telemetry-stat-label">LATENCY</span>
            <span className="telemetry-stat-value">{latency !== null ? `${latency} ms` : '--'}</span>
          </div>
          <div className="telemetry-stat">
            <span className="telemetry-stat-label">BITRATE</span>
            <span className="telemetry-stat-value">{bitrate !== null ? `${bitrate} kbps` : '--'}</span>
          </div>
          <div className="telemetry-stat">
            <span className="telemetry-stat-label">LOSS RATE</span>
            <span className="telemetry-stat-value">{packetLoss}%</span>
          </div>
        </div>

        <div className="visualizer-section">
          <div className="visualizer-container">
            <div 
              className="glow-orb" 
              style={{ 
                transform: `scale(${1 + (volume / 255) * 1.3})`,
                opacity: 0.3 + (volume / 255) * 0.5,
                background: role === 'sender' ? 'radial-gradient(circle, var(--accent-1) 0%, transparent 70%)' : 'radial-gradient(circle, var(--accent-2) 0%, transparent 70%)'
              }}
            />
            <div className="icon-center">
              {role === 'sender' ? (
                <Mic size={40} color={volume > 30 ? 'var(--accent-1)' : '#fff'} style={{ transition: 'color 0.1s ease' }} />
              ) : (
                <Volume2 size={40} color={volume > 30 ? 'var(--accent-2)' : '#fff'} style={{ transition: 'color 0.1s ease' }} />
              )}
            </div>
          </div>

          {/* Canvas Spectrum visualizer */}
          <canvas 
            ref={canvasRef} 
            width={520} 
            height={120} 
            style={{ 
              width: '100%', 
              height: '60px', 
              display: 'block', 
              margin: '0.5rem 0 1rem 0', 
              borderRadius: '4px',
              opacity: volume > 5 ? 1 : 0.2,
              transition: 'opacity 0.3s ease'
            }} 
          />

          {/* dynamic VU Meter bar */}
          <div className="vu-meter">
            <div className="vu-meter-label">
              <span>VU LEVEL</span>
              <span>{Math.round((volume / 255) * 100)}%</span>
            </div>
            <div className="vu-meter-track">
              <div 
                className="vu-meter-bar" 
                style={{ 
                  width: `${(volume / 255) * 100}%`,
                  background: role === 'sender' ? 'var(--accent-1)' : 'var(--accent-2)',
                  boxShadow: role === 'sender' ? '0 0 8px var(--accent-1)' : '0 0 8px var(--accent-2)'
                }}
              />
            </div>
          </div>
        </div>

        {/* Volume / Gain controls */}
        {role === 'sender' && (
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

        {/* System Telemetry Log panel */}
        <div className="telemetry-panel">
          <div className="telemetry-header">SYSTEM TELEMETRY LOG</div>
          <div className="telemetry-content">
            {logs.length === 0 && <div className="telemetry-empty">No telemetry events logged yet.</div>}
            {logs.map((log, i) => <div className="telemetry-line" key={i}>{log}</div>)}
          </div>
        </div>

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
                <Square size={16} /> Stop Recording
              </button>
            )}
          </div>
        )}

        {/* Recording Library Section */}
        {role === 'receiver' && recordings.length > 0 && (
          <div className="telemetry-panel mt-8" style={{ background: 'rgba(0, 0, 0, 0.4)' }}>
            <div className="telemetry-header">🎥 RECORDING LIBRARY (TAKES LIST)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
              {recordings.map((rec, index) => {
                const ext = rec.mimeType.includes('mp4') ? 'mp4' : 'webm';
                return (
                  <div key={rec.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--panel-border)', padding: '0.75rem 1rem', borderRadius: '6px' }}>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff' }}>
                        Take #{recordings.length - index} ({rec.timestamp})
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono', marginTop: '0.15rem' }}>
                        Duration: {rec.duration} | Size: {rec.size} | Format: {ext.toUpperCase()}
                      </div>
                    </div>
                    <div>
                      <a 
                        href={rec.url} 
                        download={`${rec.filename}.${ext}`}
                        className="btn-control"
                        style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', background: 'rgba(0, 210, 255, 0.1)', color: 'var(--accent-2)', borderColor: 'var(--accent-2)' }}
                      >
                        Download
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button className="btn-danger mt-8" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', margin: '2rem auto 0 auto' }} onClick={handleDisconnect}>
          <RefreshCw size={14} /> Disconnect / Restart
        </button>
      </div>
    </div>
  );
}

export default App;
