import React from 'react';

export default function RemoteControlPanel({
  isPhoneMuted,
  remotePhoneGain,
  remoteAckMsg,
  isPhoneConnected,
  onGainChange,
  onToggleMute,
}) {
  return (
    <div className="remote-panel">
      <div className="remote-panel-header">
        <span>Remote Phone Controls</span>
        <button
          className={`btn-control ${isPhoneMuted ? 'is-danger-active' : ''}`}
          onClick={onToggleMute}
          disabled={!isPhoneConnected}
        >
          {isPhoneMuted ? 'Phone Mic Muted' : 'Mute Phone Mic'}
        </button>
      </div>
      <div className="slider-label compact">
        <label htmlFor="remote-microphone-gain">Remote Microphone Gain</label>
        <span className="value-sender">{Math.round(remotePhoneGain * 100)}%</span>
      </div>
      <input
        id="remote-microphone-gain"
        type="range"
        min="0"
        max="2"
        step="0.01"
        value={remotePhoneGain}
        onChange={onGainChange}
        className="slider-input accent-sender"
        disabled={!isPhoneConnected}
      />
      {remoteAckMsg && <div className="ack-message" role="status">{remoteAckMsg}</div>}
    </div>
  );
}
