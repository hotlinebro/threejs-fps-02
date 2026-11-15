// palette.js — the six EMBERLINE colours, one source of truth for CSS + three.js.
// canvas #1b1a24 · surface #2a2f3a · hairline #3a4152 · ink #f2ead8
// muted #8f96a8 · accent amber #f0a830. Teal #57c8c0 is the sparing second
// accent (Wardens + pylon markers only).
export const PAL = {
  canvas: 0x1b1a24, surface: 0x2a2f3a, hairline: 0x3a4152,
  ink: 0xf2ead8, muted: 0x8f96a8, amber: 0xf0a830, teal: 0x57c8c0,
};
export const CSS = {
  canvas: '#1b1a24', surface: '#2a2f3a', hairline: '#3a4152',
  ink: '#f2ead8', muted: '#8f96a8', amber: '#f0a830', teal: '#57c8c0',
};
export const TEAM = { sparks: PAL.amber, wardens: PAL.teal };
