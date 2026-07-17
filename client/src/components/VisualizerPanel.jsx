import React from 'react';
import { Mic, Volume2 } from 'lucide-react';
import { ROLE_SENDER } from '../constants';

export default function VisualizerPanel({ role, canvasRef, orbRef, iconRef, vuBarRef, vuLabelRef }) {
  const isSender = role === ROLE_SENDER;
  
  return (
    <div className="visualizer-section">
      <div className="visualizer-container">
        <div 
          ref={orbRef}
          className="glow-orb" 
          style={{ 
            transform: 'scale(1)',
            opacity: 0.3,
            background: isSender 
              ? 'radial-gradient(circle, var(--accent-1) 0%, transparent 70%)' 
              : 'radial-gradient(circle, var(--accent-2) 0%, transparent 70%)'
          }}
        />
        <div 
          ref={iconRef}
          className="icon-center"
          style={{ 
            color: '#fff',
            transition: 'color 0.1s ease'
          }}
        >
          {isSender ? (
            <Mic size={40} color="currentColor" />
          ) : (
            <Volume2 size={40} color="currentColor" />
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
          opacity: 0.2,
          transition: 'opacity 0.3s ease'
        }} 
      />

      {/* dynamic VU Meter bar */}
      <div className="vu-meter">
        <div className="vu-meter-label">
          <span>VU LEVEL</span>
          <span ref={vuLabelRef}>0%</span>
        </div>
        <div className="vu-meter-track">
          <div 
            ref={vuBarRef}
            className="vu-meter-bar" 
            style={{ 
              width: '0%',
              background: isSender ? 'var(--accent-1)' : 'var(--accent-2)',
              boxShadow: isSender ? '0 0 8px var(--accent-1)' : '0 0 8px var(--accent-2)'
            }}
          />
        </div>
      </div>
    </div>
  );
}
