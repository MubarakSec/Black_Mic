import React from 'react';
import { Mic, Volume2 } from 'lucide-react';

export default function RoomSelector({ roomId, setRoomId, onStartSender, onStartReceiver }) {
  return (
    <div className="console-panel text-center">
      <h1 className="title">Black Mic Studio</h1>
      <p className="subtitle">Select device console role</p>
      
      <div className="room-input-container">
        <label className="room-input-label">Studio Room ID</label>
        <input 
          type="text" 
          value={roomId} 
          maxLength={12}
          onChange={(e) => setRoomId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          className="room-input"
          aria-label="Studio Room Identification Code"
        />
        <span className="room-input-hint">Use the same ID on both devices to pair.</span>
      </div>
      
      <div className="card-grid">
        <button className="role-card" onClick={onStartSender} aria-label="Use this device as the phone microphone">
          <div className="icon-wrapper">
            <Mic size={36} color="var(--accent-1)" />
          </div>
          <h2>Phone (Microphone)</h2>
          <p>Stream compressed voice</p>
        </button>
        
        <button className="role-card" onClick={onStartReceiver} aria-label="Use this device as the PC audio receiver">
          <div className="icon-wrapper">
            <Volume2 size={36} color="var(--accent-2)" />
          </div>
          <h2>PC (Receiver)</h2>
          <p>Receive and play audio</p>
        </button>
      </div>
    </div>
  );
}
