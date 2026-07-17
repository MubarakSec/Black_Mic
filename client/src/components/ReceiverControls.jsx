import React from 'react';
import { Mic, Square } from 'lucide-react';
import RemoteControlPanel from './RemoteControlPanel';

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function ReceiverControls({
  outputVolume,
  setOutputVolume,
  jitterBufferMs,
  setJitterBufferMs,
  remotePhoneGain,
  isPhoneMuted,
  remoteAckMsg,
  isMonitoring,
  isAudioRecording,
  recordingSeconds,
  onRemoteGainChange,
  onToggleRemoteMute,
  onToggleMonitoring,
  onStartAudioRecording,
  onStopAudioRecording,
}) {
  return (
    <>
      <div className="slider-container">
        <div className="slider-label">
          <span>USB Jitter Buffer (Latency)</span>
          <span className="value-receiver">{jitterBufferMs}ms</span>
        </div>
        <input
          type="range"
          min="10"
          max="150"
          step="5"
          value={jitterBufferMs}
          onChange={(e) => setJitterBufferMs(parseInt(e.target.value, 10))}
          className="slider-input accent-receiver"
        />
      </div>

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
      </div>

      {isAudioRecording && (
        <div className="recording-status-bar" style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1.25rem', fontSize: '0.85rem', fontFamily: 'JetBrains Mono', color: 'var(--danger-color)', fontWeight: '600' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <span className="rec-dot"></span>
            REC {formatTime(recordingSeconds)}
          </span>
        </div>
      )}
    </>
  );
}
