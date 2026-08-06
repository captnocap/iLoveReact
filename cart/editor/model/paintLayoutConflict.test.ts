// Paint-layout conflict facts stay human-readable and topology-exact.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/model/paintLayoutConflict.test.ts --bundle \
//     --outfile=/tmp/editor-paint-layout-conflict.test.js --format=iife \
//     --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-paint-layout-conflict.test.js

import {
  paintEraTriangleCount,
  paintLayoutKeepLiveClearsSemantics,
  paintLayoutMismatchSentence,
  type PaintLayoutDiskFacts,
} from './paintLayoutConflict';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const disk = (variants: PaintLayoutDiskFacts['variants']): PaintLayoutDiskFacts => ({
  packageDir: '/models/example',
  doc: { bytes: 81099, modifiedMs: 1, stamp: '81099:1', triangles: 961, authoredFaces: 600 },
  semantics: { namedFaces: 8, regions: [{ name: 'headrest_mount_left', faces: 8 }] },
  basePaint: { id: null, name: 'Base painting', triangles: 1019 },
  variants,
  marker: { reason: 'topology-changed', docStamp: '81099:1' },
});

test('six UV floats describe one painted triangle', () => {
  assert(paintEraTriangleCount([0, 0, 1, 0, 1, 1]) === 1, 'one triangle was miscounted');
  assert(paintEraTriangleCount([0, 0, 1]) === null, 'partial UV geometry was treated as a paint era');
});

test('the requested painting owns the mismatch sentence', () => {
  const facts = disk([
    { id: '1', name: 'Painting 1', triangles: 2382 },
    { id: '2', name: 'Painting 2', triangles: 1019 },
  ]);
  assert(
    paintLayoutMismatchSentence(961, facts, '2') === 'Painting 2 fits a 1019-triangle shape; the live mesh is 961 triangles.',
    'the concrete mismatch was not named',
  );
});

test('same cardinality still explains face-layout staleness honestly', () => {
  const facts = disk([{ id: '2', name: 'Painting 2', triangles: 961 }]);
  assert(
    paintLayoutMismatchSentence(961, facts, '2').includes('paint mapping differs'),
    'same-count topology drift was presented as compatible',
  );
});

test('Keep LIVE recognizes the disclosed removal of disk-only names', () => {
  const facts = disk([]);
  assert(
    paintLayoutKeepLiveClearsSemantics({ namedFaces: 0 }, facts),
    'an empty live table did not recognize the named disk state it will replace',
  );
  assert(
    !paintLayoutKeepLiveClearsSemantics({ namedFaces: 1 }, facts),
    'a resident named state was mistaken for a semantic clear',
  );
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
