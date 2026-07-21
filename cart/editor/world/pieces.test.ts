// cart/editor/world/pieces.test.ts — drag-run placement follows semantic kind,
// including build pieces exported from the model editor.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/pieces.test.ts --bundle \
//     --outfile=/tmp/editor-pieces.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-pieces.test.js

import { setAuthoredPieces } from './authoredRegistry';
import { cacheAuthoredMesh } from './authoredMesh';
import { resolveMovedPlacement, resolvePlacement, resolveRunPlacements, retainPieceSequence, supportsRunPlacement, visibleStoreyPieces, type PlacedPiece } from './pieces';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

setAuthoredPieces([
  { id: 'model:exported-wall', modelId: 'exported-wall', pkgId: 'studio:wall', label: 'Exported Wall', kind: 'wall', hex: '#888888' },
  { id: 'model:exported-floor', modelId: 'exported-floor', pkgId: 'studio:floor', label: 'Exported Floor', kind: 'floor', hex: '#777777' },
  { id: 'model:offset-floor', modelId: 'offset-floor', pkgId: 'studio:offset-floor', label: 'Offset Floor', kind: 'floor', hex: '#777777' },
  { id: 'model:missing-floor', modelId: 'missing-floor', pkgId: 'studio:missing-floor', label: 'Missing Floor', kind: 'floor', hex: '#777777' },
  { id: 'prop:exported-chair', modelId: 'exported-chair', pkgId: 'studio:chair', label: 'Exported Chair', kind: 'prop', hex: '#666666' },
]);
cacheAuthoredMesh('exported-floor', new Float32Array([
  -1.5, 0, -1.5, 0, 0, 0, 0, 0,
  1.5, 0, -1.5, 0, 0, 0, 0, 0,
  -1.5, 0, 1.5, 0, 0, 0, 0, 0,
  1.5, 0, 1.5, 0, 0, 0, 0, 0,
]));
cacheAuthoredMesh('exported-wall', new Float32Array([
  -1.5, 0, -0.01, 0, 0, 0, 0, 0,
  1.5, 0, -0.01, 0, 0, 0, 0, 0,
  -1.5, 3, 0.01, 0, 0, 0, 0, 0,
  1.5, 3, 0.01, 0, 0, 0, 0, 0,
]));
cacheAuthoredMesh('offset-floor', new Float32Array([
  0, 0, 0, 0, 0, 0, 0, 0,
  6, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 3, 0, 0, 0, 0, 0,
  6, 0, 3, 0, 0, 0, 0, 0,
]));

test('exported wall inherits wall drag-run placement', () => {
  assert(supportsRunPlacement('model:exported-wall'), 'exported wall is runnable');
  const run = resolveRunPlacements('model:exported-wall', 1.5, 0, 10.5, 0, 0);
  assert(run.length === 4, `four wall modules placed, got ${run.length}`);
  assert(run.every((piece) => piece.pieceId === 'model:exported-wall'), 'every module keeps the exported piece id');
  assert(run.every((piece) => piece.z === 0 && piece.yawDegrees === 0), 'wall run follows one snapped edge');
});

test('exported floor inherits rectangular area placement', () => {
  assert(supportsRunPlacement('model:exported-floor'), 'exported floor is runnable');
  const run = resolveRunPlacements('model:exported-floor', 1.5, 1.5, 7.5, 4.5, 0);
  assert(run.length === 6, `3×2 floor area placed, got ${run.length}`);
  assert(run.every((piece) => piece.pieceId === 'model:exported-floor'), 'every cell keeps the exported piece id');
});

test('floor run clears the highest rendered terrain under its complete footprint', () => {
  let queried: readonly number[] | null = null;
  let calls = 0;
  const run = resolveRunPlacements(
    'model:exported-floor',
    1.5,
    1.5,
    7.5,
    4.5,
    0,
    1.25,
    0,
    (minX, minZ, maxX, maxZ) => {
      calls += 1;
      queried = [minX, minZ, maxX, maxZ];
      return 2.75;
    },
  );
  assert(calls === 1, `terrain maximum crossed the boundary ${calls} times instead of once`);
  assert(JSON.stringify(queried) === JSON.stringify([0, 0, 9, 6]), `wrong foundation footprint ${JSON.stringify(queried)}`);
  assert(run.every((piece) => piece.y === 2.75), 'level run did not clear its highest rendered ground point');
});

test('single floor click clears its snapped footprint and preserves its storey', () => {
  let queried: readonly number[] | null = null;
  const placed = resolvePlacement(
    'model:exported-floor',
    1.2,
    1.4,
    2,
    1.25,
    0,
    0,
    (minX, minZ, maxX, maxZ) => {
      queried = [minX, minZ, maxX, maxZ];
      return 2.75;
    },
  );
  assert(JSON.stringify(queried) === JSON.stringify([0, 0, 3, 3]), `wrong click footprint ${JSON.stringify(queried)}`);
  assert(placed?.y === 8.75, `footprint terrain did not retain the 6m storey offset, got ${placed?.y}`);
});

test('rotated authored floor queries its asymmetric mesh-space footprint', () => {
  let queried: readonly number[] | null = null;
  const placed = resolvePlacement(
    'model:offset-floor',
    1.5,
    1.5,
    0,
    0,
    0,
    90,
    (minX, minZ, maxX, maxZ) => {
      queried = [minX, minZ, maxX, maxZ];
      return 4;
    },
  );
  const expected = [1.5, -4.5, 4.5, 1.5];
  assert(!!queried && queried.every((value, index) => Math.abs(value - expected[index]!) < 1e-9), `wrong asymmetric footprint ${JSON.stringify(queried)}`);
  assert(placed?.y === 4, `asymmetric floor did not clear its footprint, got ${placed?.y}`);
});

test('authored floor without real bounds is refused instead of guessed at 3m', () => {
  let terrainQueries = 0;
  const placed = resolvePlacement('model:missing-floor', 1.5, 1.5, 0, 0, 0, 0, () => {
    terrainQueries += 1;
    return 4;
  });
  assert(placed === null, 'unbounded authored floor was allowed to bypass terrain-safe placement');
  assert(terrainQueries === 0, 'unbounded authored floor issued a knowingly incomplete terrain query');
});

test('exported prop remains a single free placement', () => {
  assert(!supportsRunPlacement('prop:exported-chair'), 'exported prop is not runnable');
  const run = resolveRunPlacements('prop:exported-chair', 1, 2, 8.25, 9.75, 0);
  assert(run.length === 1, `one prop placed, got ${run.length}`);
  assert(run[0]?.x === 8.25 && run[0]?.z === 9.75, 'prop lands at the cursor without grid tiling');
});

test('armed turn rotates the placement ghost and committed transform before drop', () => {
  const floor = resolvePlacement('model:exported-floor', 1.5, 1.5, 0, 0, 0, 90);
  assert(floor?.yawDegrees === 90, `floor turn carried into placement, got ${floor?.yawDegrees}`);
  const wall = resolvePlacement('model:exported-wall', 1.5, 0, 0, 0, 0, 90);
  assert(wall?.yawDegrees === 90, `edge base yaw plus turn carried into placement, got ${wall?.yawDegrees}`);
  const prop = resolvePlacement('prop:exported-chair', 8.25, 9.75, 0, 0, 0, 270);
  assert(prop?.yawDegrees === 270, `prop turn carried into placement, got ${prop?.yawDegrees}`);
});

test('move preserves instance identity and authored data while snapping its transform', () => {
  const source: PlacedPiece = {
    id: 'bp_keep',
    pieceId: 'model:exported-wall',
    x: 0,
    y: 3,
    z: 1.5,
    yawDegrees: 90,
    floor: 1,
    slots: { wall: { assetId: 'skin.brick' } },
    overrides: { collision: true },
  };
  const moved = resolveMovedPlacement(source, 7.2, 8.2, 2);
  assert(!!moved, 'wall move resolved');
  assert(moved!.id === source.id, 'move keeps the instance id');
  assert(moved!.floor === 1 && moved!.y === 5, `move keeps storey and rebases terrain, got floor=${moved!.floor} y=${moved!.y}`);
  assert(moved!.x === 6 && moved!.z === 7.5, `yaw-90 wall stays on its vertical edge family, got (${moved!.x},${moved!.z})`);
  assert(moved!.yawDegrees === 90, 'move preserves yaw');
  assert(moved!.slots === source.slots && moved!.overrides === source.overrides, 'move preserves instance slots and overrides');

  let terrainQueries = 0;
  const lifted = resolveMovedPlacement(source, 7.2, 8.2, 2, () => {
    terrainQueries += 1;
    return 4.5;
  });
  assert(terrainQueries === 1, `move queried terrain ${terrainQueries} times`);
  assert(lifted?.y === 7.5, `move did not preserve storey above footprint maximum, got ${lifted?.y}`);
});

test('an unchanged storey cutaway preserves the live-world list identity', () => {
  const pieces: PlacedPiece[] = [
    { id: 'ground-a', pieceId: 'model:exported-floor', x: 1.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 },
    { id: 'ground-b', pieceId: 'prop:exported-chair', x: 2, y: 0, z: 2, yawDegrees: 0, floor: 0 },
  ];
  const visible = visibleStoreyPieces(pieces, 12, false);
  assert(visible === pieces, 'unchanged visibility manufactured a live-world update');

  const upper: PlacedPiece = { id: 'upper', pieceId: 'model:exported-floor', x: 1.5, y: 9, z: 1.5, yawDegrees: 0, floor: 3 };
  const world = [...pieces, upper];
  const floor0 = visibleStoreyPieces(world, 0, false);
  const floor1 = visibleStoreyPieces(world, 1, false);
  assert(retainPieceSequence(floor0, floor1) === floor0, 'equal cutaway membership did not retain the prior projection');
  const floor3 = visibleStoreyPieces(world, 3, false);
  assert(retainPieceSequence(floor0, floor3) === floor3, 'a newly visible piece was incorrectly suppressed');
});

setAuthoredPieces([]);
log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
