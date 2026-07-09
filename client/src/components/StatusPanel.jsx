import React from 'react';
import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';

function getStatusIcon(status) {
  const isConnected = status.includes('Connected') || status.includes('Streaming') || status.includes('Broadcasting');
  if (isConnected) return <CheckCircle2 color="var(--success-color)" size={16} />;
  return <Activity color="var(--warning-color)" size={16} />;
}

export default function StatusPanel({ status, role, isPhoneMuted, roomState, operatorIssue }) {
  return (
    <div className="status-stack">
      <div className="status-badge">
        {getStatusIcon(status)}
        <span>{status}</span>
      </div>

      {roomState && (
        <div className="room-state-strip">
          <span>Phone: {roomState.senders}</span>
          <span>PC: {roomState.receivers}</span>
        </div>
      )}

      {operatorIssue && (
        <div className="status-badge status-warning">
          <AlertTriangle size={16} /> {operatorIssue}
        </div>
      )}

      {role === 'sender' && isPhoneMuted && (
        <div className="status-badge status-danger">
          <AlertTriangle size={16} /> MICROPHONE MUTED BY PC
        </div>
      )}

      {role === 'sender' && (
        <div className="status-badge status-note">
          <div>
            <strong><AlertTriangle size={14} /> KEEP THIS TAB VISIBLE</strong>
            <span>Switching browser tabs or locking the screen will pause audio capture.</span>
          </div>
        </div>
      )}
    </div>
  );
}
