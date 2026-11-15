// player.js — first-person movement, look, crouch, jump, health, recoil.
// Acceleration-based WASD, walk (Shift) is slow/quiet/accurate, crouch
// (Ctrl/C) lowers the eye and shrinks spread, jump (Space) is a small hop.
// Position is feet-based (x, y=ground height, z); the camera sits at eyeH.
import { collide, heightAt } from './world.js';
import { S } from './state.js';
import { applyArmour } from './armour.js';

export const EYE_STAND = 1.62, EYE_CROUCH = 1.05;
const SPEED = 4.6, WALK = 2.2, CROUCH = 2.0, ACCEL = 42, RADIUS = 0.35;

export function createPlayer() {
  return {
    x: 0, y: 0, z: 12, yaw: 0, pitch: 0, vy: 0, onGround: true,
    hp: 100, alive: true, crouch: false, moving: false, speed: 0,
    recoil: 0, recoilX: 0,           // pitch kick + horizontal drift
    weapon: 'kestrel', flash: 0, frag: 0, smoke: 0, grenadeSel: 'frag',
    armour: 0, helmet: false, helmetHits: 0, // Kevlar points + helmet (armour.js)
    mag: {}, reserve: {}, owned: { pip: true },
    plantHeld: 0,
  };
}

export function resetPlayer(p, x, z, yaw) {
  p.x = x; p.z = z; p.yaw = yaw; p.pitch = 0; p.vy = 0; p.onGround = true;
  p.hp = 100; p.alive = true; p.crouch = false; p.recoil = 0; p.recoilX = 0;
  p.y = heightAt(x, z);
}

// Fixed-step movement. input: {f, s, walk, crouch, jump}. dt = 1/60.
export function stepPlayer(p, world, input, dt) {
  if (!p.alive) return;
  const wantCrouch = input.crouch;
  p.crouch = wantCrouch;
  const sp = wantCrouch ? CROUCH : (input.walk ? WALK : SPEED);
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  // forward is -Z rotated by yaw; right is +X rotated by yaw
  let mx = (-sy) * input.f + cy * input.s;
  let mz = (-cy) * input.f + (-sy) * input.s;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; }
  p.moving = ml > 0.1;
  p.speed = p.moving ? sp : 0;
  // simple velocity smoothing (no stored velocity object: integrate directly)
  p.x += mx * sp * dt; p.z += mz * sp * dt;
  collide(world, p, RADIUS);
  // gravity / jump
  const ground = heightAt(p.x, p.z);
  if (input.jump && p.onGround) { p.vy = 4.6; p.onGround = false; }
  if (!p.onGround) {
    p.vy -= 13 * dt; p.y += p.vy * dt;
    if (p.y <= ground) { p.y = ground; p.vy = 0; p.onGround = true; }
  } else p.y = ground;
  // recoil recovery (~0.4 s)
  p.recoil *= Math.pow(0.02, dt); p.recoilX *= Math.pow(0.02, dt);
  if (Math.abs(p.recoil) < 0.001) p.recoil = 0;
  if (Math.abs(p.recoilX) < 0.001) p.recoilX = 0;
}

export function eyePos(p, out) {
  out.x = p.x; out.y = p.y + (p.crouch ? EYE_CROUCH : EYE_STAND); out.z = p.z;
  return out;
}

// Look direction from yaw/pitch + recoil kick. Writes into out (unit vector).
export function lookDir(p, out) {
  const pitch = p.pitch + p.recoil, yaw = p.yaw + p.recoilX;
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp; out.y = Math.sin(pitch); out.z = -Math.cos(yaw) * cp;
  return out;
}

export function damagePlayer(p, dmg, fromX, fromZ, head) {
  if (!p.alive) return false;
  // Kevlar / helmet absorb first (armour.js); only the rest hits HP.
  p.hp -= applyArmour(p, dmg, !!head);
  // damage direction indicator: angle of the shooter relative to facing
  const dx = fromX - p.x, dz = fromZ - p.z;
  const ang = Math.atan2(dx, dz) - Math.atan2(-Math.sin(p.yaw), -Math.cos(p.yaw));
  S.dmgDir = ang; S.dmgT = 1.2;
  if (p.hp <= 0) { p.hp = 0; p.alive = false; S.deaths++; return true; }
  return false;
}
