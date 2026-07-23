// cart/editor/world/vertexSnap.test.ts — vertex snapping math (req_3378).
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/vertexSnap.test.ts --bundle \
//     --outfile=/tmp/editor-vertex-snap.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-vertex-snap.test.js

import { setAuthoredPieces } from './authoredRegistry';
import { cacheAuthoredMesh } from './authoredMesh';
import { findVertexSnap, snapVerticesFor, worldSnapVertices } from './vertexSnap';
import type { PlacedPiece } from './pieces';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (e) { failed += 1; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
function close(a: number, b: number, m: string) { if (Math.abs(a - b) > 1e-5) throw new Error(`${m}: got ${a}, want ${b}`); }

setAuthoredPieces([
  { id: 'prop:slab', modelId: 'slab', pkgId: 'studio:slab', label: 'Slab', kind: 'prop', hex: '#888888' },
]);
// A 2×1×2 slab: 4 corners at y=0, 4 at y=1 — soup repeats one corner to prove welding.
cacheAuthoredMesh('slab', new Float32Array([
  -1, 0, -1, 0, 0, 0, 0, 0,
  1, 0, -1, 0, 0, 0, 0, 0,
  -1, 0, 1, 0, 0, 0, 0, 0,
  1, 0, 1, 0, 0, 0, 0, 0,
  -1, 1, -1, 0, 0, 0, 0, 0,
  1, 1, -1, 0, 0, 0, 0, 0,
  -1, 1, 1, 0, 0, 0, 0, 0,
  1, 1, 1, 0, 0, 0, 0, 0,
  1, 1, 1, 0, 0, 0, 0, 0, // duplicate corner — welds away
]));

const placed = (id: string, x: number, z: number, extra: Partial<PlacedPiece> = {}): PlacedPiece =>
  ({ id, pieceId: 'prop:slab', x, y: 0, z, yawDegrees: 0, floor: 0, ...extra });

test('snap sets weld duplicate soup corners to unique vertices', () => {
  const set = snapVerticesFor('prop:slab');
  assert(!!set && set.length === 8 * 3, `8 welded corners, got ${(set?.length ?? 0) / 3}`);
});

test('world snap vertices carry yaw and uniform scale', () => {
  const verts = worldSnapVertices(placed('a', 10, 0, { yawDegrees: 90, scale: 2 }));
  assert(!!verts, 'transformed set exists');
  // Local (1,0,1) at yaw 90, scale 2: renderer frame → world (x + lx*c + lz*s, ...) with c=0,s=1 → (10+2, 0, -2·1·(-?) ...)
  let found = false;
  for (let i = 0; i + 2 < verts!.length; i += 3) {
    if (Math.abs(verts![i]! - 12) < 1e-4 && Math.abs(verts![i + 1]!) < 1e-4 && Math.abs(verts![i + 2]! - (-2)) < 1e-4) found = true;
  }
  assert(found, 'rotated+scaled corner (12, 0, -2) present');
});

test('the nearest vertex within radius locks and the delta closes the gap exactly', () => {
  // Dragged slab at x=2.2: its corner (1.2, 0, 1) sits 0.2m from the anchor
  // slab's corner (1, 0, 1) — inside the 0.35m radius.
  const dragged = placed('dragging', 2.2, 0);
  const anchor = placed('anchor', 0, 0);
  // Cursor ray points at the dragged slab's (+x, +z, y=0) corner region.
  const ray = { origin: { x: 1.2, y: 5, z: 1 }, dir: { x: 0, y: -1, z: 0 } };
  const hit = findVertexSnap(dragged, ray, [dragged, anchor]);
  assert(!!hit, 'lock found within radius');
  close(hit!.source.x, 1.2, 'source is the cursor-nearest dragged corner x');
  close(hit!.target.x, 1, 'target is the anchor corner x');
  close(hit!.dx, -0.2, 'delta closes the gap');
  close(hit!.dy, 0, 'no vertical drift');
  // Applying the delta makes the corners coincide.
  const snapped = { ...dragged, x: dragged.x + hit!.dx };
  const after = findVertexSnap(snapped, ray, [snapped, anchor]);
  assert(!!after && Math.abs(after.dx) < 1e-5 && Math.abs(after.dz) < 1e-5, 'snapped position is the fixed point');
});

test('nothing in range → no lock; the dragged piece never snaps to itself', () => {
  const dragged = placed('dragging', 50, 50);
  const anchor = placed('anchor', 0, 0);
  assert(findVertexSnap(dragged, null, [dragged, anchor]) === null, 'far apart stays free');
  assert(findVertexSnap(dragged, null, [dragged]) === null, 'alone in the world stays free');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
