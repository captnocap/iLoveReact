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
} from './modelLoreSnapshots';
import type { RecoverySnapshotReceiptV1 } from '../../../runtime/vcs/lore';
import type { VerifiedSaveReceiptV1 } from '../../../runtime/vcs/loreSaveCoordinator';

let passed = 0;
let failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function test(name: string, run: () => void): void {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}

const SHA = 'a'.repeat(64);
const SAVE_RECEIPT: VerifiedSaveReceiptV1 = {
  ok: true,
  version: 1,
  modelId: 'car',
  saveReceiptToken: `save-v1-${'b'.repeat(64)}`,
  sha256: SHA,
  bytes: 128,
  formatVersion: 5,
};
const NORMAL_RECEIPT: RecoverySnapshotReceiptV1 = {
  ok: true,
  version: 1,
  snapshotId: 'snapshot-1',
  revision: 'c'.repeat(64),
  revisionNumber: 42,
  timestampMs: 1_723_000_000_000,
  sha256: SHA,
  sourceSha256: SHA,
  bytes: 128,
  triangles: 2,
  authoredFaces: 1,
  parts: 1,
  logicalVertices: 0,
  indexed: true,
  pushState: 'pushed',
  identityQuality: 'exact',
  objectNamespaceHash: 'd'.repeat(64),
  recoveryDegradations: [],
};

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
});

test('a failed package Save never issues or consumes a verified receipt', () => {
  let calls = 0;
  const result = snapshotNormalModelSave({
    saveSucceeded: false,
    modelId: 'car',
    activeResidentModelId: 'car',
    packageGeometryPath: 'cart/editor/data/models/props/car/mesh/doc.blob',
    packageGeometrySha256: SHA,
    label: 'Save',
  }, () => { calls += 1; return SAVE_RECEIPT; }, () => { calls += 1; return NORMAL_RECEIPT; });
  assert(!result.attempted && calls === 0, 'failed Save entered Lore');
});

test('a background Save cannot archive a different resident model', () => {
  let calls = 0;
  const result = snapshotNormalModelSave({
    saveSucceeded: true,
    modelId: 'background-model',
    activeResidentModelId: 'visible-model',
    packageGeometryPath: 'cart/editor/data/models/props/background/mesh/doc.blob',
    packageGeometrySha256: SHA,
    label: 'Autosaved',
  }, () => { calls += 1; return SAVE_RECEIPT; }, () => { calls += 1; return NORMAL_RECEIPT; });
  assert(!result.attempted && calls === 0, 'the visible resident was archived under the background model ID');
});

test('a validated active Save issues an exact package receipt then appends normal by token only', () => {
  let issued: any = null;
  let captured: any = null;
  const result = snapshotNormalModelSave({
    saveSucceeded: true,
    modelId: 'car',
    activeResidentModelId: 'car',
    packageGeometryPath: 'cart/editor/data/models/props/car/mesh/doc.blob',
    packageGeometrySha256: SHA,
    label: 'Saved by Agent Seat',
    note: 'checkpoint before roof edit',
  }, (payload) => { issued = payload; return SAVE_RECEIPT; }, (payload) => { captured = payload; return NORMAL_RECEIPT; });
  assert(result.attempted && result.archived, 'successful Save did not archive');
  assert(issued?.expectedSha256 === SHA && issued?.packageGeometryPath.endsWith('/mesh/doc.blob'),
    'receipt issuance was not bound to exact installed package geometry');
  assert(captured?.kind === 'normal' && captured?.push === true, 'normal snapshot did not request a remote push');
  assert(captured?.saveReceiptToken === SAVE_RECEIPT.saveReceiptToken, 'one-use native receipt was not consumed');
  assert(!Object.prototype.hasOwnProperty.call(captured, 'packageGeometryPath'), 'capture leaked or trusted a package path');
  assert(result.statusSuffix.includes('42'), 'revision was not exposed to Save status');
});

test('Lore rejection or host throw cannot turn a committed package Save into failure', () => {
  const rejected = snapshotNormalModelSave({
    saveSucceeded: true,
    modelId: 'car',
    activeResidentModelId: 'car',
    packageGeometryPath: 'cart/editor/data/models/props/car/mesh/doc.blob',
    packageGeometrySha256: SHA,
    label: 'Save',
  }, () => ({ ok: false, version: 1, code: 'server_unavailable', detail: 'server unavailable' }), () => NORMAL_RECEIPT);
  assert(rejected.attempted && !rejected.archived, 'Lore rejection was not isolated');
  assert(rejected.statusSuffix.startsWith('; package saved'), 'warning implied the package Save was rolled back');

  const threw = snapshotNormalModelSave({
    saveSucceeded: true,
    modelId: 'car',
    activeResidentModelId: 'car',
    packageGeometryPath: 'cart/editor/data/models/props/car/mesh/doc.blob',
    packageGeometrySha256: SHA,
    label: 'Save',
  }, () => { throw new Error('bridge failed'); }, () => NORMAL_RECEIPT);
  assert(!threw.archived && threw.statusSuffix.includes('bridge failed'), 'host throw escaped the recovery boundary');
});

test('a local-only snapshot remains a successful recovery checkpoint with an explicit warning', () => {
  const result = snapshotNormalModelSave({
    saveSucceeded: true,
    modelId: 'car',
    activeResidentModelId: 'car',
    packageGeometryPath: 'cart/editor/data/models/props/car/mesh/doc.blob',
    packageGeometrySha256: SHA,
    label: 'Save',
  }, () => SAVE_RECEIPT, () => ({ ...NORMAL_RECEIPT, revisionNumber: 7, pushState: 'local' }));
  assert(result.archived, 'durable local snapshot was misreported as failed');
  assert(result.statusSuffix.includes('local only'), 'remote outage was not exposed');
});

test('missing exact readback SHA fails outside the package transaction without issuing a receipt', () => {
  let calls = 0;
  const result = snapshotNormalModelSave({
    saveSucceeded: true,
    modelId: 'car',
    activeResidentModelId: 'car',
    packageGeometryPath: 'cart/editor/data/models/props/car/mesh/doc.blob',
    packageGeometrySha256: '',
    label: 'Save',
  }, () => { calls += 1; return SAVE_RECEIPT; }, () => { calls += 1; return NORMAL_RECEIPT; });
  assert(result.attempted && !result.archived && calls === 0, 'unverified bytes reached Lore');
  assert(result.statusSuffix.startsWith('; package saved'), 'Lore verification failure changed package success');
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
