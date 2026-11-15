// radio.js — teammate radio callouts, driven by the bot state machine.
// One job: turn a bot's state transition into one short radio line in the
// feed. A bot speaks only when its state actually changes (contact,
// rotation, plant, defuse) and at most once per 5 s, so the feed stays a
// radio net instead of spam. Only Sparks are heard: the player is on their
// net, and Warden chatter is not intercepted.
import { S, feed } from './state.js';

const COOLDOWN = 5;

export function zoneFor(x, z) {
  if (x < -7) return 'A';
  if (x > 7) return 'B';
  return 'MID';
}

function say(G, b, text) {
  feed(`RADIO ${b.name}: ${text}`);
  b._radioT = S.time;
}

// Called at the end of think() with the state the bot had when it started.
// prev -> next transitions are the only moments a callout fires.
export function radioStateChange(G, b, prev) {
  if (b.team !== 'sparks' || !b.alive) return;
  if (S.time - (b._radioT || -99) < COOLDOWN) return;
  const next = b.state;
  if (next === 'fight' && prev !== 'fight') {
    say(G, b, `Contact ${zoneFor(b.x, b.z)}`);
  } else if (next === 'rotate' && prev === 'hold' && S.planted) {
    say(G, b, `Rotating ${S.planted.site}`);
  } else if (next === 'plant' && prev !== 'plant') {
    say(G, b, `Planting ${b.site === 'MID' ? 'A' : b.site}`);
  } else if (next === 'defuse' && prev !== 'defuse') {
    say(G, b, `Defusing ${S.planted ? S.planted.site : ''}`);
  }
}
