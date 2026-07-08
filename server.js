import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  if (tiktokConnection) {
    try { tiktokConnection.disconnect(); } catch (e) { /* ignore */ }
  }

  currentUsername = username.replace('@', '').trim();
  broadcastState('connecting');

  tiktokConnection = new TikTokLiveConnection(currentUsername, {
    enableExtendedGiftInfo: true
  });

  tiktokConnection.connect()
    .then(() => {
      broadcastState('connected');
      console.log(`Connected to @${currentUsername}'s live`);
    })
    .catch(err => {
      console.error('Connect error:', err.message);
      broadcastState('error', { error: err.message || 'Could not connect. Is the user currently live?' });
    });

  tiktokConnection.on(WebcastEvent.GIFT, data => {
    const giftType = data.giftDetails?.giftType;
    const giftName = data.giftDetails?.giftName;

    // Only score once a gift streak finishes (or immediately for non-streakable gifts)
    if (giftType !== 1 || data.repeatEnd) {
      io.emit('gift', {
        giftName: giftName || `Gift #${data.giftId}`,
        sender: data.user?.nickname || data.user?.uniqueId || 'someone',
        repeatCount: data.repeatCount || 1,
        giftId: data.giftId
      });
    }
  });

  tiktokConnection.on(ControlEvent.DISCONNECTED, () => {
    broadcastState('error', { error: 'Disconnected from the live stream.' });
  });

  tiktokConnection.on(ControlEvent.ERROR, err => {
    console.error('Connection error:', err);
  });

  res.json({ ok: true });
});

io.on('connection', socket => {
  socket.emit('connectionState', {
    state: tiktokConnection ? 'connected' : 'idle',
    username: currentUsername
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Gift Dash running: http://localhost:${PORT}`);
});
