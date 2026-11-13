import React, { memo } from 'react';

const LATENCY_LABEL = '--';
const BITRATE_LABEL = '--';

function formatLatency(latency) {
  if (!Number.isFinite(latency)) return `${LATENCY_LABEL} ms`;
  return `${Math.max(0, Math.round(latency))} ms`;
}

function formatBitrate(bitrate) {
  if (!Number.isFinite(bitrate)) return `${BITRATE_LABEL} kbps`;
  return `${Math.max(0, Math.round(bitrate))} kbps`;
}

const TelemetryStrip = memo(function TelemetryStrip({ latency, bitrate, underruns }) {
  return (
    <div className="telemetry-strip">
      <div className="telemetry-stat">
        <span className="telemetry-stat-label">LATENCY</span>
        <span className="telemetry-stat-value">{latency !== null ? formatLatency(latency) : '-- ms'}</span>
      </div>
      <div className="telemetry-stat">
        <span className="telemetry-stat-label">BITRATE</span>
        <span className="telemetry-stat-value">{bitrate !== null ? formatBitrate(bitrate) : '-- kbps'}</span>
      </div>
      <div className="telemetry-stat">
        <span className="telemetry-stat-label">UNDERRUNS</span>
        <span className="telemetry-stat-value">{underruns}</span>
      </div>
    </div>
  );
});

export default TelemetryStrip;
