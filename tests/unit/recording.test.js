import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  initRoom,
  cleanupRoom,
  cleanupAllRooms,
  setPactlRunnerForTest,
} = require('../../server/recording');

describe('recording cleanup and lifecycle', () => {
  let pactlCalls;

  beforeEach(() => {
    pactlCalls = [];
    let nextModuleId = 100;
    setPactlRunnerForTest(async (args) => {
      pactlCalls.push([...args]);
      if (args[0] === 'load-module') {
        nextModuleId += 1;
        return { code: 0, out: String(nextModuleId) };
      }
      if (args[0] === 'unload-module') {
        return { code: 0, out: '' };
      }
      return { code: 0, out: '' };
    });
  });

  afterEach(async () => {
    await cleanupAllRooms();
    setPactlRunnerForTest(null);
  });

  it('initializes room and cleans it up unloading source and sink modules', async () => {
    const roomId = 'CLEAN1';
    const initResult = await initRoom(roomId);
    expect(initResult.ok).toBe(true);

    // Initialized: loaded sink and loaded remap-source
    const loadCalls = pactlCalls.filter(call => call[0] === 'load-module');
    expect(loadCalls).toHaveLength(2);

    await cleanupRoom(roomId);

    // Cleaned up: unloaded source and unloaded sink
    const unloadCalls = pactlCalls.filter(call => call[0] === 'unload-module');
    expect(unloadCalls).toHaveLength(2);
    expect(unloadCalls[0]).toEqual(['unload-module', '102']); // source first
    expect(unloadCalls[1]).toEqual(['unload-module', '101']); // sink second
  });

  it('cleans up all active rooms in cleanupAllRooms', async () => {
    const room1 = 'ALL1';
    const room2 = 'ALL2';

    await initRoom(room1);
    await initRoom(room2);

    const loadCalls = pactlCalls.filter(call => call[0] === 'load-module');
    expect(loadCalls).toHaveLength(4);

    await cleanupAllRooms();

    const unloadCalls = pactlCalls.filter(call => call[0] === 'unload-module');
    expect(unloadCalls).toHaveLength(4);
  });

  it('handles cleanupAllRooms safely when no rooms are active', async () => {
    await expect(cleanupAllRooms()).resolves.not.toThrow();
  });
});
