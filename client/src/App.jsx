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
  ROLE_SENDER,
  ROLE_RECEIVER,
  CHANNEL_MODE_MONO,
  PROFILE_RAW,
} from './constants';
import './index.css';
import './components.css';

function App() {
  const [role, setRole] = useState(null);
  const [roomId, setRoomId] = useState(() => localStorage.getItem(LS_ROOM_ID) || DEFAULT_ROOM_ID);
  const [channelMode, setChannelMode] = useState(() => localStorage.getItem(LS_CHANNEL_MODE) || CHANNEL_MODE_MONO);
  const [audioProfile, setAudioProfile] = useState(() => localStorage.getItem(LS_AUDIO_PROFILE) || PROFILE_RAW);
  const [jitterBufferMs, setJitterBufferMs] = useState(() => {
    const stored = parseInt(localStorage.getItem(LS_RECEIVER_BUFFER_MS), 10);
    return Number.isFinite(stored) ? stored : DEFAULT_RECEIVER_BUFFER_MS;
  });
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('Waiting to connect...');
  const [startingRole, setStartingRole] = useState(null);
  const [startError, setStartError] = useState(null);

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
    joinError,
    virtualMicState,
    clearJoinError,
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
    isSenderAudioReady: Boolean(micSettings),
  });

  // Share the actual socketRef from useSocketConnection with useAudioEngine
  const audioContextRefSynced = useRef(false);
  useEffect(() => {
    // Dynamic binding to restart sender if channel mode or profile changes
    if (role === ROLE_SENDER && audioContextRefSynced.current) {
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
    finalizeRecordingForDisconnect,
    clearRecordings,
  } = useRecording({ destRef, addLog });

  useEffect(() => {
    if (!joinError || !role) return;
    finalizeRecordingForDisconnect();
    cleanupAudio();
    socketRef.current?.emit('leave-room');
    setRole(null);
    setStartError(joinError);
  }, [cleanupAudio, finalizeRecordingForDisconnect, joinError, role]);

  const handleDisconnect = () => {
    addLog('🔌 Disconnecting from studio room...');
    finalizeRecordingForDisconnect();
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
    setStartError(null);
    clearJoinError();
  };

  const handleRemoteGainChange = (e) => {
    const val = parseFloat(e.target.value);
    if (!Number.isFinite(val)) return;
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

  const prepareStart = (nextRole) => {
    if (!validateRoomBeforeStart()) return false;
    setStartingRole(nextRole);
    setStartError(null);
    clearJoinError();
    setIsSignalLost(false);
    hasConnectedOnceRef.current = false;
    return true;
  };

  const onStartSender = async () => {
    if (!prepareStart(ROLE_SENDER)) return;
    const result = await startSender();
    setStartingRole(null);
    if (!result?.ok) {
      setStartError(result?.message || 'The phone microphone could not start.');
      return;
    }
    setRole(ROLE_SENDER);
  };

  const onStartReceiver = async () => {
    if (!prepareStart(ROLE_RECEIVER)) return;
    const result = await startReceiver();
    setStartingRole(null);
    if (!result?.ok) {
      setStartError(result?.message || 'The PC receiver could not start.');
      return;
    }
    setRole(ROLE_RECEIVER);
  };

  if (!role) {
    return (
      <div className="container">
        <RoomSelector 
          roomId={roomId} 
          setRoomId={setRoomId} 
          onStartSender={onStartSender} 
          onStartReceiver={onStartReceiver} 
          startingRole={startingRole}
          startError={startError}
        />
      </div>
    );
  }

  return (
    <div className="container">
      {isSignalLost && <SignalLostOverlay />}
      {isAudioLocked && !isSignalLost && <AudioLockOverlay onUnlock={unlockAudio} />}
      <StudioConsole
        role={role}
        roomId={roomId}
        status={status}
        roomState={roomState}
        isPhoneConnected={Boolean(roomState?.senders)}
        operatorIssue={operatorIssue}
        virtualMicState={virtualMicState}
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
        isCalibrating={isCalibrating}
        noiseFloorDb={noiseFloorDb}
        noiseReductionActive={noiseReductionActive}
        onRemoteGainChange={handleRemoteGainChange}
        onToggleRemoteMute={toggleRemoteMute}
        onToggleMonitoring={toggleMonitoring}
        onCalibrateNoise={startNoiseCalibration}
        onToggleNoiseReduction={toggleNoiseReduction}
        onSetNoiseFloor={setManualNoiseFloor}
        onStartAudioRecording={startAudioOnlyRecording}
        onStopAudioRecording={stopAudioOnlyRecording}
        onDisconnect={handleDisconnect}
      />
    </div>
  );
}

export default App;
