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
  residentPaintResumeAction,
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
    applyCornerUv: (cornerUv) => { calls.push(`corners:${Array.from(cornerUv).join(',')}`); return true; },
    applyProgram: (program) => { calls.push(`program:${program}`); return true; },
    applyProgramOverBase: (program) => { calls.push(`over:${program}`); return true; },
    applyAtlas: (detail, data) => { calls.push(`atlas:${detail}:${data}`); return true; },
  };
  return { calls, sources, port };
}

test('exact UV corner geometry hydrates after the raster and before paint replay', () => {
  const h = harness({
    basePaint: {
      version: 4,
      detail: 64,
      program: 'strokes',
      rasterBase: true,
      layout: [1, 2, 30, 40],
      cornerUv: [1.25, 2.5, 12, 3, 7.75, 9],
    },
    readRasterBase: () => ({ width: 320, height: 180, rgba: new Uint8Array(320 * 180 * 4) }),
  });
  const result = hydratePersistedModelPaint(h.sources, h.port);
  assert(result.status === 'ready' && result.source === 'base', 'exact base paint did not become ready');
  assert(h.calls.join('|') === 'detail:64|raster:320x180|corners:1.25,2.5,12,3,7.75,9|over:strokes', `wrong exact restore sequence: ${h.calls.join('|')}`);
});

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

test('a full-look variant restores raster base, exact UV geometry, then strokes (req_3439)', () => {
  const h = harness({
    readLatestVariant: () => ({
      id: '2', name: 'Painting 2', w: 128, h: 64, detail: 32, data: 'strokes', format: 'program',
      rasterBase: true, cornerUv: [1, 2, 3, 4, 5, 6], basePng: 'paints/paint_2.base.png',
    }),
    readVariantRasterBase: (variant) => ({ width: variant.w, height: variant.h, rgba: new Uint8Array(variant.w * variant.h * 4) }),
  });
  const result = hydratePersistedModelPaint(h.sources, h.port);
  assert(result.status === 'ready' && result.source === 'variant', 'full-look variant did not become ready');
  assert(h.calls.join('|') === 'detail:32|raster:128x64|corners:1,2,3,4,5,6|over:strokes', `wrong full-look sequence: ${h.calls.join('|')}`);
});

test('an imported-texture look with ZERO strokes is a restorable variant (req_3439)', () => {
  const h = harness({
    readLatestVariant: () => ({
      id: '1', name: 'Painting 1', w: 1024, h: 1024, detail: 1, data: '', format: 'program',
      rasterBase: true, cornerUv: [0, 0, 10, 0, 10, 10],
    }),
    readVariantRasterBase: () => ({ width: 1024, height: 1024, rgba: new Uint8Array(4) }),
  });
  const result = hydratePersistedModelPaint(h.sources, h.port);
  assert(result.status === 'ready' && result.source === 'variant', 'strokeless look did not become ready');
  assert(h.calls.join('|') === 'detail:1|raster:1024x1024|corners:0,0,10,0,10,10', `strokeless look ran a program replay: ${h.calls.join('|')}`);
});

test('a full-look variant whose raster base cannot be read fails loudly instead of half-restoring', () => {
  const h = harness({
    readLatestVariant: () => ({
      id: '3', name: 'Painting 3', w: 64, h: 64, detail: 8, data: 'strokes', format: 'program',
      rasterBase: true, cornerUv: [1, 1, 2, 2, 3, 3],
    }),
    readVariantRasterBase: () => null,
  });
  const result = hydratePersistedModelPaint(h.sources, h.port);
  assert(result.status === 'failed', 'unreadable raster base was not reported as failed');
  assert(h.calls.join('|') === 'detail:8', `unreadable raster base still applied something: ${h.calls.join('|')}`);
});

test('a program variant with an empty program is not silently replayed', () => {
  const h = harness({
    readLatestVariant: () => ({ id: '4', name: 'Painting 4', w: 64, h: 64, detail: 8, data: '', format: 'program' }),
  });
  const result = hydratePersistedModelPaint(h.sources, h.port);
  assert(result.status === 'failed', 'empty program variant was not reported as failed');
  assert(!h.calls.some((c) => c.startsWith('program:')), 'an empty program reached applyProgram');
});

test('a stale topology refuses every persisted paint source', () => {
  let variantRead = false;
  const h = harness({
    stale: true,
    basePaint: { version: 1, detail: 8, program: 'old' },
    readLatestVariant: () => { variantRead = true; return null; },
  });
  const result = hydratePersistedModelPaint(h.sources, h.port);
  assert(result.status === 'stale' && result.reason === 'layout-stale', 'stale topology was not reported with its refusal reason');
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

test('a resident atlas publishes its preview even when Paint was not active', () => {
  assert(residentPaintResumeAction({ atlasReady: true, atlasStale: false, paintToolActive: false }) === 'preview', 'resident atlas stayed hidden outside Paint');
  assert(residentPaintResumeAction({ atlasReady: true, atlasStale: false, paintToolActive: true }) === 'paint', 'active Paint tool was not restored');
  assert(residentPaintResumeAction({ atlasReady: false, atlasStale: false, paintToolActive: false }) === 'none', 'missing atlas published a preview');
  assert(residentPaintResumeAction({ atlasReady: true, atlasStale: true, paintToolActive: false }) === 'none', 'stale atlas published a preview');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
