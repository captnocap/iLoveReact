// cart/editor/world/isoStage.test.ts — the active storey is one vertical
// context shared by editing, picking, and the camera.
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
function assertClose(actual: number, expected: number, message: string) {
  if (Math.abs(actual - expected) > 1e-9) throw new Error(`${message}: got ${actual}, expected ${expected}`);
}

test('changing the active storey lifts the editing plane and camera together', () => {
  const stage = new IsoStage({ centerX: 8, centerZ: -3, level: 2, yaw: 125, pitch: 42, zoom: 1.7 });
  const before = stage.solve();
  stage.setLevel(12);
  const after = stage.solve();
  const rise = 10 * METERS_PER_LEVEL;
  assertClose(after.target[1] - before.target[1], rise, 'camera target did not follow the active storey');
  assertClose(after.pos[1] - before.pos[1], rise, 'camera eye did not follow the active storey');
  assertClose(after.target[0], before.target[0], 'floor selection moved the camera target X');
  assertClose(after.target[2], before.target[2], 'floor selection moved the camera target Z');
  assertClose(after.pos[0], before.pos[0], 'floor selection changed the orbit X');
  assertClose(after.pos[2], before.pos[2], 'floor selection changed the orbit Z');
  assert(stage.levelElevation() === 12 * METERS_PER_LEVEL, 'floor selection did not move the editing plane');
});

test('camera orbit follows terrain while preserving its storey clearance', () => {
  const stage = new IsoStage(
    { centerX: 8, centerZ: -3, level: 2, yaw: 125, pitch: 42, zoom: 1.7 },
    (x, z) => x * 2 - z,
  );
  stage.refreshTerrainElevation();
  const low = stage.solve();
  assert(low.target[1] === 25, `terrain focus was ${low.target[1]}, expected 25`);
  const lowOffset = low.pos[1] - low.target[1];

  stage.centerOn(18, -3);
  stage.refreshTerrainElevation();
  const high = stage.solve();
  assert(high.target[1] === 45, `panned terrain focus was ${high.target[1]}, expected 45`);
  assert(Math.abs((high.pos[1] - high.target[1]) - lowOffset) < 1e-9, 'terrain rise changed the authored orbit clearance');
});

test('terrain-following camera rises when the active storey rises', () => {
  const stage = new IsoStage({ centerX: 12, centerZ: 5, level: 2 }, () => 70);
  stage.refreshTerrainElevation();
  const before = stage.solve();
  stage.setLevel(9);
  const after = stage.solve();
  assert(after.target[1] - before.target[1] === 7 * METERS_PER_LEVEL, 'storey rise did not lift the terrain-following camera');
});

test('an invalid terrain sample degrades to flat ground', () => {
  const stage = new IsoStage({ level: 1 }, () => Number.NaN);
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
  const elevated = new IsoStage({ centerX: 10, centerZ: -6, level: 8, yaw: 45, pitch: 40, zoom: 1 }, () => 70);
  elevated.refreshTerrainElevation();
  elevated.zoomToCursor(500, 400, 1.5, rect);
  assert(Math.abs(elevated.pose.centerX - 10) < 1e-9 && Math.abs(elevated.pose.centerZ + 6) < 1e-9, 'center-cursor zoom drifted off elevated focus');

  const flat = new IsoStage({ centerX: 10, centerZ: -6, level: 8, yaw: 45, pitch: 40, zoom: 1.5 }, () => 0);
  flat.refreshTerrainElevation();
  elevated.dragPan(300, 350, 355, 390, rect);
  flat.dragPan(300, 350, 355, 390, rect);
  assert(Math.abs(elevated.pose.centerX - flat.pose.centerX) < 1e-9, 'terrain altitude changed horizontal drag X');
  assert(Math.abs(elevated.pose.centerZ - flat.pose.centerZ) < 1e-9, 'terrain altitude changed horizontal drag Z');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
