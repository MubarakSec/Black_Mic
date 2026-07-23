import React from 'react';
import { RefreshCw } from 'lucide-react';
import ConsoleHeader from './ConsoleHeader';
import LoggerPanel from './LoggerPanel';
import ReceiverControls from './ReceiverControls';
import RecordingLibrary from './RecordingLibrary';
import SenderControls from './SenderControls';
import StatusPanel from './StatusPanel';
import TelemetryStrip from './TelemetryStrip';
import VisualizerPanel from './VisualizerPanel';
import { ROLE_SENDER, ROLE_RECEIVER } from '../constants';

export default function StudioConsole({
  role,
  roomId,
  status,
  roomState,
  isPhoneConnected,
  operatorIssue,
  virtualMicState,
  isPhoneMuted,
  latency,
  bitrate,
  underruns,
  micSettings,
  canvasRef,
  orbRef,
  iconRef,
  vuBarRef,
  vuLabelRef,
  inputGain,
  setInputGain,
  channelMode,
  setChannelMode,
  audioProfile,
  setAudioProfile,
  outputVolume,
  setOutputVolume,
  jitterBufferMs,
  setJitterBufferMs,
  remotePhoneGain,
  remoteAckMsg,
  isMonitoring,
  isAudioRecording,
  recordingSeconds,
  recordings,
  logs,
  isCalibrating,
  noiseFloorDb,
  noiseReductionActive,
  onRemoteGainChange,
  onToggleRemoteMute,
  onToggleMonitoring,
  onCalibrateNoise,
  onToggleNoiseReduction,
  onSetNoiseFloor,
  onStartAudioRecording,
  onStopAudioRecording,
  onDisconnect,
}) {
  const isSender = role === ROLE_SENDER;
  const isReceiver = role === ROLE_RECEIVER;

  return (
    <div className="console-panel text-center">
      <ConsoleHeader role={role} roomId={roomId} />
      <StatusPanel
        status={status}
        role={role}
        isPhoneMuted={isPhoneMuted}
        roomState={roomState}
        operatorIssue={operatorIssue}
        virtualMicState={virtualMicState}
      />
      <TelemetryStrip latency={latency} bitrate={bitrate} underruns={underruns} />
      <VisualizerPanel 
        role={role} 
        canvasRef={canvasRef} 
        orbRef={orbRef}
        iconRef={iconRef}
        vuBarRef={vuBarRef}
        vuLabelRef={vuLabelRef}
      />

      {isSender && (
        <SenderControls
          inputGain={inputGain}
          setInputGain={setInputGain}
          channelMode={channelMode}
          setChannelMode={setChannelMode}
          audioProfile={audioProfile}
          setAudioProfile={setAudioProfile}
          micSettings={micSettings}
          isCalibrating={isCalibrating}
          noiseFloorDb={noiseFloorDb}
          noiseReductionActive={noiseReductionActive}
          onCalibrateNoise={onCalibrateNoise}
          onToggleNoiseReduction={onToggleNoiseReduction}
          onSetNoiseFloor={onSetNoiseFloor}
        />
      )}

      {isReceiver && (
        <ReceiverControls
          outputVolume={outputVolume}
          setOutputVolume={setOutputVolume}
          jitterBufferMs={jitterBufferMs}
          setJitterBufferMs={setJitterBufferMs}
          remotePhoneGain={remotePhoneGain}
          isPhoneMuted={isPhoneMuted}
          remoteAckMsg={remoteAckMsg}
          isMonitoring={isMonitoring}
          isAudioRecording={isAudioRecording}
          recordingSeconds={recordingSeconds}
          isPhoneConnected={isPhoneConnected}
          onRemoteGainChange={onRemoteGainChange}
          onToggleRemoteMute={onToggleRemoteMute}
          onToggleMonitoring={onToggleMonitoring}
          onStartAudioRecording={onStartAudioRecording}
          onStopAudioRecording={onStopAudioRecording}
        />
      )}

      <LoggerPanel logs={logs} />
      {isReceiver && recordings.length > 0 && <RecordingLibrary recordings={recordings} />}

      <button className="btn-danger mt-8 disconnect-button" onClick={onDisconnect}>
        <RefreshCw size={14} /> Disconnect / Restart
      </button>
    </div>
  );
}
