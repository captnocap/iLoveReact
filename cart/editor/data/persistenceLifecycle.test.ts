import { initialState } from './initialState';
import { discardModelWorkingCopyState } from './persistenceLifecycle';
import type { ModelPackage } from './types';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function dirtyState(id: string) {
  const state = initialState();
  const pkg: ModelPackage = { id, name: 'Draft', kind: 'props', folderId: `model-${id}` as any };
  state.modelParts[id] = [{ id: 'part:1', name: 'Part', visible: true, color: '#fff' }];
  state.modelRigs[id] = {};
  state.modelDirty[id] = true;
  state.modelOverrides[id] = { name: 'Renamed Draft' };
  state.modelDupes = [pkg];
  state.modelActivePartId = 'part:1';
  return state;
}

test('discard drops every ephemeral model-authoring slice', () => {
  const next = discardModelWorkingCopyState(dirtyState('draft'), 'draft', false);
  assert(next.modelParts.draft === undefined, 'part working copy survived');
  assert(next.modelRigs.draft === undefined, 'rig working copy survived');
  assert(next.modelDirty.draft === undefined, 'dirty marker survived');
  assert(next.modelOverrides.draft === undefined, 'unsaved identity override survived');
  assert(!next.modelDupes.some((item) => item.id === 'draft'), 'unsaved session package survived');
  assert(next.modelActivePartId === null, 'active part survived');
});

test('discard keeps durable identity projections for a materialized model', () => {
  const next = discardModelWorkingCopyState(dirtyState('saved'), 'saved', true);
  assert(next.modelOverrides.saved?.name === 'Renamed Draft', 'durable identity projection was discarded');
  assert(next.modelDupes.some((item) => item.id === 'saved'), 'materialized catalog row was discarded');
  assert(next.modelParts.saved === undefined && next.modelDirty.saved === undefined, 'working data survived');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
