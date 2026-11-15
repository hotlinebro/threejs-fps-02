// bots.js — bot AI: senses (LOS raycast + ~100 deg FOV + distance falloff,
// hearing via noise events), aim (260-480 ms reaction, 3-5 round bursts,
// ~35% first-shot accuracy at 15 m, never insta-headshot), and a behaviour
// state machine per bot: buy -> push -> hold -> fight -> rotate ->
// plant/defuse -> defend. Decisions tick at 10 Hz, not every frame.
// Spark bots pick a site (A 45% / B 35% / mid 20%); one carries the surge
// cell. Wardens: 2 hold A, 2 hold B, 1 roams mid; they rotate on plant or
// sound, and one defuses when the site is clear. Stuck detection re-routes.
// 5v5: player + 4 Spark bots vs 5 Warden bots.
import * as THREE from 'three';
import { S, callout } from './state.js';
import { findPath, nearestWp, collide, heightAt, segmentBlocked } from './world.js';
import { WEAPONS, gunState, giveWeapon, fire, startReload, tickGuns, fallbackWeapon } from './weapon.js';
import { applyArmour, ARMOUR } from './armour.js';
import { smokeBlocks } from './smoke.js';
import { radioStateChange } from './radio.js';

const SPARK_NAMES = ['Rook', 'Vex', 'Ash', 'Juno'];
const WARDEN_NAMES = ['Sable', 'Fern', 'Onyx', 'Bram', 'Wren'];
const BOT_SPEED = 3.4;
const FOV_COS = 0.64; // ~100 deg cone

let botId = 0;

function makeMesh(scene, team) {
  const col = team === 'sparks' ? 0xf0a830 : 0x57c8c0;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.95, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.8 }));
  body.position.y = 0.95; g.add(body);
  // Team-coloured vest, widened (0.62) so bots stay readable at range
  // against the dusk scene; the light body + pale head keep the silhouette
  // from dissolving into the dark ground the way v2's dark body did.
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.36),
    new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }));
  vest.position.y = 1.1; g.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34),
    new THREE.MeshStandardMaterial({ color: 0xc0c8d4, roughness: 0.7 }));
  head.position.y = 1.66; g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05),
    new THREE.MeshBasicMaterial({ color: col }));
  visor.position.set(0, 1.68, -0.18); g.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x1b1a24, roughness: 0.6 }));
  gun.position.set(0.25, 1.15, -0.3); g.add(gun);
  scene.add(g);
  return g;
}

export function createBots(scene) {
  const bots = [];
  for (let i = 0; i < 4; i++) bots.push(makeBot(scene, 'sparks', SPARK_NAMES[i]));
  for (let i = 0; i < 5; i++) bots.push(makeBot(scene, 'wardens', WARDEN_NAMES[i]));
  return bots;
}

function makeBot(scene, team, name) {
  return {
    id: botId++, name, team, isPlayer: false,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, alive: true,
    armour: 0, helmet: false, helmetHits: 0, // Kevlar + helmet (armour.js)
    weapon: 'jackal', money: 800, owned: {}, guns: {},
    moving: false, crouch: false, airborne: false, recoil: 0, recoilX: 0,
    state: 'buy', site: 'A', role: '', path: [], pathIdx: 0,
    target: null, lastSeen: 0, reactT: 0, burstLeft: 0, burstPause: 0,
    holdWp: 0, thinkT: 0, stuckT: 0, lastX: 0, lastZ: 0,
    plantT: 0, defuseT: 0, blindT: 0, investigate: null,
    mesh: makeMesh(scene, team),
  };
}

// Round setup: spawns, site picks, roles, buys, carrier pick.
export function resetBots(G) {
  const rng = G.rng;
  const sparks = G.bots.filter(b => b.team === 'sparks');
  const wardens = G.bots.filter(b => b.team === 'wardens');
  // Sparks: weighted site pick, one carries the cell.
  const carrierBot = rng() < 0.5 ? null : sparks[Math.floor(rng() * sparks.length)];
  S.carrier = carrierBot ? carrierBot.name : 'player';
  sparks.forEach((b, i) => {
    const r = rng(); b.site = r < 0.45 ? 'A' : r < 0.8 ? 'B' : 'MID';
    const sp = G.world.spawnSparks[i % 5];
    placeBot(b, sp[0], sp[1]);
    b.yaw = 0; // facing -Z (north, toward the pylons)
    b.role = b === carrierBot ? 'carrier' : 'push';
    b.state = 'push';
    botBuy(b, rng);
    setPath(G, b, b.site === 'A' ? 15 : b.site === 'B' ? 16 : 10);
  });
  // Wardens: 2 hold A, 2 hold B, 1 roams mid (5v5).
  const holds = [17, 19, 18, 10, 23];
  wardens.forEach((b, i) => {
    const sp = G.world.spawnWardens[i % 5];
    placeBot(b, sp[0], sp[1]);
    b.yaw = Math.PI; // facing +Z (south, toward Spark spawn)
    b.role = i === 4 ? 'roam' : 'hold';
    b.site = i < 2 ? 'A' : i === 2 || i === 3 ? 'B' : 'MID';
    b.holdWp = holds[i];
    b.state = 'hold';
    botBuy(b, rng);
    setPath(G, b, b.holdWp);
  });
  G.player.weapon = fallbackWeapon(G.player);
}

function placeBot(b, x, z) {
  b.x = x; b.z = z; b.y = heightAt(x, z); b.yaw = 0; b.pitch = 0;
  b.hp = 100; b.alive = true; b.target = null; b.plantT = 0; b.defuseT = 0;
  b.blindT = 0; b.burstLeft = 0; b.reactT = 0; b.stuckT = 0; b.investigate = null;
  b.lastX = x; b.lastZ = z;
  b.mesh.visible = true;
}

function botBuy(b, rng) {
  // Budget rule, in affordability order: rifle, SMG, shotgun, else the free
  // Pip sidearm (never spend more than the purse holds — round 1 is $800).
  if (b.money >= 2700) b.weapon = 'kestrel';
  else if (b.money >= 1700 && rng() < 0.3) b.weapon = 'mule';
  else if (b.money >= 1500) b.weapon = 'jackal';
  else b.weapon = 'pip';
  giveWeapon(b, b.weapon); giveWeapon(b, 'pip');
  b.money -= WEAPONS[b.weapon].price;
  // Armour before grenades: Kevlar if it fits, helmet if it still fits.
  if (b.money >= ARMOUR.kevlar.price) { b.armour = ARMOUR.kevlar.points; b.money -= ARMOUR.kevlar.price; }
  else b.armour = 0;
  if (b.money >= ARMOUR.helmet.price && rng() < 0.7) { b.helmet = true; b.helmetHits = 0; b.money -= ARMOUR.helmet.price; }
  else b.helmet = false;
  if (b.money >= 300) { b.frag = 1; b.money -= 300; } else b.frag = 0;
  if (b.money >= 200) { b.flash = 1; b.money -= 200; } else b.flash = 0;
}

function setPath(G, b, targetWp) {
  const from = nearestWp(G.world, b.x, b.z);
  b.path = findPath(G.world, from, targetWp);
  b.pathIdx = 0;
}

// Damage a bot. Returns true if killed. Carrier cell passes to a teammate.
export function botsDamage(G, bot, dmg, shooter, head) {
  if (!bot.alive) return false;
  // Kevlar / helmet absorb first (armour.js); head is the caller's hit flag.
  bot.hp -= applyArmour(bot, dmg, !!head);
  bot.lastSeen = S.time;
  if (bot.hp <= 0) {
    bot.hp = 0; bot.alive = false; bot.mesh.visible = false;
    if (S.carrier === bot.name) {
      const next = G.bots.find(b => b.alive && b.team === 'sparks');
      S.carrier = next ? next.name : 'player';
      if (next) callout(`${next.name} picked up the cell`);
    }
    return true;
  }
  return false;
}

// --- senses -----------------------------------------------------------------
// Returns the nearest visible enemy entity (player object or bot), else null.
function seeEnemy(G, b) {
  const eyeY = b.y + 1.5;
  const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
  let best = null, bestD = 1e9;
  const consider = (e, isPlayer) => {
    if (!e.alive) return;
    const dx = e.x - b.x, dz = e.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d > 38 || d >= bestD) return;
    const dot = (dx * fx + dz * fz) / (d || 1);
    if (dot < FOV_COS) return;
    const cy = e.y + (e.crouch ? 1.0 : 1.2);
    if (segmentBlocked(G.world, b.x, eyeY, b.z, e.x, cy, e.z)) return;
    // Smoke blocks sight for bots exactly like a wall does.
    if (smokeBlocks(G, b.x, eyeY, b.z, e.x, cy, e.z)) return;
    // distance falloff: far targets are easy to miss entirely
    if (d > 25 && G.rng() < (d - 25) / 40) return;
    best = { ent: e, isPlayer, d }; bestD = d;
  };
  if (b.team === 'wardens' && G.player.alive) consider(G.player, true);
  for (const o of G.bots) if (o.team !== b.team) consider(o, false);
  return best;
}

// --- decisions (10 Hz) -------------------------------------------------------
function think(G, b) {
  const rng = G.rng;
  if (!b.alive) return;
  const prevState = b.state; // radio callouts fire on transitions only
  if (b.blindT > 0) { b.target = null; return; }
  // hearing: a recent noise event nearby -> investigate
  if (!b.target && G.noises.length) {
    const n = G.noises[G.noises.length - 1];
    if (S.time - n.t < 1.5 && Math.hypot(n.x - b.x, n.z - b.z) < 22) {
      b.investigate = { x: n.x, z: n.z };
      if (b.state === 'hold') { setPath(G, b, nearestWp(G.world, n.x, n.z)); b.state = 'rotate'; }
    }
  }
  const seen = seeEnemy(G, b);
  if (seen) {
    if (!b.target) b.reactT = 0.26 + rng() * 0.22 + seen.d * 0.004; // reaction time
    b.target = seen.ent; b.lastSeen = S.time; b.state = 'fight';
    // Stamp the spotted enemy so the minimap can plot it for a few seconds.
    seen.ent._spottedT = S.time;
    if (b.team === 'sparks' && S.planted) b.state = 'defend';
  } else if (b.target && S.time - b.lastSeen > 1.5) {
    b.target = null; // forget after 1.5 s without LOS
    if (b.team === 'sparks') {
      b.state = S.planted ? 'defend' : 'push';
      if (!S.planted) setPath(G, b, b.site === 'A' ? 15 : b.site === 'B' ? 16 : 10);
    } else {
      b.state = S.planted ? 'rotate' : 'hold';
      if (S.planted) setPath(G, b, S.planted.site === 'A' ? 15 : 16);
      else setPath(G, b, b.holdWp);
    }
  }
  // objective behaviour
  if (b.team === 'sparks' && !S.planted) {
    if (S.carrier === b.name && b.state !== 'fight') {
      const site = b.site === 'MID' ? 'A' : b.site;
      const p = G.world.pylons[site];
      if (Math.hypot(p.x - b.x, p.z - b.z) < 2.8 && !b.target) b.state = 'plant';
      else if (b.state === 'plant') b.state = 'push';
    }
  }
  if (b.team === 'wardens' && S.planted) {
    const p = G.world.pylons[S.planted.site];
    const dSite = Math.hypot(p.x - b.x, p.z - b.z);
    const sparksNear = G.bots.some(o => o.alive && o.team === 'sparks' && Math.hypot(p.x - o.x, p.z - o.z) < 12)
      || (G.player.alive && Math.hypot(p.x - G.player.x, p.z - G.player.z) < 12);
    if (!sparksNear && !b.target) {
      if (dSite < 2.8) b.state = 'defuse';
      else if (b.role !== 'defuser' && !G.bots.some(o => o.alive && o.team === 'wardens' && o.state === 'defuse')) {
        b.role = 'defuser'; setPath(G, b, S.planted.site === 'A' ? 15 : 16); b.state = 'rotate';
      }
    }
  }
  // rotation on plant: wardens converge on the planted site
  if (b.team === 'wardens' && S.planted && b.state === 'hold' && b.role !== 'defuser') {
    setPath(G, b, S.planted.site === 'A' ? 15 : 16); b.state = 'rotate';
  }
  // Radio: one line when this bot's state actually changed (radio.js).
  radioStateChange(G, b, prevState);
}

// --- movement ----------------------------------------------------------------
function moveAlongPath(G, b, dt) {
  if (!b.path.length || b.pathIdx >= b.path.length) { b.moving = false; return; }
  const wp = G.world.wp[b.path[b.pathIdx]];
  const dx = wp[0] - b.x, dz = wp[1] - b.z, d = Math.hypot(dx, dz);
  if (d < 0.7) { b.pathIdx++; return; }
  // corner cutting: steer at the waypoint after this one if it is close
  b.yaw = Math.atan2(-dx, -dz);
  const sp = BOT_SPEED * (b.crouch ? 0.55 : 1);
  b.x += (dx / d) * sp * dt; b.z += (dz / d) * sp * dt;
  b.moving = true;
  b.y = heightAt(b.x, b.z);
  collide(G.world, b, 0.35);
  // stuck detection: no progress for 1.5 s -> re-route
  if (Math.hypot(b.x - b.lastX, b.z - b.lastZ) < 0.05) {
    b.stuckT += dt;
    if (b.stuckT > 1.5) {
      b.stuckT = 0;
      const alt = G.world.adj[nearestWp(G.world, b.x, b.z)];
      const pick = alt.length ? alt[Math.floor(G.rng() * alt.length)] : b.holdWp;
      setPath(G, b, pick);
    }
  } else { b.stuckT = 0; b.lastX = b.x; b.lastZ = b.z; }
}

// --- combat ------------------------------------------------------------------
function botShoot(G, b, dt) {
  if (!b.target || !b.target.alive || b.blindT > 0) return;
  if (b.reactT > 0) { b.reactT -= dt; return; }
  const d = Math.hypot(b.target.x - b.x, b.target.z - b.z);
  if (b.burstLeft <= 0) {
    if (b.burstPause > 0) { b.burstPause -= dt; return; }
    b.burstLeft = 3 + Math.floor(G.rng() * 3); // 3-5 round burst
  }
  const g = gunState(b, b.weapon);
  if (g.cd > 0 || g.reloading) return;
  if (g.mag === 0) {
    if (g.reserve > 0) { startReload(b, b.weapon); G.audio.reload(); }
    else b.weapon = fallbackWeapon(b);
    return;
  }
  // aim error: ~35% first-shot accuracy at 15 m, worse on a moving target
  const moving = b.target.moving || b.moving;
  const err = 0.012 + d * 0.001 + (moving ? 0.02 : 0) + (b.moving ? 0.02 : 0);
  const eyeY = b.y + 1.5;
  const ty = b.target.y + (b.target.crouch ? 1.0 : 1.3);
  let dx = b.target.x - b.x, dy = ty - eyeY, dz = b.target.z - b.z;
  const il = 1 / Math.hypot(dx, dy, dz);
  dx = dx * il + (G.rng() - 0.5) * 2 * err;
  dy = dy * il + (G.rng() - 0.5) * 2 * err;
  dz = dz * il + (G.rng() - 0.5) * 2 * err;
  // face the target while firing
  b.yaw = Math.atan2(-(b.target.x - b.x), -(b.target.z - b.z));
  const res = fire(G, b, { x: b.x, y: eyeY, z: b.z }, { x: dx, y: dy, z: dz }, b.weapon);
  if (res) b.burstLeft--;
  if (b.burstLeft <= 0) b.burstPause = 0.5 + G.rng() * 0.4;
  // strafe slightly while firing
  const strafe = (G.rng() - 0.5) * 0.9 * dt;
  b.x += Math.cos(b.yaw) * strafe; b.z += -Math.sin(b.yaw) * strafe;
}

// --- per-step update ----------------------------------------------------------
export function stepBots(G, dt) {
  for (const b of G.bots) {
    if (!b.alive) continue;
    tickGuns(b, dt);
    if (b.blindT > 0) b.blindT -= dt;
    b.thinkT += dt;
    if (b.thinkT >= 0.1) { b.thinkT = 0; think(G, b); }
    if (b.target && b.target.alive) { botShoot(G, b, dt); b.moving = false; }
    else {
      switch (b.state) {
        case 'push': case 'rotate':
          moveAlongPath(G, b, dt);
          if (b.pathIdx >= b.path.length) {
            b.state = 'hold';
            if (b.team === 'sparks' && b.site === 'MID') b.crouch = true;
          }
          break;
        case 'hold':
          b.moving = false;
          if (b.role === 'roam') {
            // patrol mid waypoints
            if (!b.path.length || b.pathIdx >= b.path.length) {
              setPath(G, b, b.holdWp === 10 ? 23 : 10);
              b.holdWp = b.holdWp === 10 ? 23 : 10;
            }
            moveAlongPath(G, b, dt);
          } else {
            // hold an angle: face the likely approach, crouch behind low cover
            const p = b.site === 'A' ? G.world.pylons.A : b.site === 'B' ? G.world.pylons.B : { x: 0, z: 6 };
            b.yaw = Math.atan2(-(p.x - b.x), -(p.z - b.z));
            b.crouch = true;
          }
          break;
        case 'plant': {
          b.moving = false; b.crouch = false;
          const site = b.site === 'MID' ? 'A' : b.site;
          const p = G.world.pylons[site];
          b.yaw = Math.atan2(-(p.x - b.x), -(p.z - b.z));
          b.plantT += dt;
          if (b.plantT >= 3.5) { b.plantT = 0; G.plantCell(site, b.name); }
          break;
        }
        case 'defuse': {
          b.moving = false;
          b.defuseT += dt;
          if (Math.floor(b.defuseT * 2) !== Math.floor((b.defuseT - dt) * 2)) G.audio.beep(false);
          if (b.defuseT >= 5) { b.defuseT = 0; G.defuseCell(b.name); }
          break;
        }
        case 'defend': {
          b.moving = false;
          const p = S.planted ? G.world.pylons[S.planted.site] : { x: 0, z: 0 };
          b.yaw = Math.atan2(-(p.x - b.x), -(p.z - b.z));
          break;
        }
        default: b.moving = false;
      }
    }
    // recoil recovery
    b.recoil *= Math.pow(0.02, dt); b.recoilX *= Math.pow(0.02, dt);
    // mesh follows the bot
    b.mesh.position.set(b.x, b.y, b.z);
    b.mesh.rotation.y = b.yaw + Math.PI;
  }
}

// Teammate callouts into the HUD feed (plant, rotate, defuse).
export function botCallouts(G) {
  for (const b of G.bots) {
    if (!b.alive || b.team !== 'sparks') continue;
    if (b.state === 'plant' && !b._calledPlant) { b._calledPlant = true; callout(`${b.name} is planting the cell`); }
    if (b.state !== 'plant') b._calledPlant = false;
  }
}
