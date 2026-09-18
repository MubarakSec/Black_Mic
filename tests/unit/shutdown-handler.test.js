import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createShutdownHandler,
  SHUTDOWN_TIMEOUT_MS,
  FORCE_EXIT_CODE,
  SUCCESS_EXIT_CODE,
} = require('../../server/shutdown-handler');

describe('shutdown-handler', () => {
  let mockServer;
  let mockIo;
  let mockRecording;
  let mockExit;

  beforeEach(() => {
    mockServer = {
      listening: true,
      close: vi.fn((callback) => callback?.()),
    };
    mockIo = {
      close: vi.fn(),
    };
    mockRecording = {
      cleanupAllRooms: vi.fn(async () => {}),
    };
    mockExit = vi.fn();
  });

  it('performs graceful shutdown in correct sequence and exits with code 0', async () => {
    const handler = createShutdownHandler({
      server: mockServer,
      io: mockIo,
      recording: mockRecording,
      onExit: mockExit,
    });

    await handler.handleShutdown('SIGTERM');

    expect(mockIo.close).toHaveBeenCalledOnce();
    expect(mockServer.close).toHaveBeenCalledOnce();
    expect(mockRecording.cleanupAllRooms).toHaveBeenCalledOnce();
    expect(mockExit).toHaveBeenCalledWith(SUCCESS_EXIT_CODE);
  });

  it('forces immediate exit with code 1 on repeated signal', async () => {
    const handler = createShutdownHandler({
      server: mockServer,
      io: mockIo,
      recording: mockRecording,
      onExit: mockExit,
    });

    const firstShutdownPromise = handler.handleShutdown('SIGINT');
    await handler.handleShutdown('SIGINT');

    expect(mockExit).toHaveBeenCalledWith(FORCE_EXIT_CODE);
    await firstShutdownPromise;
  });

  it('exits with code 1 if an error occurs during cleanup', async () => {
    mockRecording.cleanupAllRooms.mockRejectedValueOnce(new Error('Cleanup failure'));

    const handler = createShutdownHandler({
      server: mockServer,
      io: mockIo,
      recording: mockRecording,
      onExit: mockExit,
    });

    await handler.handleShutdown('SIGTERM');

    expect(mockExit).toHaveBeenCalledWith(FORCE_EXIT_CODE);
  });

  it('handles server not listening gracefully without calling server.close', async () => {
    mockServer.listening = false;

    const handler = createShutdownHandler({
      server: mockServer,
      io: mockIo,
      recording: mockRecording,
      onExit: mockExit,
    });

    await handler.handleShutdown('SIGTERM');

    expect(mockServer.close).not.toHaveBeenCalled();
    expect(mockRecording.cleanupAllRooms).toHaveBeenCalledOnce();
    expect(mockExit).toHaveBeenCalledWith(SUCCESS_EXIT_CODE);
  });

  it('forcefully exits if shutdown times out', async () => {
    vi.useFakeTimers();
    try {
      mockRecording.cleanupAllRooms = vi.fn(() => new Promise(() => {})); // Never resolves

      const handler = createShutdownHandler({
        server: mockServer,
        io: mockIo,
        recording: mockRecording,
        onExit: mockExit,
        timeoutMs: 500,
      });

      handler.handleShutdown('SIGTERM');

      vi.advanceTimersByTime(500);

      expect(mockExit).toHaveBeenCalledWith(FORCE_EXIT_CODE);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks isShuttingDown status accurately', async () => {
    const handler = createShutdownHandler({
      server: mockServer,
      io: mockIo,
      recording: mockRecording,
      onExit: mockExit,
    });

    expect(handler.isShuttingDown()).toBe(false);
    const shutdownPromise = handler.handleShutdown('SIGTERM');
    expect(handler.isShuttingDown()).toBe(true);
    await shutdownPromise;
    expect(handler.isShuttingDown()).toBe(true);
  });
});
