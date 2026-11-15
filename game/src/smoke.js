// smoke.js — smoke grenade: a lingering volume that blocks line of sight.
// One job: own the smoke clouds (spawn, grow, fade, remove) and answer the
// one question the AI and the minimap ask — does this segment pass through
// smoke? A cloud is 5 translucent spheres sharing one geometry/material,
// grows from 0.6 m to 3.4 m over ~1.2 s, lives 12 s, then fades out.
// Bullets still fly through smoke (as in the genre); vision does not.
import * as THREE from 'three';

// Fixed puff offsets (fractions of the cloud radius) — deterministic, no RNG.
const PUFFS = [
  [0, 0.35, 0], [0.55, 0.1, 0.3], [-0.5, 0.15, 0.35],
  [0.3, -0.1, -0.55], [-0.35, 0.05, -0.5],
];
export const SMOKE_PRICE = 300;
const LIFE = 12, MAX_R = 2.2, OPACITY = 0.22;

export function createSmoke(scene) {
  return {
    scene,
    list: [],
    geo: new THREE.SphereGeometry(1, 10, 8),
    mat: new THREE.MeshStandardMaterial({
      color: 0xb8c0cc, transparent: true, opacity: OPACITY, roughness: 1, depthWrite: false,
    }),
  };
}

// Spawn a cloud at (x, y, z); age pre-grows it (used by screenshot staging).
export function spawnSmokeCloud(G, x, y, z, age) {
  const sys = G.smoke;
  const meshes = [];
  for (let i = 0; i < PUFFS.length; i++) {
    const m = new THREE.Mesh(sys.geo, sys.mat);
    m.position.set(x, y, z);
    sys.scene.add(m);
    meshes.push(m);
  }
  const cloud = { x, y, z, age: age || 0, t: LIFE, r: 0.6, meshes };
  sys.list.push(cloud);
  return cloud;
}

export function stepSmoke(G, dt) {
  const list = G.smoke.list;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    c.age += dt; c.t -= dt;
    c.r = Math.min(MAX_R, 0.6 + c.age * 2.4);
    const op = c.t < 3 ? OPACITY * Math.max(0, c.t / 3) : OPACITY;
    for (let j = 0; j < c.meshes.length; j++) {
      const m = c.meshes[j], o = PUFFS[j];
      // Flattened puffs (y x 0.75) so the cloud reads as smoke, not a boulder.
      m.scale.set(c.r, c.r * 0.75, c.r);
      m.position.set(c.x + o[0] * c.r * 0.55, c.y + o[1] * c.r * 0.55, c.z + o[2] * c.r * 0.55);
      m.material.opacity = op;
    }
    if (c.t <= 0) {
      for (let j = 0; j < c.meshes.length; j++) G.smoke.scene.remove(c.meshes[j]);
      list.splice(i, 1);
    }
  }
}

// True when segment (ax,ay,az)->(bx,by,bz) passes through any live cloud.
// Segment-sphere test, locals only, no allocation.
export function smokeBlocks(G, ax, ay, az, bx, by, bz) {
  if (!G.smoke) return false;
  const list = G.smoke.list;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    let t = ((c.x - ax) * dx + (c.y - ay) * dy + (c.z - az) * dz) / (len2 || 1);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const px = ax + dx * t - c.x, py = ay + dy * t - c.y, pz = az + dz * t - c.z;
    if (px * px + py * py + pz * pz < c.r * c.r) return true;
  }
  return false;
}
