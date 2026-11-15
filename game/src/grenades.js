// grenades.js — flash cell ($200) + spark charge frag ($300) + smoke ($300).
// Thrown on an arc with gravity, one ground bounce, then: flash pops on
// first contact and blinds anyone with line of sight within 12 m for
// 2.5 s; frag detonates after 1.2 s for up to 90 area damage with falloff;
// smoke blooms into a 12 s cloud (smoke.js) that blocks bot line of sight.
// Bots hit by a flash stop aiming until it wears off.
import * as THREE from 'three';
import { S, feed } from './state.js';
import { segmentBlocked, heightAt } from './world.js';
import { damagePlayer } from './player.js';
import { spawnSmokeCloud } from './smoke.js';

export function createGrenades(scene) {
  const geo = new THREE.SphereGeometry(0.12, 10, 8);
  const matF = new THREE.MeshBasicMaterial({ color: 0xf2ead8 });
  const matB = new THREE.MeshBasicMaterial({ color: 0xf0a830 });
  const matS = new THREE.MeshBasicMaterial({ color: 0x9aa2ad });
  return { scene, list: [], geo, matF, matB, matS };
}

export function throwGrenade(G, ent, kind, origin, dir) {
  const mesh = new THREE.Mesh(G.grenades.geo,
    kind === 'flash' ? G.grenades.matF : kind === 'smoke' ? G.grenades.matS : G.grenades.matB);
  mesh.position.copy(origin);
  G.grenades.scene.add(mesh);
  G.grenades.list.push({
    kind, mesh, x: origin.x, y: origin.y, z: origin.z,
    vx: dir.x * 13, vy: dir.y * 13 + 3.2, vz: dir.z * 13,
    t: kind === 'frag' ? 1.2 : 99, bounced: false, owner: ent,
  });
}

function blindCheck(G, gx, gy, gz, kind) {
  const victims = [];
  if (G.player.alive) victims.push({ e: G.player, isPlayer: true });
  for (const b of G.bots) if (b.alive) victims.push({ e: b, isPlayer: false });
  for (const v of victims) {
    const e = v.e, eyeY = e.y + 1.5;
    const d = Math.hypot(e.x - gx, e.z - gz);
    if (kind === 'flash') {
      if (d < 12 && !segmentBlocked(G.world, gx, gy, gz, e.x, eyeY, e.z)) {
        if (v.isPlayer) S.flashT = 2.5; else { e.blindT = 2.5; e.target = null; }
        if (v.isPlayer) G.audio.flash();
      }
    } else {
      if (d < 6.5) {
        const dmg = Math.round(90 * (1 - d / 7));
        if (v.isPlayer) damagePlayer(G.player, dmg, gx, gz);
        else G.botsDamage(e, dmg, { name: 'spark charge', team: 'sparks' });
      }
    }
  }
}

export function stepGrenades(G, dt) {
  const list = G.grenades.list;
  for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i];
    g.vy -= 12 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    const ground = heightAt(g.x, g.z);
    if (g.y <= ground + 0.12) {
      g.y = ground + 0.12;
      if (g.kind === 'flash') { blindCheck(G, g.x, g.y, g.z, 'flash'); remove(G, i); continue; }
      if (g.kind === 'smoke') {
        spawnSmokeCloud(G, g.x, g.y + 0.7, g.z, 0);
        feed('smoke out — sight blocked');
        remove(G, i); continue;
      }
      if (!g.bounced) { g.vy = -g.vy * 0.4; g.vx *= 0.6; g.vz *= 0.6; g.bounced = true; }
      else { g.vy = 0; g.vx = 0; g.vz = 0; }
    }
    g.t -= dt;
    if (g.kind === 'frag' && g.t <= 0) {
      G.audio.boom();
      blindCheck(G, g.x, g.y, g.z, 'frag');
      feed('spark charge detonated');
      remove(G, i); continue;
    }
    g.mesh.position.set(g.x, g.y, g.z);
  }
}
function remove(G, i) {
  const g = G.grenades.list[i];
  G.grenades.scene.remove(g.mesh);
  G.grenades.list.splice(i, 1);
}
