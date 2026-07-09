'use strict';

const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const recording = require('./server/recording');

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

// Secure room ID validation per AGENTS.md
const validateRoomId = (id) => typeof id === 'string' && /^[A-Z0-9]{3,12}$/.test(id);

// Track which socket is in which room (for cleanup on disconnect)
const socketRooms = {};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-room', async (roomId, role) => {
    if (!validateRoomId(roomId)) {
      console.warn(`Blocked invalid join-room: "${roomId}" from ${socket.id}`);
      return;
    }
    socket.join(roomId);
    socketRooms[socket.id] = { roomId, role };
    console.log(`[${role || 'unknown'}] ${socket.id} joined room: ${roomId}`);

    // Create virtual PipeWire sink when any client joins (safe to call multiple times)
    if (role === 'receiver') await recording.initRoom(roomId);
  });

  socket.on('receiver-ready', (roomId) => {
    if (!validateRoomId(roomId)) return;
    socket.to(roomId).emit('receiver-ready');
  });

  socket.on('pcm-chunk', (chunk, roomId) => {
    if (!validateRoomId(roomId)) return;
    // Relay to receiver in room
    socket.to(roomId).emit('pcm-chunk', chunk);
    // Feed audio to PipeWire virtual sink (phone mic -> system mic)
    if (chunk?.buffer) {
      recording.feedAudio(roomId, chunk.buffer, chunk.sampleRate || 48000, chunk.channelCount || 1);
    }
  });

  // VAAPI recording control events (from PC receiver)
  socket.on('start-vaapi-record', (opts, roomId) => {
    if (!validateRoomId(roomId)) return;
    recording.startRecording(roomId, io);
  });

  socket.on('video-frame', (frameBuffer, roomId) => {
    if (!validateRoomId(roomId)) return;
    recording.feedVideoFrame(roomId, frameBuffer);
  });

  socket.on('stop-vaapi-record', (roomId) => {
    if (!validateRoomId(roomId)) return;
    recording.stopRecording(roomId);
  });

  // Remote control relay (PC -> phone)
  socket.on('remote-control', (cmd, roomId) => {
    if (!validateRoomId(roomId)) return;
    socket.to(roomId).emit('remote-control', cmd);
  });

  // Remote control ACK relay (phone -> PC)
  socket.on('remote-control-ack', (cmd, roomId) => {
    if (!validateRoomId(roomId)) return;
    socket.to(roomId).emit('remote-control-ack', cmd);
  });

  socket.on('ping-rtt', (timestamp) => {
    socket.emit('pong-rtt', timestamp);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // No immediate room cleanup — other client may still be active
    delete socketRooms[socket.id];
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Black Mic Studio server on ${useHttps ? 'HTTPS' : 'HTTP'}:${PORT}`);
});
