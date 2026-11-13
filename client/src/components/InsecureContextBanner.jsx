import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Shown when the page is served over plain HTTP on a non-localhost host.
 * Browsers refuse microphone access in that context, so the app cannot
 * work — USB mode (adb reverse → localhost) or HTTPS is required.
 */
export default function InsecureContextBanner() {
  if (typeof window === 'undefined') return null;
  if (window.isSecureContext) return null;

  return (
    <div className="setup-error" role="alert" style={{ marginBottom: '0.5rem' }}>
      <AlertTriangle size={18} aria-hidden="true" />
      <div>
        <strong>Microphone blocked: this page is not secure</strong>
        <span>
          Browsers only allow mic access on HTTPS or localhost. Use USB mode
          (./start.sh, then open localhost:3001 on the phone via adb reverse)
          or serve with HTTPS certificates.
        </span>
      </div>
    </div>
  );
}
