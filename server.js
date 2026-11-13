'use strict';

const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./server/config');
const { createRoomRegistry } = require('./server/room-registry');
const { createShutdownHandler } = require('./server/shutdown-handler');
const { createUsbStatus } = require('./server/usb-status');
const { isOriginAllowed } = require('./server/origin-check');
const { logger } = require('./server/logger');

const recording = require('./server/recording');
const {
  isValidRemoteCommand,
  isValidRole,
  isValidRoomId,
  isValidTimestamp,
  normalizePcmChunk,
  PCM_MAGIC,
  HEADER_BYTE_LENGTH,
} = require('./server/socket-validation');

const app = express();
const INVALID_ROOM_CODE = 'INVALID_ROOM';
const INVALID_ROLE_CODE = 'INVALID_ROLE';
const RATE_LIMITED_CODE = 'RATE_LIMITED';
const JOIN_WINDOW_MS = 10_000;
const JOIN_MAX_ATTEMPTS = 10;
const joinAttempts = new Map();
const IP_JOIN_WINDOW_MS = 60_000;
const IP_JOIN_MAX_ATTEMPTS = 30;
const ipJoinAttempts = new Map();

function isJoinRateLimited(socketId, clientIp, now = Date.now()) {
  const attempts = (joinAttempts.get(socketId) || []).filter(t => now - t < JOIN_WINDOW_MS);
  if (attempts.length >= JOIN_MAX_ATTEMPTS) {
    joinAttempts.set(socketId, attempts);
    return true;
  }
  attempts.push(now);
  joinAttempts.set(socketId, attempts);

  const ipKey = clientIp || 'unknown';
  const ipAttempts = (ipJoinAttempts.get(ipKey) || []).filter(t => now - t < IP_JOIN_WINDOW_MS);
  if (ipAttempts.length >= IP_JOIN_MAX_ATTEMPTS) {
    ipJoinAttempts.set(ipKey, ipAttempts);
    return true;
  }
  ipAttempts.push(now);
  ipJoinAttempts.set(ipKey, ipAttempts);
  return false;
}

function clearJoinAttempts(socketId) {
  joinAttempts.delete(socketId);
}

const PCM_BUDGET_BYTES = 1536 * 1024;
const PCM_REFILL_BYTES_PER_SEC = 400 * 1024; // >= 96kHz stereo (384 KB/s) with headroom
const PCM_WARN_INTERVAL_MS = 5000;
const HANDSHAKE_WARN_INTERVAL_MS = 5000;
const MAX_ORIGIN_LOG_LENGTH = 120;
const MAX_LOG_VALUE_LENGTH = 64;

// Strip control characters so socket-supplied values can't forge log lines
function sanitizeForLog(value) {
  return String(value ?? '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .slice(0, MAX_LOG_VALUE_LENGTH);
}

const pcmBuckets = new Map();
let lastHandshakeWarn = 0;

function takePcmBudget(socketId, bytes, now = Date.now()) {
  let bucket = pcmBuckets.get(socketId);
  if (!bucket) {
    bucket = { tokens: PCM_BUDGET_BYTES, lastRefill: now, lastWarn: 0 };
    pcmBuckets.set(socketId, bucket);
  }
  const elapsedSec = Math.max(0, (now - bucket.lastRefill) / 1000);
  bucket.tokens = Math.min(PCM_BUDGET_BYTES, Math.max(0, bucket.tokens + (elapsedSec * PCM_REFILL_BYTES_PER_SEC)));
  bucket.lastRefill = now;
  if (bucket.tokens < bytes) {
    if (now - bucket.lastWarn >= PCM_WARN_INTERVAL_MS) {
      logger.warn(`PCM flood from ${socketId}; dropping packets (${bucket.tokens.toFixed(0)} B budget left)`);
      bucket.lastWarn = now;
    }
    return false;
  }
  bucket.tokens -= bytes;
  return true;
}

function clearPcmBudget(socketId) {
  pcmBuckets.delete(socketId);
}
app.use(cors({ origin: config.corsOrigin }));

// Security headers for the SPA and API responses
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; media-src 'self' blob:; " +
    "connect-src 'self'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.static(path.join(__dirname, 'client/dist')));

// HTTPS if certs exist, HTTP otherwise
const keyPath = path.join(__dirname, 'server.key');
const certPath = path.join(__dirname, 'server.cert');
const useHttps = fs.existsSync(keyPath) && fs.existsSync(certPath);

const server = useHttps
  ? https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
  : http.createServer(app);

const io = new Server(server, {
  cors: { origin: config.corsOrigin, methods: ['GET', 'POST'] },
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    const allowed = isOriginAllowed(origin, req.headers.host, config.corsOrigin, config.host, config.port);
    if (!allowed) {
      const now = Date.now();
      if (now - lastHandshakeWarn >= HANDSHAKE_WARN_INTERVAL_MS) {
        lastHandshakeWarn = now;
        const safeOrigin = String(origin || '(none)').slice(0, MAX_ORIGIN_LOG_LENGTH);
        logger.warn(`Rejected socket handshake from origin: ${safeOrigin}`);
      }
    }
    callback(null, allowed);
  },
  maxHttpBufferSize: config.maxSocketPayloadBytes,
  transports: ['websocket'],
});

const shutdownHandler = createShutdownHandler({ server, io, recording });
shutdownHandler.registerSignalListeners();

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
  shutdownHandler.handleShutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  shutdownHandler.handleShutdown('uncaughtException');
});

const roomRegistry = createRoomRegistry();

const usbStatus = createUsbStatus();

app.get('/healthz', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    uptimeSec: Math.floor(process.uptime()),
    activeRooms: roomRegistry.roomCount(),
  });
});

app.get('/usb-status', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { devices, ...rest } = await usbStatus.getStatus();
    res.json({ ...rest, devicesCount: devices.length });
  } catch (err) {
    logger.error('usb-status failed:', err.message);
    res.status(500).json({ available: false, state: 'missing', devicesCount: 0, ready: false });
  }
});

function emitRoomState(roomId) {
  io.to(roomId).emit('room-state', roomRegistry.getRoomState(roomId));
}

function warnSocket(socket, message) {
  socket.emit('server-warning', { message });
}

function cleanupRoomIfEmpty(roomId) {
  if (roomRegistry.hasRoomMembers(roomId)) return;
  recording.cleanupRoom(roomId).catch(err => {
    logger.error('cleanupRoom failed:', err);
  });
}

function getSocketRoom(socket) {
  return roomRegistry.get(socket.id);
}

function isSocketInRoom(socket, roomId) {
  const room = getSocketRoom(socket);
  if (!room) return false;
  return room.roomId === roomId;
}

function leaveCurrentRoom(socket) {
  const room = roomRegistry.leave(socket.id);
  if (!room) return;
  socket.leave(room.roomId);
  emitRoomState(room.roomId);
  cleanupRoomIfEmpty(room.roomId);
}

function respondToJoin(acknowledge, payload) {
  if (typeof acknowledge !== 'function') return;
  acknowledge(payload);
}

io.on('connection', (socket) => {
  const clientIp = socket.handshake?.address || 'unknown';
  logger.debug('Client connected:', socket.id, clientIp);

  socket.on('join-room', (roomId, role, acknowledge) => {
    if (isJoinRateLimited(socket.id, clientIp)) {
      logger.warn(`Rate-limited join-room from ${socket.id} (${sanitizeForLog(clientIp)})`);
      respondToJoin(acknowledge, {
        ok: false,
        code: RATE_LIMITED_CODE,
        message: 'Too many join attempts. Wait a few seconds and try again.',
      });
      return;
    }
    if (!isValidRoomId(roomId)) {
      logger.warn(`Blocked invalid join-room: "${sanitizeForLog(roomId)}" from ${socket.id}`);
      respondToJoin(acknowledge, {
        ok: false,
        code: INVALID_ROOM_CODE,
        message: 'Room ID must use 3-12 uppercase letters or numbers.',
      });
      return;
    }
    if (!isValidRole(role)) {
      logger.warn(`Blocked invalid join-room role: "${sanitizeForLog(role)}" from ${socket.id}`);
      respondToJoin(acknowledge, {
        ok: false,
        code: INVALID_ROLE_CODE,
        message: 'Choose either the phone or PC receiver role.',
      });
      return;
    }

    const joinResult = roomRegistry.join(socket.id, roomId, role);
    if (!joinResult.ok) {
      warnSocket(socket, joinResult.message);
      respondToJoin(acknowledge, joinResult);
      return;
    }

    const previousRoom = joinResult.previous;
    if (previousRoom && previousRoom.roomId !== roomId) {
      socket.leave(previousRoom.roomId);
      emitRoomState(previousRoom.roomId);
      cleanupRoomIfEmpty(previousRoom.roomId);
    }

    socket.join(roomId);
    logger.info(`[${role || 'unknown'}] ${socket.id} joined room: ${roomId}`);
    respondToJoin(acknowledge, { ok: true });

    // Create virtual PipeWire sink when any client joins
    if (role === 'receiver') {
      recording.initRoom(roomId).then(initResult => {
        if (!initResult.ok) {
          warnSocket(socket, initResult.message);
          socket.emit('virtual-mic-state', {
            roomId,
            ready: false,
            message: initResult.message,
          });
          return;
        }
        socket.emit('virtual-mic-state', {
          roomId,
          ready: true,
          sourceName: `BlackMic_${roomId}`,
        });
      }).catch(err => {
        logger.error(`initRoom failed for ${roomId}:`, err);
        const message = `Virtual microphone setup failed for room ${roomId}.`;
        warnSocket(socket, message);
        socket.emit('virtual-mic-state', { roomId, ready: false, message });
      });
    }
    emitRoomState(roomId);
  });

  socket.on('leave-room', () => {
    leaveCurrentRoom(socket);
  });

  socket.on('receiver-ready', (roomId) => {
    if (!isValidRoomId(roomId)) return;
    if (!isSocketInRoom(socket, roomId)) return;
    if (getSocketRoom(socket)?.role !== 'receiver') return;
    socket.to(roomId).emit('receiver-ready');
  });

  socket.on('pcm-chunk', (chunk, roomId) => {
    if (!isValidRoomId(roomId)) return;
    if (!isSocketInRoom(socket, roomId)) return;
    if (getSocketRoom(socket)?.role !== 'sender') return;
    const pcmChunk = normalizePcmChunk(chunk);
    if (!pcmChunk) return;
    if (!takePcmBudget(socket.id, pcmChunk.buffer.length)) return;

    // Relay only the validated PCM payload (reconstructed with header for receiver parsing)
    const relayBuf = Buffer.allocUnsafe(HEADER_BYTE_LENGTH + pcmChunk.buffer.length);
    relayBuf.writeUInt16LE(PCM_MAGIC, 0);
    relayBuf.writeUInt32LE(pcmChunk.sampleRate, 2);
    relayBuf.writeUInt8(pcmChunk.channelCount, 6);
    pcmChunk.buffer.copy(relayBuf, HEADER_BYTE_LENGTH);
    socket.to(roomId).emit('pcm-chunk', relayBuf);

    // Feed audio to PipeWire virtual sink (phone mic -> system mic)
    recording.feedAudio(roomId, pcmChunk.buffer, pcmChunk.sampleRate, pcmChunk.channelCount);
  });

  // Remote control relay (PC -> phone)
  socket.on('remote-control', (cmd, roomId) => {
    if (!isValidRoomId(roomId)) return;
    if (!isSocketInRoom(socket, roomId)) return;
    if (getSocketRoom(socket)?.role !== 'receiver') return;
    if (!isValidRemoteCommand(cmd)) return;
    socket.to(roomId).emit('remote-control', cmd);
  });

  // Remote control ACK relay (phone -> PC)
  socket.on('remote-control-ack', (cmd, roomId) => {
    if (!isValidRoomId(roomId)) return;
    if (!isSocketInRoom(socket, roomId)) return;
    if (getSocketRoom(socket)?.role !== 'sender') return;
    if (!isValidRemoteCommand(cmd)) return;
    socket.to(roomId).emit('remote-control-ack', cmd);
  });

  socket.on('ping-rtt', (timestamp) => {
    if (!isValidTimestamp(timestamp)) return;
    socket.emit('pong-rtt', timestamp);
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected:', socket.id);
    clearJoinAttempts(socket.id);
    clearPcmBudget(socket.id);
    leaveCurrentRoom(socket);
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${config.port} is already in use. Set PORT to use a different port.`);
    process.exit(1);
  }
  logger.error('Server failed:', error.message);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  logger.info(`Black Mic Studio server on ${useHttps ? 'HTTPS' : 'HTTP'}://${config.host}:${config.port}`);
});
