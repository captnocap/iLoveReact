// Headless parity tests for the indexed loop-cut walk.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/model/editMesh.test.ts --bundle \
//     --outfile=/tmp/editor-edit-mesh.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit/geometries=$ROOT/runtime/geometries \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-edit-mesh.test.js

import { loopCutFromFace, type EditMesh, type V3 } from './editMesh';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

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
  assert(xs.some((x) => Math.abs(x - 0.79166667) < 1e-6), `missing recursive far cut: ${xs.join(', ')}`);
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
