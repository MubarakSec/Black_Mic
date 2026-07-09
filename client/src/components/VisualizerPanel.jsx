import React from 'react';
import { Mic, Volume2 } from 'lucide-react';

export default function VisualizerPanel({ role, volume, canvasRef }) {
  const isSender = role === 'sender';
  
  return (
    <div className="visualizer-section">
      <div className="visualizer-container">
        <div 
          className="glow-orb" 
          style={{ 
            transform: `scale(${1 + (volume / 255) * 1.3})`,
            opacity: 0.3 + (volume / 255) * 0.5,
            background: isSender 
              ? 'radial-gradient(circle, var(--accent-1) 0%, transparent 70%)' 
              : 'radial-gradient(circle, var(--accent-2) 0%, transparent 70%)'
          }}
        />
        <div className="icon-center">
          {isSender ? (
            <Mic size={40} color={volume > 30 ? 'var(--accent-1)' : '#fff'} style={{ transition: 'color 0.1s ease' }} />
          ) : (
            <Volume2 size={40} color={volume > 30 ? 'var(--accent-2)' : '#fff'} style={{ transition: 'color 0.1s ease' }} />
          )}
        </div>
      </div>

      {/* Canvas Spectrum visualizer */}
      <canvas 
        ref={canvasRef} 
        width={520} 
        height={120} 
        style={{ 
          width: '100%', 
          height: '60px', 
          display: 'block', 
          margin: '0.5rem 0 1rem 0', 
          borderRadius: '4px',
          opacity: volume > 5 ? 1 : 0.2,
          transition: 'opacity 0.3s ease'
        }} 
      />

      {/* dynamic VU Meter bar */}
      <div className="vu-meter">
        <div className="vu-meter-label">
          <span>VU LEVEL</span>
          <span>{Math.round((volume / 255) * 100)}%</span>
        </div>
        <div className="vu-meter-track">
          <div 
            className="vu-meter-bar" 
            style={{ 
              width: `${(volume / 255) * 100}%`,
              background: isSender ? 'var(--accent-1)' : 'var(--accent-2)',
              boxShadow: isSender ? '0 0 8px var(--accent-1)' : '0 0 8px var(--accent-2)'
            }}
          />
        </div>
      </div>
    </div>
  );
}
