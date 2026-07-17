import React from 'react';

export default function RemoteControlPanel({
  isPhoneMuted,
  remotePhoneGain,
  remoteAckMsg,
  onGainChange,
  onToggleMute,
}) {
  return (
    <div className="remote-panel">
      <div className="remote-panel-header">
        <span>Remote Phone Controls</span>
        <button className={`btn-control ${isPhoneMuted ? 'is-danger-active' : ''}`} onClick={onToggleMute}>
          {isPhoneMuted ? 'Phone Mic Muted' : 'Mute Phone Mic'}
        </button>
      </div>
      <div className="slider-label compact">
        <span>Remote Microphone Gain</span>
        <span className="value-sender">{Math.round(remotePhoneGain * 100)}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="2"
        step="0.01"
        value={remotePhoneGain}
        onChange={onGainChange}
        className="slider-input accent-sender"
      />
      {remoteAckMsg && <div className="ack-message">{remoteAckMsg}</div>}
    </div>
  );
}
