// HTTP static server + WebSocket room manager.
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';
import { Game } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const games = new Map(); // code -> Game
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (games.has(c));
  return c;
};
let nextId = 1;

wss.on('connection', ws => {
  const id = 'p' + (nextId++);
  let game = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', data => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'create') {
      if (game) return;
      const code = newCode();
      game = new Game(code, c => games.delete(c));
      games.set(code, game);
      game.addPlayer(id, m.name, ws);
      ws.send(JSON.stringify({ t: 'joined', code, id }));
      game.sendLobby();
    } else if (m.t === 'join') {
      if (game) return;
      const code = String(m.code || '').toUpperCase().trim();
      const g = games.get(code);
      if (!g) return ws.send(JSON.stringify({ t: 'error', msg: 'No room with that code.' }));
      if (g.state !== 'lobby') return ws.send(JSON.stringify({ t: 'error', msg: 'That match already started.' }));
      if (g.players.size >= 4) return ws.send(JSON.stringify({ t: 'error', msg: 'Room is full.' }));
      game = g;
      game.addPlayer(id, m.name, ws);
      ws.send(JSON.stringify({ t: 'joined', code, id }));
      game.sendLobby();
    } else if (game) {
      game.handle(id, m);
    }
  });

  ws.on('close', () => { if (game) game.removePlayer(id); });
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Ghost Game MVP listening on http://localhost:${PORT}`));
