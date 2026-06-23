// mountSurfaces behavior (P4, req_1687) — the flat layers a model can hold a prop
// on, read off the cooked mesh: up-faces cluster into levels, side/under faces and
// slivers drop out. A shelf's three boards must come back as three surface Ys so
// point-and-place can land a prop on the layer under the crosshair.

import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';
import { horizontalSurfacesFromMesh } from './mountSurfaces';

// One up-facing quad (two tris, 6 verts) at height y, spanning a 1×0.5 board.
// 8 floats/vertex: pos3 nrm3 uv2 — only ny matters for the scan.
function board(y: number, ny: number): number[] {
  const w = 0.5, d = 0.25; // half-extents → a 1.0 × 0.5 top, area 0.5 m²
  const corners = [
    [-w, -d], [w, -d], [w, d],
    [-w, -d], [w, d], [-w, d],
  ];
  const out: number[] = [];
  for (const [x, z] of corners) out.push(x, y, z, 0, ny, 0, 0, 0);
  return out;
}

test('three shelf boards → three surface levels, low to high', () => {
  const verts = new Float32Array([...board(0.5, 1), ...board(1.0, 1), ...board(1.5, 1)]);
  const s = horizontalSurfacesFromMesh(verts);
  assertEqual(s.length, 3, 'one surface per board');
  assertClose(s[0].y, 0.5, 1e-6, 'lowest board');
  assertClose(s[1].y, 1.0, 1e-6, 'middle board');
  assertClose(s[2].y, 1.5, 1e-6, 'top board');
});

test('side and under faces never count as surfaces', () => {
  // a down-facing board (ny=-1) and a vertical face (ny=0) at the same height
  const verts = new Float32Array([...board(1.0, 1), ...board(1.0, -1), ...board(2.0, 0)]);
  const s = horizontalSurfacesFromMesh(verts);
  assertEqual(s.length, 1, 'only the up-face board is a surface');
  assertClose(s[0].y, 1.0, 1e-6, 'the up face');
});

test('a sliver (tiny top) is dropped, a real board is kept', () => {
  const sliver: number[] = [];
  for (const [x, z] of [[-0.01, -0.01], [0.01, -0.01], [0.01, 0.01], [-0.01, -0.01], [0.01, 0.01], [-0.01, 0.01]]) {
    sliver.push(x, 0.8, z, 0, 1, 0, 0, 0); // ~0.0004 m² — below the area floor
  }
  const verts = new Float32Array([...board(0.5, 1), ...sliver]);
  const s = horizontalSurfacesFromMesh(verts);
  assertEqual(s.length, 1, 'the sliver is not a standable layer');
  assertClose(s[0].y, 0.5, 1e-6, 'the real board survives');
});

test('verts of one board within the merge window collapse to one level', () => {
  // boards 0.51 and 0.49 are < 6cm apart → one surface, mean ~0.5
  const verts = new Float32Array([...board(0.49, 1), ...board(0.51, 1)]);
  const s = horizontalSurfacesFromMesh(verts);
  assertEqual(s.length, 1, 'near-coplanar faces are one level');
  assert(Math.abs(s[0].y - 0.5) < 0.02, 'level centers on its verts');
});

test('a model with no flat tops yields no surfaces', () => {
  const verts = new Float32Array([...board(1.0, 0.2), ...board(2.0, -0.9)]); // all steep/under
  assertEqual(horizontalSurfacesFromMesh(verts).length, 0, 'nothing to stand on');
});

finish('mountSurfaces');
