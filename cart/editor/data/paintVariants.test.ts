// cart/editor/data/paintVariants.test.ts — paint skins carry UV/paint while the
// current model remains the single geometry authority.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/paintVariants.test.ts --bundle \
//     --outfile=/tmp/editor-paint-variants.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-paint-variants.test.js

import {
  bindPaintSkinToCurrentMesh,
  paintSkinFitsCurrentMesh,
  PAINT_MESH_VERTEX_BYTES,
} from './paintVariants';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

const vertex = (x: number, nx: number, u: number, v: number) => [x, x + 1, x + 2, nx, nx + 1, nx + 2, u, v];

test('a saved skin contributes UVs but never its stale positions or normals', () => {
  const current = new Float32Array([
    ...vertex(10, 20, 0.1, 0.2),
    ...vertex(30, 40, 0.3, 0.4),
    ...vertex(50, 60, 0.5, 0.6),
  ]);
  const savedSkin = new Float32Array([
    ...vertex(-10, -20, 0.7, 0.8),
    ...vertex(-30, -40, 0.9, 1.0),
    ...vertex(-50, -60, 0.11, 0.12),
  ]);
  const bound = bindPaintSkinToCurrentMesh(current, savedSkin);
  assert(bound !== null, 'same-cardinality skin should bind');
  for (let i = 0; i < current.length; i += 8) {
    for (let field = 0; field < 6; field += 1) {
      assert(bound![i + field] === current[i + field], `geometry field ${field} came from stale skin`);
    }
    assert(bound![i + 6] === savedSkin[i + 6], 'u did not come from saved skin');
    assert(bound![i + 7] === savedSkin[i + 7], 'v did not come from saved skin');
  }
});

test('a topology-changing skin cannot bind to the current model', () => {
  const current = new Float32Array(3 * 8);
  const stale = new Float32Array(6 * 8);
  assert(bindPaintSkinToCurrentMesh(current, stale) === null, 'different vertex counts must refuse');
  assert(!paintSkinFitsCurrentMesh(current.byteLength, stale.byteLength), 'stale skin must leave the palette');
});

test('a well-formed legacy skin remains usable until a base mesh exists', () => {
  const triangleBytes = 3 * PAINT_MESH_VERTEX_BYTES;
  assert(paintSkinFitsCurrentMesh(null, triangleBytes), 'legacy skin should remain reachable');
  assert(!paintSkinFitsCurrentMesh(null, triangleBytes - 1), 'partial vertex data must refuse');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
