// cart/editor/model/modelLoreSnapshots.test.ts
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/model/modelLoreSnapshots.test.ts --bundle \
//     --outfile=/tmp/model-lore-snapshots.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/model-lore-snapshots.test.js

import {
  loreSnapshotObjectIds,
  modelPackageGeometryPath,
  snapshotNormalModelSave,
  type LoreSnapshotResponse,
} from './modelLoreSnapshots';

let passed = 0;
let failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function test(name: string, run: () => void): void {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}

test('stable object IDs follow native range rank rather than outliner order', () => {
  const ids = loreSnapshotObjectIds([
    { id: 'door', lo: 72 },
    { id: 'body', lo: 0 },
    { id: 'wheel', lo: 48 },
  ]);
  assert(ids?.join(',') === 'body,wheel,door', `object order was ${ids?.join(',')}`);
});

test('an unranked outliner row omits ID stamping instead of guessing a native range owner', () => {
  assert(loreSnapshotObjectIds([
    { id: 'body', lo: 0 },
    { id: 'unranked' },
  ]) === null, 'unranked row was assigned to a native range by list position');

  let request: Readonly<Record<string, unknown>> | null = null;
  snapshotNormalModelSave({
    saveSucceeded: true,
    modelId: 'car',
    activeResidentModelId: 'car',
    packageGeometryPath: 'cart/editor/data/models/props/car/mesh/doc.blob',
    objectRows: [{ id: 'body', lo: 0 }, { id: 'unranked' }],
    label: 'Save',
  }, (payload) => { request = payload; return { ok: true }; });
  assert(request !== null && !Object.prototype.hasOwnProperty.call(request, 'objectIds'),
    'request carried fabricated range identity');
});

test('a failed package Save never invokes the resident snapshot door', () => {
  let calls = 0;
  const result = snapshotNormalModelSave({
    saveSucceeded: false,
    modelId: 'car',
    activeResidentModelId: 'car',
    packageGeometryPath: 'cart/editor/data/models/props/car/mesh/doc.blob',
    objectRows: [],
    label: 'Save',
  }, () => { calls += 1; return { ok: true }; });
  assert(!result.attempted && calls === 0, 'failed Save entered Lore');
});

test('a background Save cannot archive a different resident model', () => {
  let calls = 0;
  const result = snapshotNormalModelSave({
    saveSucceeded: true,
    modelId: 'background-model',
    activeResidentModelId: 'visible-model',
    packageGeometryPath: 'cart/editor/data/models/props/background/mesh/doc.blob',
    objectRows: [],
    label: 'Autosaved',
  }, () => { calls += 1; return { ok: true }; });
  assert(!result.attempted && calls === 0, 'the visible resident was archived under the background model ID');
});

test('a validated active Save snapshots exact identity and keeps push outside the Save transaction', () => {
  let request: Readonly<Record<string, unknown>> | null = null;
  const response: LoreSnapshotResponse = {
    ok: true,
    revision: 'abc123',
    revisionNumber: 42,
    pushed: true,
  };
  const result = snapshotNormalModelSave({
    saveSucceeded: true,
    modelId: 'car',
    activeResidentModelId: 'car',
    packageGeometryPath: 'cart/editor/data/models/props/car/mesh/doc.blob',
    objectRows: [{ id: 'glass', lo: 30 }, { id: 'body', lo: 0 }],
    label: 'Saved by Agent Seat',
    note: 'checkpoint before roof edit',
  }, (payload) => { request = payload; return response; });
  assert(result.attempted && result.archived, 'successful Save did not archive');
  assert(request !== null, 'snapshot request was not captured');
  assert(request!.kind === 'normal' && request!.push === true, 'normal snapshot did not request a remote push');
  assert(JSON.stringify(request!.objectIds) === JSON.stringify(['body', 'glass']), 'range-ranked IDs were lost');
  assert(result.statusSuffix.includes('42'), 'revision was not exposed to Save status');
});

test('Lore rejection or host throw cannot turn a committed package Save into failure', () => {
  const rejected = snapshotNormalModelSave({
    saveSucceeded: true,
    modelId: 'car',
    activeResidentModelId: 'car',
    packageGeometryPath: 'cart/editor/data/models/props/car/mesh/doc.blob',
    objectRows: [],
    label: 'Save',
  }, () => ({ ok: false, error: 'server unavailable' }));
  assert(rejected.attempted && !rejected.archived, 'Lore rejection was not isolated');
  assert(rejected.statusSuffix.startsWith('; package saved'), 'warning implied the package Save was rolled back');

  const threw = snapshotNormalModelSave({
    saveSucceeded: true,
    modelId: 'car',
    activeResidentModelId: 'car',
    packageGeometryPath: 'cart/editor/data/models/props/car/mesh/doc.blob',
    objectRows: [],
    label: 'Save',
  }, () => { throw new Error('bridge failed'); });
  assert(!threw.archived && threw.statusSuffix.includes('bridge failed'), 'host throw escaped the recovery boundary');
});

test('a local-only snapshot remains a successful recovery checkpoint with an explicit warning', () => {
  const result = snapshotNormalModelSave({
    saveSucceeded: true,
    modelId: 'car',
    activeResidentModelId: 'car',
    packageGeometryPath: 'cart/editor/data/models/props/car/mesh/doc.blob',
    objectRows: [],
    label: 'Save',
  }, () => ({ ok: true, revisionNumber: 7, pushed: false, pushError: 'remote down' }));
  assert(result.archived, 'durable local snapshot was misreported as failed');
  assert(result.statusSuffix.includes('local only') && result.statusSuffix.includes('remote down'),
    'remote outage was not exposed');
});

test('restore targets ordinary documents and manifest-declared character geometry', () => {
  assert(modelPackageGeometryPath('pkg/car', undefined) === 'pkg/car/mesh/doc.blob', 'ordinary path drifted');
  const hash = 'a'.repeat(64);
  assert(modelPackageGeometryPath('pkg/person', {
    meshes: { kind: 'skinned', geometryPath: `mesh/character-${hash}.rjmd` },
  }) === `pkg/person/mesh/character-${hash}.rjmd`, 'character immutable geometry path was ignored');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} model Lore snapshot test(s) failed`);
