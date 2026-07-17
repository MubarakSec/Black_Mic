import React, { useState, useEffect, useRef, useCallback } from 'react';
import AudioLockOverlay from './components/AudioLockOverlay';
import RoomSelector from './components/RoomSelector';
import SignalLostOverlay from './components/SignalLostOverlay';
import StudioConsole from './components/StudioConsole';
import { useRecording } from './hooks/useRecording';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useSocketConnection } from './hooks/useSocketConnection';
import { isValidRoomId } from './utils/socketValidation';
import {
  DEFAULT_ROOM_ID,
  LS_ROOM_ID,
  LS_CHANNEL_MODE,
  LS_AUDIO_PROFILE,
  LS_RECEIVER_BUFFER_MS,
  DEFAULT_RECEIVER_BUFFER_MS,
} from './constants';
import './index.css';
import './components.css';

function App() {
  const [role, setRole] = useState(null);
  const [roomId, setRoomId] = useState(() => localStorage.getItem(LS_ROOM_ID) || DEFAULT_ROOM_ID);
  const [channelMode, setChannelMode] = useState(() => localStorage.getItem(LS_CHANNEL_MODE) || 'mono');
  const [audioProfile, setAudioProfile] = useState(() => localStorage.getItem(LS_AUDIO_PROFILE) || 'clean');
  const [jitterBufferMs, setJitterBufferMs] = useState(() => parseInt(localStorage.getItem(LS_RECEIVER_BUFFER_MS) || DEFAULT_RECEIVER_BUFFER_MS.toString(), 10));
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('Waiting to connect...');

  const [remotePhoneGain, setRemotePhoneGain] = useState(1.0);
  const [isPhoneMuted, setIsPhoneMuted] = useState(false);
  const [remoteAckMsg, setRemoteAckMsg] = useState(null);

  const socketRef = useRef(null);

  const addLog = useCallback((msg) => {
    console.log(msg);
    setLogs(prev => [...prev.slice(-6), msg]);
  }, []);

  // Sync basic state to localStorage
  useEffect(() => { localStorage.setItem(LS_ROOM_ID, roomId); }, [roomId]);
  useEffect(() => { localStorage.setItem(LS_CHANNEL_MODE, channelMode); }, [channelMode]);
  useEffect(() => { localStorage.setItem(LS_AUDIO_PROFILE, audioProfile); }, [audioProfile]);
  useEffect(() => { localStorage.setItem(LS_RECEIVER_BUFFER_MS, jitterBufferMs); }, [jitterBufferMs]);

  // Audio Engine Hook (handles audio graphs, nodes, visualizer direct DOM rendering)
  const {
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
  } = useAudioEngine({
    role,
    channelMode,
    audioProfile,
    addLog,
    setStatus,
    socketRef,
    roomId,
    jitterBufferMs,
  });

  // Socket Connection Hook (handles Socket.IO, pcm-chunk relay, RTT ping, bitrate calculation)
  const {
    operatorIssue,
    roomState,
    latency,
    bitrate,
  } = useSocketConnection({
    role,
    roomId,
    addLog,
    status,
    setStatus,
    socketRef,
    inputGain,
    setInputGain,
    setIsPhoneMuted,
    setRemotePhoneGain,
    setRemoteAckMsg,
    senderGainNodeRef,
    receiverPlaybackNodeRef,
    lastChunkTimeRef,
    hasConnectedOnceRef,
    isSignalLost,
    setIsSignalLost,
  });

  // Share the actual socketRef from useSocketConnection with useAudioEngine
  const audioContextRefSynced = useRef(false);
  useEffect(() => {
    // Dynamic binding to restart sender if channel mode or profile changes
    if (role === 'sender' && audioContextRefSynced.current) {
      addLog(`🔄 Settings changed. Restarting mic stream...`);
      cleanupAudio();
      startSender();
    }
    audioContextRefSynced.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelMode, audioProfile]);

  // Recording Hook
  const {
    isAudioRecording, recordings, recordingSeconds,
    startAudioOnlyRecording, stopAudioOnlyRecording,
    clearRecordings,
  } = useRecording({ destRef, addLog });

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
    setIsMonitoring(false);
    setUnderruns(0);
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

  const onStartSender = () => {
    if (!validateRoomBeforeStart()) return;
    setRole('sender');
    startSender();
  };

  const onStartReceiver = () => {
    if (!validateRoomBeforeStart()) return;
    setRole('receiver');
    startReceiver();
  };

  if (!role) {
    return (
      <div className="container">
        <RoomSelector 
          roomId={roomId} 
          setRoomId={setRoomId} 
          onStartSender={onStartSender} 
          onStartReceiver={onStartReceiver} 
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
        underruns={underruns}
        micSettings={micSettings}
        canvasRef={canvasRef}
        orbRef={orbRef}
        iconRef={iconRef}
        vuBarRef={vuBarRef}
        vuLabelRef={vuLabelRef}
        inputGain={inputGain}
        setInputGain={setInputGain}
        channelMode={channelMode}
        setChannelMode={setChannelMode}
        audioProfile={audioProfile}
        setAudioProfile={setAudioProfile}
        outputVolume={outputVolume}
        setOutputVolume={setOutputVolume}
        jitterBufferMs={jitterBufferMs}
        setJitterBufferMs={setJitterBufferMs}
        remotePhoneGain={remotePhoneGain}
        remoteAckMsg={remoteAckMsg}
        isMonitoring={isMonitoring}
        isAudioRecording={isAudioRecording}
        recordingSeconds={recordingSeconds}
        recordings={recordings}
        logs={logs}
        onRemoteGainChange={handleRemoteGainChange}
        onToggleRemoteMute={toggleRemoteMute}
        onToggleMonitoring={toggleMonitoring}
        onStartAudioRecording={startAudioOnlyRecording}
        onStopAudioRecording={stopAudioOnlyRecording}
        onDisconnect={handleDisconnect}
      />
    </div>
  );
}

export default App;
