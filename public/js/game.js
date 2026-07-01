// Client match logic: first-person controls, collision, abilities, HUD, effects.
import * as THREE from 'three';
import {
  initRenderer, buildHouse, makeHunterMesh, makeGhostMesh, makeComponentMesh,
  makeResidueMesh, makeBarricadeMesh, makeCrushMesh, makeHurlMesh, makeBodyMesh,
  walls, props, HOUSE, ritualCircle,
} from './world.js';
import { roomAt } from '/shared/map.js';
import * as sfx from './audio.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const HUNTER_COLORS = [0x4aa8d8, 0xd8a04a, 0x6ad86a];

export class Match {
  constructor({ net, canvas, myId, role, spawn, components, ritual, players, tune }) {
    this.net = net;
    this.myId = myId;
    this.role = role;
    this.tune = tune;
    this.playersInfo = players;
    this.dead = false;
    this.over = false;

    const { renderer, scene, camera } = initRenderer(canvas);
    Object.assign(this, { renderer, scene, camera });
    const built = buildHouse(scene);
    this.solids = built.solids;
    this.propMeshes = built.propMeshes;
    this.roomLights = built.roomLights;

    // my body
    this.pos = new THREE.Vector3(spawn.x, 1.6, spawn.z);
    this.yaw = role === 'ghost' ? Math.PI : 0;
    this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.speedNow = 0;
    this.staggerUntil = 0;
    this.dragged = false;
    this.blindUntil = 0;

    // remote meshes
    this.hunterMeshes = new Map();
    let ci = 0;
    for (const p of players) {
      if (p.role === 'hunter') {
        const m = makeHunterMesh(p.name, HUNTER_COLORS[ci++ % HUNTER_COLORS.length]);
        m.visible = p.id !== myId;
        scene.add(m);
        this.hunterMeshes.set(p.id, m);
      }
    }
    this.ghostMesh = makeGhostMesh();
    this.ghostMesh.visible = false;
    scene.add(this.ghostMesh);

    // components
    this.compMeshes = new Map();
    for (const c of components) {
      const m = makeComponentMesh();
      m.position.set(c.x, 0, c.z);
      scene.add(m);
      this.compMeshes.set(c.id, m);
    }

    this.barricadeMeshes = new Map(); // id -> {mesh, box}
    this.residueMeshes = [];
    this.anims = [];
    this.shake = 0;

    // flashlight (hunter)
    this.flash = new THREE.SpotLight(0xfff2d8, 60, 22, 0.45, 0.5, 1.4);
    this.flash.visible = false;
    scene.add(this.flash);
    scene.add(this.flash.target);

    if (role === 'ghost') {
      // ghost-vision: the ghost sees in the dark
      scene.add(new THREE.AmbientLight(0x5a70a8, 1.2));
      scene.fog.far = 40;
    }

    // hunter tool state
    this.tool = null; // 'emf' | 'thermo'
    this.flashOn = false;
    this.bat = { emf: 100, thermo: 100, flash: 100 };
    this.lastEmf = 0;
    this.carrying = null;

    this.state = null;      // last server state packet
    this.holdE = null;      // {kind, start, id}
    this.channeling = false;
    this.lastPhaseAt = 0;
    this.lastPosSend = 0;
    this.prevPos = this.pos.clone();

    this.keys = new Set();
    this.bindInput(canvas);
    this.setupHud();

    this.clock = new THREE.Clock();
    this.rafId = 0;
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.update(Math.min(0.05, this.clock.getDelta()));
      renderer.render(scene, camera);
    };
    loop();
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    sfx.stopLoops();
    document.exitPointerLock?.();
    this.unbindInput();
    this.renderer.dispose();
  }

  // ------------- input -------------

  bindInput(canvas) {
    this.onKeyDown = e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.handleKey(e.code);
    };
    this.onKeyUp = e => {
      this.keys.delete(e.code);
      if (e.code === 'KeyE') this.releaseE();
    };
    this.onMouseMove = e => {
      if (document.pointerLockElement !== canvas) return;
      this.yaw -= e.movementX * 0.0023;
      this.pitch = clamp(this.pitch - e.movementY * 0.0023, -1.45, 1.45);
    };
    this.onClick = () => { canvas.requestPointerLock(); sfx.unlock(); };
    this.onLockChange = () => {
      const locked = document.pointerLockElement === canvas;
      $('clickToPlay').classList.toggle('hidden', locked || this.over);
    };
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.onLockChange();
    canvas.addEventListener('click', this.onClick);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    this.canvas = canvas;
  }

  unbindInput() {
    $('clickToPlay').classList.add('hidden');
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.canvas.removeEventListener('click', this.onClick);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
  }

  handleKey(code) {
    if (this.over) return;
    if (code === 'KeyH') $('helpPanel').classList.toggle('hidden');
    if (this.dead || this.dragged) return;

    if (this.role === 'hunter') {
      if (code === 'KeyF') this.flashOn = !this.flashOn && this.bat.flash > 0;
      if (code === 'Digit1') this.tool = this.tool === 'emf' ? null : (this.bat.emf > 0 ? 'emf' : this.tool);
      if (code === 'Digit2') this.tool = this.tool === 'thermo' ? null : (this.bat.thermo > 0 ? 'thermo' : this.tool);
      if (code === 'KeyE') this.pressE();
    } else {
      if (code === 'KeyE') this.ghostE();
      if (code === 'KeyQ') this.ghostTargetAction('hurl', this.tune.HURL_RANGE);
      if (code === 'KeyC') this.net.send({ t: 'act', kind: 'clutter' });
      if (code === 'KeyX') this.ghostTargetAction('crush', this.tune.CRUSH_RANGE);
      if (code === 'KeyR') this.net.send({ t: 'act', kind: 'rampage' });
    }
  }

  // hunter E press — resolve context
  pressE() {
    const ctx = this.interactContext();
    if (!ctx) return;
    if (ctx.kind === 'rescue') this.net.send({ t: 'int', kind: 'rescue' });
    else if (ctx.kind === 'pickup') this.net.send({ t: 'int', kind: 'pickup', id: ctx.id });
    else if (ctx.kind === 'deposit') this.net.send({ t: 'int', kind: 'deposit' });
    else if (ctx.kind === 'channel') { this.channeling = true; this.net.send({ t: 'int', kind: 'chanStart' }); }
    else if (ctx.kind === 'clear') this.holdE = { kind: 'clear', id: ctx.id, start: performance.now() };
  }

  releaseE() {
    this.holdE = null;
    if (this.channeling) {
      this.channeling = false;
      this.net.send({ t: 'int', kind: 'chanStop' });
    }
  }

  ghostE() {
    const st = this.state;
    if (st && st.rampage && !this.blind()) {
      const h = this.nearestHunter(this.tune.GRAB_RANGE);
      if (h) return this.net.send({ t: 'act', kind: 'grab', targetId: h.id });
    }
    const pr = this.nearestProp(this.tune.HAUNT_RANGE);
    if (pr) this.net.send({ t: 'act', kind: 'haunt', propId: pr.id });
  }

  ghostTargetAction(kind, range) {
    const h = this.bestHunterTarget(range);
    if (h) this.net.send({ t: 'act', kind, targetId: h.id });
  }

  // ------------- helpers -------------

  blind() { return performance.now() / 1000 < this.blindUntil; }

  livingHunterList() {
    if (!this.state) return [];
    return this.state.hunters.filter(h => h.alive && h.id !== this.myId);
  }

  nearestHunter(range) {
    let best = null, bd = range * range;
    for (const h of this.livingHunterList()) {
      const d = (h.x - this.pos.x) ** 2 + (h.z - this.pos.z) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  // prefers a hunter roughly in front of the ghost
  bestHunterTarget(range) {
    const fw = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    let best = null, bestScore = -1;
    for (const h of this.livingHunterList()) {
      const dx = h.x - this.pos.x, dz = h.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 0.001) continue;
      const dot = (dx / d) * fw.x + (dz / d) * fw.z;
      const score = dot * 2 - d / range;
      if (score > bestScore) { bestScore = score; best = h; }
    }
    return best;
  }

  nearestProp(range) {
    let best = null, bd = range * range;
    for (const p of props) {
      const d = (p.x - this.pos.x) ** 2 + (p.z - this.pos.z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  interactContext() {
    const st = this.state;
    if (!st || this.dead || this.dragged) return null;
    // rescue first — highest stakes
    const draggedMate = st.hunters.find(h => h.dragged && h.alive && h.id !== this.myId);
    if (draggedMate) {
      const d = Math.hypot(draggedMate.x - this.pos.x, draggedMate.z - this.pos.z);
      if (d < this.tune.RESCUE_RANGE) return { kind: 'rescue', label: '<b>E</b> — TEAR THEM FREE' };
    }
    if (!this.carrying) {
      for (const c of st.comps) {
        if (c.state !== 'world') continue;
        if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < 2.0)
          return { kind: 'pickup', id: c.id, label: '<b>E</b> — Take ritual component' };
      }
    }
    const dCircle = Math.hypot(ritualCircle.x - this.pos.x, ritualCircle.z - this.pos.z);
    if (this.carrying && dCircle < ritualCircle.r + 1.2)
      return { kind: 'deposit', label: '<b>E</b> — Place component on the circle' };
    if (st.ritual.placed === st.ritual.total && st.ritual.progress < st.ritual.channelS && dCircle < this.tune.CHANNEL_RANGE)
      return { kind: 'channel', label: 'Hold <b>E</b> — Channel the banish ritual' };
    for (const [id, b] of this.barricadeMeshes) {
      const p = b.mesh.position;
      if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 2.2)
        return { kind: 'clear', id, label: 'Hold <b>E</b> — Shove the furniture aside' };
    }
    return null;
  }

  // ------------- per-frame -------------

  update(dt) {
    const nowS = performance.now() / 1000;

    this.move(dt, nowS);

    // send position ~15Hz
    if (nowS - this.lastPosSend > 0.066) {
      this.lastPosSend = nowS;
      this.net.send({
        t: 'pos',
        x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2),
        ry: +this.yaw.toFixed(2), sp: +this.speedNow.toFixed(2),
      });
    }

    // camera
    const shakeX = (Math.random() - 0.5) * this.shake;
    const shakeY = (Math.random() - 0.5) * this.shake;
    this.shake = Math.max(0, this.shake - dt * 0.6);
    this.camera.position.set(this.pos.x + shakeX, this.pos.y + shakeY, this.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);

    // flashlight follows camera
    if (this.role === 'hunter') {
      this.flash.visible = this.flashOn && this.bat.flash > 0 && !this.dead;
      this.flash.position.copy(this.camera.position);
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.flash.target.position.copy(this.camera.position).add(dir.multiplyScalar(8));
      this.drainBatteries(dt);
    }

    // hold-E progress (barricade clearing)
    if (this.holdE && performance.now() - this.holdE.start > 2000) {
      this.net.send({ t: 'int', kind: 'clear', id: this.holdE.id });
      this.holdE = null;
    }

    // animations
    this.anims = this.anims.filter(a => a(dt) !== false);

    // component bob
    for (const [, m] of this.compMeshes) {
      if (m.visible) m.children[1].position.y = 0.58 + Math.sin(nowS * 3) * 0.03;
    }

    this.updateHud();
  }

  move(dt, nowS) {
    const t = this.tune;
    if (this.dragged || this.over) { this.speedNow = 0; return; }

    let speed;
    if (this.dead) speed = 8; // spectator fly
    else if (this.role === 'ghost') speed = this.state?.rampage ? t.RAMPAGE_SPEED : t.GHOST_SPEED;
    else speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? t.HUNTER_SPRINT : t.HUNTER_WALK;
    if (!this.dead && nowS < this.staggerUntil) speed = 0;
    if (this.role === 'ghost' && this.state?.ghostSelf?.stunned) speed = 0;

    const f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const s = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    let vx = 0, vz = 0;
    if (f || s) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      vx = (-sin * f + cos * s);
      vz = (-cos * f - sin * s);
      const len = Math.hypot(vx, vz);
      vx = vx / len * speed; vz = vz / len * speed;
    }
    this.speedNow = Math.hypot(vx, vz);

    this.prevPos.copy(this.pos);
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;

    if (this.dead) {
      // free fly up/down
      if (this.keys.has('Space')) this.pos.y += 6 * dt;
      if (this.keys.has('ControlLeft')) this.pos.y -= 6 * dt;
      this.pos.y = clamp(this.pos.y, 0.5, 12);
      this.pos.x = clamp(this.pos.x, HOUSE.x1 - 6, HOUSE.x2 + 6);
      this.pos.z = clamp(this.pos.z, HOUSE.z1 - 6, HOUSE.z2 + 6);
      return;
    }

    this.pos.y = 1.6;

    if (this.role === 'hunter') {
      this.collide();
    } else {
      // ghosts pass through everything but stay in the house
      this.pos.x = clamp(this.pos.x, HOUSE.x1 + 0.3, HOUSE.x2 - 0.3);
      this.pos.z = clamp(this.pos.z, HOUSE.z1 + 0.3, HOUSE.z2 - 0.3);
      this.detectPhase(nowS);
    }
  }

  collide() {
    const r = 0.35;
    const boxes = [...this.solids];
    for (const [, b] of this.barricadeMeshes) boxes.push(b.box);
    for (let iter = 0; iter < 2; iter++) {
      for (const b of boxes) {
        const cx = clamp(this.pos.x, b.x1, b.x2);
        const cz = clamp(this.pos.z, b.z1, b.z2);
        let dx = this.pos.x - cx, dz = this.pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-9) {
          const pushL = this.pos.x - b.x1, pushR = b.x2 - this.pos.x;
          const pushU = this.pos.z - b.z1, pushD = b.z2 - this.pos.z;
          const m = Math.min(pushL, pushR, pushU, pushD);
          if (m === pushL) this.pos.x = b.x1 - r;
          else if (m === pushR) this.pos.x = b.x2 + r;
          else if (m === pushU) this.pos.z = b.z1 - r;
          else this.pos.z = b.z2 + r;
        } else {
          const d = Math.sqrt(d2);
          this.pos.x = cx + dx / d * r;
          this.pos.z = cz + dz / d * r;
        }
      }
    }
  }

  detectPhase(nowS) {
    if (nowS - this.lastPhaseAt < this.tune.PHASE_CD) return;
    const p0 = this.prevPos, p1 = this.pos;
    for (const w of walls) {
      if (w.z1 === w.z2) { // horizontal wall
        const z = w.z1;
        if ((p0.z - z) * (p1.z - z) < 0) {
          const k = (z - p0.z) / (p1.z - p0.z);
          const x = p0.x + (p1.x - p0.x) * k;
          if (x >= Math.min(w.x1, w.x2) - 0.1 && x <= Math.max(w.x1, w.x2) + 0.1) {
            this.lastPhaseAt = nowS;
            const nz = Math.sign(p1.z - p0.z) || 1;
            this.net.send({ t: 'act', kind: 'phase', x: +x.toFixed(2), z, nx: 0, nz });
            return;
          }
        }
      } else { // vertical wall
        const x = w.x1;
        if ((p0.x - x) * (p1.x - x) < 0) {
          const k = (x - p0.x) / (p1.x - p0.x);
          const z = p0.z + (p1.z - p0.z) * k;
          if (z >= Math.min(w.z1, w.z2) - 0.1 && z <= Math.max(w.z1, w.z2) + 0.1) {
            this.lastPhaseAt = nowS;
            const nx = Math.sign(p1.x - p0.x) || 1;
            this.net.send({ t: 'act', kind: 'phase', x, z: +z.toFixed(2), nx, nz: 0 });
            return;
          }
        }
      }
    }
  }

  drainBatteries(dt) {
    if (this.dead) return;
    if (this.flashOn) {
      this.bat.flash = Math.max(0, this.bat.flash - dt * (100 / 240));
      if (this.bat.flash === 0) this.flashOn = false;
    }
    if (this.tool === 'emf') {
      this.bat.emf = Math.max(0, this.bat.emf - dt * (100 / 90));
      if (this.bat.emf === 0) this.tool = null;
    }
    if (this.tool === 'thermo') {
      this.bat.thermo = Math.max(0, this.bat.thermo - dt * (100 / 90));
      if (this.bat.thermo === 0) this.tool = null;
    }
  }

  // ------------- server state -------------

  onState(st) {
    this.state = st;

    // remote hunters
    for (const h of st.hunters) {
      const mesh = this.hunterMeshes.get(h.id);
      if (h.id === this.myId) {
        this.carrying = h.carrying;
        if (h.dragged && !this.dragged) { this.dragged = true; $('dragOverlay').classList.remove('hidden'); }
        if (!h.dragged && this.dragged) { this.dragged = false; $('dragOverlay').classList.add('hidden'); }
        if (this.dragged || !h.alive) { this.pos.set(h.x, 1.6, h.z); }
        continue;
      }
      if (!mesh) continue;
      mesh.visible = h.alive;
      mesh.position.lerp(new THREE.Vector3(h.x, 0, h.z), 0.35);
      mesh.rotation.y = h.ry;
    }

    // the ghost, when visible to hunters (rampage / dragging)
    if (this.role !== 'ghost') {
      if (st.ghost) {
        this.ghostMesh.visible = true;
        this.ghostMesh.position.lerp(new THREE.Vector3(st.ghost.x, 0, st.ghost.z), 0.35);
        this.ghostMesh.rotation.y = st.ghost.ry;
      } else this.ghostMesh.visible = false;
    }

    // components
    for (const c of st.comps) {
      const m = this.compMeshes.get(c.id);
      if (!m) continue;
      if (c.state === 'world') { m.visible = true; m.position.set(c.x, 0, c.z); }
      else if (c.state === 'carried') m.visible = false;
      else { // placed — arrange around the circle
        const i = st.comps.filter(x => x.state === 'placed').findIndex(x => x.id === c.id);
        const ang = (i / st.ritual.total) * Math.PI * 2;
        m.visible = true;
        m.position.set(ritualCircle.x + Math.cos(ang) * (ritualCircle.r - 0.25), 0, ritualCircle.z + Math.sin(ang) * (ritualCircle.r - 0.25));
      }
    }

    // audio loops for hunters
    if (this.role === 'hunter' && !this.dead) {
      sfx.setHeartbeat(st.dread || 0);
      sfx.setEmfBeep(this.tool === 'emf' && this.bat.emf > 0 ? st.emf : 0);
      this.lastEmf = st.emf;
    }
  }

  // ------------- events -------------

  onEvent(m) {
    const dist = (x, z) => Math.hypot(x - this.pos.x, z - this.pos.z);
    switch (m.ev) {
      case 'haunt': {
        const pm = this.propMeshes.get(m.propId);
        if (pm) this.shakeProp(pm);
        const p = props.find(p => p.id === m.propId);
        if (p) sfx.knock(dist(p.x, p.z));
        this.flickerRoom(m.room);
        if (this.role === 'ghost') this.msg(m.scored ? 'Haunt +' + this.tune.HAUNT_GAIN + ' (hunter nearby)' : 'No charge — no hunter nearby');
        return;
      }
      case 'residue': {
        const r = makeResidueMesh(m.x, m.y, m.z, m.nx, m.nz);
        this.scene.add(r);
        this.residueMeshes.push(r);
        const ttl = this.tune.PHASE_RESIDUE_S;
        let age = 0;
        this.anims.push(dt => {
          age += dt;
          r.material.opacity = 0.85 * (1 - age / ttl);
          if (age >= ttl) { this.scene.remove(r); return false; }
        });
        if (this.role === 'ghost') sfx.whoosh(0);
        return;
      }
      case 'hurl': {
        const target = this.state?.hunters.find(h => h.id === m.targetId);
        const proj = makeHurlMesh();
        const from = new THREE.Vector3(m.from.x, m.from.y, m.from.z);
        const to = target ? new THREE.Vector3(target.x, 1.3, target.z) : from.clone();
        proj.position.copy(from);
        this.scene.add(proj);
        sfx.whoosh(dist(m.from.x, m.from.z));
        let k = 0;
        this.anims.push(dt => {
          k += dt / 0.4;
          proj.position.lerpVectors(from, to, Math.min(1, k));
          proj.rotation.x += dt * 12;
          if (k >= 1) { this.scene.remove(proj); return false; }
        });
        return;
      }
      case 'stagger': {
        if (m.targetId === this.myId) {
          this.staggerUntil = performance.now() / 1000 + this.tune.STAGGER_S;
          this.shake = 0.25;
          this.releaseE();
          const f = $('staggerFlash');
          f.classList.remove('hidden');
          void f.offsetWidth;
          setTimeout(() => f.classList.add('hidden'), 500);
          sfx.thud(0);
        }
        return;
      }
      case 'barricade': {
        const mesh = makeBarricadeMesh(m.x, m.z, m.axis);
        this.scene.add(mesh);
        const w = m.axis === 'h' ? 0.9 : 0.3, d = m.axis === 'h' ? 0.3 : 0.9;
        this.barricadeMeshes.set(m.id, { mesh, box: { x1: m.x - w, z1: m.z - d, x2: m.x + w, z2: m.z + d } });
        sfx.scrape(dist(m.x, m.z));
        if (this.role === 'hunter') this.msg('Something slid across a doorway…');
        return;
      }
      case 'barricadeGone': {
        const b = this.barricadeMeshes.get(m.id);
        if (b) { this.scene.remove(b.mesh); this.barricadeMeshes.delete(m.id); }
        return;
      }
      case 'crushTele': {
        const grp = makeCrushMesh(m.x, m.z);
        this.scene.add(grp);
        this.crushGrp = grp;
        sfx.rumble(m.s, dist(m.x, m.z));
        const dur = m.s;
        let age = 0;
        this.anims.push(dt => {
          if (grp !== this.crushGrp && !grp.userData.slamming) return false;
          age += dt;
          if (!grp.userData.slamming) grp.userData.block.position.y = 0.45 + Math.min(1, age / dur) * 2.2;
          return true;
        });
        return;
      }
      case 'crushSlam': {
        const grp = this.crushGrp;
        this.crushGrp = null;
        sfx.slam(dist(m.x, m.z));
        this.shake = Math.max(this.shake, 0.3 * Math.max(0, 1 - dist(m.x, m.z) / 12));
        if (grp) {
          grp.userData.slamming = true;
          let age = 0;
          this.anims.push(dt => {
            age += dt;
            grp.userData.block.position.y = Math.max(0.45, 2.65 - age * 22);
            grp.userData.ring.material.opacity = Math.max(0, 0.5 - age * 0.5);
            if (age > 1.2) { this.scene.remove(grp); return false; }
          });
        }
        if (m.killed && m.targetId === this.myId) this.die();
        else if (m.killed) this.msg('Someone was crushed!');
        else if (this.role === 'ghost') this.msg('Crush missed.');
        return;
      }
      case 'rampageStart': {
        sfx.roar();
        if (this.role === 'ghost') {
          this.blindUntil = performance.now() / 1000 + m.blind;
          $('blind').classList.remove('hidden');
          setTimeout(() => $('blind').classList.add('hidden'), m.blind * 1000);
          this.msg('RAMPAGE — hunt them down!');
        } else {
          this.msg('IT MANIFESTS. RUN. HIDE.');
          this.shake = Math.max(this.shake, 0.35);
        }
        return;
      }
      case 'rampageEnd': {
        if (this.role === 'ghost') this.msg('Your fury subsides. Meter drained.');
        else this.msg('The air stills…');
        return;
      }
      case 'grab': {
        sfx.scream();
        if (m.targetId === this.myId) this.msg('YOU ARE GRABBED — a teammate must free you!');
        else this.msg('A hunter is being DRAGGED — press E near them to save them!');
        return;
      }
      case 'rescue': {
        sfx.thud(0);
        if (m.targetId === this.myId) this.msg('You were torn free!');
        else this.msg('Rescue! The ghost recoils.');
        return;
      }
      case 'death': {
        const body = makeBodyMesh();
        body.position.set(m.x, 0.32, m.z);
        this.scene.add(body);
        const hm = this.hunterMeshes.get(m.targetId);
        if (hm) hm.visible = false;
        if (m.targetId === this.myId) this.die();
        else {
          sfx.scream();
          const name = this.playersInfo.find(p => p.id === m.targetId)?.name || 'A hunter';
          this.msg(`${name} was ${m.how === 'crush' ? 'crushed' : 'executed'}.`);
        }
        return;
      }
      case 'pickup': {
        sfx.chime();
        if (m.by === this.myId) this.msg('Component taken — bring it to the ritual circle.');
        return;
      }
      case 'placed': {
        sfx.chime();
        this.msg(`Ritual component placed (${m.placed}/${m.total}).`);
        return;
      }
    }
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    sfx.scream();
    sfx.stopLoops();
    const js = $('jumpscare');
    js.classList.remove('hidden');
    setTimeout(() => {
      js.classList.add('hidden');
      $('deathScreen').classList.remove('hidden');
    }, 950);
    this.flashOn = false;
    this.tool = null;
    this.pos.y = 3;
  }

  // ------------- effects helpers -------------

  shakeProp(mesh) {
    const ox = mesh.position.x, oz = mesh.position.z;
    let age = 0;
    this.anims.push(dt => {
      age += dt;
      if (age >= 0.55) { mesh.position.x = ox; mesh.position.z = oz; return false; }
      mesh.position.x = ox + (Math.random() - 0.5) * 0.08;
      mesh.position.z = oz + (Math.random() - 0.5) * 0.08;
    });
  }

  flickerRoom(roomId) {
    const rl = this.roomLights.get(roomId);
    if (!rl) return;
    let age = 0;
    this.anims.push(dt => {
      age += dt;
      if (age >= 0.8) { rl.light.intensity = rl.base; return false; }
      rl.light.intensity = Math.random() < 0.4 ? rl.base * 0.1 : rl.base * 1.3;
    });
  }

  msg(text) {
    const box = $('messages');
    const d = document.createElement('div');
    d.textContent = text;
    box.prepend(d);
    while (box.children.length > 5) box.lastChild.remove();
    setTimeout(() => d.remove(), 6000);
  }

  // ------------- HUD -------------

  setupHud() {
    $('hud').classList.remove('hidden');
    $('messages').innerHTML = '';
    if (this.role === 'ghost') {
      $('ghostHud').classList.remove('hidden');
      $('hunterHud').classList.add('hidden');
      $('objective').innerHTML = 'You are the <b>POLTERGEIST</b>. Haunt objects <i>near</i> hunters to charge your meter. Kill them all before they finish the ritual.';
      $('helpPanel').textContent =
        'WASD — float (you pass through walls; phasing leaves residue and drains meter once charged)\nE — haunt nearby object / GRAB during Rampage\nQ — Hurl (stagger a hunter)\nC — Clutter (barricade nearest doorway)\nX — Crush (isolated, still target)\nR — RAMPAGE (full meter)\nH — toggle help';
    } else {
      $('hunterHud').classList.remove('hidden');
      $('ghostHud').classList.add('hidden');
      $('objective').innerHTML = 'Find the <b>3 ritual components</b>, place them on the glowing circle in the Study, and channel the banish ritual. Your tools track the ghost. Stay together — it kills stragglers.';
      $('helpPanel').textContent =
        'WASD — move, SHIFT — sprint\nMouse — look\nE — interact (pick up / place / channel / rescue)\n1 — EMF reader   2 — Thermometer\nF — flashlight (batteries are limited!)\nH — toggle help';
    }
  }

  updateHud() {
    const st = this.state;
    // interact prompt
    let promptText = '';
    if (!this.dead && !this.over) {
      if (this.role === 'hunter') {
        const ctx = this.interactContext();
        if (ctx) promptText = ctx.label;
      } else if (!this.blind()) {
        if (st?.rampage && this.nearestHunter(this.tune.GRAB_RANGE)) promptText = '<b>E</b> — GRAB';
        else {
          const pr = this.nearestProp(this.tune.HAUNT_RANGE);
          if (pr) promptText = `<b>E</b> — Haunt the ${pr.name}`;
        }
      }
    }
    $('prompt').innerHTML = promptText;

    if (!st) return;

    // channel bar
    const ch = st.ritual.channeling > 0 || this.channeling;
    $('channelBar').classList.toggle('hidden', !(ch && st.ritual.placed === st.ritual.total));
    $('channelFill').style.width = `${(st.ritual.progress / st.ritual.channelS) * 100}%`;

    if (this.role === 'ghost') {
      const meter = st.ghostSelf?.meter ?? 0;
      $('meterFill').style.width = `${meter}%`;
      const near = this.nearestHunter(this.tune.PROX_RADIUS);
      const pn = $('proxNote');
      pn.textContent = near ? 'A hunter is close — haunts will charge you' : 'No hunters nearby — haunts earn nothing';
      pn.classList.toggle('on', !!near);
      const T = this.tune;
      this.abState('abHaunt', true, false);
      this.abState('abHurl', meter >= T.LESSER_AT && meter >= T.HURL_COST, meter < T.LESSER_AT);
      this.abState('abClutter', meter >= T.LESSER_AT && meter >= T.CLUTTER_COST, meter < T.LESSER_AT);
      this.abState('abCrush', meter >= T.CRUSH_COST, meter < T.CRUSH_COST);
      this.abState('abRampage', meter >= T.METER_MAX, meter < T.METER_MAX);
      if (st.dragging) $('objective').innerHTML = `DRAGGING — execution in ${st.dragging.execIn.toFixed(1)}s unless they're saved…`;
    } else {
      // tools
      $('toolEmf').className = 'tool' + (this.tool === 'emf' ? ' on' : '') + (this.bat.emf <= 0 ? ' dead' : '');
      $('toolThermo').className = 'tool' + (this.tool === 'thermo' ? ' on' : '') + (this.bat.thermo <= 0 ? ' dead' : '');
      $('toolFlash').className = 'tool' + (this.flashOn ? ' on' : '') + (this.bat.flash <= 0 ? ' dead' : '');
      $('batEmf').style.width = `${this.bat.emf}%`;
      $('batThermo').style.width = `${this.bat.thermo}%`;
      $('batFlash').style.width = `${this.bat.flash}%`;
      const lights = $('emfLights').children;
      const lvl = this.tool === 'emf' && this.bat.emf > 0 ? st.emf : 0;
      for (let i = 0; i < 5; i++) lights[i].className = i < lvl ? (lvl >= 5 ? 'on5' : 'on') : '';
      if (this.tool === 'thermo' && this.bat.thermo > 0) {
        const room = roomAt(this.pos.x, this.pos.z);
        $('thermoRead').textContent = room ? `${st.temps[room.id].toFixed(1)}°C — ${room.name}` : '--';
      } else $('thermoRead').textContent = '--';
      // ritual line
      const r = st.ritual;
      $('ritualState').textContent = r.placed < r.total
        ? `${r.placed}/${r.total} components placed`
        : r.progress < r.channelS
          ? `CHANNEL AT THE CIRCLE (${Math.round((r.progress / r.channelS) * 100)}%)`
          : 'COMPLETE';
      $('carryHud').classList.toggle('hidden', !this.carrying);
    }
  }

  abState(id, ready, locked) {
    const el = $(id);
    el.classList.toggle('ready', !!ready);
    el.classList.toggle('locked', !!locked);
  }
}
