import React, { useState } from 'react';
import { Moon } from 'lucide-react';

export default function BlackoutControl() {
  const [isBlackoutActive, setIsBlackoutActive] = useState(false);

  const startBlackout = async () => {
    setIsBlackoutActive(true);
    await document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const stopBlackout = async () => {
    setIsBlackoutActive(false);
    if (!document.fullscreenElement) return;
    await document.exitFullscreen?.().catch(() => {});
  };

  return (
    <>
      <div className="blackout-control">
        <div>
          <strong><Moon size={15} /> Battery-saving black screen</strong>
          <span>Keeps Chrome and microphone active. Lower phone brightness, then tap to restore.</span>
        </div>
        <button type="button" className="btn-control" onClick={startBlackout}>
          Start
        </button>
      </div>
      {isBlackoutActive && (
        <button type="button" className="blackout-screen" onClick={stopBlackout}>
          <span>● Recording · tap to restore</span>
        </button>
      )}
    </>
  );
}
