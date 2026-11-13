'use strict';

const ROLE_TAKEN_CODE = 'ROLE_TAKEN';
const ROLE_LABELS = {
  sender: 'phone',
  receiver: 'PC receiver',
};

function createRoomRegistry() {
  // Source of truth: socketId -> { roomId, role }
  const entries = new Map();
  // Index: roomId -> role -> Set(socketId). Keeps join/leave/query O(1)
  // instead of scanning every socket for each room-state emission.
  const roomsById = new Map();

  function roleSet(roomId, role) {
    let roleMap = roomsById.get(roomId);
    if (!roleMap) {
      roleMap = new Map();
      roomsById.set(roomId, roleMap);
    }
    let members = roleMap.get(role);
    if (!members) {
      members = new Set();
      roleMap.set(role, members);
    }
    return members;
  }

  function peekRoleSet(roomId, role) {
    return roomsById.get(roomId)?.get(role) || null;
  }

  function indexAdd(socketId, roomId, role) {
    roleSet(roomId, role).add(socketId);
  }

  function indexRemove(socketId, roomId, role) {
    const roleMap = roomsById.get(roomId);
    if (!roleMap) return;
    const members = roleMap.get(role);
    if (!members) return;
    members.delete(socketId);
    if (members.size === 0) roleMap.delete(role);
    if (roleMap.size === 0) roomsById.delete(roomId);
  }

  function findRoleOccupant(roomId, role, excludedSocketId) {
    const members = peekRoleSet(roomId, role);
    if (!members) return null;
    for (const socketId of members) {
      if (socketId === excludedSocketId) continue;
      return [socketId, entries.get(socketId)];
    }
    return null;
  }

  function get(socketId) {
    return entries.get(socketId) || null;
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
    if (previous) {
      indexRemove(socketId, previous.roomId, previous.role);
    }
    entries.set(socketId, { roomId, role });
    indexAdd(socketId, roomId, role);
    return { ok: true, previous };
  }

  function leave(socketId) {
    const entry = get(socketId);
    if (!entry) return null;
    entries.delete(socketId);
    indexRemove(socketId, entry.roomId, entry.role);
    return entry;
  }

  function hasRoomMembers(roomId) {
    const roleMap = roomsById.get(roomId);
    if (!roleMap) return false;
    for (const members of roleMap.values()) {
      if (members.size > 0) return true;
    }
    return false;
  }

  function countRole(roomId, role) {
    return peekRoleSet(roomId, role)?.size || 0;
  }

  function roomCount() {
    return roomsById.size;
  }

  function getRoomState(roomId) {
    return {
      roomId,
      senders: countRole(roomId, 'sender'),
      receivers: countRole(roomId, 'receiver'),
    };
  }

  return {
    get,
    getRoomState,
    hasRoomMembers,
    join,
    leave,
    roomCount,
  };
}

module.exports = { createRoomRegistry, ROLE_TAKEN_CODE };
