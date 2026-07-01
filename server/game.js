// Match logic. One Game per room. The server is authoritative for the meter,
// evidence, temperatures, kills, the ritual, and win/lose. Movement is
// client-authoritative (this is a playtest build, not an anti-cheat build).

import {
  rooms, roomAt, doors, props, ritualCircle, componentSpots,
  hunterSpawns, ghostSpawn,
} from '../shared/map.js';

// Every number the design doc calls a "starting position, not a spec".
// Tune here after playtests.
export const TUNE = {
  METER_MAX: 100,
  LESSER_AT: 33,          // Hurl/Clutter unlock threshold (~1/3 meter per doc)

  HAUNT_GAIN: 7,          // meter per baseline haunt WITH a hunter in proximity
  HAUNT_RANGE: 2.8,       // ghost must be this close to a prop to haunt it
  PROX_RADIUS: 10,        // a hunter within this of the prop => points (doc's proximity rule)
  HAUNT_CD: 1.4,          // seconds between haunts

  PHASE_COST: 5,          // meter drained per wall-phase, ONLY while charged (doc)
  PHASE_RESIDUE_S: 45,    // residue visibility (doc says 30-60s, [OPEN])
  PHASE_CD: 0.6,

  HURL_COST: 10,
  HURL_RANGE: 12,
  STAGGER_S: 1.6,         // stagger interrupts ritual channel + tool reading

  CLUTTER_COST: 15,
  CLUTTER_RANGE: 7,       // nearest doorway within this of the ghost
  BARRICADE_S: 25,        // barricade lifetime if not cleared

  CRUSH_COST: 35,         // "dumps a big chunk of meter" (doc)
  CRUSH_RANGE: 14,
  CRUSH_ISO_RADIUS: 7,    // target is "isolated": no living teammate within this
  CRUSH_MAX_SPEED: 1.7,   // target is "relatively stationary"
  CRUSH_TELE_S: 1.6,      // "a beat to move or break line of sight" (doc, [OPEN])
  CRUSH_KILL_RADIUS: 1.5,

  RAMPAGE_BLIND_S: 5,     // ghost blind period on manifest (doc: ~5s)
  RAMPAGE_DUR_S: 32,
  GRAB_RANGE: 1.9,
  DRAG_EXEC_S: 6,         // drag this long uninterrupted => execution (doc)
  RESCUE_RANGE: 2.8,      // teammate intervention range
  GRAB_CD: 3,             // after a rescue breaks the grab
  RESCUE_STUN_S: 3,

  EVIDENCE_TTL: 45,       // EMF trace lifetime
  COLD_RATE: 1.8,         // deg/s the ghost's current room cools
  COLD_DECAY: 0.25,       // deg/s rooms warm back up
  TEMP_BASE: 18,
  TEMP_MIN: 1,

  RITUAL_COMPONENTS: 3,
  CHANNEL_S: 12,          // total channel time to banish
  CHANNEL_RANGE: 2.4,

  MIN_PLAYERS: 2,
  MAX_HUNTERS: 3,
};

const now = () => Date.now() / 1000;
const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;

let nextEvId = 1;

export class Game {
  constructor(code, onEmpty) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.state = 'lobby'; // lobby | playing | ended
    this.players = new Map(); // id -> player
    this.hostId = null;
    this.reset();
    this.loop = setInterval(() => this.tick(), 66);
    this.lastTick = now();
  }

  reset() {
    this.meter = 0;
    this.evidence = [];        // {id,x,z,strength,t}
    this.residues = [];        // {id,x,y,z,nx,nz,t}
    this.barricades = [];      // {id,doorId,x,z,axis,t}
    this.cold = Object.fromEntries(rooms.map(r => [r.id, 0]));
    this.components = [];      // {id,x,z,state:'world'|'carried'|'placed',carrier}
    this.ritualProgress = 0;
    this.channelers = new Set();
    this.crush = null;         // {targetId,x,z,resolveT}
    this.rampage = null;       // {endT,blindUntil}
    this.drag = null;          // {targetId,startT}
    this.grabCdUntil = 0;
    this.hauntCdUntil = 0;
    this.phaseCdUntil = 0;
    this.winner = null;
  }

  // ---- lobby ----

  addPlayer(id, name, ws) {
    const p = {
      id, name: String(name).slice(0, 16) || 'Player', ws,
      role: null, alive: true,
      x: 0, y: 1.6, z: 0, ry: 0, sp: 0,
      speedAvg: 0, staggerUntil: 0, stunUntil: 0,
      carrying: null, dragged: false,
    };
    this.players.set(id, p);
    if (!this.hostId) this.hostId = id;
    this.sendLobby();
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (p.carrying) {
      const c = this.components.find(c => c.id === p.carrying);
      if (c && c.state === 'carried') { c.state = 'world'; c.x = p.x; c.z = p.z; c.carrier = null; }
    }
    this.channelers.delete(id);
    if (this.drag && this.drag.targetId === id) this.drag = null;
    if (this.hostId === id) this.hostId = this.players.keys().next().value || null;

    if (this.players.size === 0) {
      clearInterval(this.loop);
      this.onEmpty(this.code);
      return;
    }
    if (this.state === 'playing') {
      if (p.role === 'ghost') this.end('hunters', 'The ghost fled this plane (disconnected).');
      else this.checkHunterWipe();
    }
    this.sendLobby();
  }

  setRole(id, role) {
    if (this.state !== 'lobby') return;
    const p = this.players.get(id);
    if (!p) return;
    if (role === 'ghost') {
      for (const q of this.players.values()) if (q.role === 'ghost' && q.id !== id) q.role = null;
      p.role = 'ghost';
    } else if (role === 'hunter') {
      const hunters = [...this.players.values()].filter(q => q.role === 'hunter' && q.id !== id);
      if (hunters.length >= TUNE.MAX_HUNTERS) return this.sendTo(id, { t: 'error', msg: 'Hunter slots full (max 3).' });
      p.role = 'hunter';
    }
    this.sendLobby();
  }

  start(id) {
    if (this.state !== 'lobby' || id !== this.hostId) return;
    const all = [...this.players.values()];
    const ghost = all.find(p => p.role === 'ghost');
    const hunters = all.filter(p => p.role === 'hunter');
    if (!ghost) return this.sendTo(id, { t: 'error', msg: 'Someone must play the Ghost.' });
    if (hunters.length < 1) return this.sendTo(id, { t: 'error', msg: 'Need at least 1 Hunter.' });
    if (all.some(p => !p.role)) return this.sendTo(id, { t: 'error', msg: 'Everyone needs a role.' });

    this.reset();
    this.state = 'playing';
    this.startT = now();

    // spawn ritual components at 3 random candidate spots
    const spots = [...componentSpots].sort(() => Math.random() - 0.5).slice(0, TUNE.RITUAL_COMPONENTS);
    this.components = spots.map((s, i) => ({ id: 'comp' + i, x: s.x, z: s.z, state: 'world', carrier: null }));

    hunters.forEach((h, i) => {
      const s = hunterSpawns[i % hunterSpawns.length];
      Object.assign(h, { x: s.x, z: s.z, y: 1.6, alive: true, carrying: null, dragged: false, staggerUntil: 0 });
    });
    Object.assign(ghost, { x: ghostSpawn.x, z: ghostSpawn.z, y: 1.6, alive: true });

    for (const p of this.players.values()) {
      this.sendTo(p.id, {
        t: 'startMatch',
        role: p.role,
        spawn: { x: p.x, z: p.z },
        components: this.components.map(c => ({ id: c.id, x: c.x, z: c.z })),
        ritual: ritualCircle,
        players: all.map(q => ({ id: q.id, name: q.name, role: q.role })),
        tune: TUNE,
      });
    }
  }

  again(id) {
    if (this.state !== 'ended' || id !== this.hostId) return;
    this.state = 'lobby';
    this.reset();
    for (const p of this.players.values()) { p.alive = true; p.dragged = false; p.carrying = null; }
    this.sendLobby();
  }

  // ---- message handling ----

  handle(id, m) {
    const p = this.players.get(id);
    if (!p) return;
    switch (m.t) {
      case 'role': return this.setRole(id, m.role);
      case 'start': return this.start(id);
      case 'again': return this.again(id);
      case 'pos': {
        if (this.state !== 'playing' || !p.alive || p.dragged) return;
        p.x = +m.x || 0; p.y = +m.y || 1.6; p.z = +m.z || 0; p.ry = +m.ry || 0;
        const sp = Math.min(+m.sp || 0, 12);
        p.speedAvg = p.speedAvg * 0.8 + sp * 0.2;
        return;
      }
      case 'act': return this.state === 'playing' ? this.action(p, m) : null;
      case 'int': return this.state === 'playing' ? this.interact(p, m) : null;
    }
  }

  action(p, m) {
    if (p.role !== 'ghost' || !p.alive) return;
    const t = now();
    switch (m.kind) {
      case 'haunt': {
        if (t < this.hauntCdUntil) return;
        const prop = props.find(pr => pr.id === m.propId);
        if (!prop || dist2(p.x, p.z, prop.x, prop.z) > TUNE.HAUNT_RANGE ** 2) return;
        this.hauntCdUntil = t + TUNE.HAUNT_CD;
        // proximity rule: points only if a living hunter is near the prop
        const near = this.livingHunters().some(h => dist2(h.x, h.z, prop.x, prop.z) < TUNE.PROX_RADIUS ** 2);
        if (near) this.meter = Math.min(TUNE.METER_MAX, this.meter + TUNE.HAUNT_GAIN);
        this.addEvidence(prop.x, prop.z, 5);
        this.broadcast({ t: 'ev', ev: 'haunt', propId: prop.id, scored: near, room: prop.room });
        return;
      }
      case 'phase': {
        if (t < this.phaseCdUntil) return;
        this.phaseCdUntil = t + TUNE.PHASE_CD;
        // drain only while charged (doc: phasing stays free while weak)
        if (this.meter >= TUNE.LESSER_AT) this.meter = Math.max(0, this.meter - TUNE.PHASE_COST);
        const r = { id: nextEvId++, x: +m.x, y: 1.4, z: +m.z, nx: +m.nx || 0, nz: +m.nz || 1, born: t };
        this.residues.push(r);
        this.addEvidence(r.x, r.z, 2);
        this.broadcast({ t: 'ev', ev: 'residue', id: r.id, x: r.x, y: r.y, z: r.z, nx: r.nx, nz: r.nz });
        return;
      }
      case 'hurl': {
        if (this.meter < TUNE.LESSER_AT || this.meter < TUNE.HURL_COST) return;
        const target = this.players.get(m.targetId);
        if (!target || target.role !== 'hunter' || !target.alive) return;
        if (dist2(p.x, p.z, target.x, target.z) > TUNE.HURL_RANGE ** 2) return;
        this.meter -= TUNE.HURL_COST;
        this.addEvidence(target.x, target.z, 4);
        this.broadcast({ t: 'ev', ev: 'hurl', from: { x: p.x, y: 1.4, z: p.z }, targetId: target.id });
        // stagger lands when the projectile does
        setTimeout(() => {
          if (this.state !== 'playing' || !target.alive) return;
          target.staggerUntil = now() + TUNE.STAGGER_S;
          this.channelers.delete(target.id);
          this.broadcast({ t: 'ev', ev: 'stagger', targetId: target.id });
        }, 400);
        return;
      }
      case 'clutter': {
        if (this.meter < TUNE.LESSER_AT || this.meter < TUNE.CLUTTER_COST) return;
        let best = null, bd = TUNE.CLUTTER_RANGE ** 2;
        for (const d of doors) {
          if (this.barricades.some(b => b.doorId === d.id)) continue;
          const dd = dist2(p.x, p.z, d.x, d.z);
          if (dd < bd) { bd = dd; best = d; }
        }
        if (!best) return;
        this.meter -= TUNE.CLUTTER_COST;
        const b = { id: nextEvId++, doorId: best.id, x: best.x, z: best.z, axis: best.axis, born: t };
        this.barricades.push(b);
        this.addEvidence(best.x, best.z, 4);
        this.broadcast({ t: 'ev', ev: 'barricade', id: b.id, x: b.x, z: b.z, axis: b.axis });
        return;
      }
      case 'crush': {
        if (this.crush || this.meter < TUNE.CRUSH_COST) return;
        const target = this.players.get(m.targetId);
        if (!target || target.role !== 'hunter' || !target.alive || target.dragged) return;
        if (dist2(p.x, p.z, target.x, target.z) > TUNE.CRUSH_RANGE ** 2) return;
        // doc: isolated…
        const iso = !this.livingHunters().some(h =>
          h.id !== target.id && dist2(h.x, h.z, target.x, target.z) < TUNE.CRUSH_ISO_RADIUS ** 2);
        if (!iso) return this.sendTo(p.id, { t: 'toast', msg: 'Target is not isolated.' });
        // …and relatively stationary
        if (target.speedAvg > TUNE.CRUSH_MAX_SPEED) return this.sendTo(p.id, { t: 'toast', msg: 'Target is moving too much.' });
        this.meter -= TUNE.CRUSH_COST;
        this.crush = { targetId: target.id, x: target.x, z: target.z, resolveT: t + TUNE.CRUSH_TELE_S };
        this.addEvidence(target.x, target.z, 5);
        this.broadcast({ t: 'ev', ev: 'crushTele', x: target.x, z: target.z, s: TUNE.CRUSH_TELE_S });
        return;
      }
      case 'rampage': {
        if (this.rampage || this.meter < TUNE.METER_MAX) return;
        this.meter = TUNE.METER_MAX; // spent at the end
        this.rampage = { endT: t + TUNE.RAMPAGE_DUR_S, blindUntil: t + TUNE.RAMPAGE_BLIND_S };
        this.addEvidence(p.x, p.z, 5);
        this.broadcast({ t: 'ev', ev: 'rampageStart', blind: TUNE.RAMPAGE_BLIND_S, dur: TUNE.RAMPAGE_DUR_S });
        return;
      }
      case 'grab': {
        if (!this.rampage || this.drag || t < this.grabCdUntil || t < this.rampage.blindUntil) return;
        if (t < p.stunUntil) return;
        const target = this.players.get(m.targetId);
        if (!target || target.role !== 'hunter' || !target.alive) return;
        if (dist2(p.x, p.z, target.x, target.z) > TUNE.GRAB_RANGE ** 2) return;
        this.drag = { targetId: target.id, startT: t };
        target.dragged = true;
        this.channelers.delete(target.id);
        this.broadcast({ t: 'ev', ev: 'grab', targetId: target.id, execIn: TUNE.DRAG_EXEC_S });
        return;
      }
    }
  }

  interact(p, m) {
    if (p.role !== 'hunter' || !p.alive || p.dragged) return;
    const t = now();
    if (t < p.staggerUntil) return;
    switch (m.kind) {
      case 'pickup': {
        if (p.carrying) return;
        const c = this.components.find(c => c.id === m.id && c.state === 'world');
        if (!c || dist2(p.x, p.z, c.x, c.z) > 2.2 ** 2) return;
        c.state = 'carried'; c.carrier = p.id; p.carrying = c.id;
        this.broadcast({ t: 'ev', ev: 'pickup', id: c.id, by: p.id });
        return;
      }
      case 'deposit': {
        if (!p.carrying) return;
        if (dist2(p.x, p.z, ritualCircle.x, ritualCircle.z) > (ritualCircle.r + 1.2) ** 2) return;
        const c = this.components.find(c => c.id === p.carrying);
        if (!c) { p.carrying = null; return; }
        c.state = 'placed'; c.carrier = null; p.carrying = null;
        const placed = this.components.filter(c => c.state === 'placed').length;
        this.broadcast({ t: 'ev', ev: 'placed', id: c.id, placed, total: this.components.length });
        return;
      }
      case 'chanStart': {
        const allPlaced = this.components.every(c => c.state === 'placed');
        if (!allPlaced) return;
        if (dist2(p.x, p.z, ritualCircle.x, ritualCircle.z) > TUNE.CHANNEL_RANGE ** 2) return;
        this.channelers.add(p.id);
        return;
      }
      case 'chanStop': {
        this.channelers.delete(p.id);
        return;
      }
      case 'rescue': {
        if (!this.drag) return;
        const victim = this.players.get(this.drag.targetId);
        if (!victim || victim.id === p.id) return;
        if (dist2(p.x, p.z, victim.x, victim.z) > TUNE.RESCUE_RANGE ** 2) return;
        this.drag = null;
        victim.dragged = false;
        this.grabCdUntil = t + TUNE.GRAB_CD;
        const ghost = this.ghost();
        if (ghost) ghost.stunUntil = t + TUNE.RESCUE_STUN_S;
        this.broadcast({ t: 'ev', ev: 'rescue', targetId: victim.id, by: p.id });
        return;
      }
      case 'clear': {
        const b = this.barricades.find(b => String(b.id) === String(m.id));
        if (!b || dist2(p.x, p.z, b.x, b.z) > 2.5 ** 2) return;
        this.barricades = this.barricades.filter(x => x.id !== b.id);
        this.broadcast({ t: 'ev', ev: 'barricadeGone', id: b.id });
        return;
      }
    }
  }

  // ---- simulation ----

  tick() {
    const t = now();
    const dt = Math.min(0.25, t - this.lastTick);
    this.lastTick = t;
    if (this.state !== 'playing') { this.sendState(); return; }

    // evidence + residue decay
    this.evidence = this.evidence.filter(e => t - e.t < TUNE.EVIDENCE_TTL);
    this.residues = this.residues.filter(r => t - r.born < TUNE.PHASE_RESIDUE_S);
    const expired = this.barricades.filter(b => t - b.born >= TUNE.BARRICADE_S);
    if (expired.length) {
      this.barricades = this.barricades.filter(b => t - b.born < TUNE.BARRICADE_S);
      for (const b of expired) this.broadcast({ t: 'ev', ev: 'barricadeGone', id: b.id });
    }

    // room temperature
    const ghost = this.ghost();
    const ghostRoom = ghost && ghost.alive ? roomAt(ghost.x, ghost.z) : null;
    for (const r of rooms) {
      if (ghostRoom && r.id === ghostRoom.id) {
        this.cold[r.id] = Math.min(TUNE.TEMP_BASE - TUNE.TEMP_MIN, this.cold[r.id] + TUNE.COLD_RATE * dt);
      } else {
        this.cold[r.id] = Math.max(0, this.cold[r.id] - TUNE.COLD_DECAY * dt);
      }
    }

    // crush resolution
    if (this.crush && t >= this.crush.resolveT) {
      const target = this.players.get(this.crush.targetId);
      let killed = false;
      if (target && target.alive &&
          dist2(target.x, target.z, this.crush.x, this.crush.z) < TUNE.CRUSH_KILL_RADIUS ** 2) {
        killed = true;
        this.kill(target, 'crush');
      }
      this.broadcast({ t: 'ev', ev: 'crushSlam', x: this.crush.x, z: this.crush.z, killed, targetId: this.crush.targetId });
      this.crush = null;
      if (killed) this.checkHunterWipe();
    }

    // drag / execution
    if (this.drag) {
      const victim = this.players.get(this.drag.targetId);
      if (!victim || !victim.alive) {
        this.drag = null;
      } else if (ghost) {
        // victim is pulled along with the ghost
        victim.x = ghost.x; victim.z = ghost.z; victim.y = 1.2;
        if (t - this.drag.startT >= TUNE.DRAG_EXEC_S) {
          this.kill(victim, 'execution');
          this.drag = null;
          this.checkHunterWipe();
        }
      }
    }

    // rampage timer — meter is spent when the window closes
    if (this.rampage && t >= this.rampage.endT) {
      this.rampage = null;
      this.meter = 0;
      if (this.drag) {
        const victim = this.players.get(this.drag.targetId);
        if (victim) victim.dragged = false;
        this.drag = null;
      }
      this.broadcast({ t: 'ev', ev: 'rampageEnd' });
    }

    // ritual channel
    if (this.channelers.size > 0) {
      // validate channelers still in range, alive, unstaggered
      for (const id of [...this.channelers]) {
        const h = this.players.get(id);
        if (!h || !h.alive || h.dragged || t < h.staggerUntil ||
            dist2(h.x, h.z, ritualCircle.x, ritualCircle.z) > TUNE.CHANNEL_RANGE ** 2) {
          this.channelers.delete(id);
        }
      }
      if (this.channelers.size > 0) {
        this.ritualProgress = Math.min(TUNE.CHANNEL_S, this.ritualProgress + dt);
        if (this.ritualProgress >= TUNE.CHANNEL_S) return this.end('hunters', 'The banish ritual is complete.');
      }
    }

    this.sendState();
  }

  kill(victim, how) {
    victim.alive = false;
    victim.dragged = false;
    this.channelers.delete(victim.id);
    if (victim.carrying) {
      const c = this.components.find(c => c.id === victim.carrying);
      if (c && c.state === 'carried') { c.state = 'world'; c.x = victim.x; c.z = victim.z; c.carrier = null; }
      victim.carrying = null;
    }
    this.broadcast({ t: 'ev', ev: 'death', targetId: victim.id, how, x: victim.x, z: victim.z });
  }

  checkHunterWipe() {
    if (this.state === 'playing' && this.livingHunters().length === 0) {
      this.end('ghost', 'Every hunter is dead.');
    }
  }

  end(winner, reason) {
    if (this.state !== 'playing') return;
    this.state = 'ended';
    this.winner = winner;
    this.broadcast({ t: 'end', winner, reason });
  }

  // ---- helpers / net ----

  ghost() { return [...this.players.values()].find(p => p.role === 'ghost'); }
  livingHunters() { return [...this.players.values()].filter(p => p.role === 'hunter' && p.alive); }

  addEvidence(x, z, strength) {
    this.evidence.push({ id: nextEvId++, x, z, strength, t: now() });
  }

  emfFor(h) {
    const t = now();
    let v = 0;
    const ghost = this.ghost();
    if (ghost && ghost.alive) {
      const d = Math.sqrt(dist2(h.x, h.z, ghost.x, ghost.z));
      v = Math.max(v, 5 * (1 - d / 12));
    }
    for (const e of this.evidence) {
      const d = Math.sqrt(dist2(h.x, h.z, e.x, e.z));
      const fresh = 1 - (t - e.t) / TUNE.EVIDENCE_TTL;
      v = Math.max(v, e.strength * (1 - d / 8) * fresh);
    }
    return Math.max(0, Math.min(5, Math.round(v)));
  }

  sendLobby() {
    this.broadcast({
      t: 'lobby',
      state: this.state,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, role: p.role, host: p.id === this.hostId,
      })),
    });
  }

  sendState() {
    if (this.state !== 'playing') return;
    const t = now();
    const ghost = this.ghost();
    const hunters = [...this.players.values()].filter(p => p.role === 'hunter');
    const huntersPub = hunters.map(h => ({
      id: h.id, x: +h.x.toFixed(2), y: +h.y.toFixed(2), z: +h.z.toFixed(2), ry: +h.ry.toFixed(2),
      alive: h.alive, carrying: h.carrying, dragged: h.dragged,
      staggered: t < h.staggerUntil,
    }));
    const temps = {};
    for (const r of rooms) temps[r.id] = +(TUNE.TEMP_BASE - this.cold[r.id]).toFixed(1);
    const ritual = {
      placed: this.components.filter(c => c.state === 'placed').length,
      total: this.components.length,
      progress: +this.ritualProgress.toFixed(2),
      channelS: TUNE.CHANNEL_S,
      channeling: this.channelers.size,
    };
    const comps = this.components.map(c => ({ id: c.id, x: c.x, z: c.z, state: c.state, carrier: c.carrier }));
    const barr = this.barricades.map(b => ({ id: b.id, x: b.x, z: b.z, axis: b.axis }));
    const ghostVisible = !!(this.rampage || this.drag);
    const ghostPub = ghost && ghostVisible ? {
      x: +ghost.x.toFixed(2), y: +ghost.y.toFixed(2), z: +ghost.z.toFixed(2), ry: +ghost.ry.toFixed(2),
    } : null;

    for (const p of this.players.values()) {
      if (p.role === 'hunter') {
        const dread = ghost && ghost.alive
          ? Math.max(0, Math.min(1, 1 - Math.sqrt(dist2(p.x, p.z, ghost.x, ghost.z)) / 10))
          : 0;
        this.sendTo(p.id, {
          t: 'st', hunters: huntersPub, ghost: ghostPub,
          emf: this.emfFor(p), dread: +dread.toFixed(2), temps, ritual,
          comps, barr,
          rampage: !!this.rampage,
        });
      } else {
        this.sendTo(p.id, {
          t: 'st', hunters: huntersPub,
          ghostSelf: { meter: +this.meter.toFixed(1), stunned: t < p.stunUntil },
          temps, ritual, comps, barr,
          rampage: !!this.rampage,
          blind: this.rampage ? Math.max(0, this.rampage.blindUntil - t) : 0,
          dragging: this.drag ? { targetId: this.drag.targetId, execIn: Math.max(0, TUNE.DRAG_EXEC_S - (t - this.drag.startT)) } : null,
        });
      }
    }
  }

  sendTo(id, msg) {
    const p = this.players.get(id);
    if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws.readyState === 1) p.ws.send(s);
    }
  }
}
