// cart/editor/world/authoredRegistry.test.ts — exported models contribute one
// palette tile per saved painting, never a mutable base + duplicate skin.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/authoredRegistry.test.ts --bundle \
//     --outfile=/tmp/editor-authored-registry.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-authored-registry.test.js

import { authoredPaletteEntries, preferredAuthoredPaletteId, type AuthoredBuildPiece } from './authoredRegistry';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

const exported: AuthoredBuildPiece = {
  id: 'prop:painted-model',
  modelId: 'painted-model',
  pkgId: 'studio:painted-model',
  label: 'Painted Model',
  kind: 'prop',
  hex: '#778899',
};

test('an unpainted export keeps one base fallback', () => {
  const entries = authoredPaletteEntries(exported, []);
  assert(entries.length === 1, `one base entry, got ${entries.length}`);
  assert(entries[0]?.id === exported.id, `base id kept, got ${entries[0]?.id}`);
  assert(preferredAuthoredPaletteId(exported, []) === exported.id, 'export arms the base fallback');
});

test('one saved painting replaces the base instead of duplicating it', () => {
  const skins = [{ id: '1', name: 'Clean' }];
  const entries = authoredPaletteEntries(exported, skins);
  assert(entries.length === 1, `one painting produces one entry, got ${entries.length}`);
  assert(entries[0]?.id === 'prop:painted-model#p1', `skin id carried, got ${entries[0]?.id}`);
  assert(entries[0]?.label === 'Painted Model · Clean', `painting label carried, got ${entries[0]?.label}`);
  assert(preferredAuthoredPaletteId(exported, skins) === entries[0]?.id, 'export arms the visible painting');
});

test('multiple saved paintings remain independently placeable', () => {
  const skins = [{ id: '1', name: 'Clean' }, { id: '2', name: 'Tagged' }];
  const entries = authoredPaletteEntries(exported, skins);
  assert(entries.length === 2, `two paintings produce two entries, got ${entries.length}`);
  assert(entries.map((entry) => entry.id).join(',') === 'prop:painted-model#p1,prop:painted-model#p2', 'only saved skin ids are exposed');
  assert(!entries.some((entry) => entry.id === exported.id), 'mutable base is absent when stored skins exist');
  assert(preferredAuthoredPaletteId(exported, skins) === 'prop:painted-model#p2', 'export arms the newest stored painting');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
