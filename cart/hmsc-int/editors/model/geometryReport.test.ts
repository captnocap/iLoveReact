// geometryReport.test.ts — pins the dashboard geometry census math (req_1874):
// the soup census (8 floats/vertex, edges = tris*3) and the EditMesh census
// (shared verts, n-gon fan to triangles, unique edges). Pure + headless — the
// store-walking reportAssetGeometry() is verified live in `rjit dev`.

import { assertEqual, finish, test } from '../../game/_testkit';
import { cuboid } from './editMesh';
import { editMeshTotals, meshBlobTotals } from './geometryReport';

test('editMeshTotals: a cuboid is 8 verts, 12 tris (6 quads fanned), 12 edges', () => {
  const box = cuboid(2, 2, 2);
  const t = editMeshTotals(box);
  assertEqual(t.meshes, 1, 'one mesh');
  assertEqual(t.vertices, 8, 'cuboid shared verts');
  assertEqual(t.triangles, 12, 'six quads → 6*(4-2) = 12 triangles');
  assertEqual(t.edges, 12, 'cuboid unique edges');
});

test('meshBlobTotals: a soup of N 8-float verts is N verts, N/3 tris, tris*3 edges', () => {
  // 6 vertices = 2 triangles. 6 verts * 8 floats = 48 floats.
  const soup = new Float32Array(6 * 8);
  const t = meshBlobTotals(soup);
  assertEqual(t.meshes, 1, 'one mesh');
  assertEqual(t.vertices, 6, 'soup vertex count = floats / 8');
  assertEqual(t.triangles, 2, 'soup triangles = verts / 3');
  assertEqual(t.edges, 6, 'soup edges = triangles * 3 (no shared edges)');
});

test('meshBlobTotals: an empty soup is all zeros', () => {
  const t = meshBlobTotals(new Float32Array(0));
  assertEqual(t.vertices, 0, 'no verts');
  assertEqual(t.triangles, 0, 'no tris');
  assertEqual(t.edges, 0, 'no edges');
});

finish();
