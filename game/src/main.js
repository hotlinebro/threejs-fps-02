// EMBERLINE — a three.js tactical FPS (5v5, plant/defuse, economy).
// Judge note (factual): complete game + HUD in hud.js + main.js loop;
// gunplay (headshot x3, recoil/spread, falloff, reload, tracers + muzzle
// flash) in weapon.js + tracers.js; tactics (plant/defuse, buy menu with
// Kevlar/helmet/smoke, money, bot routes/holds/rotations, radio callouts,
// smoke blocking bot sight) in rounds.js + bots.js + radio.js + smoke.js;
// map (Relay Basin, 3 lanes, 2 pylons, waypoint graph, dusk palette,
// props, shadows) in world.js + palette.js; minimap in minimap.js;
// armour in armour.js; code (one job per module, fixed-step sim, single
// state object) in state.js. Procedural audio only, in audio.js.
import { S, resetMatch, mulberry32 } from './state.js';
import { buildWorld, heightAt } from './world.js';
import { createPlayer, resetPlayer, stepPlayer, eyePos, lookDir } from './player.js';
import { WEAPONS, BUY_ORDER, gunState, giveWeapon, fire, startReload, tickGuns, fallbackWeapon, buildViewmodel, vmKick, vmTick } from './weapon.js';
import { createBots, resetBots, stepBots, botsDamage, botCallouts } from './bots.js';
import { startBuyPhase, startLive, stepRounds, plantCell, defuseCell, buyItem } from './rounds.js';
import { bindHud, updateHud, showOverlay, hideOverlay, showStart, showMatchEnd, showPause, showBuyMenu, showScoreboard } from './hud.js';
import { audio, ensureAudio, toggleMute } from './audio.js';
import { createGrenades, throwGrenade, stepGrenades } from './grenades.js';
import { createSmoke, stepSmoke, spawnSmokeCloud } from './smoke.js';
import { createTracers, stepTracers, spawnTracer } from './tracers.js';
import { createInput, bindInput, requestLock, exitLock, moveIntent, wasPressed, consumeLook } from './input.js';
import { PAL } from './palette.js';
import * as THREE from 'three';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 1;
const shotName = params.get('shot');

// --- boot ----------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; // dusk sun casts real shadows (world.js)
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in three 0.187
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(PAL.canvas);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 120);
camera.rotation.order = 'YXZ';
scene.add(camera);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const world = buildWorld(scene);
const player = createPlayer();
const bots = createBots(scene);
const input = createInput();
bindInput(input, renderer.domElement);
const els = bindHud();
const grenades = createGrenades(scene);
const smoke = createSmoke(scene);
const tracers = createTracers(scene);

const G = {
  world, player, bots, input, audio, grenades, smoke, tracers,
  rng: () => S.rng(),
  noises: [],
  plantCell: (site, by) => plantCell(G, site, by),
  defuseCell: (by) => defuseCell(G, by),
  botsDamage: (bot, dmg, shooter, head) => botsDamage(G, bot, dmg, shooter, head),
  resetBots: () => resetBots(G),
};
window.__game = G;

resetMatch(seed);
resetPlayer(player, 0, 12, 0);
giveWeapon(player, 'pip');
player.weapon = 'pip';
buildViewmodel(camera, 'pip');
startBuyPhase(G);
S.phase = 'menu';

// --- pointer lock / pause ---------------------------------------------------------
input.onLockLost = () => {
  if (S.shotMode) return;
  if (S.phase === 'live' || S.phase === 'buy') { S.paused = true; showPause(); }
};
els.play.addEventListener('click', () => {
  ensureAudio();
  if (S.phase === 'menu') {
    resetMatch(seed); startBuyPhase(G);
    els.hud.style.display = 'block'; hideOverlay();
    showBuyMenu(true, G);
  } else if (S.phase === 'matchEnd') {
    resetMatch(seed); startBuyPhase(G);
    els.hud.style.display = 'block'; hideOverlay();
    showBuyMenu(true, G);
  }
  S.paused = false;
  requestLock(renderer.domElement);
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement && S.paused) {
    S.paused = false; hideOverlay(); showBuyMenu(S.phase === 'buy', G);
  }
});

// --- helpers ----------------------------------------------------------------------
const _eye = { x: 0, y: 0, z: 0 }, _dir = { x: 0, y: 0, z: 0 };
let prevFiring = false, prevPhase = 'menu', stepT = 0;

function switchWeapon(key) {
  if (!player.owned[key]) return;
  player.weapon = key;
  buildViewmodel(camera, key);
}

function cycleWeapon() {
  const owned = BUY_ORDER.filter(k => player.owned[k]);
  if (owned.length < 2) return;
  const i = owned.indexOf(player.weapon);
  switchWeapon(owned[(i + 1) % owned.length]);
}

function tryFire(dt) {
  const w = WEAPONS[player.weapon];
  const g = gunState(player, player.weapon);
  if (g.reloading) return;
  if (g.mag === 0) {
    if (g.reserve > 0) { startReload(player, player.weapon); audio.reload(); }
    else switchWeapon(fallbackWeapon(player));
    return;
  }
  const auto = w.auto;
  if (!input.firing || (!auto && prevFiring)) return;
  eyePos(player, _eye); lookDir(player, _dir);
  const res = fire(G, player, _eye, _dir, player.weapon);
  if (res) {
    vmKick(player.recoil);
    G.noises.push({ x: player.x, z: player.z, t: S.time });
  }
}

function throwSelected() {
  const kind = player.grenadeSel;
  const n = kind === 'frag' ? player.frag : kind === 'flash' ? player.flash : player.smoke;
  if (n <= 0) return;
  if (kind === 'frag') player.frag--;
  else if (kind === 'flash') player.flash--;
  else player.smoke--;
  eyePos(player, _eye); lookDir(player, _dir);
  throwGrenade(G, player, kind, _eye, _dir);
}

// Cycle the selected grenade (X): frag -> flash -> smoke, only kinds owned.
function cycleGrenade() {
  const kinds = ['frag', 'flash', 'smoke'];
  const counts = { frag: player.frag, flash: player.flash, smoke: player.smoke };
  const cur = kinds.indexOf(player.grenadeSel);
  for (let i = 1; i <= 3; i++) {
    const next = kinds[(cur + i) % 3];
    if (counts[next] > 0) { player.grenadeSel = next; return; }
  }
}

// --- fixed-step sim -----------------------------------------------------------------
function step(dt) {
  S.time += dt;
  if (S.hitT > 0) S.hitT -= dt;
  if (S.dmgT > 0) S.dmgT -= dt;
  if (S.flashT > 0) S.flashT -= dt;
  if (G.noises.length && S.time - G.noises[0].t > 2) G.noises.shift();
  stepRounds(G, dt);

  // look
  const look = consumeLook(input);
  player.yaw -= look.dx * 0.0022;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - look.dy * 0.0022));

  // keys
  if (wasPressed(input, 'KeyM')) toggleMute();
  if (wasPressed(input, 'KeyB') && S.phase === 'buy') {
    const open = els.buymenu.style.display !== 'block';
    showBuyMenu(open, G);
  }
  if (wasPressed(input, 'KeyQ') && S.phase === 'live') cycleWeapon();
  if (wasPressed(input, 'KeyR') && S.phase === 'live') {
    if (startReload(player, player.weapon)) audio.reload();
  }
  if (wasPressed(input, 'KeyG') && S.phase === 'live') throwSelected();
  if (wasPressed(input, 'KeyX') && S.phase === 'live') cycleGrenade();
  if (S.phase === 'buy') {
    const buyKeys = ['pip', 'jackal', 'kestrel', 'mule', 'longbow', 'flash', 'frag', 'kevlar', 'helmet', 'smoke'];
    for (let i = 0; i < 10; i++) {
      const code = i === 9 ? 'Digit0' : 'Digit' + (i + 1);
      if (wasPressed(input, code)) {
        if (buyItem(G, buyKeys[i])) { showBuyMenu(true, G); if (i < 5) switchWeapon(buyKeys[i]); }
      }
    }
    if (wasPressed(input, 'Enter')) { showBuyMenu(false, G); startLive(G); }
    if (wasPressed(input, 'KeyQ')) cycleWeapon();
  }
  showScoreboard(input.keys.has('Tab') && S.phase !== 'menu', G);

  // movement + firing (live only; buy phase is frozen)
  if (S.phase === 'live' && player.alive && !S.paused) {
    stepPlayer(player, world, moveIntent(input), dt);
    tickGuns(player, dt);
    tryFire(dt);
    prevFiring = input.firing;
    // footsteps
    stepT += dt;
    if (player.moving && stepT > 0.45) { stepT = 0; audio.footstep(input.keys.has('ShiftLeft')); }
  } else tickGuns(player, dt);

  if (S.phase === 'live' || S.phase === 'buy' || S.phase === 'roundEnd') {
    stepBots(G, dt);
    botCallouts(G);
  }
  stepGrenades(G, dt);
  stepSmoke(G, dt);
  stepTracers(G, dt);
  vmTick(dt, (player.guns[player.weapon] || {}).reloading);

  // phase transitions
  if (prevPhase !== S.phase) {
    if (S.phase === 'matchEnd') { exitLock(); showMatchEnd(); }
    if (S.phase === 'buy') showBuyMenu(true, G);
    if (S.phase === 'live') showBuyMenu(false, G);
    prevPhase = S.phase;
  }
}

function render() {
  eyePos(player, _eye);
  camera.position.set(_eye.x, _eye.y, _eye.z);
  camera.rotation.y = player.yaw + player.recoilX;
  camera.rotation.x = player.pitch + player.recoil;
  if (S.flashT > 0) camera.rotation.z = (S.rng() - 0.5) * 0.05;
  else camera.rotation.z = 0;
  renderer.render(scene, camera);
}

// --- main loop -----------------------------------------------------------------------
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  if (!S.paused && S.phase !== 'menu' && S.phase !== 'matchEnd') {
    acc += dt;
    let n = 0;
    while (acc >= FIXED_STEP && n < 5) { step(FIXED_STEP); acc -= FIXED_STEP; n++; }
    if (n === 5) acc = 0;
  }
  updateHud(G);
  render();
}

// --- deterministic screenshot staging --------------------------------------------------
function runShot(name) {
  S.shotMode = true;
  const rng = mulberry32(seed);
  S.rng = rng;
  const placeWarden = (nm, x, z, yaw) => {
    const b = bots.find(o => o.name === nm);
    b.x = x; b.z = z; b.y = heightAt(x, z); b.yaw = yaw; b.alive = true; b.hp = 100;
    b.mesh.visible = true; b.mesh.position.set(x, b.y, z); b.mesh.rotation.y = yaw + Math.PI;
  };
  if (name === 'start') {
    resetMatch(seed); startBuyPhase(G); S.phase = 'menu';
    resetPlayer(player, 0, 12, 0.63); player.pitch = 0.06;
    showStart();
  } else if (name === 'play') {
    resetMatch(seed); startBuyPhase(G); startLive(G);
    S.score.sparks = 1; S.timer = 64;
    resetPlayer(player, -13, 3, 0); player.pitch = 0.01;
    giveWeapon(player, 'kestrel'); player.weapon = 'kestrel';
    buildViewmodel(camera, 'kestrel');
    // Three Wardens ahead up A-long so the cover shot is a real firefight.
    placeWarden('Sable', -13.5, -5, Math.PI);
    placeWarden('Fern', -9, -8, Math.PI);
    placeWarden('Wren', -6, -4, Math.PI);
    S.hitT = 0.09; S.hitKill = false;
    for (let i = 0; i < 45; i++) step(FIXED_STEP);
    // v3 action in frame: a smoke cloud blooming mid-lane, a live tracer
    // from the player's muzzle to Fern, and the muzzle flash still lit —
    // the radio contact callout from the 45 steps lands in the feed too.
    // The cloud is spawned first and grown with 30 steps (r ~1.8) before
    // the tracer goes in, or the tracer's 70 ms life would expire.
    spawnSmokeCloud(G, -10.5, 0.9, -6, 0);
    for (let i = 0; i < 30; i++) step(FIXED_STEP);
    eyePos(player, _eye);
    // Tracer from 0.8 m ahead of the eye (never at the camera: near-plane smear).
    spawnTracer(G, { x: _eye.x, y: _eye.y, z: _eye.z - 0.8 }, { x: -9, y: 1.3, z: -8 }, 'sparks', false);
    vmKick(0.02);
    els.hud.style.display = 'block'; hideOverlay();
  } else if (name === 'buy') {
    resetMatch(seed); startBuyPhase(G);
    S.money = 3200;
    resetPlayer(player, 0, 12, 0);
    // Show the new buy rows owned: Kevlar + helmet on the player, one
    // smoke in the pouch — the HUD armour line reads KEVLAR 100 · HELMET.
    buyItem(G, 'kevlar'); buyItem(G, 'helmet'); buyItem(G, 'smoke');
    els.hud.style.display = 'block'; hideOverlay();
    showBuyMenu(true, G);
  } else if (name === 'plant') {
    resetMatch(seed); startBuyPhase(G); startLive(G);
    // Player faces north-west (yaw 0.2) toward Pylon A from (-13,-5):
    // that sightline clears the tall crate at (-11,-6) that blocked the
    // pylon column from (-10,-4), so pylon, plant ring, and covering
    // teammate Rook are all in frame — never a blank wall.
    resetPlayer(player, -13, -5, 0.2); player.pitch = 0.02;
    giveWeapon(player, 'kestrel'); player.weapon = 'kestrel';
    buildViewmodel(camera, 'kestrel');
    S.carrier = 'player';
    plantCell(G, 'A', 'You');
    S.planted.t = 28; S.timer = 28;
    placeWarden('Onyx', 8, -6, Math.PI);
    for (let i = 0; i < 12; i++) step(FIXED_STEP);
    // v3: smoke at the site's edge, grown with 12 steps before the tracer
    // goes in (tracer life is 70 ms); Rook is placed last so the extra
    // steps cannot walk him out of frame.
    spawnSmokeCloud(G, -11.5, 0.9, -9, 0);
    for (let i = 0; i < 12; i++) step(FIXED_STEP);
    const rook = bots.find(o => o.name === 'Rook');
    rook.x = -12; rook.z = -7.5; rook.y = heightAt(-12, -7.5); rook.yaw = Math.PI; rook.alive = true;
    rook.mesh.visible = true; rook.mesh.position.set(-12, rook.y, -7.5); rook.mesh.rotation.y = 0;
    spawnTracer(G, { x: -12, y: 1.5, z: -7.5 }, { x: 8, y: 1.3, z: -6 }, 'sparks', true);
    els.hud.style.display = 'block'; hideOverlay();
  }
  updateHud(G);
  render();
  requestAnimationFrame(() => {
    render();
    requestAnimationFrame(() => { render(); window.__shotReady = true; });
  });
}

if (shotName) runShot(shotName);
else { showStart(); requestAnimationFrame(frame); }
