import React from 'react';

export default function TelemetryStrip({ latency, bitrate, packetLoss }) {
  return (
    <div className="telemetry-strip">
      <div className="telemetry-stat">
        <span className="telemetry-stat-label">LATENCY</span>
        <span className="telemetry-stat-value">{latency !== null ? `${latency} ms` : '--'}</span>
      </div>
      <div className="telemetry-stat">
        <span className="telemetry-stat-label">BITRATE</span>
        <span className="telemetry-stat-value">{bitrate !== null ? `${bitrate} kbps` : '--'}</span>
      </div>
      <div className="telemetry-stat">
        <span className="telemetry-stat-label">LOSS RATE</span>
        <span className="telemetry-stat-value">{packetLoss}%</span>
      </div>
    </div>
  );
}
