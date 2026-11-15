// state.js — the single game-state object + round state machine.
// Phases: menu -> buy -> live -> roundEnd -> buy ... -> matchEnd -> menu.
// Every module reads this one object; no module keeps its own copy of
// round/score/timer/plant state.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const S = {
  phase: 'menu',           // menu | buy | live | roundEnd | matchEnd
  round: 1, maxRounds: 9, winRounds: 5,
  score: { sparks: 0, wardens: 0 },
  timer: 0,                // round clock (buy 15 / live 100 / roundEnd 4)
  money: 800, kills: 0, deaths: 0, shots: 0, hits: 0,
  lossStreak: 0, roundWinner: '', roundReason: '',
  planted: null,           // { site:'A'|'B', t: seconds left to detonation }
  plantProg: 0, defuseProg: 0, carrier: 'player', // who holds the surge cell
  plantedBy: '', defusedBy: '',
  time: 0,                 // total sim time (fixed-step seconds)
  seed: 1, rng: mulberry32(1),
  paused: false, muted: false, shotMode: false,
  feed: [],                // kill-feed lines, newest first (max 4)
  callouts: [],            // teammate callout lines
  flashT: 0,               // player flash-blind seconds left
  dmgDir: -1, dmgT: 0,     // damage direction indicator
  hitT: 0, hitKill: false, // hitmarker display timer
};

export function resetMatch(seed) {
  S.phase = 'menu'; S.round = 1;
  S.score.sparks = 0; S.score.wardens = 0;
  S.timer = 0; S.money = 800; S.kills = 0; S.deaths = 0;
  S.shots = 0; S.hits = 0; S.lossStreak = 0;
  S.roundWinner = ''; S.roundReason = '';
  S.planted = null; S.plantProg = 0; S.defuseProg = 0;
  S.carrier = 'player'; S.plantedBy = ''; S.defusedBy = '';
  S.time = 0; S.seed = seed || 1; S.rng = mulberry32(S.seed);
  S.feed.length = 0; S.callouts.length = 0;
  S.flashT = 0; S.dmgT = 0; S.hitT = 0;
}

export function feed(line) {
  S.feed.unshift(line);
  if (S.feed.length > 4) S.feed.length = 4;
}

export function callout(line) {
  S.callouts.unshift(line);
  if (S.callouts.length > 3) S.callouts.length = 3;
}
