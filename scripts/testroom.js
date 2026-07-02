// Solo-test helper: hosts a room, takes whichever role the human doesn't pick,
// auto-starts the match, and acts as a simple warm body:
//  - as hunter: stands in the hallway (a valid haunt/kill target)
//  - as ghost: lurks by the hallway side table and haunts it, so a hunter
//    player sees prop shakes, hears knocks, and gets EMF readings.
// Usage: node scripts/testroom.js
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000');
let me = null, myRole = null, started = false;
const send = m => ws.send(JSON.stringify(m));

ws.on('open', () => send({ t: 'create', name: 'TestBot' }));

ws.on('message', data => {
  const m = JSON.parse(data);
  if (m.t === 'joined') {
    me = m.id;
    console.log(`ROOM CODE: ${m.code}`);
    console.log('Join from the game menu with that code, pick either role, and the match will start.');
  }
  if (m.t === 'lobby' && !started) {
    const human = m.players.find(p => p.id !== me);
    if (human?.role && !myRole) {
      myRole = human.role === 'ghost' ? 'hunter' : 'ghost';
      send({ t: 'role', role: myRole });
      console.log(`You picked ${human.role} — TestBot plays ${myRole}. Starting…`);
      setTimeout(() => send({ t: 'start' }), 800);
    }
  }
  if (m.t === 'startMatch') {
    started = true;
    let pos = m.role === 'ghost' ? { x: 1.2, z: 7.5 } : { x: 2.6, z: 8.0 };
    setInterval(() => send({ t: 'pos', x: pos.x, y: 1.6, z: pos.z, ry: 0, sp: 0 }), 100);
    if (m.role === 'ghost') {
      setInterval(() => send({ t: 'act', kind: 'haunt', propId: 'sidetable' }), 2500);
      console.log('TestBot ghost is lurking in the hallway, rattling the side table.');
    } else {
      console.log('TestBot hunter is standing in the hallway. It will not fight back.');
    }
  }
  if (m.t === 'end') {
    console.log(`Match over: ${m.winner} win — ${m.reason}`);
    process.exit(0);
  }
});

ws.on('close', () => process.exit(0));
ws.on('error', e => { console.error('error:', e.message); process.exit(1); });
