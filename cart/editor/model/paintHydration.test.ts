// Persisted paint hydration is a document-load operation, not a side effect of
// entering the Paint tool.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/model/paintHydration.test.ts --bundle \
//     --outfile=/tmp/editor-paint-hydration.test.js --format=iife \
//     --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-paint-hydration.test.js

import {
  hydratePersistedModelPaint,
  type PaintHydrationPort,
  type PersistedPaintSources,
} from './paintHydration';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function harness(overrides: Partial<PersistedPaintSources> = {}) {
  const calls: string[] = [];
  const sources: PersistedPaintSources = {
    stale: false,
    basePaint: null,
    readRasterBase: () => null,
    readLatestVariant: () => null,
    ...overrides,
  };
  const port: PaintHydrationPort = {
    invalidateLayout: () => { calls.push('invalidate'); },
    setDetail: (detail) => { calls.push(`detail:${detail}`); },
    importAtlas: (raster) => { calls.push(`raster:${raster.width}x${raster.height}`); return true; },
    applyLayout: (layout) => { calls.push(`layout:${Array.from(layout).join(',')}`); return true; },
    applyProgram: (program) => { calls.push(`program:${program}`); return true; },
    applyProgramOverBase: (program) => { calls.push(`over:${program}`); return true; },
    applyAtlas: (detail, data) => { calls.push(`atlas:${detail}:${data}`); return true; },
  };
  return { calls, sources, port };
}

test('a raster-backed atlas hydrates completely without activating a paint tool', () => {
  const h = harness({
    basePaint: { version: 3, detail: 64, program: 'strokes', rasterBase: true, layout: [1, 2, 30, 40] },
    readRasterBase: () => ({ width: 320, height: 180, rgba: new Uint8Array(320 * 180 * 4) }),
  });
  const result = hydratePersistedModelPaint(h.sources, h.port);
  assert(result.status === 'ready' && result.source === 'base', 'base paint did not become ready');
  assert(h.calls.join('|') === 'detail:64|raster:320x180|layout:1,2,30,40|over:strokes', `wrong restore sequence: ${h.calls.join('|')}`);
});

test('modern program paint restores its authored layout before replay', () => {
  const h = harness({
    basePaint: { version: 2, detail: 32, program: 'recipe', layout: [0, 0, 8, 8] },
  });
  const result = hydratePersistedModelPaint(h.sources, h.port);
  assert(result.status === 'ready' && result.source === 'base', 'program base did not become ready');
  assert(h.calls.join('|') === 'detail:32|layout:0,0,8,8|program:recipe', `wrong program sequence: ${h.calls.join('|')}`);
});

test('a legacy named painting is a lazy fallback for packages without a base record', () => {
  const h = harness({
    readLatestVariant: () => ({ id: '7', name: 'Painting 7', w: 64, h: 64, detail: 16, data: 'legacy', format: 'program' }),
  });
  const result = hydratePersistedModelPaint(h.sources, h.port);
  assert(result.status === 'ready' && result.source === 'variant', 'legacy variant did not become ready');
  assert(h.calls.join('|') === 'detail:16|program:legacy', `wrong legacy sequence: ${h.calls.join('|')}`);
});

test('a stale topology refuses every persisted paint source', () => {
  let variantRead = false;
  const h = harness({
    stale: true,
    basePaint: { version: 1, detail: 8, program: 'old' },
    readLatestVariant: () => { variantRead = true; return null; },
  });
  const result = hydratePersistedModelPaint(h.sources, h.port);
  assert(result.status === 'stale', 'stale topology was not reported');
  assert(h.calls.join('|') === 'invalidate', 'stale topology attempted a restore');
  assert(!variantRead, 'stale topology read a legacy paint program');
});

test('a failed persisted record is distinct from a model with no paint', () => {
  const failedHarness = harness({ basePaint: { version: 1, detail: 8, program: 'broken' } });
  failedHarness.port.applyProgram = () => false;
  assert(hydratePersistedModelPaint(failedHarness.sources, failedHarness.port).status === 'failed', 'failed record was reported missing');
  const emptyHarness = harness();
  assert(hydratePersistedModelPaint(emptyHarness.sources, emptyHarness.port).status === 'missing', 'empty model was reported failed');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
