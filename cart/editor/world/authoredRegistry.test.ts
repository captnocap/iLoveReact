// cart/editor/world/authoredRegistry.test.ts — exported models keep their current
// Studio look as the default plus one stable palette tile per saved painting.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/authoredRegistry.test.ts --bundle \
//     --outfile=/tmp/editor-authored-registry.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-authored-registry.test.js

import { authoredPaletteEntries, authoredPieceFrom, authoredResidentKeyOf, preferredAuthoredPaletteId, setAuthoredPieces, type AuthoredBuildPiece } from './authoredRegistry';

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

test('one saved painting sits beside the current Studio look', () => {
  const skins = [{ id: '1', name: 'Clean' }];
  const entries = authoredPaletteEntries(exported, skins);
  assert(entries.length === 2, `current + one painting should produce two entries, got ${entries.length}`);
  assert(entries[0]?.id === exported.id && entries[0]?.label === 'Painted Model · Current', 'current base look is not first');
  assert(entries[1]?.id === 'prop:painted-model#p1', `skin id carried, got ${entries[1]?.id}`);
  assert(entries[1]?.label === 'Painted Model · Clean', `painting label carried, got ${entries[1]?.label}`);
  assert(preferredAuthoredPaletteId(exported, skins) === exported.id, 'export silently armed a named painting instead of the current look');
});

test('multiple saved paintings remain independently placeable', () => {
  const skins = [{ id: '1', name: 'Clean' }, { id: '2', name: 'Tagged' }];
  const entries = authoredPaletteEntries(exported, skins);
  assert(entries.length === 3, `current + two paintings should produce three entries, got ${entries.length}`);
  assert(entries.map((entry) => entry.id).join(',') === 'prop:painted-model,prop:painted-model#p1,prop:painted-model#p2', 'current or saved skin ids are missing');
  assert(preferredAuthoredPaletteId(exported, skins) === exported.id, 'export did not preserve the current Studio look');
});

test('resident identity preserves exported meaning and paint skin', () => {
  assert(authoredResidentKeyOf('model:shared') === 'model:shared', 'build meaning was stripped from resident key');
  assert(authoredResidentKeyOf('prop:shared') === 'prop:shared', 'prop meaning was stripped from resident key');
  assert(authoredResidentKeyOf('model:shared#p2') === 'model:shared#p2', 'paint skin was stripped from resident key');
});

test('cold hydration resolves slot metadata from the explicit authored snapshot', () => {
  assert(authoredPieceFrom([exported], exported.id) === exported, 'base exported prop did not resolve');
  assert(authoredPieceFrom([exported], `${exported.id}#p2`) === exported, 'painted variant did not resolve to its base export');
});

test('retained two-argument live callers fall back to the mirrored registry', () => {
  setAuthoredPieces([exported]);
  assert(authoredPieceFrom(undefined, exported.id) === exported, 'missing hot-reload snapshot crashed or lost the exported prop');
  assert(authoredPieceFrom(undefined, `${exported.id}#p2`) === exported, 'missing hot-reload snapshot lost a paint variant');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
