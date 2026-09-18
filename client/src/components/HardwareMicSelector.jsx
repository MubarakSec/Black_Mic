import React from 'react';

export default function HardwareMicSelector({
  availableMics = [],
  selectedDeviceId = '',
  onSelectDevice,
  selectedDeviceRecommendation,
}) {
  if (!availableMics || availableMics.length === 0) return null;

  return (
    <div className="channel-mode-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem', marginTop: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
        <span>Hardware Microphone</span>
        {selectedDeviceRecommendation?.badge && (
          <span style={{ fontSize: '0.75rem', color: selectedDeviceRecommendation.isRecommended ? '#00f58c' : '#ffb84d', fontWeight: 'bold' }}>
            {selectedDeviceRecommendation.badge}
          </span>
        )}
      </div>
      <select
        id="microphone-device-select"
        value={selectedDeviceId || ''}
        onChange={(e) => onSelectDevice?.(e.target.value)}
        className="slider-input"
        style={{
          padding: '0.5rem 0.6rem',
          background: 'rgba(20, 24, 30, 0.95)',
          color: '#fff',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '6px',
          fontSize: '0.82rem',
          cursor: 'pointer',
        }}
      >
        {availableMics.map((mic) => (
          <option key={mic.deviceId} value={mic.deviceId} style={{ background: '#14181e', color: '#fff' }}>
            {mic.displayName}
          </option>
        ))}
      </select>
      {selectedDeviceRecommendation?.explanation && (
        <div style={{ fontSize: '0.73rem', opacity: 0.7, fontStyle: 'italic', textAlign: 'left', marginTop: '0.1rem' }}>
          💡 {selectedDeviceRecommendation.explanation}
        </div>
      )}
    </div>
  );
}
