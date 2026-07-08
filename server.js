const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let tiktokConnection = null;
let currentUsername = null;

function broadcastState(state, extra = {}) {
  io.emit('connectionState', { state, username: currentUsername, ...extra });
}

app.post('/api/connect', async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });

  // Clean up any previous connection
  if (tiktokConnection) {
    try { tiktokConnection.disconnect(); } catch (e) { /* ignore */ }
  }

  currentUsername = username.replace('@', '').trim();
  broadcastState('connecting');

  tiktokConnection = new WebcastPushConnection(currentUsername);

  tiktokConnection.connect()
    .then(() => {
      broadcastState('connected');
      console.log(`Connected to @${currentUsername}'s live`);
    })
    .catch(err => {
      console.error('Connect error:', err.message);
      broadcastState('error', { error: err.message || 'Could not connect. Is the user currently live?' });
    });

  tiktokConnection.on('gift', data => {
    // Only emit on the final tally of a streak (or non-streakable gifts)
    if (data.giftType !== 1 || data.repeatEnd) {
      io.emit('gift', {
        giftName: data.giftName,
        sender: data.nickname || data.uniqueId || 'someone',
        repeatCount: data.repeatCount || 1,
        giftId: data.giftId
      });
    }
  });

  tiktokConnection.on('disconnected', () => {
    broadcastState('error', { error: 'Disconnected from the live stream.' });
  });

  tiktokConnection.on('streamEnd', () => {
    broadcastState('error', { error: 'The live stream has ended.' });
  });

  res.json({ ok: true });
});

io.on('connection', socket => {
  // Let a newly-opened tab know the current state immediately
  socket.emit('connectionState', {
    state: tiktokConnection ? 'connected' : 'idle',
    username: currentUsername
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Gift Dash running: http://localhost:${PORT}`);
});
