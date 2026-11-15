// minimap.js — live tactical minimap, drawn on a 2D canvas in the HUD.
// One job: turn world state into a top-down read (north up). Teammates are
// always plotted; enemies only for 3 s after a Spark last saw them (their
// _spottedT stamp, set in bots.js), so the minimap rewards spotting instead
// of handing out wallhacks. Pylons, the plant site and smoke clouds plot too.
// No allocation in the draw: every coordinate is a local number.
import { S } from './state.js';

const W = 150, H = 110, S_X = 3.6, O_X = 75, O_Z = 55;
const COL_WALL = '#5a6478', COL_LOW = '#333a48', COL_BG = 'rgba(10,13,20,0.82)';
const COL_SPARKS = '#f0a830', COL_WARDENS = '#57c8c0', COL_YOU = '#ffffff';

let cv = null, ctx = null;

export function bindMinimap() {
  cv = document.getElementById('minimap');
  ctx = cv ? cv.getContext('2d') : null;
}

function px(x) { return O_X + x * S_X; }
function py(z) { return O_Z + z * S_X; }

export function drawMinimap(G) {
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = COL_BG;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#3a4152';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  // walls + low cover, straight from the shared collider list
  for (let i = 0; i < G.world.colliders.length; i++) {
    const c = G.world.colliders[i];
    ctx.fillStyle = c.y1 > 1.5 ? COL_WALL : COL_LOW;
    ctx.fillRect(px(c.x0), py(c.z0), (c.x1 - c.x0) * S_X, (c.z1 - c.z0) * S_X);
  }
  // smoke clouds (grey discs) — the minimap shows what blocks sight
  if (G.smoke) {
    for (let i = 0; i < G.smoke.list.length; i++) {
      const cl = G.smoke.list[i];
      ctx.fillStyle = 'rgba(154,162,173,0.55)';
      ctx.beginPath();
      ctx.arc(px(cl.x), py(cl.z), cl.r * S_X, 0, 6.2832);
      ctx.fill();
    }
  }
  // pylons: amber A (west), teal B (east); planted site pulses
  const pyl = G.world.pylons;
  ctx.fillStyle = COL_SPARKS;
  ctx.fillRect(px(pyl.A.x) - 4, py(pyl.A.z) - 4, 8, 8);
  ctx.fillStyle = COL_WARDENS;
  ctx.fillRect(px(pyl.B.x) - 4, py(pyl.B.z) - 4, 8, 8);
  if (S.planted) {
    const p = pyl[S.planted.site];
    ctx.strokeStyle = Math.floor(S.time * 3) % 2 ? '#ff5a3c' : '#f0a830';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px(p.x), py(p.z), 8, 0, 6.2832);
    ctx.stroke();
  }
  // bots: sparks always, wardens only while freshly spotted
  for (let i = 0; i < G.bots.length; i++) {
    const b = G.bots[i];
    if (!b.alive) continue;
    if (b.team === 'wardens' && S.time - (b._spottedT || -99) > 3) continue;
    ctx.fillStyle = b.team === 'sparks' ? COL_SPARKS : COL_WARDENS;
    ctx.beginPath();
    ctx.arc(px(b.x), py(b.z), 3, 0, 6.2832);
    ctx.fill();
  }
  // player arrow, rotated by yaw (yaw 0 faces north, up on the map)
  const p = G.player;
  if (p.alive) {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = -fz, rz = fx; // right vector on the map
    const cx = px(p.x), cz = py(p.z);
    ctx.fillStyle = COL_YOU;
    ctx.beginPath();
    ctx.moveTo(cx + fx * 6, cz + fz * 6);
    ctx.lineTo(cx - fx * 4 + rx * 4, cz - fz * 4 + rz * 4);
    ctx.lineTo(cx - fx * 4 - rx * 4, cz - fz * 4 - rz * 4);
    ctx.closePath();
    ctx.fill();
  }
}
