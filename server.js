import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { TikTokLive } from '@tiktool/live';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let tiktokClient = null;
let currentUsername = null;

function broadcastState(state, extra = {}) {
  io.emit('connectionState', { state, username: currentUsername, ...extra });
}

app.post('/api/connect', async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });

  if (tiktokClient) {
    try { tiktokClient.disconnect(); } catch (e) { /* ignore */ }
  }

  currentUsername = username.replace('@', '').trim();
  broadcastState('connecting');

  const apiKey = process.env.TIKTOOL_API_KEY;
  if (!apiKey) {
    broadcastState('error', { error: 'Server is missing TIKTOOL_API_KEY.' });
    return res.status(500).json({ error: 'missing api key' });
  }

  tiktokClient = new TikTokLive({
    uniqueId: currentUsername,
    apiKey
  });

  tiktokClient.on('connected', () => {
    broadcastState('connected');
    console.log(`Connected to @${currentUsername}'s live`);
  });

  tiktokClient.on('gift', data => {
    io.emit('gift', {
      giftName: data.giftName || `Gift #${data.giftId}`,
      sender: data.nickname || data.uniqueId || data.user?.nickname || data.user?.uniqueId || 'someone',
      repeatCount: data.repeatCount || 1,
      giftId: data.giftId
    });
  });

  tiktokClient.on('disconnected', () => {
    broadcastState('error', { error: 'Disconnected from the live stream.' });
  });

  tiktokClient.on('error', err => {
    console.error('TikTool connection error:', err);
    broadcastState('error', { error: err?.message || 'Could not connect. Is the user currently live?' });
  });

  try {
    await tiktokClient.connect();
    res.json({ ok: true });
  } catch (err) {
    console.error('Connect error:', err);
    broadcastState('error', { error: err?.message || 'Could not connect. Is the user currently live?' });
    res.status(500).json({ error: err?.message || 'connect failed' });
  }
});

io.on('connection', socket => {
  socket.emit('connectionState', {
    state: tiktokClient ? 'connected' : 'idle',
    username: currentUsername
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Gift Dash running: http://localhost:${PORT}`);
});
