import React from 'react';

export default function RecordingLibrary({ recordings }) {
  return (
    <div className="telemetry-panel mt-8" style={{ background: 'rgba(0, 0, 0, 0.4)' }}>
      <div className="telemetry-header">🎥 RECORDING LIBRARY (TAKES LIST)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
        {recordings.map((rec, index) => {
          const ext = rec.mimeType.includes('mp4') ? 'mp4' : 'webm';
          return (
            <div key={rec.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--panel-border)', padding: '0.75rem 1rem', borderRadius: '6px' }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff' }}>
                  Take #{recordings.length - index} ({rec.timestamp})
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono', marginTop: '0.15rem' }}>
                  Duration: {rec.duration} | Size: {rec.size} | Format: {ext.toUpperCase()}
                </div>
              </div>
              <div>
                <a 
                  href={rec.url} 
                  download={`${rec.filename}.${ext}`}
                  className="btn-control"
                  style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', background: 'rgba(0, 210, 255, 0.1)', color: 'var(--accent-2)', borderColor: 'var(--accent-2)' }}
                >
                  Download
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
