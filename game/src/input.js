// input.js — keyboard + mouse + pointer lock. No input works before lock
// except menu keys. Losing lock pauses (handled by main.js via onLockLost).
export function createInput() {
  return {
    keys: new Set(), firing: false, locked: false,
    lookDX: 0, lookDY: 0,           // accumulated mouse deltas (consumed per step)
    pressed: new Set(),             // keys pressed since last consume
    onLockChange: null, onLockLost: null,
  };
}

export function bindInput(inp, canvas) {
  const el = canvas;
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    inp.keys.add(e.code);
    inp.pressed.add(e.code);
    if (e.code === 'Tab') e.preventDefault();
  });
  document.addEventListener('keyup', (e) => inp.keys.delete(e.code));
  document.addEventListener('mousedown', (e) => { if (e.button === 0) inp.firing = true; });
  document.addEventListener('mouseup', (e) => { if (e.button === 0) inp.firing = false; });
  document.addEventListener('mousemove', (e) => {
    if (!inp.locked) return;
    inp.lookDX += e.movementX; inp.lookDY += e.movementY;
  });
  document.addEventListener('pointerlockchange', () => {
    inp.locked = document.pointerLockElement === el;
    if (inp.onLockChange) inp.onLockChange(inp.locked);
    if (!inp.locked && inp.onLockLost) inp.onLockLost();
  });
  document.addEventListener('pointerlockerror', () => { inp.locked = false; });
  window.addEventListener('blur', () => { inp.keys.clear(); inp.firing = false; });
}

export function requestLock(canvas) {
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
}
export function exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

// Movement intent for one fixed step. Returns a fresh small object per call
// (input is read once per step, not in the render loop).
export function moveIntent(inp) {
  const k = inp.keys;
  return {
    f: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
    s: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
    walk: k.has('ShiftLeft') || k.has('ShiftRight'),
    crouch: k.has('ControlLeft') || k.has('KeyC'),
    jump: k.has('Space'),
  };
}

// True once if the key was pressed since the last consume.
export function wasPressed(inp, code) {
  if (inp.pressed.has(code)) { inp.pressed.delete(code); return true; }
  return false;
}
export function consumeLook(inp) {
  const dx = inp.lookDX, dy = inp.lookDY;
  inp.lookDX = 0; inp.lookDY = 0;
  return { dx, dy };
}
