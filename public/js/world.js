// Three.js scene setup + house construction from the shared map.
import * as THREE from 'three';
import {
  rooms, walls, wallBoxes, props, propBox, WALL_H, WALL_T, HOUSE, ritualCircle,
} from '/shared/map.js';

export { rooms, walls, props, HOUSE, ritualCircle };

export function initRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04050a);
  scene.fog = new THREE.Fog(0x04050a, 6, 26);
  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 100);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  return { renderer, scene, camera };
}

export function buildHouse(scene) {
  const solids = wallBoxes(); // wall collision AABBs
  const propMeshes = new Map();
  const roomLights = new Map();

  // floor per room (subtle color variance, cartoony)
  const floorColors = { bedroom1: 0x4a4258, bathroom: 0x3e4a55, kitchen: 0x50483a, dining: 0x4a3e38, hall: 0x453f4a, bedroom2: 0x3e4658, living: 0x4c4038, study: 0x443a4e };
  for (const r of rooms) {
    const g = new THREE.PlaneGeometry(r.x2 - r.x1, r.z2 - r.z1);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: floorColors[r.id] || 0x444 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((r.x1 + r.x2) / 2, 0, (r.z1 + r.z2) / 2);
    scene.add(m);
  }

  // ceiling (dark, keeps light pooled)
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(HOUSE.x2 - HOUSE.x1, HOUSE.z2 - HOUSE.z1),
    new THREE.MeshLambertMaterial({ color: 0x14161e })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set((HOUSE.x1 + HOUSE.x2) / 2, WALL_H, (HOUSE.z1 + HOUSE.z2) / 2);
  scene.add(ceil);

  // walls (+ dark baseboards and a picture rail so close-up walls still read as walls)
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x6a7288 });
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x353b4e });
  for (const w of walls) {
    const len = Math.abs(w.x2 - w.x1) + Math.abs(w.z2 - w.z1);
    const horizontal = w.z1 === w.z2;
    const g = new THREE.BoxGeometry(horizontal ? len + WALL_T : WALL_T, WALL_H, horizontal ? WALL_T : len + WALL_T);
    const m = new THREE.Mesh(g, wallMat);
    m.position.set((w.x1 + w.x2) / 2, WALL_H / 2, (w.z1 + w.z2) / 2);
    scene.add(m);
    for (const [y, h] of [[0.14, 0.28], [2.35, 0.09]]) {
      const t = new THREE.Mesh(
        new THREE.BoxGeometry(horizontal ? len + WALL_T + 0.06 : WALL_T + 0.06, h, horizontal ? WALL_T + 0.06 : len + WALL_T + 0.06),
        trimMat
      );
      t.position.set((w.x1 + w.x2) / 2, y, (w.z1 + w.z2) / 2);
      scene.add(t);
    }
  }

  // props
  for (const p of props) {
    const g = new THREE.BoxGeometry(p.w, p.h, p.d);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: p.color }));
    m.position.set(p.x, p.h / 2, p.z);
    m.userData.prop = p;
    m.userData.baseY = p.h / 2;
    scene.add(m);
    propMeshes.set(p.id, m);
    solids.push(propBox(p));
  }

  // room lights — dim, warm, flickerable
  for (const r of rooms) {
    const l = new THREE.PointLight(0xffd9a0, 12, 11, 1.6);
    l.position.set((r.x1 + r.x2) / 2, WALL_H - 0.4, (r.z1 + r.z2) / 2);
    scene.add(l);
    roomLights.set(r.id, { light: l, base: 12 });
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe8c0 })
    );
    bulb.position.copy(l.position);
    scene.add(bulb);
  }

  scene.add(new THREE.AmbientLight(0x304060, 0.55));

  // ritual circle
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ritualCircle.r - 0.15, ritualCircle.r, 40),
    new THREE.MeshBasicMaterial({ color: 0xffb040, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(ritualCircle.x, 0.02, ritualCircle.z);
  scene.add(ring);
  const ringGlow = new THREE.PointLight(0xffb040, 3, 5, 1.8);
  ringGlow.position.set(ritualCircle.x, 0.8, ritualCircle.z);
  scene.add(ringGlow);

  return { solids, propMeshes, roomLights, ritualRing: ring };
}

// ---- factories ----

export function makeHunterMesh(name, color = 0x4aa8d8) {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.75, 4, 10),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = 0.85;
  grp.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 12, 10),
    new THREE.MeshLambertMaterial({ color: 0xe8c8a8 })
  );
  head.position.y = 1.55;
  grp.add(head);
  grp.add(nameSprite(name));
  return grp;
}

export function makeGhostMesh() {
  const grp = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.7, emissive: 0x8ab8ff, emissiveIntensity: 0.6 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 12, 1, true), mat);
  body.position.y = 0.9;
  grp.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), mat);
  head.position.y = 1.7;
  grp.add(head);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x101018 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), eyeMat);
    eye.position.set(0.15 * s, 1.76, 0.36);
    grp.add(eye);
  }
  const glow = new THREE.PointLight(0x9ac8ff, 5, 6, 1.8);
  glow.position.y = 1.4;
  grp.add(glow);
  return grp;
}

function nameSprite(name) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.fillStyle = '#fff';
  g.strokeStyle = '#000';
  g.lineWidth = 6;
  g.strokeText(name, 128, 42);
  g.fillText(name, 128, 42);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
  sp.scale.set(1.8, 0.45, 1);
  sp.position.y = 2.1;
  return sp;
}

export function makeComponentMesh() {
  const grp = new THREE.Group();
  const candle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.15, 0.5, 10),
    new THREE.MeshLambertMaterial({ color: 0xf0e8d0, emissive: 0x604818, emissiveIntensity: 0.4 })
  );
  candle.position.y = 0.25;
  grp.add(candle);
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffc040 })
  );
  flame.position.y = 0.58;
  grp.add(flame);
  const l = new THREE.PointLight(0xffa030, 2.5, 4, 1.8);
  l.position.y = 0.7;
  grp.add(l);
  return grp;
}

export function makeResidueMesh(x, y, z, nx, nz) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 14),
    new THREE.MeshBasicMaterial({ color: 0x4bffa0, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  m.position.set(x + nx * (WALL_T / 2 + 0.02), y, z + nz * (WALL_T / 2 + 0.02));
  m.lookAt(x + nx * 2, y, z + nz * 2);
  return m;
}

export function makeBarricadeMesh(x, z, axis) {
  const w = axis === 'h' ? 1.8 : 0.6;
  const d = axis === 'h' ? 0.6 : 1.8;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, 1.9, d),
    new THREE.MeshLambertMaterial({ color: 0x5a3a22 })
  );
  m.position.set(x, 0.95, z);
  return m;
}

export function makeCrushMesh(x, z) {
  const grp = new THREE.Group();
  const block = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.9, 1.15),
    new THREE.MeshLambertMaterial({ color: 0x24262e })
  );
  block.position.y = 0.45;
  grp.add(block);
  const ringM = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.5, 28),
    new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  ringM.rotation.x = -Math.PI / 2;
  ringM.position.y = 0.03;
  grp.add(ringM);
  grp.position.set(x, 0, z);
  grp.userData.block = block;
  grp.userData.ring = ringM;
  return grp;
}

export function makeHurlMesh() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.3),
    new THREE.MeshLambertMaterial({ color: 0xc09050 })
  );
}

export function makeBodyMesh() {
  const m = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.7, 4, 8),
    new THREE.MeshLambertMaterial({ color: 0x3a4a5a })
  );
  m.rotation.z = Math.PI / 2;
  m.position.y = 0.32;
  return m;
}
