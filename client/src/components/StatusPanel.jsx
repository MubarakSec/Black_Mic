import React from 'react';
import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';

function getStatusIcon(status) {
  const isConnected = status.includes('Connected') || status.includes('Streaming') || status.includes('Broadcasting');
  if (isConnected) return <CheckCircle2 color="var(--success-color)" size={16} />;
  return <Activity color="var(--warning-color)" size={16} />;
}

function getVirtualMicLabel(virtualMicState) {
  if (!virtualMicState) return 'System mic: Preparing';
  if (virtualMicState.ready) return 'System mic: Ready';
  return 'System mic: Unavailable';
}

export default function StatusPanel({
  status,
  role,
  isPhoneMuted,
  roomState,
  operatorIssue,
  virtualMicState,
}) {
  return (
    <div className="status-stack">
      <div className="status-badge" role="status" aria-live="polite">
        {getStatusIcon(status)}
        <span>{status}</span>
      </div>

      {roomState && (
        <div className="room-state-strip">
          <span>Phone: {roomState.senders}</span>
          <span>PC: {roomState.receivers}</span>
          {role === 'receiver' && (
            <span className={virtualMicState?.ready ? 'system-mic-ready' : ''}>
              {getVirtualMicLabel(virtualMicState)}
            </span>
          )}
        </div>
      )}

      {operatorIssue && (
        <div className="status-badge status-warning" role="alert">
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
