import React from 'react';

const PROFILE_LABELS = {
  raw:   'RAW — No browser DSP, no Android filters',
  clean: 'CLEAN — 80 Hz HPF + Compressor (Web Audio)',
  call:  'CALL — Android EC + NS (for open speakers)',
};

// What each profile REQUESTS from Android
const PROFILE_WANTS = {
  raw:   { noiseSuppression: false, echoCancellation: false },
  clean: { noiseSuppression: false, echoCancellation: false },
  call:  { noiseSuppression: true,  echoCancellation: true  },
};

function ProfileCheck({ label, requested, actual }) {
  const match = actual === requested;
  const icon = match ? '✅' : '❌';
  const color = match ? '#00f58c' : '#ff4d4d';
  const actualText = actual ? 'ON' : 'OFF';
  const note = match ? '' : requested ? ' (Android ignored request!)' : ' (Android forced this ON!)';
  return (
    <div style={{ color, fontSize: '0.78rem' }}>
      {icon} <span style={{ opacity: 0.7, color: '#fff' }}>{label}:</span> {actualText}{note}
    </div>
  );
}

export default function SenderControls({
  inputGain,
  setInputGain,
  channelMode,
  setChannelMode,
  audioProfile,
  setAudioProfile,
  micSettings,
}) {
  const wants = PROFILE_WANTS[audioProfile];

  return (
    <>
      <div className="slider-container">
        <div className="slider-label">
          <span>Microphone Input Gain</span>
          <span className="value-sender">{(inputGain * 100).toFixed(0)}% ({inputGain.toFixed(2)}×)</span>
        </div>
        <input
          type="range"
          min="0"
          max="2"
          step="0.01"
          value={inputGain}
          onChange={(e) => setInputGain(parseFloat(e.target.value))}
          className="slider-input accent-sender"
        />
      </div>

      <div className="channel-mode-row">
        <span>Audio Profile</span>
        <div className="segmented-control" style={{ flex: '2', display: 'flex', gap: '0' }}>
          <button
            className={`btn-control ${audioProfile === 'raw' ? 'is-sender-active' : ''}`}
            onClick={() => setAudioProfile('raw')}
            style={{ flex: '1', padding: '0.4rem 0' }}
          >
            RAW
          </button>
          <button
            className={`btn-control ${audioProfile === 'clean' ? 'is-sender-active' : ''}`}
            onClick={() => setAudioProfile('clean')}
            style={{ flex: '1', padding: '0.4rem 0' }}
          >
            CLEAN
          </button>
          <button
            className={`btn-control ${audioProfile === 'call' ? 'is-sender-active' : ''}`}
            onClick={() => setAudioProfile('call')}
            style={{ flex: '1', padding: '0.4rem 0' }}
          >
            CALL
          </button>
        </div>
      </div>

      <div style={{ fontSize: '0.73rem', opacity: 0.55, marginTop: '0.2rem', textAlign: 'center', fontStyle: 'italic' }}>
        {PROFILE_LABELS[audioProfile]}
      </div>

      <div className="channel-mode-row">
        <span>Channel Mode</span>
        <div className="segmented-control">
          <button
            className={`btn-control ${channelMode === 'mono' ? 'is-sender-active' : ''}`}
            onClick={() => setChannelMode('mono')}
          >
            MONO
          </button>
          <button
            className={`btn-control ${channelMode === 'stereo' ? 'is-receiver-active' : ''}`}
            onClick={() => setChannelMode('stereo')}
          >
            STEREO
          </button>
        </div>
      </div>

      {micSettings && (
        <div style={{
          marginTop: '1rem',
          fontSize: '0.8rem',
          textAlign: 'left',
          background: 'rgba(0,0,0,0.3)',
          padding: '12px',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ marginBottom: '8px', fontWeight: 'bold', color: 'var(--accent-1)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            🔍 Phone Audio Diagnostics
          </div>

          {/* Hardware facts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', marginBottom: '8px', opacity: 0.85 }}>
            <div><span style={{ opacity: 0.55 }}>Mic:</span> {micSettings.label || 'Unknown'}</div>
            <div><span style={{ opacity: 0.55 }}>Rate:</span> {micSettings.sampleRate} Hz</div>
            <div><span style={{ opacity: 0.55 }}>Channels:</span> {micSettings.channelCount}</div>
          </div>

          {/* Profile compliance: requested vs actual */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '7px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '0.72rem', opacity: 0.45, marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Profile Compliance
            </div>
            <ProfileCheck
              label="Noise Suppression"
              requested={wants.noiseSuppression}
              actual={micSettings.noiseSuppression}
            />
            <ProfileCheck
              label="Echo Cancellation"
              requested={wants.echoCancellation}
              actual={micSettings.echoCancellation}
            />
            <div style={{ fontSize: '0.78rem', color: micSettings.autoGainControl ? '#ff4d4d' : '#00f58c' }}>
              {micSettings.autoGainControl ? '❌' : '✅'}{' '}
              <span style={{ opacity: 0.7, color: '#fff' }}>Auto Gain Control:</span>{' '}
              {micSettings.autoGainControl ? 'ON (Android forced)' : 'OFF'}
            </div>
          </div>
        </div>
      )}

      {!micSettings && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.73rem', opacity: 0.4, textAlign: 'center' }}>
          Diagnostics appear after mic connects
        </div>
      )}
    </>
  );
}
