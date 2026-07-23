import React from 'react';
import { AlertTriangle, LoaderCircle, Mic, Volume2 } from 'lucide-react';
import { ROLE_RECEIVER, ROLE_SENDER } from '../constants';

export default function RoomSelector({
  roomId,
  setRoomId,
  onStartSender,
  onStartReceiver,
  startingRole,
  startError,
}) {
  const isStarting = Boolean(startingRole);

  return (
    <div className="console-panel text-center">
      <h1 className="title">Black Mic Studio</h1>
      <p className="subtitle">Connect your phone microphone to this PC.</p>
      
      <div className="room-input-container">
        <label className="room-input-label" htmlFor="studio-room-id">Studio Room ID</label>
        <input 
          id="studio-room-id"
          type="text" 
          value={roomId} 
          maxLength={12}
          onChange={(e) => setRoomId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          className="room-input"
          aria-describedby="studio-room-hint"
          disabled={isStarting}
        />
        <span id="studio-room-hint" className="room-input-hint">Use the same ID on both devices to pair.</span>
      </div>

      {startError && (
        <div className="setup-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Could not start this console</strong>
            <span>{startError}</span>
          </div>
        </div>
      )}
      
      <div className="card-grid">
        <button
          className="role-card"
          onClick={onStartSender}
          aria-label="Use this device as the phone microphone"
          disabled={isStarting}
        >
          <div className="icon-wrapper">
            {startingRole === ROLE_SENDER
              ? <LoaderCircle size={36} className="spinner-icon" aria-hidden="true" />
              : <Mic size={36} color="var(--accent-1)" aria-hidden="true" />}
          </div>
          <h2>{startingRole === ROLE_SENDER ? 'Starting microphone…' : 'Phone (Microphone)'}</h2>
          <p>Capture and send phone audio</p>
        </button>
        
        <button
          className="role-card"
          onClick={onStartReceiver}
          aria-label="Use this device as the PC audio receiver"
          disabled={isStarting}
        >
          <div className="icon-wrapper">
            {startingRole === ROLE_RECEIVER
              ? <LoaderCircle size={36} className="spinner-icon" aria-hidden="true" />
              : <Volume2 size={36} color="var(--accent-2)" aria-hidden="true" />}
          </div>
          <h2>{startingRole === ROLE_RECEIVER ? 'Starting receiver…' : 'PC (Receiver)'}</h2>
          <p>Route phone audio into desktop apps</p>
        </button>
      </div>
    </div>
  );
}
