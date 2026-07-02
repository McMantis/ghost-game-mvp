// Deterministic protocol test: disruptor -> ability lock -> charge ->
// grab -> ward rescue -> regrab -> execution.
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
      if (m.ghostSelf) { c.meter = m.ghostSelf.meter; c.stunned = m.ghostSelf.stunned; c.lock = m.ghostSelf.lock; }
      if (m.hunters) c.me = m.hunters.find(h => h.id === c.id) || c.me;
      if (m.ward !== undefined) c.ward = m.ward;
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
const [, aStart] = await startP;
console.log('match started in room', code);

// position streams: ghost + A together in hallway, B close by (facing the ghost)
const GX = 1.5, GZ = 7.6, BX = 2.6, BZ = 8.3;
const bRy = Math.atan2(-(GX - BX), -(GZ - BZ)); // client forward is (-sin ry, -cos ry)
const aPos = { x: 1.5, z: 7.3, tl: 0 };
const posTimer = setInterval(() => {
  G.send({ t: 'pos', x: GX, y: 1.6, z: GZ, ry: 0, sp: 0 });
  if (!A.me || !A.me.dragged) A.send({ t: 'pos', x: aPos.x, y: 1.6, z: aPos.z, ry: 0, sp: 0, tl: aPos.tl });
  B.send({ t: 'pos', x: BX, y: 1.6, z: BZ, ry: bRy, sp: 0 });
}, 100);
await sleep(400);

// disruptor: B is aimed at the ghost and fires
const disP = A.once('ev:disrupted');
B.send({ t: 'int', kind: 'disrupt' });
const disEv = await Promise.race([disP, sleep(2000).then(() => null)]);
check('disruptor hit lands (aim within margin)', !!disEv);

// while locked, haunting does nothing
G.send({ t: 'act', kind: 'haunt', propId: 'sidetable' });
const blocked = await Promise.race([G.once('ev:haunt'), sleep(1500).then(() => null)]);
check('haunt blocked during disruptor lock', !blocked);
console.log('waiting out the ability lock…');
await sleep((disEv?.lock ?? 12) * 1000);

// identification puzzle: A holds a tracker lock near the ghost until a FALSE
// object is revealed, then uses it at the circle to trigger the penalty
console.log('tracker lock-on for clues…');
const clues = [];
A.on('ev:clue', m => clues.push(m));
aPos.tl = 1;
let fake = null;
const clueT0 = Date.now();
while (!fake && Date.now() - clueT0 < 30000) {
  await sleep(300);
  fake = clues.find(c => c.known === 'fake');
}
aPos.tl = 0;
check('tracker lock reveals identification clues', clues.length >= 1);
check('a FALSE object was identified', !!fake);

if (fake) {
  const fc = aStart.components.find(c => c.id === fake.id);
  aPos.x = fc.x; aPos.z = fc.z;
  await sleep(500);
  A.send({ t: 'int', kind: 'pickup', id: fake.id });
  await sleep(400);
  aPos.x = 20.5; aPos.z = 12.5; // the ritual circle in the Study
  await sleep(500);
  const meterBefore = G.meter;
  const wrongP = B.once('ev:wrongObject');
  A.send({ t: 'int', kind: 'deposit' });
  const wrongEv = await Promise.race([wrongP, sleep(2500).then(() => null)]);
  check('FALSE object triggers the penalty event', !!wrongEv && wrongEv.id === fake.id);
  await sleep(500);
  check(`ghost meter surged by penalty (+${wrongEv?.gain})`, G.meter >= meterBefore + (wrongEv?.gain ?? 25) - 1);
  aPos.x = 1.5; aPos.z = 7.3; // back to the hallway for the rest of the test
  await sleep(500);
}

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
check('rescue consumed B\'s ward (recharging)', B.ward > 0);

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
