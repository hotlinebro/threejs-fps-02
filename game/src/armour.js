// armour.js — Kevlar vest + helmet: buyable protection, one job.
// Kevlar (100 points) absorbs half of every hit until it is gone; the
// helmet halves headshot damage and cracks after two headshots. Both are
// plain fields on the entity (armour, helmet, helmetHits), so the same
// function serves the player (player.js) and the bots (bots.js) — the
// damage pipeline calls applyArmour() before subtracting HP, never after.
export const ARMOUR = {
  kevlar: { name: 'Kevlar vest', price: 650, points: 100, desc: 'absorbs half of all damage' },
  helmet: { name: 'Helmet', price: 350, desc: 'halves headshots, cracks after 2' },
};

// Reduce dmg by armour/helmet. Mutates ent.armour / ent.helmet. Returns dmg left.
export function applyArmour(ent, dmg, head) {
  let d = dmg;
  if (head && ent.helmet) {
    d = Math.round(d * 0.5);
    ent.helmetHits = (ent.helmetHits || 0) + 1;
    if (ent.helmetHits >= 2) { ent.helmet = false; ent.helmetHits = 0; }
  }
  if (ent.armour > 0 && d > 0) {
    const absorbed = Math.min(ent.armour, Math.round(d * 0.5));
    ent.armour -= absorbed;
    d -= absorbed;
  }
  return d;
}

export function armourLabel(ent) {
  if (!ent.armour && !ent.helmet) return 'NO ARMOUR';
  const parts = [];
  if (ent.armour > 0) parts.push(`KEVLAR ${ent.armour}`);
  if (ent.helmet) parts.push('HELMET');
  return parts.join(' · ');
}
