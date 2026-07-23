'use strict';

const ROLE_TAKEN_CODE = 'ROLE_TAKEN';
const ROLE_LABELS = {
  sender: 'phone',
  receiver: 'PC receiver',
};

function createRoomRegistry() {
  const entries = new Map();

  function get(socketId) {
    return entries.get(socketId) || null;
  }

  function findRoleOccupant(roomId, role, excludedSocketId) {
    return Array.from(entries.entries()).find(([socketId, entry]) => {
      if (socketId === excludedSocketId) return false;
      return entry.roomId === roomId && entry.role === role;
    });
  }

  function join(socketId, roomId, role) {
    const occupant = findRoleOccupant(roomId, role, socketId);
    if (occupant) {
      const roleLabel = ROLE_LABELS[role] || role;
      return {
        ok: false,
        code: ROLE_TAKEN_CODE,
        message: `A ${roleLabel} is already connected to room ${roomId}.`,
      };
    }

    const previous = get(socketId);
    entries.set(socketId, { roomId, role });
    return { ok: true, previous };
  }

  function leave(socketId) {
    const entry = get(socketId);
    if (!entry) return null;
    entries.delete(socketId);
    return entry;
  }

  function hasRoomMembers(roomId) {
    return Array.from(entries.values()).some(entry => entry.roomId === roomId);
  }

  function getRoomState(roomId) {
    return Array.from(entries.values()).reduce((state, entry) => {
      if (entry.roomId !== roomId) return state;
      if (entry.role === 'sender') return { ...state, senders: state.senders + 1 };
      if (entry.role === 'receiver') return { ...state, receivers: state.receivers + 1 };
      return state;
    }, { roomId, senders: 0, receivers: 0 });
  }

  return {
    get,
    getRoomState,
    hasRoomMembers,
    join,
    leave,
  };
}

module.exports = { createRoomRegistry, ROLE_TAKEN_CODE };
