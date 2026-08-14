// Native mesh event bridge contract — Zig enum ordinals and Uint32 rows must
// decode to the same stable command identity used by the editor bus.

import {
  NATIVE_MESH_ACTIONS,
  decodeNativeMeshActions,
  modelDocumentToken,
  nativeMeshActionSourceOrdinal,
  withNativeMeshActionSource,
} from './nativeMeshEvents';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('semantic ordinals preserve the native journal contract', () => {
  assert(NATIVE_MESH_ACTIONS.length === 39, `expected all 39 native actions, got ${NATIVE_MESH_ACTIONS.length}`);
  assert(NATIVE_MESH_ACTIONS[0]?.commandId === 'model.mesh.extrude-face', 'first ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[14]?.commandId === 'model.mesh.merge-parts', 'merge ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[20]?.commandId === 'model.mesh.transform', 'transform ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[22]?.commandId === 'model.mesh.scale-by', 'scale-by ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[23]?.commandId === 'model.uv.edit', 'UV edit ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[25]?.commandId === 'model.uv.reload-texture', 'UV reload ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[26]?.commandId === 'model.mesh.integrity-alert', 'integrity-alert ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[27]?.commandId === 'model.mesh.tris-to-quads', 'tris-to-quads ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[28]?.commandId === 'model.uv.resize-atlas', 'UV atlas resize ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[29]?.commandId === 'model.mesh.connect-vertices', 'connect-vertices ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[30]?.commandId === 'model.mesh.bevel', 'bevel ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[31]?.commandId === 'model.paint.fill-selection', 'selection-paint ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[32]?.commandId === 'model.retopology.edit-guide', 'retopology-guide ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[33]?.commandId === 'model.recovery.restore', 'historical-restore ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[34]?.commandId === 'model.recovery.field-edit', 'field-edit ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[35]?.commandId === 'model.mesh.basic-cut', 'basic-cut ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[36]?.commandId === 'model.mesh.marquee-cut', 'marquee-cut ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[37]?.commandId === 'model.mesh.edge-split', 'edge-split ordinal drifted');
  assert(NATIVE_MESH_ACTIONS[38]?.commandId === 'model.mesh.edge-tubes', 'edge-tubes ordinal drifted');
});

test('document tokens are stable, distinct, nonzero, and bridge-exact', () => {
  const bridge = modelDocumentToken('models/bridge');
  assert(bridge === modelDocumentToken('models/bridge'), 'same document changed tokens');
  assert(bridge !== modelDocumentToken('models/other'), 'ordinary model ids collided');
  assert(bridge > 0 && bridge <= 0x7fff_ffff, `token escaped positive bridge range: ${bridge}`);
  assert(new Uint32Array([bridge])[0] === bridge, 'token did not survive Uint32 exactly');
});


test('one fixed native row decodes identity, phase, source, and counts', () => {
  const row = new Uint32Array(11);
  row.set([1, 41, 99, 20, 1, 7, 24, 24, 2, 2, 3]);
  const report = decodeNativeMeshActions(row.buffer)[0]!;
  assert(report.id === 41 && report.documentToken === 99, 'action/document identity drifted');
  assert(report.kind === 'transform' && report.commandId === 'model.mesh.transform', 'semantic action drifted');
  assert(report.phase === 'undone' && report.source === 'viewport', 'phase/source drifted');
  assert(report.beforeVertices === 24 && report.afterVertices === 24, 'vertex counts drifted');
  assert(report.beforeParts === 2 && report.afterParts === 2 && report.droppedBefore === 3, 'part/overflow counts drifted');
});

test('source scope always resets to native, including after a throw', () => {
  const writes: number[] = [];
  const prior = (globalThis as any).__mesh_action_source;
  (globalThis as any).__mesh_action_source = (ordinal: number) => writes.push(ordinal);
  assert(nativeMeshActionSourceOrdinal('focus-panel') === 4, 'focus panel did not normalize to dock');
  withNativeMeshActionSource('action bar', () => 1);
  try { withNativeMeshActionSource('hotkey', () => { throw new Error('expected'); }); } catch { /* expected */ }
  (globalThis as any).__mesh_action_source = prior;
  assert(writes.join(',') === '3,0,2,0', `source scope leaked: ${writes.join(',')}`);
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
