// weapon.js — weapon defs, hitscan fire, spread/recoil, reload, viewmodel.
// Gunplay rules: headshot x3, recoil kick + drift that recovers in ~0.4 s,
// spread grows while moving/airborne and shrinks crouched/still, damage
// falloff past ~25 m for SMG/shotgun, reload 2.2-3.2 s, empty reserve
// forces a switch to the Pip sidearm.
import * as THREE from 'three';
import { S, feed } from './state.js';
import { segmentBlocked } from './world.js';
import { damagePlayer } from './player.js';

export const WEAPONS = {
  pip:     { name: 'Pip',     price: 0,    mag: 12, reserve: 36, dmg: 26, head: 78,  rof: 0.16, reload: 2.2, spread: 0.012, kick: 0.011, falloff: 0,    auto: false, pellets: 1, len: 0.34, col: 0x8f96a8 },
  jackal:  { name: 'Jackal',  price: 1500, mag: 28, reserve: 84, dmg: 22, head: 66,  rof: 0.085, reload: 2.6, spread: 0.02,  kick: 0.009, falloff: 25,   auto: true,  pellets: 1, len: 0.52, col: 0x2a2f3a },
  kestrel: { name: 'Kestrel', price: 2700, mag: 25, reserve: 75, dmg: 34, head: 102, rof: 0.13, reload: 2.8, spread: 0.008, kick: 0.016, falloff: 0,    auto: true,  pellets: 1, len: 0.66, col: 0x3a4152 },
  mule:    { name: 'Mule',    price: 1700, mag: 6,  reserve: 24, dmg: 9,  head: 12,  rof: 0.9,  reload: 3.0, spread: 0.045, kick: 0.05,  falloff: 25,   auto: false, pellets: 8, len: 0.58, col: 0x4a3b28 },
  longbow: { name: 'Longbow', price: 4100, mag: 5,  reserve: 15, dmg: 85, head: 170, rof: 1.1,  reload: 3.2, spread: 0.003, kick: 0.045, falloff: 0,    auto: false, pellets: 1, len: 0.78, col: 0x1e2230 },
};
export const BUY_ORDER = ['pip', 'jackal', 'kestrel', 'mule', 'longbow'];
export const GRENADE_PRICE = { flash: 200, frag: 300 };

// Per-entity gun state, created lazily: { mag, reserve, cd, reloading, reloadT }
export function gunState(ent, key) {
  ent.guns = ent.guns || {};
  if (!ent.guns[key]) {
    const w = WEAPONS[key];
    ent.guns[key] = { mag: w.mag, reserve: w.reserve, cd: 0, reloading: false, reloadT: 0 };
  }
  return ent.guns[key];
}

export function giveWeapon(ent, key) {
  ent.owned = ent.owned || {};
  ent.owned[key] = true;
  gunState(ent, key);
}

export function startReload(ent, key) {
  const g = gunState(ent, key), w = WEAPONS[key];
  if (g.reloading || g.mag >= w.mag || g.reserve <= 0) return false;
  g.reloading = true; g.reloadT = w.reload;
  return true;
}

export function tickGuns(ent, dt) {
  if (!ent.guns) return;
  for (const key of Object.keys(ent.guns)) {
    const g = ent.guns[key];
    if (g.cd > 0) g.cd -= dt;
    if (g.reloading) {
      g.reloadT -= dt;
      if (g.reloadT <= 0) {
        g.reloading = false;
        const w = WEAPONS[key], need = w.mag - g.mag, take = Math.min(need, g.reserve);
        g.mag += take; g.reserve -= take;
      }
    }
  }
}

// Spread (radians) for one shot: base + movement/air + recoil bloom.
export function spreadFor(ent, w, moving, crouch, airborne) {
  let s = w.spread;
  if (moving) s *= 2.1;
  if (airborne) s *= 2.6;
  if (crouch) s *= 0.55;
  if (!moving && !airborne) s *= 0.7; // stopping to aim pays
  return s + (ent.recoil || 0) * 0.35;
}

// Ray vs sphere. Returns t or -1. No allocation.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  return tca - Math.sqrt(r2 - d2);
}

// One hitscan trigger pull. G = { world, player, bots, audio, hud }.
// shooter: { team, name, isPlayer, x, y, z, recoil, recoilX, moving, crouch, airborne }
// origin/dir are plain {x,y,z} objects. Returns 'hit' | 'kill' | 'miss' | ''.
export function fire(G, shooter, origin, dir, key) {
  const w = WEAPONS[key], g = gunState(shooter, key);
  if (g.cd > 0 || g.reloading || g.mag <= 0) return '';
  g.cd = w.rof; g.mag--;
  shooter.recoil = (shooter.recoil || 0) + w.kick;
  shooter.recoilX = (shooter.recoilX || 0) + (G.rng() - 0.5) * w.kick * 0.5;
  if (shooter.isPlayer) { S.shots++; G.audio.shot(key, 0); }
  else G.audio.shot(key, Math.hypot(origin.x - G.player.x, origin.z - G.player.z));

  const spread = spreadFor(shooter, w, shooter.moving, shooter.crouch, shooter.airborne);
  let result = 'miss', hitCounted = false;
  for (let p = 0; p < w.pellets; p++) {
    const dx = dir.x + (G.rng() - 0.5) * 2 * spread;
    const dy = dir.y + (G.rng() - 0.5) * 2 * spread;
    const dz = dir.z + (G.rng() - 0.5) * 2 * spread;
    const il = 1 / Math.hypot(dx, dy, dz);
    const rx = dx * il, ry = dy * il, rz = dz * il;
    // targets: the player (if shooter is a bot) + enemy bots
    const targets = [];
    if (!shooter.isPlayer && G.player.alive) targets.push({ ent: G.player, isPlayer: true, name: 'You' });
    for (const b of G.bots) {
      if (b.alive && b.team !== shooter.team) targets.push({ ent: b, isPlayer: false, name: b.name });
    }
    let best = null; // { t, target, head }
    for (const t of targets) {
      const e = t.ent;
      const eyeY = e.y + (e.crouch ? 1.05 : 1.62);
      const th = raySphere(origin.x, origin.y, origin.z, rx, ry, rz, e.x, eyeY - 0.12, e.z, 0.24);
      const tb = raySphere(origin.x, origin.y, origin.z, rx, ry, rz, e.x, e.y + 0.85, e.z, 0.5);
      let tt = -1, head = false;
      if (th >= 0 && (tb < 0 || th < tb)) { tt = th; head = true; }
      else if (tb >= 0) { tt = tb; head = false; }
      if (tt >= 0 && tt < 90 && (!best || tt < best.t)) best = { t: tt, target: t, head };
    }
    if (!best) continue;
    const hx = origin.x + rx * best.t, hy = origin.y + ry * best.t, hz = origin.z + rz * best.t;
    if (segmentBlocked(G.world, origin.x, origin.y, origin.z, hx, hy, hz)) continue;
    const dist = best.t;
    let dmg = best.head ? w.head : w.dmg;
    if (w.falloff && dist > w.falloff) dmg *= Math.max(0.45, 1 - (dist - w.falloff) / 40);
    dmg = Math.round(dmg);
    const t = best.target;
    let killed = false;
    if (t.isPlayer) killed = damagePlayer(G.player, dmg, shooter.x, shooter.z);
    else killed = G.botsDamage(t.ent, dmg, shooter);
    if (shooter.isPlayer) {
      if (!hitCounted) { S.hits++; hitCounted = true; }
      S.hitT = 0.09; S.hitKill = killed;
      G.audio.hit(killed);
      if (killed && result !== 'kill') { S.kills++; S.money += 300; feed(`${shooter.name} ▸ ${t.name}${best.head ? ' (headshot)' : ''}`); }
    } else if (killed) {
      feed(`${shooter.name} ▸ ${t.name}`);
      if (t.isPlayer) G.audio.hit(false);
    }
    result = killed ? 'kill' : 'hit';
  }
  return result;
}

// Out of reserve ammo -> forced sidearm switch. Returns the weapon key to use.
export function fallbackWeapon(ent) {
  const g = gunState(ent, ent.weapon || 'pip');
  if (g.mag === 0 && g.reserve === 0 && ent.weapon !== 'pip') {
    ent.weapon = 'pip';
    return 'pip';
  }
  return ent.weapon;
}

// --- viewmodel ------------------------------------------------------------
let vmGroup = null, vmFlash = null, vmLight = null, vmBaseZ = 0;
export function buildViewmodel(camera, key) {
  if (vmGroup) { camera.remove(vmGroup); vmGroup = null; }
  const w = WEAPONS[key];
  const mat = new THREE.MeshStandardMaterial({ color: w.col, roughness: 0.6, metalness: 0.3 });
  const matD = new THREE.MeshStandardMaterial({ color: 0x1b1a24, roughness: 0.7 });
  vmGroup = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, w.len), mat);
  body.position.set(0.22, -0.2, -0.45); vmGroup.add(body);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.1), matD);
  grip.position.set(0.22, -0.3, -0.22); grip.rotation.x = 0.3; vmGroup.add(grip);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), matD);
  barrel.position.set(0.22, -0.17, -0.45 - w.len / 2); vmGroup.add(barrel);
  vmFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xffc06a, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  vmFlash.position.set(0.22, -0.17, -0.45 - w.len / 2 - 0.1); vmGroup.add(vmFlash);
  vmLight = new THREE.PointLight(0xffc06a, 0, 6); vmLight.position.set(0.22, -0.1, -0.6); vmGroup.add(vmLight);
  vmBaseZ = -0.45;
  camera.add(vmGroup);
  return vmGroup;
}

export function vmKick(kick) {
  if (vmGroup) vmGroup.position.z = kick * 1.6;
  if (vmFlash) vmFlash.material.opacity = 0.9;
  if (vmLight) vmLight.intensity = 14;
}
export function vmTick(dt, reloading) {
  if (!vmGroup) return;
  vmGroup.position.z += (vmBaseZ * 0 - vmGroup.position.z) * Math.min(1, dt * 14);
  vmGroup.position.y = reloading ? -0.32 : -0.2 + Math.sin(S.time * 1.4) * 0.004;
  if (vmFlash) vmFlash.material.opacity *= Math.pow(0.001, dt);
  if (vmLight) vmLight.intensity *= Math.pow(0.001, dt);
}
export function vmMuzzle() {
  return { x: 0.22, y: -0.17, z: -0.45 };
}
