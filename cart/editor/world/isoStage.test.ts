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

test('camera orbit follows terrain while preserving its authored clearance', () => {
  const stage = new IsoStage(
    { centerX: 8, centerZ: -3, viewY: 4, yaw: 125, pitch: 42, zoom: 1.7 },
    (x, z) => x * 2 - z,
  );
  stage.refreshTerrainElevation();
  const low = stage.solve();
  assert(low.target[1] === 23, `terrain focus was ${low.target[1]}, expected 23`);
  const lowOffset = low.pos[1] - low.target[1];

  stage.centerOn(18, -3);
  stage.refreshTerrainElevation();
  const high = stage.solve();
  assert(high.target[1] === 43, `panned terrain focus was ${high.target[1]}, expected 43`);
  assert(Math.abs((high.pos[1] - high.target[1]) - lowOffset) < 1e-9, 'terrain rise changed the authored orbit clearance');
});

test('terrain-following camera remains independent of the active storey', () => {
  const stage = new IsoStage({ centerX: 12, centerZ: 5, viewY: 2 }, () => 70);
  stage.refreshTerrainElevation();
  const before = stage.solve();
  stage.setLevel(9);
  const after = stage.solve();
  assert(JSON.stringify(after) === JSON.stringify(before), 'storey selection moved the terrain-following camera');
});

test('an invalid terrain sample degrades to flat ground', () => {
  const stage = new IsoStage({ viewY: 3 }, () => Number.NaN);
  stage.refreshTerrainElevation();
  assert(stage.solve().target[1] === 3, 'invalid terrain escaped the stage boundary');
});

test('camera projections reuse one cached terrain sample', () => {
  let samples = 0;
  const stage = new IsoStage({ centerX: 2, centerZ: 4 }, () => {
    samples += 1;
    return 12;
  });
  stage.refreshTerrainElevation();
  stage.solve();
  stage.solve();
  stage.project(2, 12, 4, { x: 0, y: 0, width: 800, height: 600 });
  stage.worldRay(400, 300, { x: 0, y: 0, width: 800, height: 600 });
  assert(samples === 1, `pure solves crossed the terrain door ${samples} times`);
});

test('elevated terrain keeps zoom and drag navigation on the camera focus plane', () => {
  const rect = { x: 0, y: 0, width: 1000, height: 800 };
  const elevated = new IsoStage({ centerX: 10, centerZ: -6, viewY: 3, level: 8, yaw: 45, pitch: 40, zoom: 1 }, () => 70);
  elevated.refreshTerrainElevation();
  elevated.zoomToCursor(500, 400, 1.5, rect);
  assert(Math.abs(elevated.pose.centerX - 10) < 1e-9 && Math.abs(elevated.pose.centerZ + 6) < 1e-9, 'center-cursor zoom drifted off elevated focus');

  const flat = new IsoStage({ centerX: 10, centerZ: -6, viewY: 3, level: 8, yaw: 45, pitch: 40, zoom: 1.5 }, () => 0);
  flat.refreshTerrainElevation();
  elevated.dragPan(300, 350, 355, 390, rect);
  flat.dragPan(300, 350, 355, 390, rect);
  assert(Math.abs(elevated.pose.centerX - flat.pose.centerX) < 1e-9, 'terrain altitude changed horizontal drag X');
  assert(Math.abs(elevated.pose.centerZ - flat.pose.centerZ) < 1e-9, 'terrain altitude changed horizontal drag Z');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
