import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function SignalLostOverlay() {
  return (
    <div className="alarm-overlay">
      <div className="alarm-content">
        <AlertTriangle size={48} color="var(--danger-color)" />
        <h2>MICROPHONE DISCONNECTED!</h2>
        <p>The audio stream stopped. Check your phone's USB connection.</p>
      </div>
    </div>
  );
}
