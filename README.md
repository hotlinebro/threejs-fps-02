# EMBERLINE — a three.js tactical FPS

A decommissioned solar relay station in a desert basin at golden hour. You are a
**Spark** (amber) attacking with four bot teammates against five **Warden**
bots (teal-slate). Plant the surge cell on Pylon A or B, hold it 35 seconds
till it blows — or stop them trying.

## How a match works

- **Buy phase (15 s):** frozen, buy menu open (B or keys 1–7). Start $800.
- **Round (100 s):** 5v5. Plant (hold E, 3.5 s) → 35 s detonation countdown.
  Wardens win by defusing (hold E, 5 s), eliminating all Sparks, or surviving
  the timer. Elimination wins for either side.
- **Match:** first to 5 round wins, max 9 rounds.
- **Money:** kill +$300, round win +$3,250, loss +$1,900 (+$500 per
  consecutive loss, cap +$3,400), plant +$300.

## Weapons

| Weapon | Price | Mag / Reserve | Damage |
|---|---|---|---|
| Pip (sidearm) | free | 12 / 36 | 26 / 78 head |
| Jackal (SMG) | $1,500 | 28 / 84 | 22 / 66 head |
| Kestrel (rifle) | $2,700 | 25 / 75 | 34 / 102 head |
| Mule (scattergun) | $1,700 | 6 / 24 | 9×8 pellets |
| Longbow (marksman) | $4,100 | 5 / 15 | 85 / 170 head |
| Flash cell | $200 | blinds on sight, 2.5 s | |
| Spark charge | $300 | 90 area damage | |

Headshots deal ×3. Spread grows while moving or airborne, shrinks crouched
or still; recoil recovers in ~0.4 s. SMG/shotgun damage falls off past 25 m.
Empty reserve forces a switch to the Pip.

## Controls

WASD move · mouse look (pointer lock) · left click fire · R reload ·
Shift walk (slow, quiet, accurate) · Ctrl/C crouch · Space jump ·
Q switch weapon · G throw grenade · E hold to plant/defuse · B buy menu
(buy phase, 1–7 buy) · Tab scoreboard · Esc pause · M mute.

## Bots

State machine per bot (buy → push → hold → fight → rotate → plant/defuse →
defend), waypoint graph over three lanes, line-of-sight + ~100° FOV vision
with distance falloff, hearing for gunfire/plant beeps, 260–480 ms
reaction, 3–5 round bursts, ~35% first-shot accuracy at 15 m, stuck
detection with re-routing. Spark bots pick a site (A 45% / B 35% / mid 20%);
one carries the surge cell. Wardens hold A (2), B (2), roam mid (1), rotate
on plant/sound, and one defuses when the site is clear. Teammates call out
plants and rotations in the HUD feed.

## Run it

```sh
node serve.ts        # then open http://localhost:8080
```

Deterministic screenshots: `?shot=start|play|buy|plant&seed=1` stages a
frame, renders twice, and sets `window.__shotReady`.

## Method note

Fixed-step simulation (60 Hz) separate from rendering; one state object
(`src/state.js`); one job per module; no per-frame allocation in the hot
loops; procedural WebAudio only, no external assets; palette of six colours
throughout. Map, bots, and economy were designed first (see the design doc),
then built in order: world → player/weapon → bots → rounds/economy →
grenades/audio → HUD polish → shot staging.

v2: brighter golden-hour lighting, 5v5, re-staged screenshots.
