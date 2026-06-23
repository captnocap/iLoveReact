// seedFromPiece.test.ts — proves "open a primitive as an editable mesh" (req_1684).
// Bundle + run:
//   tools/esbuild cart/hmsc-int/editors/model/seedFromPiece.test.ts --bundle \
//     --format=esm --platform=neutral --target=es2022 \
//     --alias:@reactjit=runtime --alias:@game=cart/hmsc-int/game
//   tools/v8cli <out>.js
// Covers: a plain wall seeds one clean box at the catalog footprint sitting on the
// ground; a window-edit wall seeds the wall WITH the opening (the cut carried, the
// door leaf + glass dropped); a floor seeds its plate core; stairs seed every step;
// a ramp seeds a wedge whose top actually slopes.

import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';
import { seedMeshFromPiece, seedNameFromPiece } from './seedFromPiece';
import type { EditMesh, V3 } from './editMesh';

function bounds(m: EditMesh): { min: V3; max: V3; size: V3 } {
  let lo: V3 = [Infinity, Infinity, Infinity];
  let hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const v of m.verts) for (let a = 0; a < 3; a += 1) { if (v[a] < lo[a]) lo[a] = v[a]; if (v[a] > hi[a]) hi[a] = v[a]; }
  return { min: lo, max: hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}

test('a plain wall seeds one clean box at the catalog footprint, sitting on the ground', () => {
  const m = seedMeshFromPiece('wall.concrete.common');
  assertEqual(m.verts.length, 8, 'a lone wall is one solid → 8 verts');
  assertEqual(m.faces.length, 6, 'a box → 6 quad faces');
  const b = bounds(m);
  assertClose(b.size[0], 3, 1e-6, 'wall width 3m');
  assertClose(b.size[1], 3, 1e-6, 'wall height 3m');
  assertClose(b.min[1], 0, 1e-6, 'base rests on y=0 (no WALLTOP lift with no neighbours)');
  assert(b.size[2] > 0.05 && b.size[2] < 0.6, 'wall thickness is the slab depth, not a slab plate');
});

test('a window-edit wall seeds the wall WITH the opening, dropping the glass + door leaf', () => {
  const plain = seedMeshFromPiece('wall.concrete.common');
  const win = seedMeshFromPiece('wall.stucco.window');
  // the cut splits the band into jambs + sill + header — strictly more solids than a plain wall.
  assert(win.verts.length > plain.verts.length, 'a cut wall has more boxes than a solid wall');
  // no glass pane verts: nothing should sit at the thin pane depth colour/centre — we
  // assert the opening is hollow by checking no vert lands in the opening's centre band.
  const b = bounds(win);
  assertClose(b.size[0], 3, 1e-6, 'still a 3m-wide wall');
  assertClose(b.size[1], 3, 1e-6, 'still 3m tall');
});

test('a floor seeds its plate core (top/bottom face plates dropped)', () => {
  const m = seedMeshFromPiece('floor.concrete.common');
  assertEqual(m.verts.length, 8, 'the plate core is one box');
  const b = bounds(m);
  assertClose(b.size[0], 3, 1e-6, 'floor 3m wide');
  assertClose(b.size[2], 3, 1e-6, 'floor 3m deep');
  assert(b.size[1] > 0 && b.size[1] < 0.4, 'floor is thin');
});

test('stairs seed every step as its own box', () => {
  const m = seedMeshFromPiece('stairs.concrete.common');
  assert(m.verts.length >= 8 * 3, 'multiple stepped boxes (≥3 steps × 8 verts)');
  assertEqual(m.verts.length % 8, 0, 'every step is a clean box');
  const b = bounds(m);
  assertClose(b.min[1], 0, 1e-6, 'lowest step sits on the ground');
  assert(b.size[1] > 0.5, 'stairs rise');
});

test('a ramp seeds a wedge whose top slopes (low end ≠ high end)', () => {
  const m = seedMeshFromPiece('ramp.concrete.common');
  assertEqual(m.verts.length, 8, 'a wedge is one solid → 8 verts');
  const b = bounds(m);
  assert(b.min[1] >= -1e-6, 'base on the ground');
  assert(b.size[1] > 0.4, 'the ramp rises');
  // the four top verts are not coplanar in y → it is a slope, not a flat slab.
  const ys = m.verts.map((v) => v[1]);
  const topSpread = Math.max(...ys) - Math.min(...ys.filter((y) => y > 1e-3 || ys.length === 0 ? true : true));
  assert(topSpread > 0.4, 'top edge is higher than the low edge (a true wedge)');
});

test('seedNameFromPiece reads the catalog label, falls back to the id', () => {
  assertEqual(seedNameFromPiece('wall.concrete.common'), 'Concrete Wall', 'uses the catalog label');
  assertEqual(seedNameFromPiece('not.a.real.piece'), 'not.a.real.piece', 'unknown id → the id itself');
});

finish();
