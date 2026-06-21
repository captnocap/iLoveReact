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
import { screenRay, pickFaceCell, faceCellGrid, cellAtlasRect, brushCells, dabRadiusCells, uvToWorld, mirrorPaintDabs, faceUvPerWorld, surfaceBrushDabs, PAINT_CELL_UNITS, PAINT_GRID_UNITS, type PaintTarget } from './meshPaint';
import type { EditMesh } from './editMesh';

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

test('a BIG face still grids the WHOLE face — GRID_MAX coarsens the cell, never truncates the tail (req_1318)', () => {
  // a 100u cube at the fine fixed resolution would want ~1250 cells/edge — far past the
  // cap. The OLD code capped the COUNT but kept the fine cell, so the grid only covered
  // the first 256 cells from one corner and the far end had no cells (the "can't paint
  // the end" bug). The fix coarsens the cell so the grid spans u0..u1 within the cap.
  const box = cuboid(100, 100, 100);
  const grid = faceCellGrid(box, 0, PAINT_GRID_UNITS)!;
  assert(grid.nu <= 256 && grid.nv <= 256, 'cell count stays within the cap');
  assert(grid.u0 + grid.nu * grid.cuv >= grid.u1 - 1e-6, 'the grid reaches the far U edge of the face — no dropped tail');
  assert(grid.v0 + grid.nv * grid.cuv >= grid.v1 - 1e-6, 'the grid reaches the far V edge of the face — no dropped tail');
});

test('dabRadiusCells maps the detail slider to a footprint on the FIXED grid (req_1318)', () => {
  // a fine dab at one cell = a single cell (radius 0); the brush multiplier adds rings;
  // a bigger dab spans more cells. The grid itself never changes — only the footprint.
  assertEqual(dabRadiusCells(PAINT_GRID_UNITS, 1), 0, 'a one-cell dab, brush 1 → radius 0 (single cell)');
  assertEqual(dabRadiusCells(PAINT_GRID_UNITS, 3), 2, 'brush 3 adds two rings → radius 2');
  assert(dabRadiusCells(1.2, 1) > dabRadiusCells(0.2, 1), 'a bigger dab covers more cells');
});

test('mirrorPaintDabs reflects a dab onto the symmetric face across X (req_1538)', () => {
  // a minimal symmetric pair: the +X and −X faces of a unit-2 box, each with its OWN
  // distinct UV island so faceTexelRect can tell them apart (island A: u 0..0.4, island
  // B: u 0.5..0.9; both map y→u, z→v the same way). A dab on +X must mirror onto −X.
  const T = 1024;
  const mesh: EditMesh = {
    verts: [
      [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1],     // +X face (0..3)
      [-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1],  // −X face (4..7)
    ],
    faces: [
      { loop: [0, 1, 2, 3], uv: [[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4]] },
      { loop: [4, 5, 6, 7], uv: [[0.5, 0], [0.9, 0], [0.9, 0.4], [0.5, 0.4]] },
    ],
  };
  const targets: PaintTarget[] = [{ partId: 'p', mesh, lift: 0 }];
  // paint at world (1, 0.5, -0.5): UV (0.3,0.1) on island A → texel (307.2, 102.4).
  const dabs = mirrorPaintDabs(targets, 0.3 * T, 0.1 * T, [0], T);
  assertEqual(dabs.length, 1, 'one mirror image across a single plane');
  // its reflection (−1,0.5,−0.5) is UV (0.8,0.1) on island B → texel (819.2, 102.4).
  assert(nearly(dabs[0].x, 0.8 * T, 0.5) && nearly(dabs[0].y, 0.1 * T, 0.5), 'mirror dab lands on the −X island at the symmetric texel');
  assert(!!dabs[0].clip && dabs[0].clip!.x0 >= 0.5 * T - 1, 'the mirror dab is scissored to the −X islands clip rect');
  // a dab with no mirror plane returns nothing.
  assertEqual(mirrorPaintDabs(targets, 0.3 * T, 0.1 * T, [], T).length, 0, 'no plane → no mirror');
});

test('faceUvPerWorld is the longest-edge uv↔world scale (8u face, full-square uv → 1/8)', () => {
  const box = cuboid(8, 8, 8); // fullFaceUV: each face uv fills [0,1], world edge = 8u
  assert(nearly(faceUvPerWorld(box, 0), 1 / 8), 'upw = uvLen(1) / worldLen(8) = 0.125');
});

test('surfaceBrushDabs: a small brush on the +Z face paints ONLY that face, radiusPx world-scaled', () => {
  const box = cuboid(8, 8, 8); // origin-centred, +Z face at z=4
  const T = 1024;
  // brush radius 1u at the +Z face centre — neighbour faces are 4u away, out of reach.
  const dabs = surfaceBrushDabs(box, 0, [0, 0, 4], 1, T);
  assertEqual(dabs.length, 1, 'one face touched by a 1u brush at the face centre');
  // effR = full radius at the closest point (d=0): radiusPx = 1 * (1/8) * 1024 = 128.
  assert(nearly(dabs[0].radiusPx, 128, 0.5), 'the dab radius is the world radius mapped into this face (128px)');
});

test('surfaceBrushDabs: a brush spanning a shared EDGE paints BOTH faces — seam continuity (req_1580)', () => {
  const box = cuboid(8, 8, 8); // +Z face at z=4, +X face at x=4, sharing the x=4,z=4 edge
  const T = 1024;
  const near = [3.5, 0, 4]; // on +Z, 0.5u from the +X face plane
  assertEqual(surfaceBrushDabs(box, 0, near, 0.3, T).length, 1, 'a 0.3u brush stays on the +Z face (edge is 0.5u away)');
  const both = surfaceBrushDabs(box, 0, near, 1.0, T);
  assert(both.length >= 2, 'a 1.0u brush reaches across the 0.5u-distant edge onto the +X face too');
  // each dab carries its source faceIndex (req_1611: lock-face filters on it to contain
  // a stroke to the one face under the cursor) — and the two faces here are distinct.
  assertEqual(new Set(both.map((d) => d.faceIndex)).size, both.length, 'each dab names a distinct face');
});

test('surfaceBrushDabs: lift shifts the surface — a brush below the lifted face misses', () => {
  const box = cuboid(8, 8, 8);
  const T = 1024;
  // the +Z face lifted by 100u sits far from a world point at the un-lifted height.
  assertEqual(surfaceBrushDabs(box, 100, [0, 0, 4], 1, T).length, 0, 'no face within reach once lifted away');
  assert(surfaceBrushDabs(box, 100, [0, 100, 4], 1, T).length >= 1, 'reaches the face at its lifted height');
});

finish('meshPaint');
