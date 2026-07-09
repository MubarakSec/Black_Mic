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

export default function StudioConsole({
  role,
  roomId,
  status,
  roomState,
  operatorIssue,
  isPhoneMuted,
  latency,
  bitrate,
  underruns,
  canvasRef,
  orbRef,
  iconRef,
  vuBarRef,
  vuLabelRef,
  inputGain,
  setInputGain,
  channelMode,
  setChannelMode,
  outputVolume,
  setOutputVolume,
  remotePhoneGain,
  remoteAckMsg,
  isMonitoring,
  isAudioRecording,
  recordingSeconds,
  recordings,
  logs,
  onRemoteGainChange,
  onToggleRemoteMute,
  onToggleMonitoring,
  onStartAudioRecording,
  onStopAudioRecording,
  onDisconnect,
}) {
  const isSender = role === 'sender';
  const isReceiver = role === 'receiver';

  return (
    <div className="console-panel text-center">
      <ConsoleHeader role={role} roomId={roomId} />
      <StatusPanel status={status} role={role} isPhoneMuted={isPhoneMuted} roomState={roomState} operatorIssue={operatorIssue} />
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
        />
      )}

      {isReceiver && (
        <ReceiverControls
          outputVolume={outputVolume}
          setOutputVolume={setOutputVolume}
          remotePhoneGain={remotePhoneGain}
          isPhoneMuted={isPhoneMuted}
          remoteAckMsg={remoteAckMsg}
          isMonitoring={isMonitoring}
          isAudioRecording={isAudioRecording}
          recordingSeconds={recordingSeconds}
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
