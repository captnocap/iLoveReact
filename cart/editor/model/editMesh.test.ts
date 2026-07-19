// Headless parity tests for the indexed loop-cut walk.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/model/editMesh.test.ts --bundle \
//     --outfile=/tmp/editor-edit-mesh.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit/geometries=$ROOT/runtime/geometries \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-edit-mesh.test.js

import { cylinder, editMeshToGeometry, loopCutFromFace, mirrorMesh, symmetrize, type EditMesh, type V3 } from './editMesh';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
function faceNormalMagnitude(mesh: EditMesh, loop: number[]): number {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = mesh.verts[loop[i]], b = mesh.verts[loop[(i + 1) % loop.length]];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return Math.hypot(nx, ny, nz);
}

function renderedQuadDiagonal(mesh: EditMesh, faceIndex: number): V3[] {
  const face = mesh.faces[faceIndex];
  const geometry = editMeshToGeometry(mesh, (candidate) => candidate === face);
  const counts = new Map<string, { position: V3; count: number }>();
  for (let corner = 0; corner < 6; corner += 1) {
    const at = corner * 8;
    const position: V3 = [geometry.positions[at], geometry.positions[at + 1], geometry.positions[at + 2]];
    const key = position.map((value) => value.toFixed(6)).join(',');
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { position, count: 1 });
  }
  return [...counts.values()].filter((entry) => entry.count === 2).map((entry) => entry.position);
}

const positionSetKey = (positions: V3[]) => positions
  .map((position) => position.map((value) => value.toFixed(6)).join(','))
  .sort()
  .join('|');

test('equal-length non-planar mirror quads carry the same physical diagonal', () => {
  // A square in YZ with alternating X is the exact tie that defeats "shortest
  // diagonal": both diagonals are length sqrt(8), but they produce opposite folds.
  const source: EditMesh = {
    verts: [[1, -1, -1], [2, -1, 1], [1, 1, 1], [2, 1, -1]],
    faces: [{ loop: [0, 1, 2, 3] }],
  };
  const sourceDiagonal = renderedQuadDiagonal(source, 0);
  assert(sourceDiagonal.length === 2, `source did not lower to one diagonal: ${sourceDiagonal.length}`);

  const mirrored = mirrorMesh(source, 0);
  const mirroredDiagonal = renderedQuadDiagonal(mirrored, 0);
  const reflectedSource = sourceDiagonal.map(([x, y, z]) => [-x, y, z] as V3);
  assert(positionSetKey(mirroredDiagonal) === positionSetKey(reflectedSource),
    `mirror chose the other physical diagonal: ${positionSetKey(mirroredDiagonal)} != ${positionSetKey(reflectedSource)}`);

  const paired = symmetrize(source, 0, true);
  assert(paired.faces.length === 2, `symmetrize should emit a kept face and twin, got ${paired.faces.length}`);
  const keptDiagonal = renderedQuadDiagonal(paired, 0);
  const twinDiagonal = renderedQuadDiagonal(paired, 1);
  const reflectedKept = keptDiagonal.map(([x, y, z]) => [-x, y, z] as V3);
  assert(positionSetKey(twinDiagonal) === positionSetKey(reflectedKept),
    `symmetrize twin chose the other physical diagonal: ${positionSetKey(twinDiagonal)} != ${positionSetKey(reflectedKept)}`);
});

function taperedRing(): EditMesh {
  const bottom: V3[] = [[-4, 0, -4], [4, 0, -4], [4, 0, 4], [-4, 0, 4]];
  const top: V3[] = [[-1, 2, -1], [1, 2, -1], [1, 2, 1], [-1, 2, 1]];
  return {
    verts: [...bottom, ...top],
    faces: [0, 1, 2, 3].map((i) => ({ loop: [i, (i + 1) % 4, 4 + ((i + 1) % 4), 4 + i] })),
  };
}

test('loop cut follows the closed tapered quad ring by vertex identity', () => {
  const source = taperedRing();
  const cut = loopCutFromFace(source, { face: 0, direction: 1, cuts: 1, offset: Math.sqrt(22) / 2 });
  assert(cut.faces.length === 8, `four quads should become eight, got ${cut.faces.length}`);
  assert(cut.verts.length === 12, `the four shared ring edges should mint four vertices, got ${cut.verts.length}`);
  for (const v of cut.verts.slice(source.verts.length)) assert(v[1] === 1, `tapered cut drifted off the edge ratio: y=${v[1]}`);
  for (const face of cut.faces) assert(faceNormalMagnitude(cut, face.loop) > 1e-6, `cut emitted a crossed/degenerate face: ${face.loop.join(',')}`);
});

test('the cylinder primitive has reference fan caps that loop cut can enter', () => {
  const segments = 16;
  const source = cylinder(1, 2, segments);
  assert(source.verts.length === segments * 2 + 2, `cylinder is missing its cap centers: ${source.verts.length}`);
  assert(source.faces.length === segments * 3, `cylinder does not have side quads plus two cap fans: ${source.faces.length}`);
  assert(source.faces.slice(segments).every((face) => face.loop.length === 3), 'a cylinder cap remained an n-gon');

  // direction 1 enters the top and bottom rim edges. The reference walk splits
  // those terminal fan triangles and stops at their existing center vertices.
  const cut = loopCutFromFace(source, { face: 0, direction: 1, cuts: 1, offset: Math.sin(Math.PI / segments) });
  assert(cut.faces.length === source.faces.length + 3, `side + two cap triangles should each split once, got ${cut.faces.length}`);
  assert(cut.verts.length === source.verts.length + 2, `shared top/bottom rim cuts should mint two vertices, got ${cut.verts.length}`);
  for (const face of cut.faces) assert(faceNormalMagnitude(cut, face.loop) > 1e-6, `cap traversal emitted a degenerate face: ${face.loop.join(',')}`);
});

test('a terminal triangle is split and traversal stops there', () => {
  const mesh: EditMesh = {
    verts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0.5, 2, 0]],
    faces: [{ loop: [0, 1, 2, 3] }, { loop: [3, 2, 4] }],
  };
  const cut = loopCutFromFace(mesh, { face: 0, direction: 0, cuts: 1, offset: 0.5 });
  assert(cut.faces.length === 4, `quad + terminal tri should become four faces, got ${cut.faces.length}`);
  assert(cut.verts.length === 7, `the shared terminal edge should reuse its cut vertex, got ${cut.verts.length - mesh.verts.length}`);
});

test('a boundary is a successful partial ring, never a plane-style full slice', () => {
  const mesh: EditMesh = {
    verts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0]],
    faces: [{ loop: [0, 1, 2, 3] }, { loop: [1, 4, 5, 2] }],
  };
  const cut = loopCutFromFace(mesh, { face: 0, direction: 0, cuts: 1, offset: 0.5 });
  assert(cut.faces.length === 3, `the walk should stop at the first face boundary, got ${cut.faces.length} faces`);
  assert(cut.faces.some((face) => face.loop.includes(4) && face.loop.includes(5)), 'the unrelated neighbor was unexpectedly sliced');
});

test('direction above two uses the reference triangle edge-to-edge split', () => {
  const mesh: EditMesh = { verts: [[0, 0, 0], [2, 0, 0], [0, 2, 0]], faces: [{ loop: [0, 1, 2] }] };
  const cut = loopCutFromFace(mesh, { face: 0, direction: 3, cuts: 1, offset: 1 });
  assert(cut.faces.length === 2, `triangle should split into two faces, got ${cut.faces.length}`);
  assert(cut.faces.some((face) => face.loop.length === 4), 'direction 3 must leave the reference quad remainder');
  assert(cut.faces.some((face) => face.loop.length === 3), 'direction 3 must emit the reference terminal triangle');
});

test('multiple cuts use the reference recursive amended-offset spacing', () => {
  const mesh: EditMesh = {
    verts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
    faces: [{ loop: [0, 1, 2, 3] }],
  };
  const cut = loopCutFromFace(mesh, { face: 0, direction: 0, cuts: 2, offset: 0.25 });
  const xs = cut.verts.slice(mesh.verts.length).map((vertex) => vertex[0]);
  assert(xs.some((x) => Math.abs(x - 0.16666667) < 1e-6), `missing recursive near cut: ${xs.join(', ')}`);
  assert(xs.some((x) => Math.abs(x - 0.375) < 1e-6), `missing recursive far cut: ${xs.join(', ')}`);
});

test('a shared selected edge overrides the direction slider like the reference', () => {
  const mesh: EditMesh = {
    verts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0]],
    faces: [{ loop: [0, 1, 2, 3] }, { loop: [1, 4, 5, 2] }],
  };
  const cut = loopCutFromFace(mesh, { face: 0, direction: 0, cuts: 1, offset: 0.5, selectedFaces: [0, 1] });
  assert(cut.faces.length === 4, `both selected quads should split across their shared edge, got ${cut.faces.length}`);
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
