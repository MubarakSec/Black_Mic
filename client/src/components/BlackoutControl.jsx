import React, { useState, useEffect } from 'react';
import { Moon } from 'lucide-react';

export default function BlackoutControl({ restartBusy = false }) {
  const [isBlackoutActive, setIsBlackoutActive] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setIsBlackoutActive(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

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
        <button type="button" className="btn-control" onClick={startBlackout} disabled={restartBusy}>
          {restartBusy ? 'Restarting mic…' : 'Start'}
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
