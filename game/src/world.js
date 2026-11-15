// world.js — "Relay Basin": a 40x28 m solar relay station at dusk.
// v3 palette: cold blue-grey sky, dark asphalt ground with painted lane
// markings, brick + steel walls in contrast, crates in varied hues, amber
// (Sparks / Pylon A) vs teal (Wardens / Pylon B) accents, floodlight poles,
// pipes, vents, signs, barrels and a skyline silhouette beyond the walls.
// Three lanes (A-long west, MID through the control bunker + catwalk,
// B-short east), Pylon A (dish mast, NW) and Pylon B (panel array, NE).
// Collision is axis-aligned boxes only; one shared collider list is used
// by the player, the bots, and the hitscan wall test. Waypoints (~24 nodes)
// form the graph bots path over with BFS. The sun casts real shadows.
import * as THREE from 'three';
import { PAL } from './palette.js';

export const MAP = { x: 20, z: 14 }; // half-extents in metres

// AABB colliders: {x0,z0,x1,z1} ground footprint + top height y1.
// Walls are tall; crates are low (crouch cover).
function box(list, x0, z0, x1, z1, y1) { list.push({ x0, z0, x1, z1, y1 }); }

export function buildWorld(scene) {
  const colliders = [];
  const solid = []; // meshes used for the LOS raycast
  const mat = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.05 });
  const basic = (c) => new THREE.MeshBasicMaterial({ color: c });
  const mGround = mat(0x3a3a40), mBrick = mat(PAL.brick), mSteel = mat(PAL.surface),
        mConcrete = mat(0x4a5058), mPanel = mat(0x2a5a64, 0.35),
        mAmber = mat(PAL.amber, 0.5), mTeal = mat(PAL.teal, 0.5),
        mDark = mat(0x2e323c), mRust = mat(0xa85a28, 0.7), mOlive = mat(0x6a6a3a, 0.8);
  const mBeaconA = basic(PAL.amber), mBeaconB = basic(PAL.teal);
  const mMarkWhite = basic(0x8f8f88), mMarkYellow = basic(0xa8842a); // dim paint, never a white beam
  // Crate hues vary by position hash — never one flat crate colour.
  const mCrates = [mat(0xa85a28, 0.8), mat(0x6a6a3a, 0.8), mat(0x3a5a6a, 0.8),
    mat(0xb08a3a, 0.8), mat(0x8a3a2a, 0.8)];
  const crateMat = (x, z) => mCrates[Math.abs(Math.floor(x * 7 + z * 13)) % mCrates.length];

  const add = (geo, m, x, y, z, ry = 0, coll = true, h = 99) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z); mesh.rotation.y = ry;
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    if (coll) { solid.push(mesh); }
    return mesh;
  };
  const block = (w, h, d, m, x, y, z, ry = 0) => {
    add(new THREE.BoxGeometry(w, h, d), m, x, y, z, ry);
    // footprint collider (skip if the piece is high above the ground)
    if (y - h / 2 < 0.1) box(colliders, x - w / 2, z - d / 2, x + w / 2, z + d / 2, y + h / 2);
  };

  // --- ground, sky, light -------------------------------------------------
  // Dusk: cold blue-grey sky/fog, low cool sun with real shadows, warm
  // amber fill from the east, dim blue hemisphere so shadows stay readable.
  scene.background = new THREE.Color(PAL.canvas);
  scene.fog = new THREE.Fog(PAL.canvas, 40, 95);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), mGround);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const sun = new THREE.DirectionalLight(0xa8bce0, 2.3);
  sun.position.set(-18, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -26; sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xff9a4a, 0.95);
  fill.position.set(18, 10, -6); scene.add(fill);
  scene.add(new THREE.HemisphereLight(0x4a5a7a, 0x3a2c1e, 1.5));
  const lampA = new THREE.PointLight(PAL.amber, 70, 22); lampA.position.set(-14, 5, -10); scene.add(lampA);
  const lampB = new THREE.PointLight(PAL.teal, 70, 22); lampB.position.set(14, 5, -10); scene.add(lampB);
  const lampMid = new THREE.PointLight(0xffc06a, 30, 14); lampMid.position.set(0, 4.5, -2); scene.add(lampMid);

  // --- painted ground: concrete pads + lane markings ----------------------
  const pad = (x, z, w, d, m) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    p.rotation.x = -Math.PI / 2; p.position.set(x, 0.015, z); p.receiveShadow = true; scene.add(p);
  };
  pad(-14, -10, 5.6, 5.6, mConcrete); pad(14, -10, 5.6, 5.6, mConcrete);
  pad(0, -2, 11, 7, mConcrete);
  const dashGeo = new THREE.PlaneGeometry(0.12, 1.4);
  // Dashes only in the north half: a dash under the spawn camera reads as
  // a giant white beam in the foreground instead of a lane marking.
  for (let z = -12; z <= 0; z += 3) {
    for (const [x, m] of [[-10.5, mMarkWhite], [0, mMarkYellow], [10.5, mMarkWhite]]) {
      const d = new THREE.Mesh(dashGeo, m);
      d.rotation.x = -Math.PI / 2; d.position.set(x, 0.02, z); scene.add(d);
    }
  }

  // --- perimeter walls: brick base + steel top (two-tone, in contrast) ----
  const wallRun = (w, d, x, z) => {
    block(w, 1.2, d, mBrick, x, 0.6, z);
    block(w, 2.0, d, mSteel, x, 2.2, z);
  };
  wallRun(42, 1, 0, -14.5); wallRun(42, 1, 0, 14.5);
  wallRun(1, 30, -20.5, 0); wallRun(1, 30, 20.5, 0);

  // --- skyline silhouettes beyond the walls (depth at a glance) -----------
  const skyline = [[-30, -20, 8, 14], [-28, 10, 7, 10], [30, -18, 9, 16],
    [28, 14, 6, 9], [0, -30, 10, 18], [-8, 28, 8, 12], [12, 30, 7, 15]];
  for (const [x, z, w, h] of skyline) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat(0x2c3850));
    s.position.set(x, h / 2, z); scene.add(s);
  }

  // --- Pylon A (NW, dish mast) + Pylon B (NE, panel array) ----------------
  const hazard = (x, z) => {
    // amber edge stripes around the pad so the site reads from any lane
    for (const [dx, dz, w, d] of [[0, -2.9, 5.6, 0.3], [0, 2.9, 5.6, 0.3], [-2.9, 0, 0.3, 5.6], [2.9, 0, 0.3, 5.6]]) {
      add(new THREE.BoxGeometry(w, 0.04, d), mAmber, x + dx, 0.42, z + dz);
    }
  };
  const pylon = (x, z, mat2, beacon) => {
    add(new THREE.BoxGeometry(5, 0.4, 5), mDark, x, 0.2, z); // raised pad (walkable, no collider)
    hazard(x, z);
    block(1.2, 4.2, 1.2, mSteel, x, 2.1, z);                 // pylon column
    add(new THREE.BoxGeometry(1.35, 0.18, 1.35), mat2, x, 3.0, z); // team band breaks the monolith
    add(new THREE.SphereGeometry(0.7, 12, 8), beacon, x, 4.6, z); // glowing beacon
    add(new THREE.TorusGeometry(1.6, 0.08, 8, 32), beacon, x, 0.25, z).rotation.x = Math.PI / 2; // plant ring
  };
  pylon(-14, -10, mAmber, mBeaconA); pylon(14, -10, mTeal, mBeaconB);
  // dish mast at A
  const mast = add(new THREE.CylinderGeometry(0.18, 0.3, 9, 8), mSteel, -17.5, 4.5, -12);
  void mast;
  const dish = add(new THREE.SphereGeometry(1.6, 12, 8, 0, Math.PI * 2, 0, 1.1), mAmber, -17.5, 9.2, -12);
  dish.rotation.x = -0.9;
  // panel array at B
  for (let i = 0; i < 4; i++) {
    const p = add(new THREE.BoxGeometry(2.6, 0.15, 1.8), mPanel, 11 + (i % 2) * 3.4, 1.4, -12.4 + Math.floor(i / 2) * 2.4);
    p.rotation.x = -0.5; p.rotation.y = 0.2;
  }

  // --- floodlight poles at the four corners --------------------------------
  for (const [x, z, m] of [[-18, -12, mBeaconA], [18, -12, mBeaconB], [-18, 12, mBeaconA], [18, 12, mBeaconB]]) {
    add(new THREE.CylinderGeometry(0.09, 0.12, 5, 6), mSteel, x, 2.5, z);
    add(new THREE.BoxGeometry(0.7, 0.25, 0.4), mDark, x, 5.1, z);
    add(new THREE.PlaneGeometry(0.55, 0.16), m, x, 5.05, z + (z < 0 ? 0.21 : -0.21));
  }

  // --- pipes along the north + west walls, vent on the bunker -------------
  const pipe = (len, x, y, z, ry) => {
    const p = add(new THREE.CylinderGeometry(0.14, 0.14, len, 8), mSteel, x, y, z);
    p.rotation.z = ry;
  };
  pipe(40, 0, 2.5, -13.9, Math.PI / 2);
  pipe(40, 0, 2.1, -13.9, Math.PI / 2);
  const pipeW = add(new THREE.CylinderGeometry(0.14, 0.14, 28, 8), mRust, -19.9, 2.5, 0);
  pipeW.rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(1.2, 0.5, 1.2), mDark, 0, 3.45, -2); // roof vent
  for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(1.3, 0.06, 0.2), mSteel, 0, 3.6 + i * 0.12, -2.3 + i * 0.3);
  add(new THREE.BoxGeometry(1.6, 1.0, 0.15), mSteel, -8, 2.2, -13.9); // wall vent
  for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(1.4, 0.08, 0.05), mDark, -8, 1.95 + i * 0.25, -13.8);

  // --- road signs at the lane mouths (amber = A side, teal = B side) ------
  const sign = (x, z, m) => {
    add(new THREE.BoxGeometry(0.08, 2.4, 0.08), mSteel, x, 1.2, z);
    add(new THREE.BoxGeometry(1.0, 0.7, 0.06), m, x, 2.4, z);
    const c1 = add(new THREE.BoxGeometry(0.5, 0.09, 0.02), mDark, x, 2.4, z + 0.05);
    c1.rotation.z = 0.6;
    const c2 = add(new THREE.BoxGeometry(0.5, 0.09, 0.02), mDark, x, 2.4, z + 0.05);
    c2.rotation.z = -0.6;
  };
  sign(-10.5, 8, mAmber); sign(10.5, 8, mTeal);

  // --- control bunker (MID) + catwalk over it -----------------------------
  // Bunker walls (brick) with two doorways (north + south gaps at x -1..1).
  block(3.4, 3, 0.6, mBrick, -3.3, 1.5, -2); block(3.4, 3, 0.6, mBrick, 3.3, 1.5, -2);
  block(0.6, 3, 6, mBrick, -5, 1.5, -2); block(0.6, 3, 6, mBrick, 5, 1.5, -2);
  // Catwalk: roof slab over the bunker + south ramp. heightAt() (below)
  // makes it walkable; it is visual + height, not a collider.
  add(new THREE.BoxGeometry(10.6, 0.25, 6.6), mDark, 0, 3.1, -2);
  const ramp = add(new THREE.BoxGeometry(3, 0.2, 5), mDark, 0, 1.55, 4.2);
  ramp.rotation.x = 0.6;
  add(new THREE.BoxGeometry(0.15, 1, 6.6), mAmber, -5.3, 3.7, -2); // catwalk rail
  add(new THREE.BoxGeometry(0.15, 1, 6.6), mAmber, 5.3, 3.7, -2);

  // --- cover: crates, barriers, panel rows --------------------------------
  const crate = (x, z, s = 1.1, h = 1.1) => block(s, h, s, crateMat(x, z), x, h / 2, z);
  const tall = (x, z, w = 1.2, d = 1.2) => block(w, 2.2, d, crateMat(x, z), x, 1.1, z);
  // A-long (west lane)
  crate(-12, 4); crate(-11.5, -2); tall(-11, -6); crate(-15, 2, 1.1, 1.1); crate(-6, 9.5);
  tall(-16, -6); crate(-9, -8);
  // MID
  crate(-3, 6); crate(3, 6); block(2.4, 1.1, 0.6, mConcrete, -4.5, 0.55, 2.5); block(2.4, 1.1, 0.6, mConcrete, 4.5, 0.55, 2.5);
  // B-short (east lane)
  crate(12, 4); crate(11.5, -2); tall(11, -6); crate(16, 2); crate(6, 9.5); tall(16, -6); crate(9, -8);
  // solar panel rows (angled cover, solid)
  const panelRow = (x, z, ry) => { const p = add(new THREE.BoxGeometry(4.5, 1.6, 0.25), mPanel, x, 0.9, z, ry); void p; box(colliders, x - 2.2, z - 0.4, x + 2.2, z + 0.4, 1.8); };
  panelRow(-6, -8.5, 0.3); panelRow(6, -8.5, -0.3); panelRow(-6, 10, -0.2); panelRow(6, 10, 0.2);
  // concrete barriers near spawns
  block(3, 1.1, 0.6, mConcrete, -6, 0.55, 11); block(3, 1.1, 0.6, mConcrete, 6, 0.55, 11);
  block(3, 1.1, 0.6, mConcrete, -6, 0.55, -11); block(3, 1.1, 0.6, mConcrete, 6, 0.55, -11);
  // barrels (rust / teal / dark) — low cover with a real collider each
  const barrel = (x, z, m) => {
    add(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), m, x, 0.55, z);
    add(new THREE.TorusGeometry(0.45, 0.03, 6, 16), mDark, x, 0.9, z).rotation.x = Math.PI / 2;
    box(colliders, x - 0.45, z - 0.45, x + 0.45, z + 0.45, 1.1);
  };
  barrel(-17, 4, mRust); barrel(-16.2, 5.1, mTeal); barrel(17, -2, mRust);
  barrel(16.2, -3.1, mOlive); barrel(-8, -11.8, mTeal); barrel(17, 9, mRust);

  // --- waypoints (~24 nodes) ----------------------------------------------
  // ids: 0-2 Spark spawn, 3-5 Warden spawn, 6-8 A lane, 9-11 MID,
  // 12-14 B lane, 15-16 sites, 17-20 hold spots, 21-23 rotation links.
  const wp = [
    [-14, 12], [0, 12], [14, 12],            // 0-2 sparks spawn
    [-14, -12], [0, -12], [14, -12],         // 3-5 wardens spawn
    [-14, 6], [-13, -1], [-14, -7],          // 6-8 A-long
    [-3, 7], [0, -2], [3, 7],                // 9-11 MID (10 = bunker)
    [14, 6], [13, -1], [14, -7],             // 12-14 B-short
    [-14, -10], [14, -10],                   // 15 A site, 16 B site
    [-11, -9], [11, -9], [-7, -4], [7, -4],  // 17-20 hold spots
    [-8, 2], [8, 2], [0, 9],                 // 21-23 rotation links
  ];
  const edges = [
    [0, 6], [1, 9], [1, 23], [2, 12], [6, 7], [7, 8], [8, 15], [8, 17],
    [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 16], [14, 18],
    [15, 17], [16, 18], [17, 19], [19, 21], [20, 22], [9, 21], [11, 22],
    [21, 7], [22, 13], [21, 23], [22, 23], [23, 6], [23, 12],
    [3, 15], [4, 19], [5, 16], [19, 15], [20, 16], [3, 17], [5, 18],
    [7, 21], [13, 22], [9, 6], [11, 12],
  ];
  const adj = wp.map(() => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }

  return {
    colliders, solid, wp, adj,
    pylons: { A: { x: -14, z: -10 }, B: { x: 14, z: -10 } },
    spawnSparks: [[-14, 12], [-7, 12], [0, 12], [7, 12], [14, 12]],
    spawnWardens: [[-14, -12], [-7, -12], [0, -12], [7, -12], [14, -12]],
  };
}

// Walkable height: pylon pads (0.4), catwalk slab (y 3.0) over the bunker + its south ramp.
export function heightAt(x, z) {
  if (Math.abs(x + 14) < 2.5 && Math.abs(z + 10) < 2.5) return 0.4;
  if (Math.abs(x - 14) < 2.5 && Math.abs(z + 10) < 2.5) return 0.4;
  if (x > -5.3 && x < 5.3 && z > -5.3 && z < 1.3) return 3.0;
  if (x > -1.5 && x < 1.5 && z >= 1.3 && z < 6.5) return 3.0 * (6.5 - z) / 5.2;
  return 0;
}

// Resolve an XZ circle (radius r) against the AABB colliders. Mutates p.
export function collide(world, p, r) {
  for (const c of world.colliders) {
    if (p.y > c.y1 - 0.15) continue; // feet near/above the top: step over it
    const cx = Math.max(c.x0, Math.min(p.x, c.x1));
    const cz = Math.max(c.z0, Math.min(p.z, c.z1));
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r;
    } else if (d2 <= 1e-8) {
      // centre inside the box: push out along the smallest penetration
      const pl = Math.min(p.x - c.x0, c.x1 - p.x), pd = Math.min(p.z - c.z0, c.z1 - p.z);
      if (pl < pd) p.x = (p.x - c.x0 < c.x1 - p.x) ? c.x0 - r : c.x1 + r;
      else p.z = (p.z - c.z0 < c.z1 - p.z) ? c.z0 - r : c.z1 + r;
    }
  }
  p.x = Math.max(-MAP.x + 0.5, Math.min(MAP.x - 0.5, p.x));
  p.z = Math.max(-MAP.z + 0.5, Math.min(MAP.z - 0.5, p.z));
}

// Segment (ax,ay,az)->(bx,by,bz) blocked by any collider? Slab test.
export function segmentBlocked(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (const c of world.colliders) {
    let t0 = 0, t1 = 1, ok = true;
    const mins = [c.x0, 0, c.z0], maxs = [c.x1, c.y1, c.z1], o = [ax, ay, az], d = [dx, dy, dz];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mins[i] || o[i] > maxs[i]) { ok = false; break; } }
      else {
        let ta = (mins[i] - o[i]) / d[i], tb = (maxs[i] - o[i]) / d[i];
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok) return true;
  }
  return false;
}

// BFS path over the waypoint graph. Returns an array of node ids.
export function findPath(world, from, to) {
  if (from === to) return [to];
  const prev = new Array(world.wp.length).fill(-1);
  const q = [from]; prev[from] = from;
  while (q.length) {
    const n = q.shift();
    for (const m of world.adj[n]) {
      if (prev[m] === -1) { prev[m] = n; if (m === to) { const path = [to]; let c = to; while (c !== from) { c = prev[c]; path.unshift(c); } return path; } q.push(m); }
    }
  }
  return [to];
}

export function nearestWp(world, x, z) {
  let best = 0, bd = 1e9;
  for (let i = 0; i < world.wp.length; i++) {
    const dx = world.wp[i][0] - x, dz = world.wp[i][1] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
