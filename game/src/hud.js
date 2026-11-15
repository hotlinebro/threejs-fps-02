// hud.js — every HUD element reflects real state, nothing decorative:
// dynamic crosshair (gap widens with spread), hitmarker (white hit /
// amber kill, 90 ms), health bar + number, big mag/reserve ammo, money,
// round timer (amber < 20 s, red + detonation countdown after a plant),
// round score, alive dots per team, 4-line kill feed, damage direction
// indicator, objective line. Overlays: start menu, buy menu, round-end
// banner, match-end screen, pause.
import { S } from './state.js';
import { WEAPONS, BUY_ORDER, GRENADE_PRICE } from './weapon.js';
import { PLANT_TIME, DEFUSE_TIME } from './rounds.js';

const $ = (id) => document.getElementById(id);
const els = {};
export function bindHud() {
  for (const id of ['hud', 'crosshair', 'hitmarker', 'ammo', 'ammo-mag', 'ammo-reserve',
    'score', 'score-value', 'overlay', 'overlay-title', 'overlay-copy', 'play',
    'health', 'health-num', 'health-fill', 'money', 'timer', 'alive', 'feed',
    'objective', 'dmg', 'buymenu', 'buy-list', 'buy-money', 'buy-timer',
    'banner', 'banner-title', 'banner-copy', 'scoreboard', 'flash', 'progress', 'progress-fill']) {
    els[id] = $(id);
  }
  return els;
}

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function updateHud(G) {
  const p = G.player;
  // crosshair gap from current spread (still/crouched = tight dot)
  const g = p.guns && p.guns[p.weapon];
  const spread = g ? WEAPONS[p.weapon].spread * (p.moving ? 2.1 : 0.7) * (p.crouch ? 0.55 : 1) : 0.01;
  els.crosshair.style.setProperty('--gap', `${4 + spread * 900}px`);
  els.crosshair.classList.toggle('hidden', S.phase === 'menu' || S.phase === 'matchEnd');
  // hitmarker
  els.hitmarker.classList.toggle('kill', S.hitKill);
  els.hitmarker.style.opacity = S.hitT > 0 ? 1 : 0;
  // health / ammo / money
  els['health-num'].textContent = Math.ceil(p.hp);
  els['health-fill'].style.width = `${Math.max(0, p.hp)}%`;
  els['health-fill'].style.background = p.hp > 50 ? '#f0a830' : p.hp > 25 ? '#e07b2e' : '#c23b2e';
  if (g) {
    els['ammo-mag'].textContent = g.reloading ? '--' : g.mag;
    els['ammo-reserve'].textContent = g.reserve;
  }
  els.money.textContent = `$${S.money.toLocaleString('en-US')}`;
  // timer: amber < 20 s, red detonation countdown after a plant
  els.timer.textContent = fmtTime(S.timer);
  els.timer.classList.toggle('warn', !S.planted && S.timer < 20 && S.phase === 'live');
  els.timer.classList.toggle('danger', !!S.planted);
  if (S.planted) els.timer.textContent = `DETONATION ${fmtTime(S.planted.t)}`;
  // score + alive dots
  els['score-value'].textContent = `${S.score.sparks} — ${S.score.wardens}`;
  const sAlive = (p.alive ? 1 : 0) + G.bots.filter(b => b.alive && b.team === 'sparks').length;
  const wAlive = G.bots.filter(b => b.alive && b.team === 'wardens').length;
  els.alive.innerHTML = `<span class="amber">${'●'.repeat(sAlive)}${'○'.repeat(5 - sAlive)}</span> ` +
    `<span class="teal">${'●'.repeat(wAlive)}${'○'.repeat(5 - wAlive)}</span>`;
  // kill feed (4 lines) + callouts
  els.feed.innerHTML = [...S.feed, ...S.callouts].slice(0, 4).map(l => `<div>${l}</div>`).join('');
  // objective line
  els.objective.textContent = S.planted
    ? `Defend the cell at Pylon ${S.planted.site} — ${Math.ceil(S.planted.t)}s to detonation`
    : S.carrier === 'player'
      ? 'You carry the surge cell — plant it at Pylon A or B (hold E)'
      : `${S.carrier} carries the cell — cover them to a pylon`;
  // damage direction indicator
  els.dmg.style.opacity = S.dmgT > 0 ? 1 : 0;
  els.dmg.style.transform = `rotate(${S.dmgDir}rad)`;
  // flash blind overlay
  els.flash.style.opacity = S.flashT > 0 ? Math.min(1, S.flashT) : 0;
  // plant/defuse progress bar
  const prog = S.plantProg > 0 ? S.plantProg / PLANT_TIME : S.defuseProg > 0 ? S.defuseProg / DEFUSE_TIME : 0;
  els.progress.style.display = prog > 0 ? 'block' : 'none';
  els['progress-fill'].style.width = `${prog * 100}%`;
  // round-end banner
  if (S.phase === 'roundEnd') {
    els.banner.style.display = 'block';
    els['banner-title'].textContent = S.roundWinner === 'sparks' ? 'SPARKS TAKE THE ROUND' : 'WARDENS TAKE THE ROUND';
    els['banner-copy'].textContent = `${S.roundReason} — Round ${S.round} · Score ${S.score.sparks}–${S.score.wardens}`;
  } else els.banner.style.display = 'none';
}

// --- overlays ------------------------------------------------------------------
export function showOverlay(title, copy, playLabel, showPlay) {
  els.overlay.style.display = 'flex';
  els['overlay-title'].textContent = title;
  els['overlay-copy'].textContent = copy;
  els.play.style.display = showPlay ? 'block' : 'none';
  if (playLabel) els.play.textContent = playLabel;
}
export function hideOverlay() { els.overlay.style.display = 'none'; }

export function showStart() {
  showOverlay('EMBERLINE',
    'Plant the surge cell on a relay pylon. Hold it till it blows — or stop them trying.',
    'CLICK TO PLAY', true);
  els.hud.style.display = 'none';
}
export function showMatchEnd() {
  const acc = S.shots ? Math.round((S.hits / S.shots) * 100) : 0;
  const winner = S.score.sparks > S.score.wardens ? 'SPARKS WIN THE MATCH'
    : S.score.wardens > S.score.sparks ? 'WARDENS WIN THE MATCH' : 'DRAW';
  showOverlay(winner,
    `Final score ${S.score.sparks}–${S.score.wardens} · Your kills ${S.kills} · Accuracy ${acc}% · Rounds ${S.round}`,
    'PLAY AGAIN', true);
  els.hud.style.display = 'none';
}
export function showPause() {
  showOverlay('PAUSED', 'Pointer lock lost. Click to resume the round.', 'RESUME', true);
}
export function showBuyMenu(show, G) {
  els.buymenu.style.display = show ? 'block' : 'none';
  if (!show) return;
  els['buy-money'].textContent = `$${S.money.toLocaleString('en-US')}`;
  els['buy-timer'].textContent = fmtTime(S.timer);
  els['buy-list'].innerHTML = BUY_ORDER.map((k, i) => {
    const w = WEAPONS[k];
    const owned = G.player.owned[k];
    return `<div class="buy-row ${owned ? 'owned' : ''}"><b>${i + 1}</b> ${w.name} — ${w.dmg} dmg · ${w.mag}/${w.reserve} ` +
      `<span>${owned ? 'OWNED' : '$' + w.price.toLocaleString('en-US')}</span></div>`;
  }).join('') +
    `<div class="buy-row"><b>6</b> Flash cell — blinds on sight <span>$${GRENADE_PRICE.flash}</span></div>` +
    `<div class="buy-row"><b>7</b> Spark charge — 90 area damage <span>$${GRENADE_PRICE.frag}</span></div>` +
    `<div class="buy-note">B or number keys buy · Enter/Ready starts the round</div>`;
}
export function showScoreboard(show, G) {
  els.scoreboard.style.display = show ? 'block' : 'none';
  if (!show) return;
  const rows = [['You', 'Sparks', G.player.hp, G.player.alive ? 'alive' : 'dead', S.kills]];
  for (const b of G.bots) rows.push([b.name, b.team === 'sparks' ? 'Sparks' : 'Wardens', b.hp, b.alive ? 'alive' : 'dead', '—']);
  els.scoreboard.innerHTML = '<h3>SCOREBOARD</h3>' + rows.map(r =>
    `<div class="sb-row"><span>${r[0]}</span><span>${r[1]}</span><span>${r[2]} HP</span><span>${r[3]}</span><span>${r[4]} kills</span></div>`).join('');
}
