// Shared map definition — used by both the server (rooms, evidence, validation)
// and the client (rendering, collision). Keep this file dependency-free ESM.

export const WALL_H = 3.2;   // wall height (m)
export const WALL_T = 0.34;  // wall thickness (m)
export const DOOR_W = 1.7;   // doorway gap width (m)

export const HOUSE = { x1: 0, z1: 0, x2: 24, z2: 16 };

export const rooms = [
  { id: 'bedroom1', name: 'Bedroom 1', x1: 0,  z1: 0, x2: 7,  z2: 6 },
  { id: 'bathroom', name: 'Bathroom',  x1: 7,  z1: 0, x2: 11, z2: 6 },
  { id: 'kitchen',  name: 'Kitchen',   x1: 11, z1: 0, x2: 18, z2: 6 },
  { id: 'dining',   name: 'Dining',    x1: 18, z1: 0, x2: 24, z2: 6 },
  { id: 'hall',     name: 'Hallway',   x1: 0,  z1: 6, x2: 24, z2: 9 },
  { id: 'bedroom2', name: 'Bedroom 2', x1: 0,  z1: 9, x2: 7,  z2: 16 },
  { id: 'living',   name: 'Living Room', x1: 7, z1: 9, x2: 16, z2: 16 },
  { id: 'study',    name: 'Study',     x1: 16, z1: 9, x2: 24, z2: 16 },
];

export function roomAt(x, z) {
  for (const r of rooms) {
    if (x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2) return r;
  }
  return null;
}

// Doorways — used by Clutter (barricades) and by wall generation below.
export const doors = [
  { id: 'd_bed1',    x: 3.5,  z: 6,    axis: 'h' },
  { id: 'd_bath',    x: 9,    z: 6,    axis: 'h' },
  { id: 'd_kitchen', x: 14.5, z: 6,    axis: 'h' },
  { id: 'd_dining',  x: 21,   z: 6,    axis: 'h' },
  { id: 'd_bed2',    x: 3.5,  z: 9,    axis: 'h' },
  { id: 'd_living',  x: 11.5, z: 9,    axis: 'h' },
  { id: 'd_study',   x: 20,   z: 9,    axis: 'h' },
  { id: 'd_kd',      x: 18,   z: 3,    axis: 'v' },
  { id: 'd_ls',      x: 16,   z: 12.5, axis: 'v' },
];

function hWall(z, x1, x2, gapsAt = []) {
  const segs = [];
  let cur = x1;
  for (const at of [...gapsAt].sort((a, b) => a - b)) {
    const gs = at - DOOR_W / 2, ge = at + DOOR_W / 2;
    if (gs > cur) segs.push({ x1: cur, z1: z, x2: gs, z2: z });
    cur = ge;
  }
  if (cur < x2) segs.push({ x1: cur, z1: z, x2, z2: z });
  return segs;
}

function vWall(x, z1, z2, gapsAt = []) {
  const segs = [];
  let cur = z1;
  for (const at of [...gapsAt].sort((a, b) => a - b)) {
    const gs = at - DOOR_W / 2, ge = at + DOOR_W / 2;
    if (gs > cur) segs.push({ x1: x, z1: cur, x2: x, z2: gs });
    cur = ge;
  }
  if (cur < z2) segs.push({ x1: x, z1: cur, x2: x, z2 });
  return segs;
}

// Wall centerline segments (thickness WALL_T applied when building AABBs).
export const walls = [
  // perimeter
  ...hWall(0, 0, 24),
  ...hWall(16, 0, 24),
  ...vWall(0, 0, 16),
  ...vWall(24, 0, 16),
  // north rooms <-> hallway
  ...hWall(6, 0, 24, [3.5, 9, 14.5, 21]),
  // hallway <-> south rooms
  ...hWall(9, 0, 24, [3.5, 11.5, 20]),
  // interior verticals, north side
  ...vWall(7, 0, 6),
  ...vWall(11, 0, 6),
  ...vWall(18, 0, 6, [3]),
  // interior verticals, south side
  ...vWall(7, 9, 16),
  ...vWall(16, 9, 16, [12.5]),
];

// Wall AABBs for collision (centerline expanded by WALL_T/2).
export function wallBoxes() {
  const t = WALL_T / 2;
  return walls.map(w => ({
    x1: Math.min(w.x1, w.x2) - t,
    z1: Math.min(w.z1, w.z2) - t,
    x2: Math.max(w.x1, w.x2) + t,
    z2: Math.max(w.z1, w.z2) + t,
  }));
}

// Furniture / props. x,z = center; w along x, d along z; h = height.
// small: hauntable + Hurl ammo source. heavy: hauntable + Crush flavor.
export const props = [
  // bedroom1
  { id: 'bed1',      name: 'bed',        room: 'bedroom1', x: 1.6,  z: 2.2,  w: 2.4, d: 1.8,  h: 0.7,  color: 0x7a5cc0, heavy: true },
  { id: 'dresser1',  name: 'dresser',    room: 'bedroom1', x: 5.8,  z: 0.8,  w: 1.8, d: 0.7,  h: 1.2,  color: 0x9a6a3f, heavy: true },
  { id: 'lamp1',     name: 'lamp',       room: 'bedroom1', x: 3.2,  z: 0.6,  w: 0.4, d: 0.4,  h: 0.9,  color: 0xf0d060, small: true },
  // bathroom
  { id: 'tub',       name: 'bathtub',    room: 'bathroom', x: 8.2,  z: 1.2,  w: 2.0, d: 1.0,  h: 0.7,  color: 0xd8e8f0, heavy: true },
  { id: 'sink',      name: 'sink',       room: 'bathroom', x: 10.4, z: 2.5,  w: 0.8, d: 0.6,  h: 1.0,  color: 0xcfe0ea, small: true },
  { id: 'cabinet',   name: 'cabinet',    room: 'bathroom', x: 10.4, z: 4.5,  w: 0.7, d: 0.5,  h: 1.1,  color: 0x88b0c0, small: true },
  // kitchen
  { id: 'fridge',    name: 'fridge',     room: 'kitchen',  x: 11.7, z: 0.9,  w: 1.1, d: 1.0,  h: 2.0,  color: 0xb8c8cc, heavy: true },
  { id: 'counter',   name: 'counter',    room: 'kitchen',  x: 14.5, z: 0.6,  w: 3.4, d: 0.9,  h: 1.0,  color: 0x6f8f7a, heavy: true },
  { id: 'stove',     name: 'stove',      room: 'kitchen',  x: 17.2, z: 0.9,  w: 1.0, d: 1.0,  h: 1.0,  color: 0x555a60, heavy: true },
  { id: 'island',    name: 'island',     room: 'kitchen',  x: 14.5, z: 3.5,  w: 2.2, d: 1.0,  h: 1.0,  color: 0x7d9a86, heavy: true },
  { id: 'pot',       name: 'pot',        room: 'kitchen',  x: 12.5, z: 4.5,  w: 0.5, d: 0.5,  h: 0.5,  color: 0x88422e, small: true },
  // dining
  { id: 'dtable',    name: 'table',      room: 'dining',   x: 21,   z: 3,    w: 2.6, d: 1.4,  h: 0.8,  color: 0x8a5a34, heavy: true },
  { id: 'chair1',    name: 'chair',      room: 'dining',   x: 19.4, z: 3,    w: 0.55, d: 0.55, h: 0.9, color: 0xa06a40, small: true },
  { id: 'chair2',    name: 'chair',      room: 'dining',   x: 22.6, z: 3,    w: 0.55, d: 0.55, h: 0.9, color: 0xa06a40, small: true },
  { id: 'chair3',    name: 'chair',      room: 'dining',   x: 21,   z: 1.6,  w: 0.55, d: 0.55, h: 0.9, color: 0xa06a40, small: true },
  { id: 'chair4',    name: 'chair',      room: 'dining',   x: 21,   z: 4.4,  w: 0.55, d: 0.55, h: 0.9, color: 0xa06a40, small: true },
  // hallway
  { id: 'sidetable', name: 'side table', room: 'hall',     x: 0.8,  z: 7.5,  w: 0.7, d: 0.5,  h: 0.9,  color: 0x9a6a3f, small: true },
  { id: 'plant1',    name: 'plant',      room: 'hall',     x: 23.3, z: 7.5,  w: 0.6, d: 0.6,  h: 1.1,  color: 0x3f8f4f, small: true },
  { id: 'plant2',    name: 'plant',      room: 'hall',     x: 16.9, z: 6.5,  w: 0.6, d: 0.6,  h: 1.1,  color: 0x3f8f4f, small: true },
  // bedroom2
  { id: 'bed2',      name: 'bed',        room: 'bedroom2', x: 2,    z: 14.2, w: 2.4, d: 1.8,  h: 0.7,  color: 0x5c8cc0, heavy: true },
  { id: 'wardrobe',  name: 'wardrobe',   room: 'bedroom2', x: 6.2,  z: 10.4, w: 1.4, d: 0.8,  h: 2.1,  color: 0x7a4a28, heavy: true },
  { id: 'toybox',    name: 'toy box',    room: 'bedroom2', x: 0.7,  z: 10,   w: 0.8, d: 0.6,  h: 0.6,  color: 0xd05a8a, small: true },
  // living room
  { id: 'sofa',      name: 'sofa',       room: 'living',   x: 9.5,  z: 14.8, w: 2.8, d: 1.1,  h: 0.9,  color: 0xb04848, heavy: true },
  { id: 'tvstand',   name: 'TV stand',   room: 'living',   x: 9.4,  z: 9.8,  w: 2.2, d: 0.7,  h: 0.7,  color: 0x44484e, heavy: true },
  { id: 'coffee',    name: 'coffee table', room: 'living', x: 9.5,  z: 13,   w: 1.3, d: 0.7,  h: 0.5,  color: 0x9a6a3f, small: true },
  { id: 'lamp2',     name: 'lamp',       room: 'living',   x: 15.2, z: 15.2, w: 0.4, d: 0.4,  h: 1.4,  color: 0xf0d060, small: true },
  { id: 'books',     name: 'book pile',  room: 'living',   x: 7.6,  z: 12,   w: 0.6, d: 0.4,  h: 0.4,  color: 0x6a4a9a, small: true },
  // study
  { id: 'desk',      name: 'desk',       room: 'study',    x: 22.8, z: 10.6, w: 1.6, d: 0.9,  h: 0.85, color: 0x8a5a34, heavy: true },
  { id: 'bookshelf', name: 'bookshelf',  room: 'study',    x: 18,   z: 15.5, w: 1.8, d: 0.55, h: 2.0,  color: 0x6a4428, heavy: true },
  { id: 'dchair',    name: 'chair',      room: 'study',    x: 22.8, z: 11.8, w: 0.55, d: 0.55, h: 0.9, color: 0xa06a40, small: true },
];

export function propBox(p) {
  return { x1: p.x - p.w / 2, z1: p.z - p.d / 2, x2: p.x + p.w / 2, z2: p.z + p.d / 2 };
}

// The generic banish ritual: place all components at the circle, then channel.
export const ritualCircle = { x: 20.5, z: 12.5, r: 1.3, room: 'study' };

// Candidate spawn points for ritual objects; the server picks RITUAL_OBJECTS
// (6) at random and secretly marks RITUAL_REAL (3) of them genuine.
export const componentSpots = [
  { x: 5.8,  z: 3.6 },   // bedroom1
  { x: 8,    z: 4.8 },   // bathroom
  { x: 16.8, z: 4.8 },   // kitchen
  { x: 19.2, z: 1.2 },   // dining
  { x: 2,    z: 8.3 },   // hallway
  { x: 5.5,  z: 12.5 },  // bedroom2
  { x: 13.5, z: 14.5 },  // living
  { x: 8.2,  z: 10.8 },  // living (2nd)
  { x: 23,   z: 5 },     // dining (2nd)
];

export const hunterSpawns = [
  { x: 1.5, z: 7.3 },
  { x: 2.6, z: 8.3 },
  { x: 3.8, z: 7.3 },
];

export const ghostSpawn = { x: 22, z: 2 };
