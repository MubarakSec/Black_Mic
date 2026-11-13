import React, { useEffect } from 'react';
import { Volume2 } from 'lucide-react';

export default function AudioLockOverlay({ onUnlock }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onUnlock?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onUnlock]);

  return (
    <div
      className="audio-lock-overlay"
      onClick={onUnlock}
      role="dialog"
      aria-modal="true"
      aria-labelledby="audio-lock-title"
      aria-describedby="audio-lock-description"
    >
      <div className="audio-lock-content">
        <Volume2 size={64} className="pulse-icon" aria-hidden="true" />
        <h2 id="audio-lock-title">AUDIO OUTPUT LOCKED</h2>
        <p id="audio-lock-description">The browser blocked auto-playback. Click anywhere on this screen to unlock the audio stream.</p>
        <button type="button" className="btn-control mt-8" autoFocus onClick={(e) => { e.stopPropagation(); onUnlock?.(); }}>Unlock Audio</button>
      </div>
    </div>
  );
}
