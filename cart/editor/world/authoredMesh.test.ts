// cart/editor/world/authoredMesh.test.ts — export-time mesh replacement also
// replaces every derived bound used by ghosts, selection, and hit testing.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/authoredMesh.test.ts --bundle \
//     --outfile=/tmp/editor-authored-mesh.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-authored-mesh.test.js

import { authoredMeshBounds, cacheAuthoredMesh } from './authoredMesh';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

const vertex = (x: number, y: number, z: number) => [x, y, z, 0, 1, 0, 0, 0];

test('re-exporting one model invalidates its previous wireframe bounds', () => {
  const modelId = 'test:bounds-revision';
  cacheAuthoredMesh(modelId, new Float32Array([
    ...vertex(-1, 0, -1),
    ...vertex(1, 0, -1),
    ...vertex(0, 2, 1),
  ]));
  const first = authoredMeshBounds(modelId);
  assert(first?.minX === -1 && first.maxX === 1 && first.maxY === 2, 'initial bounds were not measured');

  cacheAuthoredMesh(modelId, new Float32Array([
    ...vertex(-5, 3, -4),
    ...vertex(7, 3, -4),
    ...vertex(0, 12, 6),
  ]));
  const replaced = authoredMeshBounds(modelId);
  assert(replaced?.minX === -5 && replaced.maxX === 7, 'x bounds came from the previous export');
  assert(replaced?.minY === 0 && replaced.maxY === 9, 'ground-rebased y bounds came from the previous export');
  assert(replaced?.minZ === -4 && replaced.maxZ === 6, 'z bounds came from the previous export');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
