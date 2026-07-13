// cart/editor/world/isoStage.test.ts — active-storey selection is editing
// context, not a camera command.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/isoStage.test.ts --bundle \
//     --outfile=/tmp/editor-iso-stage.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-iso-stage.test.js

import { IsoStage, METERS_PER_LEVEL } from './isoStage';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('changing the active storey leaves the solved camera exactly fixed', () => {
  const stage = new IsoStage({ centerX: 8, centerZ: -3, yaw: 125, pitch: 42, zoom: 1.7 });
  const before = stage.solve();
  stage.setLevel(12);
  const after = stage.solve();
  assert(JSON.stringify(after) === JSON.stringify(before), 'floor selection moved the solved camera');
  assert(stage.levelElevation() === 12 * METERS_PER_LEVEL, 'floor selection did not move the editing plane');
});

test('legacy hot camera height migrates independently from later floor choices', () => {
  const stage = new IsoStage({ level: 4 });
  const before = stage.solve();
  stage.setLevel(9);
  const after = stage.solve();
  assert(before.target[1] === 4 * METERS_PER_LEVEL, 'legacy view height was not preserved');
  assert(after.target[1] === before.target[1], 'later floor selection changed the migrated camera height');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
