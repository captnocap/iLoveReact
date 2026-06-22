// void.test.ts — seam-1 void math: escape_depth, voidDistortion fan-out, and the
// procedural shell's determinism + core-skip. Pure modules, no rendering.

import { assert, assertClose, assertEqual, finish, test } from '../_testkit';
import type { WorldState } from '../../design';
import { worldCore, escapeDepth, distanceOutsideCore } from './distance';
import { voidDistortion, VOID_NULL, voidHash } from './distortion';
import { buildShellBatch, SHELL_CHUNK_METERS } from './shell';

// A minimal world stub — only the fields worldCore reads.
function aWorld(widthCells: number, depthCells: number, cell = 1): WorldState {
  return {
    cellSizeMeters: cell,
    layout: { key: 'k', label: 'l', widthCells, depthCells },
  } as unknown as WorldState;
}

test('escape_depth is zero everywhere inside the authored rectangle', () => {
  const core = worldCore(aWorld(600, 400));
  // The center, an edge, and a corner of the authored rectangle are all honest.
  assertEqual(escapeDepth(core.centerX, core.centerZ, core), 0, 'center is safe');
  assertEqual(escapeDepth(0, 0, core), 0, 'corner is safe');
  assertEqual(escapeDepth(600, 400, core), 0, 'far corner is safe');
  assertEqual(escapeDepth(599, 1, core), 0, 'a point inside near the edge is safe');
});

test('escape_depth climbs linearly past the rectangle edge', () => {
  const core = worldCore(aWorld(200, 200)); // [0,200] x [0,200]
  // 1km past the +x edge, on-axis: distanceOutsideCore = 1000, minus the 40m
  // grace margin = 960.
  assertClose(escapeDepth(core.maxX + 1000, core.centerZ, core), 960, 1e-6, 'depth = gap past edge minus grace');
  // distanceOutsideCore is zero inside, the straight gap outside.
  assertEqual(distanceOutsideCore(100, 100, core), 0, 'inside → 0 distance');
  assertClose(distanceOutsideCore(203, 204, core), 5, 1e-6, 'outside a corner → hypot of the gaps');
});

test('voidDistortion is null at the core and saturates outward', () => {
  const z = voidDistortion(0);
  for (const k of Object.keys(VOID_NULL) as (keyof typeof VOID_NULL)[]) {
    assertEqual(z[k], 0, `weight ${k} is 0 at depth 0`);
  }
  // Sky drifts first: at 30km skyDrift is well underway but controlInvert is not.
  const mid = voidDistortion(30_000);
  assert(mid.skyDrift > 0.3, 'skyDrift is engaged by 30km');
  assert(mid.controlInvert < 0.05, 'controlInvert is dormant at 30km');
  // Deep out, the Truman tax is fully on.
  const deep = voidDistortion(200_000);
  assertClose(deep.skyDrift, 1, 1e-6, 'skyDrift saturates deep out');
  assertClose(deep.controlInvert, 1, 1e-6, 'controlInvert saturates deep out');
});

test('every distortion weight stays within [0,1] across the whole range', () => {
  for (let km = 0; km <= 220; km += 5) {
    const w = voidDistortion(km * 1000);
    for (const k of Object.keys(VOID_NULL) as (keyof typeof VOID_NULL)[]) {
      assert(w[k] >= 0 && w[k] <= 1, `weight ${k} in range at ${km}km (got ${w[k]})`);
    }
  }
});

test('voidHash is deterministic and in [0,1)', () => {
  const a = voidHash(12, -7, 3);
  const b = voidHash(12, -7, 3);
  assertEqual(a, b, 'same coords + salt → same value');
  assert(a >= 0 && a < 1, 'hash in [0,1)');
  assert(voidHash(12, -7, 3) !== voidHash(12, -7, 4), 'salt changes the value');
});

test('the shell is deterministic — same focus rebuilds the identical batch', () => {
  const core = worldCore(aWorld(100, 100));
  const focusX = 20_000;
  const focusZ = 0;
  const a = buildShellBatch(focusX, focusZ, core, 4);
  const b = buildShellBatch(focusX, focusZ, core, 4);
  assert(a.count > 0, 'shell produced instances out in the void');
  assertEqual(a.data.length, b.data.length, 'same row count on rebuild');
  assert(a.data.every((v, i) => v === b.data[i]), 'every float identical on rebuild');
});

test('the shell skips the authored core but fills in just past the edge', () => {
  const core = worldCore(aWorld(2000, 2000)); // [0,2000] x [0,2000]
  // Deep inside a large map: every chunk in the window is inside the rectangle,
  // so nothing is drawn over the authored city.
  const inside = buildShellBatch(core.centerX, core.centerZ, core, 3);
  assertEqual(inside.count, 0, 'no shell instances over the core interior');
  // Standing AT the +x edge: the window reaches past the rectangle, so the void
  // fills the horizon immediately — this is the bug the rect-skip fixed (the old
  // circumradius gate left it empty until far past the corners).
  const atEdge = buildShellBatch(core.maxX, core.centerZ, core, 3);
  assert(atEdge.count > 0, 'shell fills the void just past the authored edge');
});

test('shell rows are stride-9 and sit at/above ground', () => {
  const core = worldCore(aWorld(100, 100));
  const batch = buildShellBatch(40_000, 0, core, 3);
  assertEqual(batch.data.length % 9, 0, 'data length is a multiple of stride 9');
  assertEqual(batch.count, batch.data.length / 9, 'count matches stride-9 rows');
  // Spot-check: every building/ground box has positive scale and color in 0..1.
  for (let i = 0; i < batch.data.length; i += 9) {
    assert(batch.data[i + 3] > 0 && batch.data[i + 4] > 0 && batch.data[i + 5] > 0, 'positive scale');
    for (let c = 6; c < 9; c += 1) assert(batch.data[i + c] >= 0 && batch.data[i + c] <= 1.05, 'color ~0..1');
  }
});

test('shell focus quantizes to chunks (caller keys the memo on chunk cells)', () => {
  // SHELL_CHUNK_METERS is the streaming grain VoidShell keys its useMemo on.
  assert(SHELL_CHUNK_METERS >= 80 && SHELL_CHUNK_METERS <= 320, 'chunk grain is city-block scaled');
  // distanceOutsideCore is the plain gap to the rectangle (0 inside).
  const core = worldCore(aWorld(10, 10));
  assertClose(distanceOutsideCore(13, 14, core), 5, 1e-6, 'gap past a corner is hypot of the per-axis gaps');
});

finish('void seam-1');
