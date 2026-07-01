// Headless test client: joins a room as a hunter, stands around, logs everything.
// Usage: node scripts/bot.js <ROOMCODE> [name] [logfile]
import WebSocket from 'ws';
import fs from 'fs';

const [, , code, name = 'Bot', logfile] = process.argv;
if (!code) { console.error('usage: node scripts/bot.js <ROOMCODE> [name] [logfile]'); process.exit(1); }

const log = line => {
  const s = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
  if (logfile) fs.appendFileSync(logfile, s + '\n');
  else console.log(s);
};

const ws = new WebSocket('ws://localhost:3000');
let me = null;
let pos = { x: 2, y: 1.6, z: 8 };
let posTimer = null;

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'join', code, name }));
  ws.send(JSON.stringify({ t: 'role', role: 'hunter' }));
  log(`connected, joining ${code} as ${name}`);
});

ws.on('message', data => {
  const m = JSON.parse(data);
  if (m.t === 'joined') { me = m.id; log(`joined as ${me}`); }
  else if (m.t === 'lobby') log(`lobby: ${m.players.map(p => `${p.name}=${p.role || '?'}`).join(', ')}`);
  else if (m.t === 'startMatch') {
    pos = { x: m.spawn.x, y: 1.6, z: m.spawn.z };
    log(`match started, role=${m.role}, spawn=${pos.x},${pos.z}`);
    posTimer = setInterval(() => {
      ws.send(JSON.stringify({ t: 'pos', ...pos, ry: 0, sp: 0 }));
    }, 100);
  }
  else if (m.t === 'ev') log(`EV ${JSON.stringify(m)}`);
  else if (m.t === 'end') { log(`END ${JSON.stringify(m)}`); cleanup(); }
  else if (m.t === 'st') {
    // log occasional state snapshots
    if (!ws._n) ws._n = 0;
    if (ws._n++ % 45 === 0) log(`ST emf=${m.emf} dread=${m.dread} ritual=${JSON.stringify(m.ritual)} me=${JSON.stringify(m.hunters.find(h => h.id === me))}`);
  }
  else if (m.t === 'error') log(`ERROR ${m.msg}`);
});

// allow simple remote control via a command file (poll every 300ms):
// write lines like "move 5 7" / "int pickup comp0" / "int rescue" to <logfile>.cmd
if (logfile) {
  const cmdFile = logfile + '.cmd';
  setInterval(() => {
    if (!fs.existsSync(cmdFile)) return;
    const lines = fs.readFileSync(cmdFile, 'utf8').trim().split('\n').filter(Boolean);
    if (!lines.length) return;
    fs.writeFileSync(cmdFile, '');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'move') { pos.x = +parts[1]; pos.z = +parts[2]; log(`moved to ${pos.x},${pos.z}`); }
      else if (parts[0] === 'int') { ws.send(JSON.stringify({ t: 'int', kind: parts[1], id: parts[2] })); log(`sent int ${parts[1]} ${parts[2] || ''}`); }
      else if (parts[0] === 'raw') { ws.send(parts.slice(1).join(' ')); }
    }
  }, 300);
}

function cleanup() { if (posTimer) clearInterval(posTimer); setTimeout(() => process.exit(0), 500); }
ws.on('close', () => { log('socket closed'); cleanup(); });
ws.on('error', e => { log('socket error ' + e.message); cleanup(); });
