// editors/build/viewport.test.ts — SUBSTRATE-0605 consumption-layer guards.
//
// The native controller's renderer-consumed behavior is tested in Zig
// (zig build test-game-camera); this suite pins BOTH embodied routes to the
// ONE shared substrate (cart/hmsc-int/Embodied.tsx) so the CAMGONE-0605
// failure shape — a route that imports GAME_NATIVE_CAMERA but never engages
// a bound node (the /build launch bug: module-level bindFirst with no
// nativeCamera node) — cannot reappear, and so the embodied drop-in cannot
// fork into per-route copies again (the 30-cameras disease as a route).

import { assert, finish, test } from '../../game/_testkit';

declare const globalThis: any;

function read(path: string): string {
  const fn = globalThis.__fs_read;
  if (typeof fn !== 'function') throw new Error('__fs_read unavailable');
  return String(fn(path));
}

test('the embodied substrate carries the V23 node-bound native camera', () => {
  const source = read('cart/hmsc-int/Embodied.tsx');
  assert(source.includes('<Scene3D.Camera nativeCamera ref={cameraRef}'), 'renderer-consumed camera node must opt into nativeCamera');
  assert(source.includes('GAME_NATIVE_CAMERA.forNode'), 'substrate must engage the node-scoped native controller');
  assert(source.includes('.setInputDeltas('), 'drag must send native input deltas');
  assert(source.includes('.setMode('), 'mode transitions must ride the controller');
  assert(!source.includes('bindFirst'), 'the CAMGONE shape (module-level bindFirst, never engages) must stay dead');
  assert(!source.includes('position={solved.pos}'), 'JS-solved camera position must not drive the renderer');
  assert(!source.includes('target={solved.target}'), 'JS-solved camera target must not drive the renderer');
});

test('the folded /test+/build surface consumes the substrate — no route-local embodied copy, camera included', () => {
  // PLAYFOLD-0605: both embodied routes are ONE surface now; the guards that
  // pinned each pre-fold route to the substrate pin the fold the same way.
  const source = read('cart/hmsc-int/editors/play/PlayRoute.tsx');
  assert(source.includes('useEmbodiedPlayer'), 'the fold must consume the shared embodied substrate');
  assert(source.includes('<EmbodiedScene'), 'the fold must render through the substrate scene (the bound camera node lives there)');
  assert(source.includes('<EmbodiedCaptures'), 'the fold must mount the substrate capture set');
  assert(!source.includes('GAME_NATIVE_CAMERA'), 'no route-local camera transport — the substrate owns the bind');
  assert(!source.includes('GAME_PHYSICS.step'), 'no route-local physics loop — the substrate owns the step');
  assert(!source.includes('GAME_INPUT.createKeyState'), 'no route-local key transport — the substrate owns it');
  // the probe's TYPE annotations name buildRigFrame legitimately; only a CALL
  // would be a route-local figure rig.
  assert(!/GAME_FIGURE\.buildRigFrame\(/.test(source.replace(/typeof GAME_FIGURE\.buildRigFrame/g, '')), 'no route-local figure rig — the substrate owns the player model');
  // GAME_CAMERA.solve stays: registry math for the crosshair PICK only,
  // parameterized by the substrate-exported PLAYER_CAMERA (one camera truth).
  assert(source.includes('PLAYER_CAMERA.'), 'the crosshair pick must solve with the substrate camera values');
});

test('F1/F2 toggle the fold mode and the URL carries it (PLAYFOLD-0605)', () => {
  const source = read('cart/hmsc-int/editors/play/PlayRoute.tsx');
  assert(source.includes("key === 'f1'"), 'F1 must flip to test mode');
  assert(source.includes("key === 'f2'"), 'F2 must flip to build mode');
  const shell = read('cart/hmsc-int/index.tsx');
  assert(shell.includes("activeRoute === 'test' || activeRoute === 'build'"), 'the shell must mount ONE PlayRoute for both paths (no remount across the toggle)');
  assert(!shell.includes('TestRoute') && !shell.includes('BuildRoute'), 'the pre-fold routes must stay dead — the fold is the one embodied surface');
});

test('the substrate consumes the mouse — capture-mode look, never drag heuristics', () => {
  const source = read('cart/hmsc-int/Embodied.tsx');
  assert(source.includes('GAME_INPUT.setPointerCapture(true)'), "USER VERDICT: 'consume my mouse' — the route must enter relative-mouse capture");
  assert(source.includes('GAME_INPUT.readPointerDelta()'), 'captured look must ride the relative-motion delta wire');
  assert(source.includes("'escape'"), 'Esc must release the mouse back to the UI');
  assert(source.includes('GAME_INPUT.setPointerCapture(false)'), 'release must actually disable relative mode');
  assert(!source.includes('movedPixels'), 'the drag/tap slop heuristic must stay dead — a captured click is always intent');
  assert(!source.includes('onMouseMove'), 'no event-driven drag look — capture feeds the frame loop');
});

test('the ruled build hotkeys lead the palette: 1 floor, 2 wall, 3 ramp, 4 roof', () => {
  const source = read('cart/hmsc-int/editors/play/PlayRoute.tsx');
  assert(source.includes("['floor', 'wall', 'ramp', 'roof']"), "USER VERDICT order: '1 2 3 4 for floor wall ramp roof'");
  assert(source.includes('1 floor · 2 wall · 3 ramp · 4 roof'), 'the help line must teach the ruled keys');
});

finish('build-viewport');
