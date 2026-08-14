import { initialState } from './initialState';
import { discardModelWorkingCopyState, upsertModelPackageProjection } from './persistenceLifecycle';
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
  state.modelTextureSlots[id] = [{ id: 'screen_1', label: 'Screen', purpose: 'screen' }];
  state.modelLights[id] = [{ id: 'light-1', kind: 'point', position: [0, 1, 0], color: '#ffffff', intensity: 1, range: 4 }];
  state.modelDirty[id] = true;
  state.modelOverrides[id] = { name: 'Renamed Draft' };
  state.modelDupes = [pkg];
  state.recentLibraryKeys = [`model:${id}`, 'asset:water'];
  state.modelActivePartId = 'part:1';
  return state;
}

test('discard drops every ephemeral model-authoring slice', () => {
  const next = discardModelWorkingCopyState(dirtyState('draft'), 'draft', false);
  assert(next.modelParts.draft === undefined, 'part working copy survived');
  assert(next.modelRigs.draft === undefined, 'rig working copy survived');
  assert(next.modelTextureSlots.draft === undefined, 'face-role working copy survived');
  assert(next.modelLights.draft === undefined, 'light working copy survived');
  assert(next.modelDirty.draft === undefined, 'dirty marker survived');
  assert(next.modelOverrides.draft === undefined, 'unsaved identity override survived');
  assert(!next.modelDupes.some((item) => item.id === 'draft'), 'unsaved session package survived');
  assert(next.recentLibraryKeys.join(',') === 'asset:water', 'discarded draft survived in durable Recent history');
  assert(next.modelActivePartId === null, 'active part survived');
});

test('discard keeps durable identity projections for a materialized model', () => {
  const next = discardModelWorkingCopyState(dirtyState('saved'), 'saved', true);
  assert(next.modelOverrides.saved?.name === 'Renamed Draft', 'durable identity projection was discarded');
  assert(next.modelDupes.some((item) => item.id === 'saved'), 'materialized catalog row was discarded');
  assert(next.recentLibraryKeys[0] === 'model:saved', 'durable model disappeared from Recent history');
  assert(next.modelParts.saved === undefined && next.modelDirty.saved === undefined, 'working data survived');
});

test('committed character revision replaces its shadowing draft projection', () => {
  const draft: ModelPackage = { id: 'saved', name: 'Draft', kind: 'props', folderId: 'model-saved' as any };
  const committed: ModelPackage = {
    ...draft,
    name: 'Committed',
    geometryPath: 'mesh/character-hash.rjmd',
    skeleton: { id: 'saved', bones: [{ id: 'root' }] },
  };
  const next = upsertModelPackageProjection([draft], committed);
  assert(next.length === 1 && next[0] === committed, 'draft continued to shadow the committed package');
  const appended = upsertModelPackageProjection([], committed);
  assert(appended.length === 1 && appended[0] === committed, 'first committed projection was not retained');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
