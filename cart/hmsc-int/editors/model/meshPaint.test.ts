// meshPaint.test.ts — the PAINT-mode pure math (the corrected painter, req_1288).
// Bundle + run:
//   tools/esbuild cart/hmsc-int/editors/model/meshPaint.test.ts --bundle \
//     --format=esm --platform=neutral --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli <out>.js
// Covers the screen→world ray (inverse of the projector), the face/CELL raycast, the
// uniform-world cell grid, the brush clamp (no spill past a face), the seamless atlas
// rect (no pinstripes), and uvToWorld.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { cuboid } from './editMesh';
import type { CameraSnap } from './meshSelect';
import { screenRay, pickFaceCell, faceCellGrid, cellAtlasRect, brushCells, uvToWorld, PAINT_CELL_UNITS, type PaintTarget } from './meshPaint';

function nearly(a: number, b: number, eps = 1e-3): boolean { return Math.abs(a - b) <= eps; }

const cam: CameraSnap = { eye: [0, 0, 5], target: [0, 0, 0], fov: 45, aspect: 1, w: 800, h: 800, near: 0.02 };

test('screenRay: centre pixel aims at the target (−Z); off-centre tilts the right way', () => {
  const ray = screenRay(cam, 400, 400);
  assert(nearly(ray.d[0], 0) && nearly(ray.d[1], 0), 'centre ray has no x/y tilt');
  assert(ray.d[2] < 0, 'centre ray points toward −Z (the target)');
  const right = screenRay(cam, 700, 400);
  assert(right.d[0] > 0, 'a pixel right of centre tilts +x');
  const down = screenRay(cam, 400, 700);
  assert(down.d[1] < 0, 'a pixel below centre tilts −y');
});

test('pickFaceCell hits the front (+Z) face and returns a cell inside the face grid', () => {
  const box = cuboid(8, 8, 8); // origin-centred; faces fullFaceUV at mint
  const targets: PaintTarget[] = [{ partId: 'a', mesh: box, lift: 0 }];
  const hit = pickFaceCell(targets, cam, 400, 400, PAINT_CELL_UNITS);
  assert(!!hit, 'centre ray hits a face');
  if (!hit) return;
  const face = box.faces[hit.faceIndex];
  const allFrontZ = face.loop.every((vi) => box.verts[vi][2] > 3.9);
  assert(allFrontZ, 'the hit face is the +Z (camera-facing) face');
  const grid = faceCellGrid(box, hit.faceIndex, PAINT_CELL_UNITS)!;
  assert(hit.cu >= 0 && hit.cu < grid.nu, 'cu inside the face cell grid');
  assert(hit.cv >= 0 && hit.cv < grid.nv, 'cv inside the face cell grid');
});

test('the cell grid is UNIFORM world-size — an 8u face gets 4 cells at 2u/cell (no slivers)', () => {
  const box = cuboid(8, 8, 8);
  const grid = faceCellGrid(box, 0, 2)!; // explicit 2u/cell: 8u edge → 4 cells (math, not the default)
  assertEqual(grid.nu, 4, '8 units / 2-unit cells = 4 cells across');
  assertEqual(grid.nv, 4, '4 cells down too');
});

test('cellAtlasRect tiles SEAMLESSLY — neighbouring cells share an exact edge (no pinstripes)', () => {
  const box = cuboid(8, 8, 8);
  const grid = faceCellGrid(box, 0, PAINT_CELL_UNITS)!;
  const texels = 512;
  const a = cellAtlasRect(grid, 0, 0, texels);
  const b = cellAtlasRect(grid, 1, 0, texels);
  assertEqual(a.x + a.w, b.x, 'cell 0 right edge == cell 1 left edge — no gap, no overlap');
  const c = cellAtlasRect(grid, 0, 1, texels);
  assertEqual(a.y + a.h, c.y, 'cell row 0 bottom == row 1 top — seamless vertically');
});

test('a miss (ray into empty space) returns null', () => {
  const box = cuboid(2, 2, 2);
  const targets: PaintTarget[] = [{ partId: 'a', mesh: box, lift: 0 }];
  const hit = pickFaceCell(targets, cam, 5, 5, PAINT_CELL_UNITS); // far corner, off the cube
  assert(hit === null, 'a corner-pixel ray off the cube misses');
});

test('brushCells clamps to the face — never spills past the cell-grid bounds', () => {
  const box = cuboid(8, 8, 8);
  const grid = faceCellGrid(box, 0, PAINT_CELL_UNITS)!; // 4×4 cells
  const cells = brushCells({ partIndex: 0, faceIndex: 0, cu: grid.nu - 1, cv: grid.nv - 1 }, 5, grid); // big brush at the corner
  assert(cells.length > 0, 'paints at least one cell');
  for (const [cu, cv] of cells) {
    assert(cu >= 0 && cu < grid.nu && cv >= 0 && cv < grid.nv, `cell (${cu},${cv}) stays inside the face`);
  }
});

test('brush size 1 paints exactly one cell — at the cursor cell', () => {
  const box = cuboid(8, 8, 8);
  const grid = faceCellGrid(box, 0, PAINT_CELL_UNITS)!;
  const cells = brushCells({ partIndex: 0, faceIndex: 0, cu: 1, cv: 2 }, 1, grid);
  assertEqual(cells.length, 1, 'a size-1 brush is one cell');
  assert(cells[0][0] === 1 && cells[0][1] === 2, 'at the cursor cell');
});

test('uvToWorld maps a UV onto the face for ANY shape — quad + triangle (req_1225)', () => {
  const box = cuboid(2, 2, 2);
  const quad = box.faces[0];
  const ctr = uvToWorld(box, quad, 0.5, 0.5)!;
  assert(!!ctr && ctr.inside, 'centre UV is inside the quad');
  const verts = quad.loop.map((vi) => box.verts[vi]);
  const cx = verts.reduce((s, v) => s + v[0], 0) / verts.length;
  const cy = verts.reduce((s, v) => s + v[1], 0) / verts.length;
  const cz = verts.reduce((s, v) => s + v[2], 0) / verts.length;
  assert(nearly(ctr.world[0], cx) && nearly(ctr.world[1], cy) && nearly(ctr.world[2], cz), 'centre UV → face centroid');
  const out = uvToWorld(box, quad, 5, 5);
  assert(!!out && !out.inside, 'a UV outside the face is flagged not-inside');
  const cone = (require('./editMesh').cone)(2, 2, 6);
  const tri = cone.faces.find((f: any) => f.loop.length === 3);
  assert(!!tri, 'cone has triangular faces');
  const onTri = uvToWorld(cone, tri, 0.34, 0.33);
  assert(!!onTri, 'uvToWorld returns a point on a triangular face');
});

finish('meshPaint');
