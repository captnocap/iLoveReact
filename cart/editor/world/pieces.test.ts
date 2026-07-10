// cart/editor/world/pieces.test.ts — drag-run placement follows semantic kind,
// including build pieces exported from the model editor.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/pieces.test.ts --bundle \
//     --outfile=/tmp/editor-pieces.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-pieces.test.js

import { setAuthoredPieces } from './authoredRegistry';
import { resolveRunPlacements, supportsRunPlacement } from './pieces';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

setAuthoredPieces([
  { id: 'model:exported-wall', modelId: 'exported-wall', pkgId: 'studio:wall', label: 'Exported Wall', kind: 'wall', hex: '#888888' },
  { id: 'model:exported-floor', modelId: 'exported-floor', pkgId: 'studio:floor', label: 'Exported Floor', kind: 'floor', hex: '#777777' },
  { id: 'prop:exported-chair', modelId: 'exported-chair', pkgId: 'studio:chair', label: 'Exported Chair', kind: 'prop', hex: '#666666' },
]);

test('exported wall inherits wall drag-run placement', () => {
  assert(supportsRunPlacement('model:exported-wall'), 'exported wall is runnable');
  const run = resolveRunPlacements('model:exported-wall', 1.5, 0, 10.5, 0, 0);
  assert(run.length === 4, `four wall modules placed, got ${run.length}`);
  assert(run.every((piece) => piece.pieceId === 'model:exported-wall'), 'every module keeps the exported piece id');
  assert(run.every((piece) => piece.z === 0 && piece.yawDegrees === 0), 'wall run follows one snapped edge');
});

test('exported floor inherits rectangular area placement', () => {
  assert(supportsRunPlacement('model:exported-floor'), 'exported floor is runnable');
  const run = resolveRunPlacements('model:exported-floor', 1.5, 1.5, 7.5, 4.5, 0);
  assert(run.length === 6, `3×2 floor area placed, got ${run.length}`);
  assert(run.every((piece) => piece.pieceId === 'model:exported-floor'), 'every cell keeps the exported piece id');
});

test('exported prop remains a single free placement', () => {
  assert(!supportsRunPlacement('prop:exported-chair'), 'exported prop is not runnable');
  const run = resolveRunPlacements('prop:exported-chair', 1, 2, 8.25, 9.75, 0);
  assert(run.length === 1, `one prop placed, got ${run.length}`);
  assert(run[0]?.x === 8.25 && run[0]?.z === 9.75, 'prop lands at the cursor without grid tiling');
});

setAuthoredPieces([]);
log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
