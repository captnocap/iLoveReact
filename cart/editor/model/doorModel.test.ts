// cart/editor/model/doorModel.test.ts — named door-part compiler boundary.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/model/doorModel.test.ts --bundle \
//     --outfile=/tmp/editor-door-model.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-door-model.test.js
import { compileDoorMesh, resolveDoorLeafPart } from './doorModel';
import type { MeshDocPartMeta, PackageMeshDoc } from '../data/meshDoc';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function triangle(a: [number, number, number], b: [number, number, number], c: [number, number, number]): number[] {
  const vertex = ([x, y, z]: [number, number, number]) => [x, y, z, 0, 1, 0, 0, 0];
  return [...vertex(a), ...vertex(b), ...vertex(c)];
}

const vertices = new Float32Array([
  ...triangle([-2, 0, -0.2], [-1, 0, 0.2], [-1, 3, 0.2]), // left frame group 0
  ...triangle([-1, 0, -0.05], [1, 0, 0.05], [1, 2.2, 0.05]), // leaf group 2, deliberately interleaved
  ...triangle([1, 0, -0.2], [2, 0, 0.2], [2, 3, 0.2]), // right frame group 1
]);
const doc: PackageMeshDoc = {
  vertices,
  faceGroups: new Uint32Array([0, 2, 1]),
  ranges: [{ lo: 0, hi: 2 }, { lo: 2, hi: 3 }],
};
const parts: MeshDocPartMeta[] = [
  { name: 'Door Frame', color: '#aaa', visible: true },
  { name: 'front DOOR carved LEAF', color: '#222', visible: true },
];

test('the leaf name contract is explicit, visible, and unique', () => {
  assert(resolveDoorLeafPart(parts).ok, 'valid Door Leaf was rejected');
  assert(!resolveDoorLeafPart([{ name: 'Door Frame', visible: true }]).ok, 'missing leaf passed');
  assert(!resolveDoorLeafPart([{ name: 'Door Leaf', visible: false }]).ok, 'hidden leaf passed');
  assert(!resolveDoorLeafPart([
    { name: 'Door Leaf', visible: true },
    { name: 'Door Glass Leaf', visible: true },
  ]).ok, 'two semantic leaves passed');
});

test('compiler moves interleaved leaf triangles into one trailing vertex slot', () => {
  const result = compileDoorMesh(vertices, doc, parts);
  assert(result.ok, result.ok ? '' : result.error);
  if (!result.ok) return;
  assert(result.mesh.leaf.start === 6, `leaf starts at vertex ${result.mesh.leaf.start}, expected 6`);
  assert(result.mesh.leaf.count === 3, `leaf count ${result.mesh.leaf.count}, expected 3`);
  assert(result.mesh.vertices[0] === -2, 'first frame triangle moved incorrectly');
  assert(result.mesh.vertices[24] === 1, 'second frame triangle did not compact before leaf');
  assert(result.mesh.vertices[48] === -1, 'leaf triangle is not trailing');
  assert(result.mesh.collisionBoxes.length === 3, `door frame should compile as two jambs + lintel, got ${result.mesh.collisionBoxes.length}`);
  const groundBands = result.mesh.collisionBoxes.filter((box) => box.minY === 0 && box.maxY > 2);
  assert(groundBands.length === 2, 'door aperture was sealed instead of leaving two ground-level jambs');
});

test('compiler keeps Studio glass as a separate trailing leaf slot', () => {
  const glassVertices = new Float32Array([
    ...triangle([-2, 0, -0.2], [-1, 0, 0.2], [-1, 3, 0.2]),
    ...triangle([1, 0, -0.2], [2, 0, 0.2], [2, 3, 0.2]),
    ...triangle([-1, 0, -0.05], [1, 0, 0.05], [1, 2.2, 0.05]), // opaque leaf
    ...triangle([-0.5, 1, -0.051], [0.5, 1, -0.051], [0.5, 1.7, -0.051]), // glass window
  ]);
  const glassDoc: PackageMeshDoc = {
    vertices: glassVertices,
    faceGroups: new Uint32Array([0, 1, 2, 2]),
    ranges: [{ lo: 0, hi: 2 }, { lo: 2, hi: 3 }],
    glassFirstVertex: 9,
  };
  const result = compileDoorMesh(glassVertices, glassDoc, parts);
  assert(result.ok, result.ok ? '' : result.error);
  if (!result.ok) return;
  assert(result.mesh.leaf.start === 6 && result.mesh.leaf.count === 6, 'combined leaf range changed');
  assert(result.mesh.leafGlass?.start === 9 && result.mesh.leafGlass.count === 3, 'glass window did not become the final leaf slot');
});

test('compiler rejects an all-leaf model because a door also needs a static frame', () => {
  const onlyLeaf: PackageMeshDoc = {
    vertices: new Float32Array(triangle([-1, 0, -0.05], [1, 0, 0.05], [1, 2, 0.05])),
    faceGroups: new Uint32Array([0]),
    ranges: [{ lo: 0, hi: 1 }],
  };
  const result = compileDoorMesh(onlyLeaf.vertices, onlyLeaf, [{ name: 'Door Leaf', color: '#222', visible: true }]);
  assert(!result.ok, 'all-leaf model compiled without a frame');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
