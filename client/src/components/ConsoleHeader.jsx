import React from 'react';

export default function ConsoleHeader({ role, roomId }) {
  return (
    <div className="console-header">
      <h1 className="title">{role === 'sender' ? 'Broadcasting Console' : 'Studio Monitor'}</h1>
      <div className="room-pill">
        <span>ROOM:</span>
        <strong>{roomId}</strong>
      </div>
    </div>
  );
}
