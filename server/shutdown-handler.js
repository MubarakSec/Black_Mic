'use strict';

const { logger } = require('./logger');

const SHUTDOWN_TIMEOUT_MS = 3000;
const FORCE_EXIT_CODE = 1;
const SUCCESS_EXIT_CODE = 0;

function createShutdownHandler({
  server,
  io,
  recording,
  onExit = process.exit,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
}) {
  let isShuttingDown = false;

  async function handleShutdown(signal = 'SIGTERM') {
    if (isShuttingDown) {
      logger.warn(`Repeated shutdown signal (${signal}). Forcefully terminating...`);
      onExit(FORCE_EXIT_CODE);
      return;
    }
    isShuttingDown = true;
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    const forceTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out. Forcefully exiting...');
      onExit(FORCE_EXIT_CODE);
    }, timeoutMs);
    if (typeof forceTimer.unref === 'function') {
      forceTimer.unref();
    }

    try {
      if (io && typeof io.close === 'function') {
        // socket.io's close() also closes the attached HTTP server and
        // disconnects all clients; awaiting it ensures disconnect handlers run
        await io.close();
      }
      if (server && server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
      if (recording && typeof recording.cleanupAllRooms === 'function') {
        await recording.cleanupAllRooms();
      }
      clearTimeout(forceTimer);
      logger.info('Graceful shutdown complete. Exiting.');
      onExit(SUCCESS_EXIT_CODE);
    } catch (err) {
      clearTimeout(forceTimer);
      logger.error('Error during graceful shutdown:', err);
      onExit(FORCE_EXIT_CODE);
    }
  }

  function registerSignalListeners() {
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  }

  return {
    handleShutdown,
    registerSignalListeners,
    isShuttingDown: () => isShuttingDown,
  };
}

module.exports = {
  createShutdownHandler,
  SHUTDOWN_TIMEOUT_MS,
  FORCE_EXIT_CODE,
  SUCCESS_EXIT_CODE,
};
