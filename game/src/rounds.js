// rounds.js — round flow + economy (folded in: prices live in weapon.js).
// Buy phase 15 s (frozen) -> live 100 s -> round end 4 s -> next buy ...
// Match: first to 5, max 9 rounds (5-5 -> one overtime round; still tied
// -> draw). Money: start $800, kill +$300, win +$3,250, loss +$1,900
// (+$500 per consecutive loss, cap +$3,400), plant +$300 (planter only).
// Plant 3.5 s -> 35 s detonation timer; defuse 5 s channel (hold E).
import { S, feed, callout } from './state.js';
import { WEAPONS, BUY_ORDER, GRENADE_PRICE, giveWeapon, gunState } from './weapon.js';
import { resetPlayer } from './player.js';

export const BUY_TIME = 15, ROUND_TIME = 100, END_TIME = 4, DETONATE = 35;
export const PLANT_TIME = 3.5, DEFUSE_TIME = 5;

// --- economy ------------------------------------------------------------------
export function buyItem(G, key) {
  const p = G.player;
  if (S.phase !== 'buy') return false;
  if (BUY_ORDER.includes(key)) {
    const w = WEAPONS[key];
    if (p.owned[key] || S.money < w.price) return false;
    S.money -= w.price;
    giveWeapon(p, key);
    p.weapon = key;
    G.audio.reload();
    return true;
  }
  if (key === 'flash' || key === 'frag') {
    const price = GRENADE_PRICE[key];
    if (S.money < price) return false;
    S.money -= price;
    if (key === 'flash') p.flash++; else p.frag++;
    p.grenadeSel = key;
    return true;
  }
  return false;
}

// --- round lifecycle ------------------------------------------------------------
export function startBuyPhase(G) {
  S.phase = 'buy'; S.timer = BUY_TIME;
  S.planted = null; S.plantProg = 0; S.defuseProg = 0;
  // respawn everyone at their spawn, reset HP/ammo
  resetPlayer(G.player, 0, 12, 0);
  // equip the best owned primary (Pip if nothing bought yet)
  G.player.weapon = G.player.owned.kestrel ? 'kestrel'
    : G.player.owned.jackal ? 'jackal'
    : G.player.owned.mule ? 'mule'
    : G.player.owned.longbow ? 'longbow' : 'pip';
  for (const b of G.bots) {
    // bot purse: last round's reward, simplified to a fresh budget each round
    b.money = 800 + (S.round - 1) * 1900;
  }
  // reset ammo for owned weapons
  for (const key of Object.keys(G.player.owned)) {
    const g = gunState(G.player, key);
    g.mag = WEAPONS[key].mag; g.reserve = WEAPONS[key].reserve; g.reloading = false;
  }
  G.resetBots();
  G.audio.stinger(true);
}

export function startLive(G) {
  S.phase = 'live'; S.timer = ROUND_TIME;
  feed(`Round ${S.round} — plant the cell at A or B`);
}

export function endRound(G, winner, reason) {
  if (S.phase === 'roundEnd') return;
  S.phase = 'roundEnd'; S.timer = END_TIME;
  S.roundWinner = winner; S.roundReason = reason;
  if (winner === 'sparks') { S.score.sparks++; S.money += 3250; S.lossStreak = 0; }
  else { S.score.wardens++; S.money += Math.min(3400, 1900 + 500 * S.lossStreak); S.lossStreak++; }
  feed(winner === 'sparks' ? `Sparks take round ${S.round} — ${reason}` : `Wardens take round ${S.round} — ${reason}`);
  G.audio.stinger(winner === 'sparks');
  if (S.score.sparks >= S.winRounds || S.score.wardens >= S.winRounds || S.round >= S.maxRounds) {
    S.phase = 'matchEnd';
    S.timer = 0;
  }
}

export function nextRound(G) {
  S.round++;
  startBuyPhase(G);
}

// Plant / defuse are called by the player (holding E) and by bots.
export function plantCell(G, site, by) {
  if (S.planted || S.phase !== 'live') return;
  S.planted = { site, t: DETONATE };
  S.plantedBy = by;
  S.timer = DETONATE; // HUD swaps to the detonation countdown
  if (by === 'You') S.money += 300;
  feed(`${by} planted the surge cell at ${site}`);
  callout(`${by} planted — defend the pylon`);
  G.audio.plant();
}

export function defuseCell(G, by) {
  if (!S.planted) return;
  S.defusedBy = by;
  feed(`${by} defused the surge cell`);
  endRound(G, 'wardens', 'Defuse');
}

// --- per-step update --------------------------------------------------------------
export function stepRounds(G, dt) {
  if (S.phase === 'buy') {
    S.timer -= dt;
    if (S.timer <= 0) startLive(G);
    return;
  }
  if (S.phase === 'roundEnd') {
    S.timer -= dt;
    if (S.timer <= 0) nextRound(G);
    return;
  }
  if (S.phase !== 'live') return;
  // detonation countdown replaces the round timer after a plant
  S.timer -= dt;
  if (S.planted) {
    S.planted.t -= dt;
    S.timer = Math.max(0, S.planted.t);
    if (S.planted.t <= 0) { endRound(G, 'sparks', 'Detonation'); return; }
  }
  // elimination wins
  const sparksAlive = (G.player.alive ? 1 : 0) + G.bots.filter(b => b.alive && b.team === 'sparks').length;
  const wardensAlive = G.bots.filter(b => b.alive && b.team === 'wardens').length;
  if (sparksAlive === 0) { endRound(G, 'wardens', 'Elimination'); return; }
  if (wardensAlive === 0) { endRound(G, 'sparks', 'Elimination'); return; }
  if (S.timer <= 0) { endRound(G, 'wardens', 'Time'); return; }
  // player plant / defuse channel (hold E near a pylon)
  stepObjective(G, dt);
}

function stepObjective(G, dt) {
  const p = G.player;
  if (!p.alive) { S.plantProg = 0; S.defuseProg = 0; return; }
  const holdingE = G.input.keys.has('KeyE');
  // plant: player carries the cell, near an unplanted pylon
  if (!S.planted && S.carrier === 'player' && holdingE) {
    for (const site of ['A', 'B']) {
      const py = G.world.pylons[site];
      if (Math.hypot(py.x - p.x, py.z - p.z) < 3.0) {
        S.plantProg += dt;
        if (Math.floor(S.plantProg * 2) !== Math.floor((S.plantProg - dt) * 2)) G.audio.beep(true);
        if (S.plantProg >= PLANT_TIME) { S.plantProg = 0; plantCell(G, site, 'You'); }
        return;
      }
    }
  }
  S.plantProg = 0; // not near a pylon (or not holding E): channel resets
  // defuse: cell planted, player near that pylon, hold E
  if (S.planted && holdingE) {
    const py = G.world.pylons[S.planted.site];
    if (Math.hypot(py.x - p.x, py.z - p.z) < 3.0) {
      S.defuseProg += dt;
      if (Math.floor(S.defuseProg * 2) !== Math.floor((S.defuseProg - dt) * 2)) G.audio.beep(false);
      if (S.defuseProg >= DEFUSE_TIME) { S.defuseProg = 0; defuseCell(G, 'You'); }
      return;
    }
  }
  S.defuseProg = 0;
}
