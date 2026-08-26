// cart/editor/stage/BlobExplorerSurface.test.ts
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/stage/BlobExplorerSurface.test.ts --bundle \
//     --outfile=/tmp/blob-explorer-surface.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/blob-explorer-surface.test.js

import {
  FACE_OPERATIONS,
  type DisplayFaceRow,
  type FaceDiffRowV1,
  type FaceTableErrorV1,
  type OperationEligibility,
} from '../../../runtime/model/faceTable';
import {
  BLOB_EXPLORER_FACE_SOURCES,
  BLOB_EXPLORER_SECTIONS,
  BLOB_EXPLORER_UI,
  blobExplorerFaceRowView,
  blobExplorerFaceState,
  blobExplorerServiceLines,
  recoveryHealth,
  faceFilterKey,
  faceSelectionForRow,
  formatBlobBytes,
  guardedFieldApplyEnabled,
  recoveryDegradationLines,
  recoveryRestoreConfirmationAction,
  recoveryRestoreEnabled,
  recoverySnapshotDraft,
  sortBlobExplorerFaces,
  stableHistoryAction,
  toggleBlobExplorerFaceFilter,
  type BlobExplorerFaceQuery,
  type BlobExplorerHistoryCorruptRowV1,
  type BlobExplorerHistoryRowV1,
  type BlobExplorerServerStatusV1,
} from './BlobExplorerSurface';
import { REGIONS } from '../shell/regions';
import { BLOB_EXPLORER_MODES, BLOB_GUARDED_FIELDS } from '../model/blobExplorerState';

let passed = 0;
let failed = 0;
const log = (globalThis as any).print
  ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function test(name: string, run: () => void): void {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}

const operationMatrix = (): Record<(typeof FACE_OPERATIONS)[number], OperationEligibility> => ({
  indexed_build: { status: 'allowed' },
  loop_cut: { status: 'allowed' },
  face_to_ngon: { status: 'allowed' },
  bevel: {
    status: 'allowed',
    contexts: [
      { key: 'edge:1', status: 'allowed' },
      { key: 'edge:2', status: 'blocked', code: 'width_limit', detail: 'maximum width is zero' },
    ],
  },
  merge: { status: 'not_analyzed', detail: 'canonical noncommitting predicate is not exposed' },
  extrude: { status: 'not_analyzed', detail: 'canonical noncommitting predicate is not exposed' },
  solidify: { status: 'not_analyzed', detail: 'canonical noncommitting predicate is not exposed' },
});

const displayRow = (): DisplayFaceRow => ({
  address: { objectId: 'door-object', group: 7, stability: 'stable' },
  faceId: 18,
  triangleIds: [30, 31],
  part: { rank: 2, objectId: 'door-object' },
  material: 4,
  semantic: { region: 9, instance: 1 },
  durableLabels: {
    faceName: 'door.outer',
    semanticRegionName: 'door',
    semanticInstanceName: 'front-left',
  },
  visibility: 'visible',
  renderClass: 'glass',
  geometry: {
    cornerCount: 4,
    triangleCount: 2,
    area: 1.25,
    perimeter: 4.5,
    centroidEdgeClearance: null,
    minEdge: 0.5,
    maxEdge: 2,
    aspect: null,
    planarityDeviation: 0.001,
    convexity: 'convex',
    degeneracy: [],
  },
  boundary: { status: 'closed' },
  audit: {
    computed: false,
    intersecting: null,
    intersectingTriangles: 0,
    unreachable: null,
    unreachableTriangles: 0,
  },
  operations: operationMatrix(),
  display: {
    faceName: 'Door Outer',
    objectName: 'Front Door',
    materialName: 'Smoked Glass',
    semanticName: 'door.front-left',
  },
});

const baseQuery = (): BlobExplorerFaceQuery => ({
  source: 'resident',
  sort: { column: 'address', direction: 'asc' },
  filters: [{ kind: 'malformed' }],
  cursor: 'cursor-2',
  limit: 200,
});

test('the panel exposes Faces, Versions, Service and distinct resident/saved/preview/diff sources', () => {
  // req_4776 retired the three inner TABS: they made each subject responsible
  // for filling the pane alone and none of them could. They are collapsible
  // sections of one document now, and SNAPSHOTS leads because that is what
  // recovery is for.
  assert(BLOB_EXPLORER_SECTIONS.join(',') === 'snapshots,faces,service', 'recovery section contract drifted');
  assert(BLOB_EXPLORER_FACE_SOURCES.join(',') === 'resident,saved,preview,diff', 'face source contract drifted');
  assert(BLOB_EXPLORER_UI.minimumDataWidth === 320, 'data column dropped below the contract minimum');
});

test('guarded mode exposes only table-backed material and semantic ids', () => {
  assert(BLOB_EXPLORER_MODES.join(',') === 'inspect,guarded_field_edit', 'guarded mode contract drifted');
  assert(BLOB_GUARDED_FIELDS.join(',') === 'material,semantic_region,semantic_instance',
    'guarded mode gained a geometry, ownership, name, or raw-offset field');
});

test('guarded apply needs the real coordinator, a stable resident face, and no historical preview', () => {
  const ready = {
    mode: 'guarded_field_edit' as const,
    coordinatorReady: true,
    historicalPreviewActive: false,
    stableFaceSelected: true,
    draftValid: true,
    applyHandlerReady: true,
  };
  assert(guardedFieldApplyEnabled(ready), 'fully authorized guarded apply stayed locked');
  assert(!guardedFieldApplyEnabled({ ...ready, coordinatorReady: false }), 'UI enabled without the native coordinator');
  assert(!guardedFieldApplyEnabled({ ...ready, historicalPreviewActive: true }), 'UI enabled over historical preview');
  assert(!guardedFieldApplyEnabled({ ...ready, stableFaceSelected: false }), 'UI enabled for unstable or absent face identity');
  assert(!guardedFieldApplyEnabled({ ...ready, draftValid: false }), 'UI enabled for an invalid table id');
});

test('the shared panel width serves recovery from its default to its drag floor', () => {
  // req_4774 retired the compact/wide presets: the panel's one draggable width
  // replaced them, so recovery is sized by the same gesture as every other pane.
  assert((REGIONS.focusPanel as Record<string, unknown>).blobCompactWidth === undefined
    && (REGIONS.focusPanel as Record<string, unknown>).blobWideWidth === undefined,
    'the blob width presets came back — the panel has ONE width now');
  assert(REGIONS.focusPanel.width - REGIONS.focusPanel.railWidth >= BLOB_EXPLORER_UI.minimumDataWidth,
    'the shared default clips the minimum data column');
  // The panel's drag FLOOR is derived from the widest minimum any pane declares,
  // which is this one. Lower the floor without lowering this and recovery breaks
  // at a width the user is allowed to drag to.
  assert(REGIONS.focusPanel.resizeMinWidth - REGIONS.focusPanel.railWidth >= BLOB_EXPLORER_UI.minimumDataWidth,
    'the panel can be dragged narrower than the Blob Explorer data column can render');
  assert(REGIONS.focusPanel.collapsedWidth === REGIONS.focusPanel.railWidth,
    'collapsing the panel retained a hidden body');
});

test('sort and filter controls preserve the query while invalidating only its cursor', () => {
  const filtered = toggleBlobExplorerFaceFilter(baseQuery(), { kind: 'tiny' });
  assert(filtered.source === 'resident' && filtered.limit === 200, 'filter dropped source or limit');
  assert(filtered.cursor === null && filtered.filters.map(faceFilterKey).join(',') === 'malformed,tiny:default',
    'filter did not append explicitly or invalidate the cursor');
  const removed = toggleBlobExplorerFaceFilter(filtered, { kind: 'malformed' });
  assert(removed.filters.length === 1 && removed.filters[0]?.kind === 'tiny', 'active filter did not toggle off');

  const ascendingArea = sortBlobExplorerFaces(baseQuery(), 'area');
  const descendingArea = sortBlobExplorerFaces(ascendingArea, 'area');
  assert(ascendingArea.sort.direction === 'asc' && descendingArea.sort.direction === 'desc',
    'sort did not enter ascending then toggle descending');
  assert(descendingArea.filters[0]?.kind === 'malformed' && descendingArea.cursor === null,
    'sort discarded filters or retained a stale cursor');
});

test('face state distinguishes pending from error, loading, empty, and ready', () => {
  const pending: FaceTableErrorV1 = {
    ok: false,
    version: 1,
    code: 'analysis_pending',
    detail: 'queued',
    analysisId: 'analysis-1',
    planeIdentityHash: 'plane-1',
    progress: 0,
    retryAfterMs: 25,
  };
  assert(blobExplorerFaceState(null, pending, false) === 'pending', 'pending collapsed into error');
  assert(blobExplorerFaceState(null, {
    ok: false, version: 1, code: 'stale_generation', detail: 'changed', currentGeneration: 8,
  }, false) === 'error', 'named host error was not visible');
  assert(blobExplorerFaceState(null, null, true) === 'loading', 'loading state was lost');
  const emptyPage: any = { source: 'resident', rows: [] };
  const readyPage: any = { source: 'resident', rows: [displayRow()] };
  assert(blobExplorerFaceState(emptyPage, null, false) === 'empty', 'empty page was not explicit');
  assert(blobExplorerFaceState(readyPage, null, false) === 'ready', 'ready page was not explicit');
});

test('row presentation says UNKNOWN and retains every blocked/not-analyzed operation', () => {
  const view = blobExplorerFaceRowView(displayRow());
  assert(view.name === 'Door Outer' && view.object === 'Front Door', 'joined stable labels were not displayed');
  assert(view.audit.startsWith('UNKNOWN'), 'uncomputed audit was colored as a clean result');
  assert(view.geometry.includes('clearance UNKNOWN') && view.geometry.includes('aspect UNKNOWN'),
    'nullable canonical metrics were fabricated');
  assert(view.blockedBy.includes('bevel[edge:2]') && view.blockedBy.includes('width_limit'),
    'blocked parameter context was dropped');
  assert(view.blockedBy.includes('merge: not analyzed') &&
    view.blockedBy.includes('extrude: not analyzed') &&
    view.blockedBy.includes('solidify: not analyzed'), 'unsupported operations disappeared');
  assert(!view.blockedBy.includes('edge:1'), 'allowed parameter context appeared in blockedBy');
});

test('saved-only diff rows target only the isolated saved preview', () => {
  const saved = displayRow();
  const diff: FaceDiffRowV1 = {
    address: saved.address,
    savedAddress: saved.address,
    presence: 'saved_only',
    changedFields: ['object_membership'],
    incomparableFields: [],
    saved,
  };
  const target = faceSelectionForRow('diff', diff);
  assert(target?.plane === 'saved_preview' && target.presence === 'saved_only' &&
    target.frame === true && target.additive === false,
    'saved-only row was routed to resident selection');
  assert(faceSelectionForRow('diff', { ...diff, presence: 'incomparable', reason: 'ambiguous' }) === null,
    'incomparable row emitted a selection intent');
  assert(faceSelectionForRow('resident', saved)?.plane === 'resident',
    'resident row did not target the live plane');
  assert(faceSelectionForRow('preview', saved)?.plane === 'preview',
    'historical preview row was mislabeled as resident or saved');
});

const exactHistory = (): BlobExplorerHistoryRowV1 => ({
  snapshotId: 'snapshot-1',
  revision: 'revision-1',
  revisionNumber: 4,
  timestampMs: 1_700_000_000_000,
  sha256: 'a'.repeat(64),
  bytes: 4096,
  label: 'Manual recovery snapshot',
  kind: 'panic',
  triangles: 12,
  authoredFaces: 6,
  parts: 2,
  logicalVertices: 8,
  pinned: false,
  pushState: 'local',
  expiresAtMs: 1_705_184_000_000,
  identityQuality: 'exact',
  objectNamespaceHash: 'namespace',
  recoveryDegradations: [],
});

test('restore is available only for an exact row with no active historical preview', () => {
  const row = exactHistory();
  assert(recoveryRestoreEnabled(row, true, false), 'exact restore was disabled');
  assert(!recoveryRestoreEnabled({ ...row, identityQuality: 'degraded', recoveryDegradations: [{
    channel: 'object_ids', actions: ['synthesized'], reasons: ['missing'], affectedCount: 1,
  }] }, true, false), 'degraded history row exposed Restore');
  assert(!recoveryRestoreEnabled({ ...row, recoveryDegradations: [{
    channel: 'object_ids', actions: ['synthesized'], reasons: ['missing'], affectedCount: 1,
  }] }, true, false), 'inconsistent exact row with a degradation exposed Restore');
  assert(!recoveryRestoreEnabled(row, true, true), 'Restore stayed enabled over an active preview');
  assert(!recoveryRestoreEnabled(row, false, false), 'global restore gate was ignored');
});

test('restore requires a second click on the same immutable snapshot row', () => {
  assert(recoveryRestoreConfirmationAction(null, 'snapshot-a') === 'arm', 'first click executed Restore');
  assert(recoveryRestoreConfirmationAction('snapshot-b', 'snapshot-a') === 'arm', 'different armed row executed Restore');
  assert(recoveryRestoreConfirmationAction('snapshot-a', 'snapshot-a') === 'execute', 'same-row confirmation did not execute');
});

test('version actions carry stable snapshot identity plus revision and SHA guards', () => {
  const action = stableHistoryAction(exactHistory());
  assert(action?.snapshotId === 'snapshot-1' && action.expectedRevision === 'revision-1' &&
    action.expectedSha256.length === 64, 'history action used rewriteable revision alone');
  const corrupt: BlobExplorerHistoryCorruptRowV1 = {
    snapshotId: 'legacy-1',
    revision: null,
    timestampMs: null,
    state: 'corrupt',
    code: 'legacy_migration_failed',
    detail: 'shared path remains retained',
    legacyAddress: 'old/event.json',
    actionsAvailable: false,
  };
  assert(stableHistoryAction(corrupt) === null, 'legacy-corrupt row gained Preview/Restore/Pin authority');
});

test('panic capture draft never invokes Save or exposes an internal event kind', () => {
  const fast = recoverySnapshotDraft('   ', '  ');
  assert(fast.kind === 'panic' && fast.label === 'Manual recovery snapshot' &&
    fast.push === false && !('note' in fast), 'fast recovery draft drifted');
  const noted = recoverySnapshotDraft(' Before roof edit ', ' human panic control ');
  assert(noted.label === 'Before roof edit' && noted.note === 'human panic control',
    'recovery label/note did not normalize');
});

test('every degradation channel remains expandable instead of becoming one generic warning', () => {
  const channels = [
    'object_ids',
    'range_membership',
    'face_groups',
    'materials',
    'semantic_membership',
    'semantic_table',
    'logical_topology',
  ] as const;
  const lines = recoveryDegradationLines(channels.map((channel, index) => ({
    channel,
    actions: ['repaired'],
    reasons: [
      'missing_or_duplicate_object_id',
      'incoherent_range_membership',
      'anonymous_or_invalid_group',
      'invalid_material_index',
      'invalid_semantic_membership',
      'invalid_semantic_table',
      'missing_or_invalid_logical_topology',
    ].slice(index, index + 1) as any,
    affectedCount: index + 1,
  })));
  assert(lines.length === 7 && channels.every((channel) => lines.some((line) => line.startsWith(channel))),
    'a typed degradation channel was collapsed or omitted');
  assert(lines[6]?.includes('7 affected'), 'affected counts were hidden');
});

const blockedService = (): BlobExplorerServerStatusV1 => ({
  state: 'blocked',
  library: { available: false, version: null },
  repository: { ready: false, path: '/data/lore', revision: null },
  service: {
    healthy: false,
    healthUrl: 'http://127.0.0.1:2026/health',
    httpCode: null,
    unitName: 'lore.service',
    active: false,
    enabled: true,
    journalTail: ['library could not load'],
    restoreCommands: ['systemctl --user restart lore.service'],
  },
  stores: { snapshotRoot: '/data/lore/revisions', localBytes: 4096, serverBytes: null },
  retention: {
    days: 60,
    nowMs: 1_700_000_000_000,
    lastPruneMs: null,
    nextPruneMs: null,
    immediatelyExpired: 2,
    localTombstones: 3,
    remotePendingTombstones: 4,
    logicallyRemovedEntries: 5,
    logicallyRemovedBytes: 8192,
    physicallyReclaimedBytes: 2048,
    remoteWatermark: null,
    legacyUnexpiredPending: 6,
    legacyCorruptPending: 7,
    legacyLayoutCutover: false,
    lastError: 'repository unavailable',
  },
  history: { pushed: 8, local: 9, unknown: 10 },
  probe: { lastCompletedMs: null, lastTransitionMs: null },
});

test('service summary exposes blocked health, stores, and the hard 60-day retention truth', () => {
  // req_4776 turned these from eight unlabelled sentences into labelled rows
  // with their explanations on hover. Every FACT the old assertions guarded is
  // still asserted; only where it lives moved.
  const rows = blobExplorerServiceLines(blockedService());
  const row = (label: string) => rows.find((entry) => entry.label === label);
  const anywhere = (needle: string) => rows.some((entry) =>
    entry.value.includes(needle) || entry.detail.includes(needle));

  assert(row('library')?.value === 'UNAVAILABLE' && row('library')?.bad === true,
    'blocked library state was softened');
  assert(anywhere('/data/lore'), 'repository path was hidden');
  assert(row('store')?.value.includes('4.0 KiB here') && row('store')?.value.includes('UNKNOWN on the server'),
    'local/server store truth was flattened');
  assert(row('kept for')?.value === '60 days' && row('kept for')!.detail.includes('does NOT extend'),
    'hard retention ceiling was absent');
  assert(row('legacy')?.value.includes('6 pending') && row('legacy')?.value.includes('7 corrupt'),
    'legacy migration blockers were hidden');
  assert(row('legacy')?.bad === true, 'a blocked legacy cutover no longer reads as a fault');
  assert(formatBlobBytes(1024 * 1024) === '1.0 MiB', 'byte formatter drifted');
});

test('recovery health does not call itself ready while a subsystem is failing', () => {
  // The screenshot that prompted this: LORE READY / SERVICE HEALTHY / HTTP 200
  // printed four rows above `prune error · LoreCallFailed`.
  const readyButPruneFailing = {
    ...blockedService(),
    state: 'ready' as const,
    library: { available: true, version: '0.8.6' },
    repository: { ready: true, revision: 'abc123', path: '/data/lore' },
    service: { ...blockedService().service, healthy: true, httpCode: 200 },
    retention: { ...blockedService().retention, legacyCorruptPending: 0, legacyLayoutCutover: true, lastError: 'LoreCallFailed' },
  };
  const verdict = recoveryHealth(readyButPruneFailing as any);
  assert(verdict.headline !== 'RECOVERY READY',
    'the pane still calls itself ready while pruning is failing');
  assert(verdict.reason?.includes('LoreCallFailed') === true,
    'the verdict does not name the failure it is reporting');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} Blob Explorer surface test(s) failed`);
