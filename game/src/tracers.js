// tracers.js — bullet tracers + muzzle flash, pooled, zero per-frame allocation.
// One job: make gunfire visible. A tracer is a 2-point line from the muzzle
// to the hit point (or 30 m out on a miss), amber for Sparks, cyan for
// Wardens, alive 70 ms. A muzzle flash is a camera-facing sprite at the
// muzzle, alive 50 ms. Both pools are preallocated (10 lines, 3 sprites)
// and reused round-robin; stepTracers only fades them.
import * as THREE from 'three';

const TRACER_LIFE = 0.07, FLASH_LIFE = 0.05, POOL_LINES = 10, POOL_FLASH = 3;

export function createTracers(scene) {
  const lines = [];
  for (let i = 0; i < POOL_LINES; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffc06a, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.visible = false; line.frustumCulled = false;
    scene.add(line);
    lines.push({ line, life: 0 });
  }
  const flashes = [];
  for (let i = 0; i < POOL_FLASH; i++) {
    const mat = new THREE.SpriteMaterial({
      color: 0xffc06a, transparent: true, opacity: 0, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.scale.set(0.6, 0.6, 1);
    s.visible = false;
    scene.add(s);
    flashes.push({ sprite: s, life: 0 });
  }
  return { lines, flashes, li: 0, fi: 0 };
}

// Spawn one tracer + (for bots) one muzzle flash. o/e are plain {x,y,z}.
// The player's own flash is the viewmodel flash (weapon.js vmFlash): a
// world-space sprite 0.8 m from the camera would fill the screen, so the
// player gets a tracer only (withFlash false).
export function spawnTracer(G, o, e, team, withFlash) {
  const t = G.tracers;
  if (!t) return;
  const slot = t.lines[t.li];
  t.li = (t.li + 1) % POOL_LINES;
  const pos = slot.line.geometry.attributes.position.array;
  pos[0] = o.x; pos[1] = o.y; pos[2] = o.z;
  pos[3] = e.x; pos[4] = e.y; pos[5] = e.z;
  slot.line.geometry.attributes.position.needsUpdate = true;
  slot.line.material.color.set(team === 'wardens' ? 0x7fe8e0 : 0xffc06a);
  slot.line.material.opacity = 1;
  slot.line.visible = true;
  slot.life = TRACER_LIFE;
  if (!withFlash) return;
  const f = t.flashes[t.fi];
  t.fi = (t.fi + 1) % POOL_FLASH;
  f.sprite.position.set(o.x, o.y, o.z);
  f.sprite.material.opacity = 0.95;
  f.sprite.visible = true;
  f.life = FLASH_LIFE;
}

export function stepTracers(G, dt) {
  const t = G.tracers;
  if (!t) return;
  for (let i = 0; i < t.lines.length; i++) {
    const s = t.lines[i];
    if (s.life <= 0) continue;
    s.life -= dt;
    s.line.material.opacity = Math.max(0, s.life / TRACER_LIFE);
    if (s.life <= 0) s.line.visible = false;
  }
  for (let i = 0; i < t.flashes.length; i++) {
    const f = t.flashes[i];
    if (f.life <= 0) continue;
    f.life -= dt;
    f.sprite.material.opacity = Math.max(0, f.life / FLASH_LIFE);
    if (f.life <= 0) f.sprite.visible = false;
  }
}
