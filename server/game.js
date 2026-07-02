// Match logic. One Game per room. The server is authoritative for the meter,
// evidence, temperatures, kills, the ritual, and win/lose. Movement is
// client-authoritative (this is a playtest build, not an anti-cheat build).

import {
  rooms, roomAt, doors, props, ritualCircle, componentSpots,
  hunterSpawns, ghostSpawn,
} from '../shared/map.js';
// ALL balance numbers live in shared/tune.js — the settings file. Tune there.
import { TUNE } from '../shared/tune.js';

export { TUNE };

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
    this.lockUntil = 0;        // disruptor: ghost abilities locked until this
    this.trailUntil = 0;       // disruptor: ghost drops visible trail markers until this
    this.nextTrailAt = 0;
    this.winner = null;
  }

  // ---- lobby ----

  addPlayer(id, name, ws) {
    const p = {
      id, name: String(name).slice(0, 16) || 'Player', ws,
      role: null, alive: true,
      x: 0, y: 1.6, z: 0, ry: 0, sp: 0, fl: false, emfOn: false,
      speedAvg: 0, staggerUntil: 0, stunUntil: 0,
      carrying: null, dragged: false,
      disruptCdUntil: 0, wardReadyAt: 0, clueT: 0,
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

    // spawn ritual objects at random candidate spots — only RITUAL_REAL of them
    // are genuine, and which ones is a secret the hunters must deduce
    const spots = [...componentSpots].sort(() => Math.random() - 0.5).slice(0, TUNE.RITUAL_OBJECTS);
    const realIdx = new Set(
      Array.from({ length: TUNE.RITUAL_OBJECTS }, (_, i) => i)
        .sort(() => Math.random() - 0.5).slice(0, TUNE.RITUAL_REAL)
    );
    this.components = spots.map((s, i) => ({
      id: 'comp' + i, x: s.x, z: s.z, state: 'world', carrier: null,
      real: realIdx.has(i), revealed: false,
    }));

    hunters.forEach((h, i) => {
      const s = hunterSpawns[i % hunterSpawns.length];
      Object.assign(h, {
        x: s.x, z: s.z, y: 1.6, alive: true, carrying: null, dragged: false,
        staggerUntil: 0, disruptCdUntil: 0, wardReadyAt: 0, fl: false, emfOn: false, clueT: 0,
      });
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
        p.fl = !!m.fl;
        p.emfOn = !!m.tl;
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
    // disruptor lock: all abilities are dead until it wears off (phasing is
    // movement, not an ability — it stays, and still leaves residue).
    if (t < this.lockUntil && m.kind !== 'phase') {
      return this.sendTo(p.id, { t: 'toast', msg: 'DISRUPTED — your powers are locked.' });
    }
    switch (m.kind) {
      case 'haunt': {
        if (t < this.hauntCdUntil) return;
        const prop = props.find(pr => pr.id === m.propId);
        if (!prop || dist2(p.x, p.z, prop.x, prop.z) > TUNE.HAUNT_RANGE ** 2) return;
        // interactions scale with the meter: heavy furniture needs power
        if (prop.heavy && this.meter < TUNE.HEAVY_HAUNT_AT) {
          return this.sendTo(p.id, { t: 'toast', msg: `The ${prop.name} is too heavy — you need ${TUNE.HEAVY_HAUNT_AT} power.` });
        }
        this.hauntCdUntil = t + TUNE.HAUNT_CD;
        // proximity rule: points only if a living hunter is near the prop
        const near = this.livingHunters().some(h => dist2(h.x, h.z, prop.x, prop.z) < TUNE.PROX_RADIUS ** 2);
        // a flashlight beam held on the ghost suppresses charging
        const lit = this.ghostLit(p);
        let gain = 0;
        if (near) {
          gain = prop.heavy ? TUNE.HAUNT_GAIN_HEAVY : TUNE.HAUNT_GAIN;
          if (lit) gain *= TUNE.FLASH_SLOW_FACTOR;
          gain = +gain.toFixed(1);
          this.meter = Math.min(TUNE.METER_MAX, this.meter + gain);
        }
        this.addEvidence(prop.x, prop.z, prop.heavy ? 5 : 4);
        this.broadcast({ t: 'ev', ev: 'haunt', propId: prop.id, scored: near, gain, lit, heavy: !!prop.heavy, room: prop.room });
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
        c.carrier = null; p.carrying = null;
        if (c.real) {
          c.state = 'placed';
          const placed = this.realPlaced();
          this.broadcast({ t: 'ev', ev: 'placed', id: c.id, placed, total: TUNE.RITUAL_REAL });
        } else {
          // identification puzzle penalty: a FALSE object shatters and dumps
          // a burst of power into the ghost's meter
          c.state = 'destroyed'; c.revealed = true;
          this.meter = Math.min(TUNE.METER_MAX, this.meter + TUNE.WRONG_OBJECT_METER);
          this.addEvidence(ritualCircle.x, ritualCircle.z, 5);
          this.broadcast({ t: 'ev', ev: 'wrongObject', id: c.id, by: p.id, gain: TUNE.WRONG_OBJECT_METER });
        }
        return;
      }
      case 'chanStart': {
        if (this.realPlaced() < TUNE.RITUAL_REAL) return;
        if (dist2(p.x, p.z, ritualCircle.x, ritualCircle.z) > TUNE.CHANNEL_RANGE ** 2) return;
        this.channelers.add(p.id);
        return;
      }
      case 'chanStop': {
        this.channelers.delete(p.id);
        return;
      }
      case 'rescue': {
        // breaking a drag-kill burns the rescuer's ward (defensive item, long recharge)
        if (!this.drag) return;
        const victim = this.players.get(this.drag.targetId);
        if (!victim || victim.id === p.id) return;
        if (dist2(p.x, p.z, victim.x, victim.z) > TUNE.RESCUE_RANGE ** 2) return;
        if (t < p.wardReadyAt) return this.sendTo(p.id, { t: 'toast', msg: 'Your ward is still recharging — you cannot break the grip.' });
        p.wardReadyAt = t + TUNE.WARD_RECHARGE_S;
        this.drag = null;
        victim.dragged = false;
        this.grabCdUntil = t + TUNE.GRAB_CD;
        const ghost = this.ghost();
        if (ghost) ghost.stunUntil = t + TUNE.RESCUE_STUN_S;
        this.broadcast({ t: 'ev', ev: 'rescue', targetId: victim.id, by: p.id });
        return;
      }
      case 'disrupt': {
        // THE key hunter tool: aim roughly at the (invisible) ghost and fire.
        // Hit => trail revealed, 10% meter drained, all ghost abilities locked.
        // Fires on a long cooldown whether it hits or not — a real commitment.
        if (t < p.disruptCdUntil) return;
        const ghost = this.ghost();
        if (!ghost || !ghost.alive) return;
        p.disruptCdUntil = t + TUNE.DISRUPT_CD_S;
        const dx = ghost.x - p.x, dz = ghost.z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry); // hunter's facing (matches client camera)
        const cos = d > 0.001 ? (dx * fx + dz * fz) / d : 1;
        const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
        const hit = d <= TUNE.DISRUPT_RANGE && ang <= TUNE.DISRUPT_AIM_DEG;
        if (hit) {
          this.meter = Math.max(0, this.meter - TUNE.METER_MAX * TUNE.DISRUPT_DRAIN_FRAC);
          this.lockUntil = t + TUNE.DISRUPT_LOCK_S;
          this.trailUntil = t + TUNE.DISRUPT_TRAIL_S;
          this.nextTrailAt = t;
          this.addEvidence(ghost.x, ghost.z, 5);
          this.broadcast({ t: 'ev', ev: 'disrupted', by: p.id, lock: TUNE.DISRUPT_LOCK_S, x: p.x, z: p.z, ry: p.ry });
        } else {
          this.broadcast({ t: 'ev', ev: 'disruptMiss', by: p.id, x: p.x, z: p.z, ry: p.ry });
        }
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

    // identification clue: a hunter holding the tracker (EMF on) with the ghost
    // in range accumulates a lock; CLUE_LOCK_S sustained seconds => a clue.
    // Breaking the signal resets the lock. Staggers count as broken.
    if (ghost && ghost.alive) {
      for (const h of this.livingHunters()) {
        const locked = h.emfOn && t >= h.staggerUntil && !h.dragged &&
          dist2(h.x, h.z, ghost.x, ghost.z) <= TUNE.CLUE_RANGE ** 2;
        if (locked) {
          h.clueT += dt;
          if (h.clueT >= TUNE.CLUE_LOCK_S) { h.clueT = 0; this.giveClue(h); }
        } else h.clueT = 0;
      }
    }

    // disruptor trail: while revealed, the ghost drops visible markers as it moves
    if (ghost && ghost.alive && t < this.trailUntil && t >= this.nextTrailAt) {
      this.nextTrailAt = t + TUNE.DISRUPT_TRAIL_STEP_S;
      this.broadcast({ t: 'ev', ev: 'trail', x: +ghost.x.toFixed(2), z: +ghost.z.toFixed(2) });
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
        // more channelers = faster ritual; one hunter alone can still (slowly) finish
        const rates = TUNE.RITUAL_RATE_BY_CHANNELERS;
        const rate = rates[Math.min(this.channelers.size, rates.length - 1)];
        this.ritualProgress = Math.min(TUNE.CHANNEL_S, this.ritualProgress + rate * dt);
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

  // is any living hunter holding a lit flashlight beam on the ghost?
  ghostLit(ghost) {
    for (const h of this.livingHunters()) {
      if (!h.fl) continue;
      const dx = ghost.x - h.x, dz = ghost.z - h.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > TUNE.FLASH_SLOW_RANGE || d < 0.001) continue;
      const fx = -Math.sin(h.ry), fz = -Math.cos(h.ry);
      const cos = (dx * fx + dz * fz) / d;
      if (Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI <= TUNE.FLASH_SLOW_DEG) return true;
    }
    return false;
  }

  realPlaced() { return this.components.filter(c => c.real && c.state === 'placed').length; }

  // a successful tracker lock identifies CLUE_REVEALS random unidentified
  // objects as TRUE or FALSE — team-wide knowledge
  giveClue(h) {
    const pool = this.components.filter(c => !c.revealed);
    if (!pool.length) return this.sendTo(h.id, { t: 'toast', msg: 'The tracker finds nothing more to learn.' });
    for (let i = 0; i < TUNE.CLUE_REVEALS && pool.length; i++) {
      const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      c.revealed = true;
      this.broadcast({
        t: 'ev', ev: 'clue', id: c.id, known: c.real ? 'real' : 'fake',
        room: roomAt(c.x, c.z)?.name || 'somewhere', by: h.id,
      });
    }
  }

  // tracker readout: the area of the latest ghost activity + coarse charge (0-4)
  trackInfo() {
    const latest = this.evidence[this.evidence.length - 1];
    return {
      room: latest ? (roomAt(latest.x, latest.z)?.name || null) : null,
      charge: Math.min(4, Math.floor(this.meter / (TUNE.METER_MAX / 4))),
    };
  }

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
      placed: this.realPlaced(),
      total: TUNE.RITUAL_REAL,
      identified: this.components.filter(c => c.revealed).length,
      objects: TUNE.RITUAL_OBJECTS,
      progress: +this.ritualProgress.toFixed(2),
      channelS: TUNE.CHANNEL_S,
      channeling: this.channelers.size,
    };
    // `real` is never sent unless revealed — the truth stays server-side
    const comps = this.components.map(c => ({
      id: c.id, x: c.x, z: c.z, state: c.state, carrier: c.carrier,
      known: c.revealed ? (c.real ? 'real' : 'fake') : null,
    }));
    const barr = this.barricades.map(b => ({ id: b.id, x: b.x, z: b.z, axis: b.axis }));
    const ghostVisible = !!(this.rampage || this.drag);
    const ghostPub = ghost && ghostVisible ? {
      x: +ghost.x.toFixed(2), y: +ghost.y.toFixed(2), z: +ghost.z.toFixed(2), ry: +ghost.ry.toFixed(2),
    } : null;

    const track = this.trackInfo();
    for (const p of this.players.values()) {
      if (p.role === 'hunter') {
        const dread = ghost && ghost.alive
          ? Math.max(0, Math.min(1, 1 - Math.sqrt(dist2(p.x, p.z, ghost.x, ghost.z)) / 10))
          : 0;
        this.sendTo(p.id, {
          t: 'st', hunters: huntersPub, ghost: ghostPub,
          emf: this.emfFor(p), dread: +dread.toFixed(2), temps, ritual,
          comps, barr, track,
          disruptCd: +Math.max(0, p.disruptCdUntil - t).toFixed(1),
          ward: +Math.max(0, p.wardReadyAt - t).toFixed(1),
          clue: +Math.min(1, p.clueT / TUNE.CLUE_LOCK_S).toFixed(2),
          rampage: !!this.rampage,
        });
      } else {
        this.sendTo(p.id, {
          t: 'st', hunters: huntersPub,
          ghostSelf: {
            meter: +this.meter.toFixed(1),
            stunned: t < p.stunUntil,
            lock: +Math.max(0, this.lockUntil - t).toFixed(1),
            lit: ghost && ghost.alive ? this.ghostLit(ghost) : false,
          },
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
