// cart/editor/model/partResidency.test.ts — native multipart lifetime regression.
//
//   tools/esbuild cart/editor/model/partResidency.test.ts --bundle \
//     --outfile=/tmp/editor-part-residency.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-part-residency.test.js
import {
  EMPTY_MODEL_VIEW_RESIDENCY,
  advanceModelViewResidency,
  choosePartAppendRoute,
} from './partResidency';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function test(name: string, run: () => void): void {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

test('deleting the seed cube keeps a multi-outliner library import resident', () => {
  const booted = advanceModelViewResidency(EMPTY_MODEL_VIEW_RESIDENCY, 'primitive:cube:1', true, true);
  assert(booted.established, 'the cube boot source did not establish the native viewer');

  // After Cube is deleted, both imported rows are metadata + native ranges. There is no
  // cart-side primitive left to compose, but the already-running ModelView must survive.
  const importedOnly = advanceModelViewResidency(booted, 'primitive:cube:1', true, false);
  assert(importedOnly.established, 'metadata-only imported parts revoked the live viewer');
});

test('a different document cannot inherit another model native session', () => {
  const booted = advanceModelViewResidency(EMPTY_MODEL_VIEW_RESIDENCY, 'model:a', true, true);
  const switched = advanceModelViewResidency(booted, 'model:b', true, false);
  assert(!switched.established, 'a seedless model borrowed the previous document session');
  const unmounted = advanceModelViewResidency(booted, 'model:a', false, false);
  assert(!unmounted.established, 'leaving the multipart surface retained a dead session');
});

test('Add Part appends to resident imported geometry and never overwrites orphan rows', () => {
  assert(choosePartAppendRoute(true, 2) === 'resident', 'multi-part library rows bypassed the live host append');
  assert(choosePartAppendRoute(true, 0) === 'resident', 'an honestly empty native mesh did not use its append door');
  assert(choosePartAppendRoute(false, 0) === 'seed-empty', 'a fresh row-empty document cannot seed its first part');
  assert(choosePartAppendRoute(false, 2) === 'refuse', 'seedless imported rows would be overwritten without a live viewer');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
