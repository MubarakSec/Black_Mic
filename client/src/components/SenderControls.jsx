import React from 'react';

export default function SenderControls({ inputGain, setInputGain, channelMode, setChannelMode }) {
  return (
    <>
      <div className="slider-container">
        <div className="slider-label">
          <span>Microphone Input Gain</span>
          <span className="value-sender">{Math.round(inputGain * 100)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="10"
          step="0.05"
          value={inputGain}
          onChange={(e) => setInputGain(parseFloat(e.target.value))}
          className="slider-input accent-sender"
        />
      </div>

      <div className="channel-mode-row">
        <span>Channel Mode</span>
        <div className="segmented-control">
          <button className={`btn-control ${channelMode === 'mono' ? 'is-sender-active' : ''}`} onClick={() => setChannelMode('mono')}>
            MONO
          </button>
          <button className={`btn-control ${channelMode === 'stereo' ? 'is-receiver-active' : ''}`} onClick={() => setChannelMode('stereo')}>
            STEREO
          </button>
        </div>
      </div>
    </>
  );
}
