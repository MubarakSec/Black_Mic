import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function SignalLostOverlay() {
  return (
    <div className="alarm-overlay" role="alert" aria-live="assertive">
      <div className="alarm-content">
        <AlertTriangle size={48} color="var(--danger-color)" aria-hidden="true" />
        <h2>MICROPHONE DISCONNECTED!</h2>
        <p>The audio stream stopped. Check the phone connection and keep its sender page open.</p>
      </div>
    </div>
  );
}
