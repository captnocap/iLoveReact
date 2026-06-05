// input.test.ts — P4 behavior tests for GAME_INPUT.
//
// Two halves, like the wire itself: the key side drives the REAL framework bus
// (runtime/ffi.ts emit — the same channel the engine's key shims publish on);
// the pointer side stubs the core host fns via withHost. Throughout, the
// V7 fence is the point: every output is a pure function of current input
// state — no dt anywhere, no velocity, no position. Transport, not integrator.

import { emit } from '@reactjit/ffi';
import { GAME_INPUT, INPUT_BINDINGS } from './input';
import { assert, assertClose, assertEqual, finish, test, withHost } from './_testkit';

// ── key transport ────────────────────────────────────────────────────────────

test('a held key reads down until its keyup arrives', () => {
  const keys = GAME_INPUT.createKeyState();
  assertEqual(keys.isDown('w'), false, 'untouched key must read up');
  emit('__keydown', { key: 'W' });
  assertEqual(keys.isDown('w'), true, 'keydown must read down (case-insensitive)');
  assertEqual(keys.isDown('a'), false, 'other keys must stay up');
  emit('__keyup', { key: 'w' });
  assertEqual(keys.isDown('w'), false, 'keyup must release the key');
  keys.dispose();
});

test('modifiers track the latest event', () => {
  const keys = GAME_INPUT.createKeyState();
  emit('__keydown', { key: 'shift', shiftKey: true });
  assertEqual(keys.shift(), true, 'shift must read held');
  emit('__keyup', { key: 'shift', shiftKey: false });
  assertEqual(keys.shift(), false, 'shift must release');
  emit('__keydown', { key: 's', ctrlKey: true, altKey: true });
  assertEqual(keys.ctrl(), true, 'ctrl must track');
  assertEqual(keys.alt(), true, 'alt must track');
  keys.dispose();
});

test('a disposed snapshot goes deaf; live subscribers still hear the bus', () => {
  const keys = GAME_INPUT.createKeyState();
  emit('__keydown', { key: 'd' });
  keys.dispose();
  emit('__keyup', { key: 'd' });
  assertEqual(keys.isDown('d'), true, 'a disposed snapshot must freeze (the keyup never lands)');

  const seen: string[] = [];
  const off = GAME_INPUT.onKeyDown((event) => seen.push(String(event.key)));
  emit('__keydown', { key: 'x' });
  off();
  emit('__keydown', { key: 'y' });
  assertEqual(seen.join(','), 'x', 'raw subscription must hear until unsubscribed');
});

test('window blur releases everything — SDL never delivers the keyup after focus loss', () => {
  const keys = GAME_INPUT.createKeyState();
  emit('__keydown', { key: 'w', shiftKey: true });
  assertEqual(keys.isDown('w'), true, 'held before blur');
  assertEqual(keys.shift(), true, 'modifier held before blur');
  emit('system:blur', { at: 0 });
  assertEqual(keys.isDown('w'), false, 'blur must release held keys (no stuck-key walk)');
  assertEqual(keys.shift(), false, 'blur must release modifiers');
  keys.dispose();
});

// ── the control contract ─────────────────────────────────────────────────────

test('the bindings table carries the controlContract vocabulary, WASD only — the contract, not the wire, rules', () => {
  const byAction = new Map(INPUT_BINDINGS.map((b) => [b.action, b]));
  assertEqual(byAction.get('jump')?.keys?.join(','), 'space', "jump is 'space' — the wire name, not ' '");
  assertEqual(byAction.get('run')?.modifier, 'shift', 'run rides the modifier FLAG, never a key name');
  assertEqual(byAction.get('interact')?.keys?.join(','), 'e,f', 'interact is E/F per the contract');
  assertEqual(byAction.get('aim')?.pointer, 'right', 'aim is the right-mouse hold');
  for (const binding of INPUT_BINDINGS) {
    for (const key of binding.keys ?? []) {
      assert(!['left', 'right', 'up', 'down'].includes(key),
        `${binding.action} binds '${key}' — the contract is WASD (hmsc controlContract); arrows now ` +
        `ARRIVE on the wire (key_pack.zig full-width packing) but the table doesn't alias them`);
    }
  }
});

test('actionDown walks the table: keys, modifier-as-flag, and pointer actions read false', () => {
  const keys = GAME_INPUT.createKeyState();
  emit('__keydown', { key: 'f' });
  assertEqual(GAME_INPUT.actionDown(keys, 'interact'), true, 'either bound key satisfies interact');
  // the camera_lab hazard: shift arrives with a useless key name (`sdl:1073742049`
  // — the full SDLK_LSHIFT code since key_pack.zig) but a TRUE flag
  emit('__keydown', { key: 'sdl:1073742049', shiftKey: true });
  assertEqual(GAME_INPUT.actionDown(keys, 'run'), true, 'run must read the shiftKey flag, not a key name');
  assertEqual(GAME_INPUT.actionDown(keys, 'aim'), false, 'pointer actions never read from key state');
  keys.dispose();
});

// ── the movement transport ───────────────────────────────────────────────────

function axesFromHeld(held: string[]): { forward: number; strafe: number } {
  const keys = GAME_INPUT.createKeyState();
  for (const key of held) emit('__keydown', { key });
  const axes = GAME_INPUT.moveAxes(keys);
  for (const key of held) emit('__keyup', { key });
  keys.dispose();
  return axes;
}

test('moveAxes packages held keys as the W(+1)/S(−1), D(+1)/A(−1) axes — no math', () => {
  assertEqual(JSON.stringify(axesFromHeld(['w'])), '{"forward":1,"strafe":0}', 'W is forward +1');
  assertEqual(JSON.stringify(axesFromHeld(['s'])), '{"forward":-1,"strafe":0}', 'S is forward −1');
  assertEqual(JSON.stringify(axesFromHeld(['d'])), '{"forward":0,"strafe":1}', 'D is strafe +1');
  assertEqual(JSON.stringify(axesFromHeld(['a'])), '{"forward":0,"strafe":-1}', 'A is strafe −1');
  assertEqual(JSON.stringify(axesFromHeld(['w', 's'])), '{"forward":0,"strafe":0}', 'opposed keys cancel');
});

test('moveIntent is the wasdDirection twin: sign convention and diagonal normalization pinned', () => {
  // W at yaw 0 walks world +Z (camera-forward)
  const fwd = GAME_INPUT.moveIntent({ forward: 1, strafe: 0 }, 0);
  assertClose(fwd.x, 0, 1e-9, 'W yaw0 x');
  assertClose(fwd.z, 1, 1e-9, 'W yaw0 z');
  // D at yaw 0 walks world −X (the engine renders +X as screen-LEFT)
  const right = GAME_INPUT.moveIntent({ forward: 0, strafe: 1 }, 0);
  assertClose(right.x, -1, 1e-9, 'D yaw0 x — strafe takes the opposite sign of forward');
  assertClose(right.z, 0, 1e-9, 'D yaw0 z');
  // W at yaw 90° walks world +X
  const turned = GAME_INPUT.moveIntent({ forward: 1, strafe: 0 }, Math.PI / 2);
  assertClose(turned.x, 1, 1e-9, 'W yaw90 x');
  assertClose(turned.z, 0, 1e-9, 'W yaw90 z');
  // diagonals normalize: |intent| never exceeds 1 across a yaw sweep
  for (let i = 0; i < 16; i++) {
    const yaw = (i / 16) * Math.PI * 2;
    const diag = GAME_INPUT.moveIntent({ forward: 1, strafe: 1 }, yaw);
    assertClose(Math.hypot(diag.x, diag.z), 1, 1e-6, `diagonal at yaw ${yaw} must normalize to 1`);
  }
});

test('TRANSPORT-ONLY (V7): direction is stateless and bounded — no dt, no velocity, no accumulation', () => {
  // same input twice → identical output (nothing integrates between calls)
  const a = GAME_INPUT.moveIntent({ forward: 1, strafe: 0.5 }, 1.2);
  const b = GAME_INPUT.moveIntent({ forward: 1, strafe: 0.5 }, 1.2);
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'repeat calls must not accumulate');
  // |intent| ≤ 1 always — a velocity or displacement would scale past it
  assert(Math.hypot(a.x, a.z) <= 1 + 1e-9, 'intent is a direction, never a displacement');
  // the door exposes no integrator vocabulary
  for (const name of Object.keys(GAME_INPUT)) {
    assert(!/step|integrat|velocity|position/i.test(name), `door surface must stay transport-only (found ${name})`);
  }
});

// ── pointer transport ────────────────────────────────────────────────────────

test('availability() names every missing pointer/typing-gate fn instead of degrading silently', () => {
  const bare = GAME_INPUT.availability();
  assertEqual(bare.complete, false, 'v8cli has no pointer wire — must not claim complete');
  assert(bare.missing.includes('getMouseX'), 'missing must name the pointer position fn');
  assert(bare.missing.includes('__mouse_delta'), 'missing must name the delta fn');
  assert(bare.missing.includes('__mouse_capture'), 'missing must name the capture fn');
  assert(bare.missing.includes('__tel_input'), 'missing must name the typing-gate fn');
  withHost(
    {
      getMouseX: () => 0, getMouseY: () => 0, getMouseDown: () => 0, getMouseRightDown: () => 0,
      __mouse_delta: () => ({ dx: 0, dy: 0 }), __mouse_capture: () => undefined, __tel_input: () => null,
    },
    () => {
      const wired = GAME_INPUT.availability();
      assertEqual(wired.complete, true, 'with the full wire stubbed, availability must read complete');
    },
  );
});

test('readPointer / readPointerDelta carry the wire values; unwired reads are honest zeros', () => {
  assertEqual(JSON.stringify(GAME_INPUT.readPointer()), '{"x":0,"y":0,"leftDown":false,"rightDown":false}', 'unwired pointer is zeros');
  assertEqual(JSON.stringify(GAME_INPUT.readPointerDelta()), '{"dx":0,"dy":0}', 'unwired delta is zeros');
  withHost(
    {
      getMouseX: () => 320, getMouseY: () => 240, getMouseDown: () => 1, getMouseRightDown: () => 0,
      __mouse_delta: () => ({ dx: -4, dy: 9 }),
    },
    () => {
      const pointer = GAME_INPUT.readPointer();
      assertEqual(pointer.x, 320, 'x rides getMouseX');
      assertEqual(pointer.leftDown, true, 'left button rides getMouseDown');
      assertEqual(pointer.rightDown, false, 'right button rides getMouseRightDown');
      const delta = GAME_INPUT.readPointerDelta();
      assertEqual(delta.dx, -4, 'dx rides __mouse_delta');
      assertEqual(delta.dy, 9, 'dy rides __mouse_delta');
    },
  );
});

test('setPointerCapture reports transport honestly and ships 1/0 down the wire', () => {
  assertEqual(GAME_INPUT.setPointerCapture(true), false, 'no capture wire → false, never a silent no-op');
  let shipped = -1;
  withHost({ __mouse_capture: (on: number) => { shipped = on; } }, () => {
    assertEqual(GAME_INPUT.setPointerCapture(true), true, 'wired → true');
    assertEqual(shipped, 1, 'true ships 1');
    GAME_INPUT.setPointerCapture(false);
    assertEqual(shipped, 0, 'false ships 0');
  });
});

test('onCursorMove relays the bus cursor stream until unsubscribed', () => {
  const seen: string[] = [];
  const off = GAME_INPUT.onCursorMove((event) => seen.push(`${event.x},${event.y},${event.dx},${event.dy}`));
  emit('system:cursor:move', { x: 5, y: 6, dx: 1, dy: -2 });
  off();
  emit('system:cursor:move', { x: 9, y: 9, dx: 0, dy: 0 });
  assertEqual(seen.join('|'), '5,6,1,-2', 'one event heard, none after unsubscribe');
});

// ── the typing gate ──────────────────────────────────────────────────────────

test('isTextEditing reads the focused-node gate; unwired is honestly "not typing"', () => {
  assertEqual(GAME_INPUT.isTextEditing(), false, 'no wire → not typing (movement may proceed)');
  withHost({ __tel_input: () => ({ focused_id: 7 }) }, () => {
    assertEqual(GAME_INPUT.isTextEditing(), true, 'a focused input id ≥ 0 reads typing');
  });
  withHost({ __tel_input: () => ({ focused_id: -1 }) }, () => {
    assertEqual(GAME_INPUT.isTextEditing(), false, 'focused_id −1 reads not typing');
  });
});

// ── the door itself ──────────────────────────────────────────────────────────

test('the door is sealed and carries the bindings table', () => {
  assert(Object.isFrozen(GAME_INPUT), 'GAME_INPUT must be frozen');
  assertEqual(GAME_INPUT.bindings, INPUT_BINDINGS, 'the control contract rides the door');
  assertEqual(INPUT_BINDINGS.length, 14, 'all 14 contract actions carried');
});

finish('game/input');
