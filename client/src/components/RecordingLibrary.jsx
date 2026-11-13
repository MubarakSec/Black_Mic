import React from 'react';

export default function RecordingLibrary({ recordings, onExportWav }) {
  return (
    <div className="telemetry-panel recording-library mt-8">
      <div className="telemetry-header">RECORDING LIBRARY</div>
      <div className="recording-list">
        {recordings.map((rec, index) => {
          const ext = rec.mimeType.includes('mp4') ? 'mp4' : 'webm';
          return (
            <div key={rec.id} className="recording-item">
              <div className="recording-meta">
                <div className="recording-title">
                  Take #{recordings.length - index} ({rec.timestamp})
                </div>
                <div className="recording-details">
                  Duration: {rec.duration} | Size: {rec.size} | Format: {ext.toUpperCase()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-control recording-download"
                  onClick={() => onExportWav?.(rec)}
                  disabled={!onExportWav}
                  title="Export lossless WAV (Int16)"
                >
                  WAV
                </button>
                <a
                  href={rec.url}
                  download={`${rec.filename}.${ext}`}
                  className="btn-control is-receiver-active recording-download"
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
