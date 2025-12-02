require('dotenv').config();
const fs = require('fs');
const https = require('https');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const socketIo = require('socket.io');

const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const fileRoutes = require('./routes/files');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------
// SECURITY LOGGING [cite: 76, 77]
// ---------------------------------------------------------
const logEvent = (type, details) => {
  const logEntry = `[${new Date().toISOString()}] [${type}] ${JSON.stringify(details)}\n`;
  // Append to a local file for the report evidence
  fs.appendFile('server_security.log', logEntry, (err) => {
    if (err) console.error("Logging failed", err);
  });
  console.log(type, details); // Also log to console
};
// Make logger available globally or pass via middleware
app.set('logger', logEvent);

// ---------------------------------------------------------
// SOCKET.IO PLACEHOLDER (will be set after https server creation)
// ---------------------------------------------------------
let io = null;
app.set('getIO', () => io);

// ---------------------------------------------------------
// DATABASE CONNECTION [cite: 107]
// ---------------------------------------------------------
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/secure-chat')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error(err));

// ---------------------------------------------------------
// ROUTES
// ---------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/files', fileRoutes);

// ---------------------------------------------------------
// HTTPS SETUP 
// ---------------------------------------------------------
// NOTE: For local dev, generate self-signed certs:
// openssl req -nodes -new -x509 -keyout server.key -out server.cert
const httpsOptions = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.crt')
};

const server = https.createServer(httpsOptions, app);
io = socketIo(server, {
  cors: { origin: "*" } // Adjust for production
});
app.set('io', io);

// ---------------------------------------------------------
// REAL-TIME SIGNALING (Socket.io)
// ---------------------------------------------------------
// Used for exchanging ephemeral keys (DH Handshake) and notifying new messages
io.on('connection', (socket) => {
  logEvent('CONNECTION', { socketId: socket.id });

  socket.on('join', (username) => {
    socket.join(username);
    logEvent('USER_JOIN', { username });
  });

  // Relay generic signals (handshake data) without storing them permanently
  socket.on('signal', (data) => {
    // data should contain { to: 'targetUser', payload: '...' }
    io.to(data.to).emit('signal', {
      from: data.from,
      payload: data.payload,
      type: data.type // e.g., 'handshake-init', 'handshake-response'
    });
    logEvent('SIGNAL_RELAY', { from: data.from, to: data.to, type: data.type });
  });

  socket.on('disconnect', () => {
    logEvent('DISCONNECT', { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 443;
server.listen(PORT, () => {
  console.log(`Secure Server running on port ${PORT}`);
});