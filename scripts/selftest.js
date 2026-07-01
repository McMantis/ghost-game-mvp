// Deterministic protocol test for the grab -> rescue -> regrab -> execution flow.
// Usage: node scripts/selftest.js   (server must be running on :3000)
import WebSocket from 'ws';

const url = 'ws://localhost:3000';
const results = [];
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };

function client(name) {
  const ws = new WebSocket(url);
  const c = { name, ws, id: null, handlers: new Map(), meter: 0, stunned: false, me: null };
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.t === 'joined') c.id = m.id;
    if (m.t === 'st') {
      if (m.ghostSelf) { c.meter = m.ghostSelf.meter; c.stunned = m.ghostSelf.stunned; }
      if (m.hunters) c.me = m.hunters.find(h => h.id === c.id) || c.me;
    }
    const key = m.t === 'ev' ? 'ev:' + m.ev : m.t;
    (c.handlers.get(key) || []).forEach(fn => fn(m));
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.on = (key, fn) => { const a = c.handlers.get(key) || []; a.push(fn); c.handlers.set(key, a); };
  c.once = key => new Promise(res => c.on(key, res));
  c.open = new Promise(res => ws.on('open', res));
  return c;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const G = client('G'), A = client('A'), B = client('B');
await Promise.all([G.open, A.open, B.open]);

G.send({ t: 'create', name: 'G' });
const joined = await G.once('joined');
const code = joined.code;
G.send({ t: 'role', role: 'ghost' });
A.send({ t: 'join', code, name: 'A' });
B.send({ t: 'join', code, name: 'B' });
await Promise.all([A.once('joined'), B.once('joined')]);
A.send({ t: 'role', role: 'hunter' });
B.send({ t: 'role', role: 'hunter' });
await sleep(300);

const startP = Promise.all([G.once('startMatch'), A.once('startMatch'), B.once('startMatch')]);
G.send({ t: 'start' });
await startP;
console.log('match started in room', code);

// position streams: ghost + A together in hallway, B close by
const posTimer = setInterval(() => {
  G.send({ t: 'pos', x: 1.5, y: 1.6, z: 7.6, ry: 0, sp: 0 });
  if (!A.me || !A.me.dragged) A.send({ t: 'pos', x: 1.5, y: 1.6, z: 7.3, ry: 0, sp: 0 });
  B.send({ t: 'pos', x: 2.6, y: 1.6, z: 8.3, ry: 0, sp: 0 });
}, 100);
await sleep(400);

// charge to full meter
console.log('charging meter…');
while (G.meter < 100) {
  G.send({ t: 'act', kind: 'haunt', propId: 'sidetable' });
  await sleep(1500);
}
check('meter reached 100 via proximity haunts', G.meter >= 100);

// rampage
const rampP = A.once('ev:rampageStart');
G.send({ t: 'act', kind: 'rampage' });
await rampP;
console.log('rampage started, waiting out blind…');
await sleep(5300);

// grab A
const grabP = B.once('ev:grab');
G.send({ t: 'act', kind: 'grab', targetId: A.id });
const grabEv = await grabP;
check('grab lands on A', grabEv.targetId === A.id);

// B rescues 1.5s in (well before the 6s execution)
await sleep(1500);
const rescueP = A.once('ev:rescue');
B.send({ t: 'int', kind: 'rescue' });
const rescueEv = await Promise.race([rescueP, sleep(3000).then(() => null)]);
check('rescue event fires', !!rescueEv && rescueEv.targetId === A.id);
await sleep(400);
check('A alive and no longer dragged after rescue', !!A.me && A.me.alive && !A.me.dragged);
check('ghost stunned after rescue', G.stunned === true);

// regrab after stun (3s) + grab cd (3s), then let execution happen
await sleep(6000);
const grab2P = B.once('ev:grab');
G.send({ t: 'act', kind: 'grab', targetId: A.id });
const grab2 = await Promise.race([grab2P, sleep(3000).then(() => null)]);
check('regrab works after cooldown', !!grab2);
const deathEv = await Promise.race([B.once('ev:death'), sleep(8000).then(() => null)]);
check('execution kills A after 6s drag', !!deathEv && deathEv.targetId === A.id && deathEv.how === 'execution');

clearInterval(posTimer);
const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} checks passed`);
G.ws.close(); A.ws.close(); B.ws.close();
process.exit(fails ? 1 : 0);
