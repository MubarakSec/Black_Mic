import React from 'react';
import { Mic, Square, Video } from 'lucide-react';
import RemoteControlPanel from './RemoteControlPanel';

export default function ReceiverControls({
  outputVolume,
  setOutputVolume,
  remotePhoneGain,
  isPhoneMuted,
  remoteAckMsg,
  isMonitoring,
  isAudioRecording,
  isVaapiRecording,
  onRemoteGainChange,
  onToggleRemoteMute,
  onToggleMonitoring,
  onStartAudioRecording,
  onStopAudioRecording,
  onStartVaapiRecording,
  onStopVaapiRecording,
}) {
  return (
    <>
      <div className="slider-container">
        <div className="slider-label">
          <span>Speaker Output Volume</span>
          <span className="value-receiver">{Math.round(outputVolume * 100)}%</span>
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

      <RemoteControlPanel
        isPhoneMuted={isPhoneMuted}
        remotePhoneGain={remotePhoneGain}
        remoteAckMsg={remoteAckMsg}
        onGainChange={onRemoteGainChange}
        onToggleMute={onToggleRemoteMute}
      />

      <div className="control-row">
        <button className={`btn-control ${isMonitoring ? 'is-receiver-active' : ''}`} onClick={onToggleMonitoring}>
          {isMonitoring ? 'Feedback Active' : 'Enable Live Feedback'}
        </button>

        {!isAudioRecording ? (
          <button className="btn-control is-sender-soft" onClick={onStartAudioRecording}>
            <Mic size={16} /> Record Audio Only
          </button>
        ) : (
          <button className="btn-control is-warning-active" onClick={onStopAudioRecording}>
            <Square size={16} /> Stop Audio Recording
          </button>
        )}

        {!isVaapiRecording ? (
          <button className="btn-control is-danger-soft" onClick={onStartVaapiRecording}>
            <Video size={16} /> Record Screen (VAAPI)
          </button>
        ) : (
          <button className="btn-control is-warning-active" onClick={onStopVaapiRecording}>
            <Square size={16} /> Stop VAAPI Recording
          </button>
        )}
      </div>
    </>
  );
}
