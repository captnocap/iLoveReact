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
  paintLayoutConflictIsVacuous,
  paintLayoutConflictRevision,
  paintLayoutConflictRevisionIsAcknowledged,
  paintLayoutKeepLiveClearsSemantics,
  paintLayoutMismatchSentence,
  modelRevisionKeepLiveOptions,
  modelRevisionMismatchSentence,
  modelRevisionPartConflict,
  type PaintLayoutDiskFacts,
} from './paintLayoutConflict';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const disk = (variants: PaintLayoutDiskFacts['variants']): PaintLayoutDiskFacts => ({
  packageDir: '/models/example',
  doc: { bytes: 81099, modifiedMs: 1, stamp: '81099:1', triangles: 961, authoredFaces: 600, parts: 4 },
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

test('part-count conflict names the deletion and mints only its disclosed capability', () => {
  const facts = disk([]);
  const reason = { kind: 'part-count' as const, liveParts: 3, diskParts: 4 };
  assert(
    modelRevisionMismatchSentence(1167, facts, null, reason) === 'The live model has 3 parts; the saved model has 4. Keep LIVE removes 1 saved part.',
    'the guarded part deletion was not explained plainly',
  );
  const options = modelRevisionKeepLiveOptions({ namedFaces: 1 }, facts, reason);
  assert(options.allowPartShrink === true, 'Keep LIVE did not authorize the disclosed part shrink');
  assert(options.allowSemanticClear === false, 'an unrelated semantic clear was authorized');
  assert(modelRevisionPartConflict(3, 4, false)?.kind === 'part-count', 'the guarded shrink did not open a conflict');
  assert(modelRevisionPartConflict(3, 4, true) === null, 'a real Delete/Merge capability was prompted again');
  assert(modelRevisionPartConflict(4, 4, false) === null, 'equal part counts were treated as destructive');
});

test('an acknowledged disk checkpoint remains resolved until disk actually changes', () => {
  const facts = disk([]);
  const revision = paintLayoutConflictRevision(facts);
  assert(revision === '81099:1', 'the stale marker did not define the conflict revision');
  assert(
    paintLayoutConflictRevisionIsAcknowledged(revision, facts),
    'the checkpoint chosen by the user was immediately forgotten',
  );
  assert(
    paintLayoutConflictRevision({ ...facts, marker: null }) === revision,
    'remaking the atlas made the same saved document look like a new conflict',
  );
  assert(
    !paintLayoutConflictRevisionIsAcknowledged(revision, {
      ...facts,
      marker: { ...facts.marker!, docStamp: '85543:2' },
    }),
    'an actual disk revision change reused the old acknowledgement',
  );
});

test('a never-painted package raises no paint-layout conflict (req_3956)', () => {
  const painted = disk([{ id: '1', name: 'Painting 1', triangles: 1019 }]);
  assert(!paintLayoutConflictIsVacuous(painted), 'a package with real paint was called vacuous');
  assert(
    !paintLayoutConflictIsVacuous({ ...painted, basePaint: null }),
    'a package whose variants survive was called vacuous',
  );
  // The exact state every agent-built model lands in: structural edits set the
  // stale marker, but no era was ever painted — the picker's own DISK panel says
  // "No readable base paint or variants". There is nothing to arbitrate.
  assert(
    paintLayoutConflictIsVacuous({ ...painted, basePaint: null, variants: [] }),
    'an unpainted package still claimed a paint conflict',
  );
  assert(paintLayoutConflictIsVacuous(null), 'a package with no readable disk facts claimed a paint conflict');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
