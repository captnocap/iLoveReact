// importMesh.test.ts — pins the GLB/triangle-soup -> Studio EditMesh bridge
// (req_1383): welding, degenerate-drop, and that the result unwraps so every face
// carries a uv (the pixel painter's hard requirement).

import { assert, assertEqual, assertThrows, finish, test } from '../../game/_testkit';
import { trianglesToEditMesh, glbToTriangles, objToTriangles, objToEditMesh, base64ToBytes, objToSoup, decimateSoup, soupToEditMesh, soupTriCount, gridForTargetTris, MAX_IMPORT_TRIS, type RawTriangles } from './importMesh';
import { unwrap, type V3 } from './editMesh';

test('welds coincident positions and makes one face per triangle', () => {
  // Two triangles sharing an edge, given as 6 separate (un-indexed) verts.
  const verts: V3[] = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], // tri A
    [1, 0, 0], [1, 1, 0], [0, 1, 0], // tri B (shares the (1,0,0)-(0,1,0) edge)
  ];
  const raw: RawTriangles = { verts, tris: [[0, 1, 2], [3, 4, 5]] };
  const m = trianglesToEditMesh(raw);
  assertEqual(m.verts.length, 4, 'shared edge welds 6 -> 4 verts');
  assertEqual(m.faces.length, 2, 'two triangles -> two faces');
  for (const f of m.faces) assertEqual(f.loop.length, 3, 'each face is a triangle');
});

test('drops triangles that collapse to a degenerate after welding', () => {
  const verts: V3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1e-9]];
  // tri 0,1,2 is fine; tri 0,3,1 collapses (0 and 3 weld together).
  const m = trianglesToEditMesh({ verts, tris: [[0, 1, 2], [0, 3, 1]] });
  assertEqual(m.faces.length, 1, 'the degenerate triangle is dropped');
});

test('unwrap gives every imported face a uv (painter requirement)', () => {
  const verts: V3[] = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0],
    [1, 0, 0], [1, 1, 0], [0, 1, 0],
  ];
  const m = unwrap(trianglesToEditMesh({ verts, tris: [[0, 1, 2], [3, 4, 5]] }));
  for (const f of m.faces) {
    assert(!!f.uv && f.uv.length === f.loop.length, 'unwrapped face has a uv per corner');
  }
});

test('base64ToBytes round-trips the GLB magic header', () => {
  // "glTF" = 0x67 0x6c 0x54 0x46 ; base64 of those 4 bytes is "Z2xURg=="
  const bytes = base64ToBytes('Z2xURg==');
  assertEqual(bytes.length, 4, 'four bytes decoded');
  assertEqual(String.fromCharCode(...bytes), 'glTF', 'decodes to the glTF magic');
});

test('glbToTriangles rejects non-GLB bytes cleanly', () => {
  let threw = false;
  try { glbToTriangles(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])); } catch { threw = true; }
  assert(threw, 'garbage bytes throw rather than silently returning empty');
});

test('parses an OBJ quad into welded triangles', () => {
  // a unit quad as two triangles sharing an edge, 1-based indices, with vt/vn refs.
  const obj = [
    'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
    'vt 0 0', 'vn 0 0 1',
    'f 1/1/1 2/1/1 3/1/1',
    'f 1/1/1 3/1/1 4/1/1',
  ].join('\n');
  const raw = objToTriangles(obj);
  assertEqual(raw.verts.length, 4, '4 OBJ verts');
  assertEqual(raw.tris.length, 2, '2 triangles');
  const m = objToEditMesh(obj);
  assertEqual(m.faces.length, 2, 'two faces after weld');
  for (const f of m.faces) assert(!!f.uv && f.uv.length === 3, 'OBJ import unwraps -> paintable');
});

// ── req_2078: big-mesh path (soup → decimate → guard) ─────────────────────────

// An n×n vertex grid → (n-1)²·2 triangles, with a little z relief so clustering
// has something to average.
function gridSoup(n: number) {
  const positions = new Float32Array(n * n * 3);
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
    const i = y * n + x;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = x * 0.01 + y * 0.02;
  }
  const idx: number[] = [];
  for (let y = 0; y < n - 1; y += 1) for (let x = 0; x < n - 1; x += 1) {
    const a = y * n + x, b = y * n + x + 1, c = (y + 1) * n + x, d = (y + 1) * n + x + 1;
    idx.push(a, b, c, b, d, c);
  }
  return { positions, indices: Uint32Array.from(idx) };
}

// `tris` independent (non-shared, non-degenerate) triangles — to push past budget.
function looseSoup(tris: number) {
  const positions = new Float32Array(tris * 9);
  const indices = new Uint32Array(tris * 3);
  for (let t = 0; t < tris; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const v = t * 3 + k;
      positions[v * 3] = t + (k === 1 ? 1 : 0);
      positions[v * 3 + 1] = k === 2 ? 1 : 0;
      positions[v * 3 + 2] = t * 0.5;
      indices[t * 3 + k] = v;
    }
  }
  return { positions, indices };
}

test('decimateSoup shrinks a dense mesh (the import Detail knob)', () => {
  const soup = gridSoup(40); // 3042 tris, 1600 verts
  const full = soupTriCount(soup);
  const coarse = decimateSoup(soup, 8);
  assert(soupTriCount(coarse) < full, 'coarse grid drops triangles');
  assert(coarse.positions.length / 3 < soup.positions.length / 3, 'coarse grid welds verts');
  // Finer grid keeps more detail than a coarser one.
  assert(soupTriCount(decimateSoup(soup, 32)) >= soupTriCount(coarse), 'finer grid keeps more');
});

test('gridForTargetTris lands at or under the requested budget', () => {
  const soup = gridSoup(60); // 6962 tris
  const target = 1500;
  const g = gridForTargetTris(soup, target);
  assert(soupTriCount(decimateSoup(soup, g)) <= target, 'seeded grid respects the target');
});

test('soupToEditMesh imports a small mesh and is paintable after unwrap', () => {
  const m = unwrap(soupToEditMesh(looseSoup(10)));
  assertEqual(m.faces.length, 10, 'ten loose triangles → ten faces');
  for (const f of m.faces) assert(!!f.uv && f.uv.length === 3, 'unwrapped face has a uv');
});

test('soupToEditMesh GUARDS the import budget instead of OOMing', () => {
  assertThrows(() => soupToEditMesh(looseSoup(MAX_IMPORT_TRIS + 1)), 'over-budget soup throws a clean error');
});

test('objToSoup matches the RawTriangles parse', () => {
  const obj = ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'f 1 2 3', 'f 1 3 4'].join('\n');
  const soup = objToSoup(obj);
  assertEqual(soupTriCount(soup), 2, 'two triangles from the quad');
  assertEqual(soup.positions.length / 3, 4, 'four verts');
});

finish('importMesh');
