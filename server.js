'use strict';

const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const recording = require('./server/recording');
const {
  isValidRemoteCommand,
  isValidRecordingOptions,
  isValidRole,
  isValidRoomId,
  isValidTimestamp,
  normalizePcmChunk,
  normalizeVideoFrame,
} = require('./server/socket-validation');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'client/dist')));

// HTTPS if certs exist, HTTP otherwise
const keyPath = path.join(__dirname, 'server.key');
const certPath = path.join(__dirname, 'server.cert');
const useHttps = fs.existsSync(keyPath) && fs.existsSync(certPath);

const server = useHttps
  ? https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
  : http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 5e6, // 5 MB — allows JPEG frame payloads
});

// Track which socket is in which room (for cleanup on disconnect)
const socketRooms = {};

function hasRoomMembers(roomId) {
  return Object.values(socketRooms).some(entry => entry.roomId === roomId);
}

function cleanupRoomIfEmpty(roomId) {
  if (hasRoomMembers(roomId)) return;
  recording.cleanupRoom(roomId);
}

function getSocketRoom(socket) {
  return socketRooms[socket.id] || null;
}

function isSocketInRoom(socket, roomId) {
  const room = getSocketRoom(socket);
  if (!room) return false;
  return room.roomId === roomId;
}

function leaveCurrentRoom(socket) {
  const room = getSocketRoom(socket);
  if (!room) return;
  socket.leave(room.roomId);
  delete socketRooms[socket.id];
  cleanupRoomIfEmpty(room.roomId);
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-room', async (roomId, role) => {
    if (!isValidRoomId(roomId)) {
      console.warn(`Blocked invalid join-room: "${roomId}" from ${socket.id}`);
      return;
    }
    if (!isValidRole(role)) {
      console.warn(`Blocked invalid join-room role: "${role}" from ${socket.id}`);
      return;
    }
    leaveCurrentRoom(socket);
    socket.join(roomId);
    socketRooms[socket.id] = { roomId, role };
    console.log(`[${role || 'unknown'}] ${socket.id} joined room: ${roomId}`);

    // Create virtual PipeWire sink when any client joins (safe to call multiple times)
    if (role === 'receiver') await recording.initRoom(roomId);
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
    const pcmChunk = normalizePcmChunk(chunk);
    if (!pcmChunk) return;

    // Relay to receiver in room
    socket.to(roomId).emit('pcm-chunk', pcmChunk);
    // Feed audio to PipeWire virtual sink (phone mic -> system mic)
    recording.feedAudio(roomId, pcmChunk.buffer, pcmChunk.sampleRate, pcmChunk.channelCount);
  });

  // VAAPI recording control events (from PC receiver)
  socket.on('start-vaapi-record', (opts, roomId) => {
    if (!isValidRoomId(roomId)) return;
    if (!isSocketInRoom(socket, roomId)) return;
    if (getSocketRoom(socket)?.role !== 'receiver') return;
    if (!isValidRecordingOptions(opts)) return;
    recording.startRecording(roomId, io);
  });

  socket.on('video-frame', (frameBuffer, roomId) => {
    if (!isValidRoomId(roomId)) return;
    if (!isSocketInRoom(socket, roomId)) return;
    const videoFrame = normalizeVideoFrame(frameBuffer);
    if (!videoFrame) return;
    recording.feedVideoFrame(roomId, videoFrame);
  });

  socket.on('stop-vaapi-record', (roomId) => {
    if (!isValidRoomId(roomId)) return;
    if (!isSocketInRoom(socket, roomId)) return;
    if (getSocketRoom(socket)?.role !== 'receiver') return;
    recording.stopRecording(roomId);
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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Black Mic Studio server on ${useHttps ? 'HTTPS' : 'HTTP'}:${PORT}`);
});
