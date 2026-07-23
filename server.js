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

process.on('unhandledRejection', (reason) => {
  console.error('[BMS] Unhandled Rejection:', reason);
});
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
app.use(cors({ origin: config.corsOrigin }));
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
  maxHttpBufferSize: config.maxSocketPayloadBytes,
  transports: ['websocket'],
});

const roomRegistry = createRoomRegistry();

function emitRoomState(roomId) {
  io.to(roomId).emit('room-state', roomRegistry.getRoomState(roomId));
}

function warnSocket(socket, message) {
  socket.emit('server-warning', { message });
}

function cleanupRoomIfEmpty(roomId) {
  if (roomRegistry.hasRoomMembers(roomId)) return;
  recording.cleanupRoom(roomId);
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
  console.log('Client connected:', socket.id);

  socket.on('join-room', (roomId, role, acknowledge) => {
    if (!isValidRoomId(roomId)) {
      console.warn(`Blocked invalid join-room: "${roomId}" from ${socket.id}`);
      respondToJoin(acknowledge, {
        ok: false,
        code: INVALID_ROOM_CODE,
        message: 'Room ID must use 3-12 uppercase letters or numbers.',
      });
      return;
    }
    if (!isValidRole(role)) {
      console.warn(`Blocked invalid join-room role: "${role}" from ${socket.id}`);
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
    console.log(`[${role || 'unknown'}] ${socket.id} joined room: ${roomId}`);
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
        console.error(`[BMS] initRoom failed for ${roomId}:`, err);
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
    socket.to(roomId).emit('receiver-ready');
  });

  socket.on('pcm-chunk', (chunk, roomId) => {
    if (!isValidRoomId(roomId)) return;
    if (!isSocketInRoom(socket, roomId)) return;
    if (getSocketRoom(socket)?.role !== 'sender') return;
    const pcmChunk = normalizePcmChunk(chunk);
    if (!pcmChunk) return;

    // Relay only the validated PCM payload (reconstructed with header for receiver parsing)
    const relayBuf = Buffer.alloc(HEADER_BYTE_LENGTH + pcmChunk.buffer.length);
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
    console.log('Client disconnected:', socket.id);
    leaveCurrentRoom(socket);
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[BMS] Port ${config.port} is already in use. Set PORT to use a different port.`);
    process.exit(1);
  }
  console.error('[BMS] Server failed:', error.message);
  process.exit(1);
});

server.listen(config.port, () => {
  console.log(`Black Mic Studio server on ${useHttps ? 'HTTPS' : 'HTTP'}:${config.port}`);
});
