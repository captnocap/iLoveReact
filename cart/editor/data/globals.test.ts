// cart/editor/data/globals.test.ts — the physics-globals WIRE CONTRACT
// (GLOBALS req_2770): packPhysicsGlobals must emit the exact 13-float lump
// order world_loader.zig setPhysicsConfig / constructor.PhysicsConfig reads.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/globals.test.ts --bundle \
//     --outfile=/tmp/editor-globals.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-globals.test.js

import { DEFAULT_PHYSICS_GLOBALS, PHYSICS_GLOBAL_SPECS, packPhysicsGlobals, revivePhysicsGlobals } from './globals';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

test('packPhysicsGlobals emits the 13-float lump order the host reads', () => {
  const packed = packPhysicsGlobals({
    gravity: 1, jumpSpeed: 2, playerRadius: 3, playerHeight: 4, stepHeight: 5,
    wallRestitution: 6, bodyRestitution: 7, sidePushGrace: 8, accelMult: 9,
    surfaceFriction: 10, surfaceRestitution: 11, walkSpeed: 12, runSpeed: 13,
  });
  assert(packed.length === 13, `13 floats, got ${packed.length}`);
  // constructor.PhysicsConfig field order = encodePhysicsConfigLump order.
  for (let i = 0; i < 13; i += 1) assert(packed[i] === i + 1, `slot ${i} carries field ${i + 1}, got ${packed[i]}`);
});

test('every spec row maps onto a real PhysicsGlobals field with its default as base', () => {
  for (const spec of PHYSICS_GLOBAL_SPECS) {
    const def = (DEFAULT_PHYSICS_GLOBALS as Record<string, number>)[spec.path];
    assert(def !== undefined, `spec '${spec.path}' names a PhysicsGlobals field`);
    assert(spec.base === def, `spec '${spec.path}' base ${spec.base} === default ${def}`);
    assert(spec.min! <= def && def <= spec.max!, `spec '${spec.path}' default ${def} inside [${spec.min}, ${spec.max}]`);
  }
});

test('revivePhysicsGlobals keeps saved numbers, drops junk, fills defaults', () => {
  const revived = revivePhysicsGlobals({ jumpSpeed: 9.5, gravity: 'nope', extra: 1 });
  assert(revived.jumpSpeed === 9.5, `saved jumpSpeed kept, got ${revived.jumpSpeed}`);
  assert(revived.gravity === DEFAULT_PHYSICS_GLOBALS.gravity, `junk gravity fell back to default, got ${revived.gravity}`);
  assert(revived.walkSpeed === DEFAULT_PHYSICS_GLOBALS.walkSpeed, `missing walkSpeed filled from default, got ${revived.walkSpeed}`);
  assert(!('extra' in revived), 'unknown keys dropped');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
