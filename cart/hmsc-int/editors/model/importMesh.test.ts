// importMesh.test.ts — pins the GLB/triangle-soup -> Studio EditMesh bridge
// (req_1383): welding, degenerate-drop, and that the result unwraps so every face
// carries a uv (the pixel painter's hard requirement).

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { trianglesToEditMesh, glbToTriangles, objToTriangles, objToEditMesh, base64ToBytes, type RawTriangles } from './importMesh';
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

finish('importMesh');
