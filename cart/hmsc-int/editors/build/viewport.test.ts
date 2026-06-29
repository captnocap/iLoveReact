// editors/build/viewport.test.ts — SUBSTRATE-0605 consumption-layer guards.
//
// The native controller's renderer-consumed behavior is tested in Zig
// (zig build test-game-camera); this suite pins the shared embodied substrate
// (cart/hmsc-int/Embodied.tsx) so the CAMGONE-0605 failure shape — a surface
// that imports GAME_NATIVE_CAMERA but never engages a bound node (module-level
// bindFirst with no nativeCamera node) — cannot reappear.
//
// The PlayRoute/PlayTestRoute fold (PLAYFOLD-0605) was retired with its /test
// route (req_2060); its source-shape guards went with the files. What remains
// here are the guards on the LIVE substrate every embodied surface consumes.

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

test('the substrate consumes the mouse — capture-mode look, never drag heuristics', () => {
  const source = read('cart/hmsc-int/Embodied.tsx');
  assert(source.includes('GAME_INPUT.setPointerCapture(true)'), "USER VERDICT: 'consume my mouse' — the surface must enter relative-mouse capture");
  assert(source.includes('GAME_INPUT.readPointerDelta()'), 'captured look must ride the relative-motion delta wire');
  assert(source.includes("'escape'"), 'Esc must release the mouse back to the UI');
  assert(source.includes('GAME_INPUT.setPointerCapture(false)'), 'release must actually disable relative mode');
  assert(!source.includes('movedPixels'), 'the drag/tap slop heuristic must stay dead — a captured click is always intent');
  assert(!source.includes('onMouseMove'), 'no event-driven drag look — capture feeds the frame loop');
});

finish('build-viewport');
