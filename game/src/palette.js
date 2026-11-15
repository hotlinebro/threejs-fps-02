// palette.js — the six EMBERLINE colours, one source of truth for CSS + three.js.
// v2: bright golden-hour palette. Canvas is a warm tan sky/fog (#ab8a68),
// surface is warm bright walls (#8f7d68); ink #f2ead8 · muted #8f96a8 ·
// accent amber #f0a830. Teal #57c8c0 is the sparing second accent
// (Wardens + pylon markers only). Everything in the scene reads at a glance.
export const PAL = {
  canvas: 0xab8a68, surface: 0x8f7d68, hairline: 0x6a5f52,
  ink: 0xf2ead8, muted: 0x8f96a8, amber: 0xf0a830, teal: 0x57c8c0,
};
export const CSS = {
  canvas: '#ab8a68', surface: '#8f7d68', hairline: '#6a5f52',
  ink: '#f2ead8', muted: '#8f96a8', amber: '#f0a830', teal: '#57c8c0',
};
export const TEAM = { sparks: PAL.amber, wardens: PAL.teal };
