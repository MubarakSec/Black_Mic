import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createRoomRegistry, ROLE_TAKEN_CODE } = require('../../server/room-registry');

describe('room registry', () => {
  let registry;

  beforeEach(() => {
    registry = createRoomRegistry();
  });

  it('allows one sender and one receiver in a room', () => {
    expect(registry.join('sender-1', 'ROOM', 'sender').ok).toBe(true);
    expect(registry.join('receiver-1', 'ROOM', 'receiver').ok).toBe(true);
    expect(registry.getRoomState('ROOM')).toEqual({
      roomId: 'ROOM',
      senders: 1,
      receivers: 1,
    });
  });

  it('rejects a duplicate role without removing the existing member', () => {
    registry.join('sender-1', 'ROOM', 'sender');

    const result = registry.join('sender-2', 'ROOM', 'sender');

    expect(result.ok).toBe(false);
    expect(result.code).toBe(ROLE_TAKEN_CODE);
    expect(registry.getRoomState('ROOM').senders).toBe(1);
  });

  it('returns the previous room when a socket moves', () => {
    registry.join('sender-1', 'OLD', 'sender');

    const result = registry.join('sender-1', 'NEW', 'sender');

    expect(result.previous).toEqual({ roomId: 'OLD', role: 'sender' });
    expect(registry.hasRoomMembers('OLD')).toBe(false);
    expect(registry.hasRoomMembers('NEW')).toBe(true);
  });

  it('returns and removes a socket membership on leave', () => {
    registry.join('receiver-1', 'ROOM', 'receiver');

    expect(registry.leave('receiver-1')).toEqual({ roomId: 'ROOM', role: 'receiver' });
    expect(registry.leave('receiver-1')).toBe(null);
  });
});
