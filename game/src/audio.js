// audio.js — procedural WebAudio only, zero assets. Noise bursts through a
// lowpass (one per weapon family), clicks for reload, sine blips for hit /
// kill, beep sequences for plant/defuse, two-note stingers for round
// start/end, soft footsteps, a high sweep for the flash. Distance
// attenuates bot shots. M toggles mute; the context resumes on the first
// user gesture (pointer-lock click) — never before.
import { S } from './state.js';

let ctx = null, master = null, noiseBuf = null;

export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
}

function tone(freq, dur, type, vol, slideTo) {
  if (!ctx || S.muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, freq, vol, q = 1) {
  if (!ctx || S.muted) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.02);
}

const SHOT = {
  pip: [900, 0.09, 0.5], jackal: [1400, 0.08, 0.45], kestrel: [800, 0.14, 0.6],
  mule: [500, 0.22, 0.7], longbow: [600, 0.25, 0.7],
};

export const audio = {
  shot(key, dist) {
    const s = SHOT[key] || SHOT.kestrel;
    const att = dist <= 0 ? 1 : Math.max(0.08, 1 - dist / 55);
    noise(s[1], s[0], s[2] * att);
    if (dist <= 0) tone(160, 0.05, 'square', 0.12);
  },
  reload() { tone(1200, 0.05, 'square', 0.12); setTimeout(() => tone(800, 0.05, 'square', 0.12), 180); },
  hit(kill) { if (kill) { tone(880, 0.09, 'sine', 0.25); setTimeout(() => tone(1320, 0.12, 'sine', 0.25), 70); } else tone(1400, 0.05, 'sine', 0.18); },
  beep(hi) { tone(hi ? 1200 : 700, 0.09, 'sine', 0.2); },
  plant() { tone(700, 0.08, 'sine', 0.2); setTimeout(() => tone(700, 0.08, 'sine', 0.2), 140); setTimeout(() => tone(1050, 0.15, 'sine', 0.22), 300); },
  stinger(win) { tone(win ? 523 : 392, 0.16, 'triangle', 0.25); setTimeout(() => tone(win ? 784 : 311, 0.3, 'triangle', 0.25), 160); },
  footstep(walk) { noise(0.05, 300, walk ? 0.05 : 0.1); },
  flash() { tone(2400, 0.5, 'sine', 0.15, 400); },
  boom() { noise(0.5, 220, 0.8); tone(70, 0.4, 'sine', 0.4, 40); },
};

export function toggleMute() { S.muted = !S.muted; return S.muted; }
