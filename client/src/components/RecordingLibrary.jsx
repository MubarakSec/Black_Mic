import React from 'react';

export default function RecordingLibrary({ recordings }) {
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
              <div>
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
