// Run:
//   tools/esbuild cart/editor/model/uvAtlasSize.test.ts --bundle --outfile=/tmp/editor-uv-atlas-size.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-uv-atlas-size.test.js

import {
  UV_ATLAS_SIZE_TUNING,
  planUvAtlasResize,
  uvAtlasResizePreview,
} from './uvAtlasSize';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (error) { failed++; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('the generation example preserves independent normalized placement', () => {
  const result = planUvAtlasResize(817, 996, 928, 1152);
  assert(result.ok, `example plan was refused: ${result.ok ? '' : result.error}`);
  if (!result.ok) return;
  assert(result.plan.changed, 'dimension change was treated as inert');
  assert(Math.abs(result.plan.scaleX - 928 / 817) < 1e-12, 'X scale lost exact guide ratio');
  assert(Math.abs(result.plan.scaleY - 1152 / 996) < 1e-12, 'Y scale lost exact guide ratio');
  assert(result.plan.targetRgbaBytes === 928 * 1152 * 4, 'RGBA budget math drifted');
  assert(uvAtlasResizePreview(result.plan) === 'X 1.1359 · Y 1.1566', 'dry-run preview drifted');
});

test('same dimensions are a valid no-op preview', () => {
  const result = planUvAtlasResize(817, 996, 817, 996);
  assert(result.ok && !result.plan.changed, 'same-size plan did not remain an inert valid draft');
  assert(result.ok && result.plan.scaleX === 1 && result.plan.scaleY === 1, 'same-size scale was not identity');
});

test('invalid and explosive dimensions are refused before allocation', () => {
  assert(!planUvAtlasResize(817, 996, 0, 1152).ok, 'zero width reached the resize boundary');
  assert(!planUvAtlasResize(817, 996, 928.5, 1152).ok, 'fractional width reached the resize boundary');
  assert(!planUvAtlasResize(817, 996, UV_ATLAS_SIZE_TUNING.maxDimension + 1, 1).ok, 'GPU dimension ceiling was bypassed');
  assert(!planUvAtlasResize(817, 996, UV_ATLAS_SIZE_TUNING.maxDimension, UV_ATLAS_SIZE_TUNING.maxDimension).ok, 'live RGBA budget was bypassed');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} uvAtlasSize tests failed`);
