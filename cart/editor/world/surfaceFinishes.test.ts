// surfaceFinishes.test.ts — the wall-side Surface Package lane (req_4783/4785).
// Locks the finish-id contract, the band → projected-plane derivation (lift,
// axes, chart-origin continuity through openings), and the catalog's packages
// validating clean against the frozen schema.
import { ARCHITECTURE_UNITS_PER_METER } from './architecture';
import type { WallRenderBand } from './architectureBake';
import {
  SURFACE_FINISH_CATALOG,
  SURFACE_FINISH_PREFIX,
  bandSurfaceId,
  bandToProjectedPlane,
  surfaceFinishForId,
} from './surfaceFinishes';
import { validateSurfacePackage } from '../render3d/shaders/surfacePackage';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}
function near(a: number, b: number, eps = 1e-5) {
  return Math.abs(a - b) <= eps;
}

function faceBand(overrides: Partial<WallRenderBand> = {}): WallRenderBand {
  // A 2m x 3m face band at x∈[1,3], y∈[0,3], z=0, facing +z.
  return {
    floor: 0,
    edgeId: 'edge-1',
    role: 'face',
    side: 'a',
    materialId: `${SURFACE_FINISH_PREFIX}brick-wall`,
    columnStartU: 4,
    columnEndU: 12,
    rowBottomU: 0,
    rowTopU: 12,
    quad: [[1, 0, 0], [3, 0, 0], [3, 3, 0], [1, 3, 0]],
    normal: [0, 0, 1],
    uv: [[0, 0], [2, 0], [2, 3], [0, 3]],
    ...overrides,
  };
}

test('every catalog package validates clean against the frozen schema', () => {
  for (const entry of SURFACE_FINISH_CATALOG) {
    const errors = validateSurfacePackage(entry.pkg);
    assert(errors.length === 0, `${entry.pkg.id}: ${errors.join(' | ')}`);
  }
});

test('finish ids resolve through the prefix and nothing else', () => {
  assert(surfaceFinishForId(`${SURFACE_FINISH_PREFIX}brick-wall`)?.pkg.id === 'brick-wall', 'brick-wall must resolve');
  assert(surfaceFinishForId('brick-wall') === null, 'a bare id is a Skins asset, never a package');
  assert(surfaceFinishForId(`${SURFACE_FINISH_PREFIX}unknown`) === null, 'unknown package ids resolve to null');
});

test('bandToProjectedPlane derives axes, size, and the mortar lift', () => {
  const entry = surfaceFinishForId(`${SURFACE_FINISH_PREFIX}brick-wall`)!;
  const plane = bandToProjectedPlane(faceBand(), entry)!;
  assert(plane !== null && plane.length === 15, 'plane must be the 15-float extended shape');
  const lift = Math.max(0, -entry.pkg.bounds.minDisplacement) + 0.001;
  assert(near(plane[0]!, 1) && near(plane[1]!, 0) && near(plane[2]!, lift), `origin must sit q0 lifted by ${lift} along +z (got ${plane[0]},${plane[1]},${plane[2]})`);
  assert(near(plane[3]!, 1) && near(plane[4]!, 0) && near(plane[5]!, 0), 'u axis must normalize q1-q0');
  assert(near(plane[6]!, 0) && near(plane[7]!, 1) && near(plane[8]!, 0), 'v axis must normalize q3-q0');
  assert(near(plane[9]!, 2) && near(plane[10]!, 3), 'size must be the quad extents in meters');
  assert(near(plane[11]!, entry.pkg.evaluation.renderSpacing), 'spacing must ride the package');
});

test('the chart origin carries the band column/row so courses continue', () => {
  const entry = surfaceFinishForId(`${SURFACE_FINISH_PREFIX}brick-wall`)!;
  const left = bandToProjectedPlane(faceBand(), entry)!;
  const right = bandToProjectedPlane(faceBand({ columnStartU: 20, quad: [[5, 0, 0], [7, 0, 0], [7, 3, 0], [5, 3, 0]] }), entry)!;
  const metersPerU = 1 / ARCHITECTURE_UNITS_PER_METER;
  assert(near(left[13]!, 4 * metersPerU), 'left band chart U origin must be columnStartU in meters');
  assert(near(right[13]!, 20 * metersPerU), 'right band chart U origin must continue the run');
  assert(near(left[14]!, 0) && near(right[14]!, 0), 'chart V origin rides rowBottomU');
});

test('a degenerate band quad refuses a plane', () => {
  const entry = surfaceFinishForId(`${SURFACE_FINISH_PREFIX}brick-wall`)!;
  const degenerate = bandToProjectedPlane(faceBand({ quad: [[1, 0, 0], [1, 0, 0], [1, 3, 0], [1, 3, 0]] }), entry);
  assert(degenerate === null, 'zero-width quads must return null');
});

test('band surface ids are stable and band-window distinct', () => {
  const a = bandSurfaceId(faceBand());
  const b = bandSurfaceId(faceBand());
  const c = bandSurfaceId(faceBand({ columnStartU: 20 }));
  assert(a === b, 'identical bands must mint identical ids');
  assert(a !== c, 'a different band window must mint a different id');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} surface finish suite failures`);
