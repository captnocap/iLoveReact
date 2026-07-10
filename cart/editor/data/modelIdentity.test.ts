// cart/editor/data/modelIdentity.test.ts — display names never erase durable
// packages or make their ids reusable.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/modelIdentity.test.ts --bundle \
//     --outfile=/tmp/editor-model-identity.test.js --format=iife --platform=neutral \
//     --target=es2022
//   tools/v8cli /tmp/editor-model-identity.test.js

import {
  allocateBuildStarterModelId,
  allocatePlayerModelId,
  allocatePrimitiveModelId,
  mergeModelCatalogSources,
} from './modelIdentity';
import type { ModelPackage, WorkspaceDocument } from './types';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

function model(id: string, name: string, kind: ModelPackage['kind'], sourceKind: ModelPackage['sourceKind']): ModelPackage {
  return {
    id,
    name,
    kind,
    sourceKind,
    folderId: 'models',
    path: `/models/${id}`,
    stage: 'wip',
    color: '#778899',
    source: `${id}/manifest.json`,
    rig: '-',
    data: '-',
    triangles: 3,
    lods: 1,
    decompositions: [],
    atlases: [],
    paints: [],
  };
}

test('same-name durable build and prop packages both survive', () => {
  const buildStage = model('studio:old-stage', 'stage', 'build', 'studio-model');
  const propStage = model('primitive:cylinder:1', 'stage', 'prop', 'primitive');
  const merged = mergeModelCatalogSources([buildStage, propStage], []);
  assert(merged.length === 2, `expected 2 durable stages, got ${merged.length}`);
  assert(merged.some((m) => m.id === propStage.id), 'new prop stage was dropped by its label');
});

test('legacy exports still collapse behind the durable package', () => {
  const durable = model('studio:pepes', 'pepes', 'prop', 'studio-model');
  const imported = model('imported:pepes', 'PEPES', 'prop', 'imported-prop');
  const cooked = model('cooked:pepes', 'pepes', 'prop', 'cooked-asset');
  const merged = mergeModelCatalogSources([durable], [imported, cooked]);
  assert(merged.length === 1 && merged[0]?.id === durable.id, 'durable model did not win legacy aliases');
});

test('legacy-only aliases keep the editable Studio source', () => {
  const cooked = model('cooked:sign', 'sign', 'prop', 'cooked-asset');
  const studio = model('studio:sign', 'SIGN', 'build', 'studio-model');
  const merged = mergeModelCatalogSources([], [cooked, studio]);
  assert(merged.length === 1 && merged[0]?.id === studio.id, 'legacy source priority changed');
});

test('disk truth reserves a primitive id even when the browser catalog omitted it', () => {
  const next = allocatePrimitiveModelId('cylinder', [], [], (id) => id === 'primitive:cylinder:1');
  assert(next === 'primitive:cylinder:2', `reused stored cylinder id: ${next}`);
});

test('disk truth also reserves player starter identities', () => {
  const docs: WorkspaceDocument[] = [];
  const next = allocatePlayerModelId(docs, [], (id) => id === 'character:player:1');
  assert(next === 'character:player:2', `reused stored player id: ${next}`);
});

test('build starters reserve identities per semantic kind', () => {
  const docs: WorkspaceDocument[] = [{ id: 'model:starter:build:wall:1', kind: 'model', title: 'Wall Piece 1', sourceId: 'starter:build:wall:1' }];
  const wall = allocateBuildStarterModelId('wall', docs, [], () => false);
  const floor = allocateBuildStarterModelId('floor', docs, [], (id) => id === 'starter:build:floor:1');
  assert(wall === 'starter:build:wall:2', `reused open wall starter id: ${wall}`);
  assert(floor === 'starter:build:floor:2', `reused stored floor starter id: ${floor}`);
  const door = allocateBuildStarterModelId('door-wall', docs, [], (id) => id === 'starter:build:door-wall:1');
  assert(door === 'starter:build:door-wall:2', `door variant collided with the base wall identity: ${door}`);
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
