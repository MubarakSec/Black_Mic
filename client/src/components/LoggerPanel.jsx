import React from 'react';

export default function LoggerPanel({ logs }) {
  return (
    <div className="telemetry-panel">
      <div className="telemetry-header">SYSTEM TELEMETRY LOG</div>
      <div className="telemetry-content">
        {logs.length === 0 && <div className="telemetry-empty">No telemetry events logged yet.</div>}
        {logs.map((log, i) => <div className="telemetry-line" key={i}>{log}</div>)}
      </div>
    </div>
  );
}
