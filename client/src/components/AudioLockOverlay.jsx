import React from 'react';
import { Volume2 } from 'lucide-react';

export default function AudioLockOverlay({ onUnlock }) {
  return (
    <div className="audio-lock-overlay" onClick={onUnlock}>
      <div className="audio-lock-content">
        <Volume2 size={64} className="pulse-icon" />
        <h2>AUDIO OUTPUT LOCKED</h2>
        <p>The browser blocked auto-playback. Click anywhere on this screen to unlock the audio stream.</p>
        <button className="btn-control mt-8">Unlock Audio</button>
      </div>
    </div>
  );
}
