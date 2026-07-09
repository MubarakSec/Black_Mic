const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'client/dist')));

// Check for local SSL keys to run in HTTPS mode (required for secure browser media contexts)
let server;
const keyPath = path.join(__dirname, 'server.key');
const certPath = path.join(__dirname, 'server.cert');
const useHttps = fs.existsSync(keyPath) && fs.existsSync(certPath);

if (useHttps) {
  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  server = https.createServer(options, app);
} else {
  server = http.createServer(app);
}

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log('Client joined:', roomId);
  });

  socket.on('receiver-ready', (roomId) => {
    socket.to(roomId).emit('receiver-ready');
  });

  socket.on('pcm-chunk', (chunk, roomId) => {
    socket.to(roomId).emit('pcm-chunk', chunk);
  });

  socket.on('offer', (offer, roomId) => {
    socket.to(roomId).emit('offer', offer);
  });

  socket.on('answer', (answer, roomId) => {
    socket.to(roomId).emit('answer', answer);
  });

  socket.on('ice-candidate', (candidate, roomId) => {
    socket.to(roomId).emit('ice-candidate', candidate);
  });

  socket.on('ping-rtt', (timestamp) => {
    socket.emit('pong-rtt', timestamp);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on ${useHttps ? 'HTTPS' : 'HTTP'} protocol on port ${PORT}`);
});
