import { useState } from 'react';
import {
  Col,
  Pressable,
} from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import './blobExplorer.cls';
import { FactRow } from '../inspector/ReadOnlySection';
import {
  FACE_OPERATIONS,
  FACE_TABLE_SORT_COLUMNS,
  formatFaceBlockedBy,
  type AuthoredFaceRowV1,
  type DisplayFaceRow,
  type DisplayFaceTablePageV1,
  type FaceAddressV1,
  type FaceBuildIssueV1,
  type FaceDiffPageV1,
  type FaceDiffRowV1,
  type FaceOperation,
  type FaceTableErrorV1,
  type FaceTableFilterV1,
  type FaceTableSortColumnV1,
  type FaceTableSortV1,
} from '../../../runtime/model/faceTable';
import type { RecoveryDegradationV1 } from '../../../runtime/model/recoveryArtifact';
import {
  BLOB_GUARDED_FIELDS,
  validateBlobGuardedFieldDraft,
  type BlobExplorerModeV1,
  type BlobGuardedFieldV1,
} from '../model/blobExplorerState';

export const BLOB_EXPLORER_TABS = ['faces', 'versions', 'service'] as const;
export type BlobExplorerTab = typeof BLOB_EXPLORER_TABS[number];

export const BLOB_EXPLORER_FACE_SOURCES = ['resident', 'saved', 'preview', 'diff'] as const;
export type BlobExplorerFaceSource = typeof BLOB_EXPLORER_FACE_SOURCES[number];
export type BlobExplorerWidthPreset = 'compact' | 'wide';

export type BlobExplorerFaceQuery = {
  source: BlobExplorerFaceSource;
  sort: FaceTableSortV1;
  filters: FaceTableFilterV1[];
  cursor: string | null;
  limit: number;
};

export type BlobExplorerFacePage = DisplayFaceTablePageV1 | FaceDiffPageV1;

export type BlobExplorerFaceSelection = {
  kind: 'face';
  source: BlobExplorerFaceSource;
  plane: 'resident' | 'saved_preview' | 'preview';
  address: FaceAddressV1;
  additive: false;
  frame: true;
  presence?: FaceDiffRowV1['presence'];
};

export type BlobExplorerBuildIssueSelection = {
  kind: 'build_issue';
  source: Exclude<BlobExplorerFaceSource, 'diff'>;
  issue: FaceBuildIssueV1;
  additive: false;
  frame: true;
};

export type SnapshotKindV1 =
  | 'panic'
  | 'normal'
  | 'save_mismatch'
  | 'pre_restore'
  | 'pre_field_edit'
  | 'restored'
  | 'field_edit';

export type BlobExplorerHistoryRowV1 = {
  snapshotId: string;
  revision: string;
  revisionNumber: number;
  timestampMs: number;
  sha256: string;
  bytes: number;
  label: string;
  note?: string;
  kind: SnapshotKindV1;
  triangles: number;
  authoredFaces: number;
  parts: number;
  logicalVertices: number;
  pinned: boolean;
  pushState: 'pushed' | 'local' | 'unknown';
  expiresAtMs: number;
  identityQuality: 'exact' | 'degraded';
  warning?: string;
  objectNamespaceHash: string;
  recoveryDegradations: RecoveryDegradationV1[];
};

export type BlobExplorerHistoryCorruptRowV1 = {
  snapshotId: string;
  revision: string | null;
  timestampMs: number | null;
  state: 'corrupt';
  code: 'corrupt_event' | 'hash_mismatch' | 'legacy_unreadable' | 'legacy_migration_failed';
  detail: string;
  legacyAddress?: string;
  actionsAvailable: false;
};

export type BlobExplorerHistoryEntryV1 =
  | BlobExplorerHistoryRowV1
  | BlobExplorerHistoryCorruptRowV1;

export type BlobExplorerHistoryStateV1 = {
  loading: boolean;
  error: string | null;
  rows: BlobExplorerHistoryEntryV1[];
  cursor: string | null;
  nextCursor: string | null;
  indexedRepair: 'not_needed' | 'repaired' | 'partial';
};

export type BlobExplorerStableRowActionV1 = {
  snapshotId: string;
  expectedRevision: string;
  expectedSha256: string;
  expectedObjectNamespaceHash: string;
};

export type BlobExplorerRecoverySnapshotDraftV1 = {
  kind: 'panic';
  label: string;
  note?: string;
  push: false;
};

export type BlobExplorerServerStatusV1 = {
  state: 'checking' | 'ready' | 'local' | 'blocked';
  library: { available: boolean; version: string | null };
  repository: { ready: boolean; path: string; revision: string | null };
  service: {
    healthy: boolean;
    healthUrl: string;
    httpCode: number | null;
    unitName: string;
    active: boolean;
    enabled: boolean;
    journalTail: string[];
    restoreCommands: string[];
  };
  stores: { snapshotRoot: string; localBytes: number; serverBytes: number | null };
  retention: {
    days: 60;
    nowMs: number;
    lastPruneMs: number | null;
    nextPruneMs: number | null;
    immediatelyExpired: number;
    localTombstones: number;
    remotePendingTombstones: number;
    logicallyRemovedEntries: number;
    logicallyRemovedBytes: number;
    physicallyReclaimedBytes: number;
    remoteWatermark: string | null;
    legacyUnexpiredPending: number;
    legacyCorruptPending: number;
    legacyLayoutCutover: boolean;
    lastError: string | null;
  };
  history: { pushed: number; local: number; unknown: number };
  probe: { lastCompletedMs: number | null; lastTransitionMs: number | null };
};

export type BlobExplorerSurfaceProps = {
  modelId: string;
  // `height` is gone (req_4775): the surface flexes into its container, so a
  // caller that supplied one was overriding the layout, not informing it.
  initialTab?: BlobExplorerTab;
  widthPreset: BlobExplorerWidthPreset;
  onWidthPreset: (preset: BlobExplorerWidthPreset) => void;
  faceQuery: BlobExplorerFaceQuery;
  facePage: BlobExplorerFacePage | null;
  faceError: FaceTableErrorV1 | null;
  faceLoading: boolean;
  selectedAddress?: FaceAddressV1 | null;
  selectedTriangles?: number | null;
  canPageFacesBackward?: boolean;
  onFaceQueryChange: (query: BlobExplorerFaceQuery) => void;
  onPreviousFacePage?: () => void;
  onSelectFace: (selection: BlobExplorerFaceSelection) => void;
  onSelectBuildIssue?: (selection: BlobExplorerBuildIssueSelection) => void;
  /** Compact native selection follow event; no geometry crosses React state. */
  onViewportFaceSelection?: (selection: { address: FaceAddressV1; selectedTriangles: number } | null) => void;
  history: BlobExplorerHistoryStateV1;
  recoverySnapshotEnabled: boolean;
  recoverySnapshotInFlight: boolean;
  recoverySnapshotStatus?: string | null;
  onRecoverySnapshot: (draft: BlobExplorerRecoverySnapshotDraftV1) => void;
  onHistoryPage: (cursor: string | null) => void;
  canPageHistoryBackward?: boolean;
  onPreviousHistoryPage?: () => void;
  onPin: (row: BlobExplorerStableRowActionV1, pinned: boolean) => void;
  onPreview: (row: BlobExplorerStableRowActionV1) => void;
  activePreview?: {
    modelId: string;
    snapshotId: string;
    resolvedRevision: string;
    sha256: string;
    capabilityToken: string;
    previewToken: string;
    triangleCount: number;
  } | null;
  onClosePreview?: () => void;
  restoreEnabled: boolean;
  restoreConfirmSnapshotId?: string | null;
  onRestore: (row: BlobExplorerStableRowActionV1) => void;
  onCopySnapshotId?: (snapshotId: string) => void;
  guardedFieldEditEnabled?: boolean;
  guardedFieldEditStatus?: string | null;
  onGuardedFieldApply?: (request: {
    address: FaceAddressV1;
    field: BlobGuardedFieldV1;
    value: number;
  }) => void;
  service: BlobExplorerServerStatusV1;
};

export const BLOB_EXPLORER_UI = {
  /** The narrowest the face table can render its columns. The focus panel's
   *  drag floor is derived from this (req_4774). */
  minimumDataWidth: 320,
} as const;


const SORT_LABELS: Record<FaceTableSortColumnV1, string> = {
  address: 'ADDRESS',
  area: 'AREA',
  centroidEdgeClearance: 'CLEARANCE',
  minEdge: 'MIN EDGE',
  maxEdge: 'MAX EDGE',
  aspect: 'ASPECT',
  planarityDeviation: 'PLANARITY',
  triangleCount: 'TRIS',
};

const SIMPLE_FILTERS: readonly Readonly<{ filter: FaceTableFilterV1; label: string }>[] = [
  { filter: { kind: 'malformed' }, label: 'MALFORMED' },
  { filter: { kind: 'degenerate' }, label: 'DEGENERATE' },
  { filter: { kind: 'non_planar' }, label: 'NON-PLANAR' },
  { filter: { kind: 'concave' }, label: 'CONCAVE' },
  { filter: { kind: 'tiny' }, label: 'TINY' },
  { filter: { kind: 'unnamed' }, label: 'UNNAMED' },
  { filter: { kind: 'intersecting' }, label: 'INTERSECTING' },
  { filter: { kind: 'unreachable' }, label: 'UNREACHABLE' },
];

export function faceAddressKey(address: FaceAddressV1): string {
  return `${address.stability}:${address.objectId}:${address.group}:${address.artifactFaceOrdinal ?? ''}`;
}

export function faceFilterKey(filter: FaceTableFilterV1): string {
  if (filter.kind === 'operation_blocked') return `${filter.kind}:${filter.operation}`;
  if (filter.kind === 'tiny') return `${filter.kind}:${filter.maxArea ?? 'default'}`;
  return filter.kind;
}

export function toggleBlobExplorerFaceFilter(
  query: BlobExplorerFaceQuery,
  filter: FaceTableFilterV1,
): BlobExplorerFaceQuery {
  const key = faceFilterKey(filter);
  const exists = query.filters.some((row) => faceFilterKey(row) === key);
  return {
    ...query,
    filters: exists
      ? query.filters.filter((row) => faceFilterKey(row) !== key)
      : [...query.filters, filter],
    cursor: null,
  };
}

export function sortBlobExplorerFaces(
  query: BlobExplorerFaceQuery,
  column: FaceTableSortColumnV1,
): BlobExplorerFaceQuery {
  return {
    ...query,
    sort: {
      column,
      direction: query.sort.column === column && query.sort.direction === 'asc' ? 'desc' : 'asc',
    },
    cursor: null,
  };
}

export function sourceBlobExplorerFaces(
  query: BlobExplorerFaceQuery,
  source: BlobExplorerFaceSource,
): BlobExplorerFaceQuery {
  return { ...query, source, cursor: null };
}

export function pageBlobExplorerFaces(
  query: BlobExplorerFaceQuery,
  cursor: string | null,
): BlobExplorerFaceQuery {
  return { ...query, cursor };
}

export type BlobExplorerFaceState = 'loading' | 'pending' | 'error' | 'empty' | 'ready';

export function blobExplorerFaceState(
  page: BlobExplorerFacePage | null,
  error: FaceTableErrorV1 | null,
  loading: boolean,
): BlobExplorerFaceState {
  if (error?.code === 'analysis_pending') return 'pending';
  if (error) return 'error';
  if (loading || !page) return 'loading';
  return page.rows.length === 0 ? 'empty' : 'ready';
}

export function faceSelectionForRow(
  source: BlobExplorerFaceSource,
  row: DisplayFaceRow | FaceDiffRowV1,
): BlobExplorerFaceSelection | null {
  if ('presence' in row) {
    if (row.presence === 'incomparable') return null;
    const savedOnly = row.presence === 'saved_only';
    return {
      kind: 'face',
      source,
      plane: savedOnly ? 'saved_preview' : 'resident',
      address: savedOnly
        ? row.savedAddress ?? row.address
        : row.residentAddress ?? row.address,
      additive: false,
      frame: true,
      presence: row.presence,
    };
  }
  return {
    kind: 'face',
    source,
    plane: source === 'saved' ? 'saved_preview' : source === 'preview' ? 'preview' : 'resident',
    address: row.address,
    additive: false,
    frame: true,
  };
}

export type BlobExplorerFaceRowView = {
  key: string;
  row: AuthoredFaceRowV1 | null;
  name: string;
  object: string;
  material: string;
  semantic: string;
  address: string;
  surface: string;
  geometry: string;
  topology: string;
  audit: string;
  blockedBy: string;
  presence: string | null;
  changes: string | null;
  reason: string | null;
};

function numberText(value: number | null, suffix = ''): string {
  if (value === null) return 'UNKNOWN';
  const absolute = Math.abs(value);
  const text = absolute !== 0 && (absolute < 0.001 || absolute >= 100000)
    ? value.toExponential(3)
    : value.toFixed(4).replace(/\.?0+$/, '');
  return `${text}${suffix}`;
}

export function blobExplorerFaceRowView(
  item: DisplayFaceRow | FaceDiffRowV1,
): BlobExplorerFaceRowView {
  const diff = 'presence' in item ? item : null;
  const row = diff ? diff.resident ?? diff.saved : item;
  if (!row) return {
    key: faceAddressKey(item.address),
    row: null,
    name: 'INCOMPARABLE FACE',
    object: item.address.objectId,
    material: 'UNKNOWN',
    semantic: 'UNKNOWN',
    address: `${item.address.objectId} / group ${item.address.group}`,
    surface: 'UNKNOWN',
    geometry: 'UNKNOWN',
    topology: 'UNKNOWN',
    audit: 'UNKNOWN — no comparable display row',
    blockedBy: 'NONE',
    presence: diff?.presence ?? null,
    changes: diff ? [...diff.changedFields, ...diff.incomparableFields.map((field) => `${field}:INCOMPARABLE`)].join(', ') || 'UNCHANGED' : null,
    reason: diff?.reason ?? null,
  };
  const display = 'display' in row ? row.display : null;
  const faceName = display?.faceName ?? row.durableLabels.faceName;
  const semanticName = display?.semanticName
    ?? row.durableLabels.semanticInstanceName
    ?? row.durableLabels.semanticRegionName;
  const audit = !row.audit.computed
    ? 'UNKNOWN — audit not computed'
    : `${row.audit.intersecting ? `INTERSECTING ${row.audit.intersectingTriangles}` : 'clear intersections'} · ${row.audit.unreachable ? `UNREACHABLE ${row.audit.unreachableTriangles}` : 'reachable'}`;
  return {
    key: faceAddressKey(item.address),
    row,
    name: faceName ?? 'UNNAMED FACE',
    object: display?.objectName ?? row.address.objectId,
    material: `${display?.materialName ?? 'material'} #${row.material}`,
    semantic: `${semanticName ?? 'unnamed'} · r${row.semantic.region}:i${row.semantic.instance}`,
    address: `${row.address.objectId} / group ${row.address.group}${row.address.stability === 'artifact_rank' ? ` / artifact face ${row.address.artifactFaceOrdinal}` : ''}`,
    surface: `${row.visibility} · ${row.renderClass}`,
    geometry: `area ${numberText(row.geometry.area)} · clearance ${numberText(row.geometry.centroidEdgeClearance)} · edge ${numberText(row.geometry.minEdge)}–${numberText(row.geometry.maxEdge)} · aspect ${numberText(row.geometry.aspect)}`,
    topology: `${row.geometry.cornerCount} corners · ${row.geometry.triangleCount} tris · ${row.geometry.convexity} · ${row.boundary.status}${row.boundary.issueCode ? ` (${row.boundary.issueCode})` : ''} · planarity ${numberText(row.geometry.planarityDeviation)}`,
    audit,
    blockedBy: formatFaceBlockedBy(row) || 'NONE',
    presence: diff?.presence ?? null,
    changes: diff ? [...diff.changedFields, ...diff.incomparableFields.map((field) => `${field}:INCOMPARABLE`)].join(', ') || 'UNCHANGED' : null,
    reason: diff?.reason ?? null,
  };
}

export function stableHistoryAction(
  row: BlobExplorerHistoryEntryV1,
): BlobExplorerStableRowActionV1 | null {
  return 'state' in row && row.state === 'corrupt' ? null : {
    snapshotId: row.snapshotId,
    expectedRevision: row.revision,
    expectedSha256: row.sha256,
    expectedObjectNamespaceHash: row.objectNamespaceHash,
  };
}

export function recoveryRestoreEnabled(
  row: BlobExplorerHistoryRowV1,
  restoreEnabled: boolean,
  historicalPreviewActive: boolean,
): boolean {
  return restoreEnabled && !historicalPreviewActive && row.identityQuality === 'exact' &&
    row.recoveryDegradations.length === 0;
}

export function recoveryRestoreConfirmationAction(
  confirmedSnapshotId: string | null,
  requestedSnapshotId: string,
): 'arm' | 'execute' {
  return confirmedSnapshotId === requestedSnapshotId ? 'execute' : 'arm';
}

export function guardedFieldApplyEnabled(input: {
  mode: BlobExplorerModeV1;
  coordinatorReady: boolean;
  historicalPreviewActive: boolean;
  stableFaceSelected: boolean;
  draftValid: boolean;
  applyHandlerReady: boolean;
}): boolean {
  return input.mode === 'guarded_field_edit' && input.coordinatorReady &&
    !input.historicalPreviewActive && input.stableFaceSelected &&
    input.draftValid && input.applyHandlerReady;
}

export function recoverySnapshotDraft(
  label: string,
  note: string,
): BlobExplorerRecoverySnapshotDraftV1 {
  const normalizedLabel = label.trim() || 'Manual recovery snapshot';
  const normalizedNote = note.trim();
  return {
    kind: 'panic',
    label: normalizedLabel,
    ...(normalizedNote ? { note: normalizedNote } : {}),
    push: false,
  };
}

export function recoveryDegradationLines(rows: readonly RecoveryDegradationV1[]): string[] {
  return rows.map((row) =>
    `${row.channel} · ${row.actions.join('+')} · ${row.reasons.join('+')} · ${row.affectedCount} affected`);
}

export function formatBlobBytes(value: number | null): string {
  if (value === null) return 'UNKNOWN';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export function formatBlobTime(value: number | null): string {
  if (value === null) return 'UNKNOWN';
  try { return new Date(value).toISOString(); } catch { return 'INVALID TIME'; }
}

export function blobExplorerServiceLines(status: BlobExplorerServerStatusV1): string[] {
  return [
    `${status.state.toUpperCase()} · library ${status.library.available ? status.library.version ?? 'available' : 'unavailable'}`,
    `repository ${status.repository.ready ? status.repository.revision ?? 'ready' : 'not ready'} · ${status.repository.path}`,
    `service ${status.service.healthy ? 'healthy' : 'unhealthy'} · HTTP ${status.service.httpCode ?? 'UNKNOWN'} · ${status.service.healthUrl} · unit ${status.service.active ? 'active' : 'inactive'}/${status.service.enabled ? 'enabled' : 'disabled'}`,
    `store ${formatBlobBytes(status.stores.localBytes)} local · ${formatBlobBytes(status.stores.serverBytes)} server · ${status.stores.snapshotRoot}`,
    `retention ${status.retention.days} days · pin does not extend the hard age ceiling`,
    `tombstones ${status.retention.localTombstones} local · ${status.retention.remotePendingTombstones} remote pending · ${status.retention.immediatelyExpired} immediately expired`,
    `removed ${status.retention.logicallyRemovedEntries} entries / ${formatBlobBytes(status.retention.logicallyRemovedBytes)} logical · ${formatBlobBytes(status.retention.physicallyReclaimedBytes)} reclaimed`,
    `legacy ${status.retention.legacyUnexpiredPending} pending · ${status.retention.legacyCorruptPending} corrupt · cutover ${status.retention.legacyLayoutCutover ? 'complete' : 'blocked'}`,
  ];
}

/** A toggle chip. This used to be a private `TinyButton` with its own border,
 *  radius, height and hex palette — which is most of why the pane read as a
 *  regurgitation of badges rather than as part of the editor. It is the shared
 *  pill now, so a filter here looks like a filter anywhere else (req_4775). */
function Chip({ label, active = false, disabled = false, tone = 'normal', onPress }: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  tone?: 'normal' | 'warning';
  onPress?: () => void;
}) {
  const Shell = active ? C.HW_PillOn : C.HW_Pill;
  const Label = active ? C.HW_PillTextOn : C.HW_PillText;
  return (
    <Shell
      onPress={disabled ? undefined : onPress}
      style={{
        height: 21,
        ...(disabled ? { opacity: 0.4 } : {}),
        ...(tone === 'warning' && !active ? { borderColor: accentFor('warning') } : {}),
      }}
    >
      <Label style={tone === 'warning' && !active ? { color: accentFor('warning') } : undefined}>{label}</Label>
    </Shell>
  );
}

/** One label/value fact. Delegates to the focus panel's shared row grammar, so
 *  recovery facts sit on the same column grid as every other panel fact AND
 *  stack with them when the panel is narrow (req_4774). */
function Fact({ label, value, tone = 'normal' }: {
  label: string;
  value: string;
  tone?: 'normal' | 'warning' | 'danger' | 'success';
}) {
  return <FactRow label={label} value={value} endColumn={false} tone={tone} />;
}

function DegradationRows({ rows }: { rows: readonly RecoveryDegradationV1[] }) {
  if (!rows.length) return null;
  return (
    <Col style={{ width: '100%', gap: 2, paddingTop: 3, paddingBottom: 4 }}>
      {recoveryDegradationLines(rows).map((line, index) => (
        <C.HW_BNoticeBody key={`${line}-${index}`} style={{ paddingLeft: 12, paddingRight: 12, color: accentFor('warning') }}>{line}</C.HW_BNoticeBody>
      ))}
    </Col>
  );
}

function FaceIdentity({ page }: { page: BlobExplorerFacePage }) {
  if (page.source === 'diff') {
    return (
      <Col style={{ width: '100%', paddingTop: 5, paddingBottom: 5, borderBottomWidth: 1, borderColor: accentFor('borderSoft') }}>
        <Fact label="resident" value={`${page.resident.identityQuality.toUpperCase()} · ${page.resident.objectNamespaceHash}`} tone={page.resident.identityQuality === 'degraded' ? 'warning' : 'success'} />
        <Fact label="saved" value={`${page.saved.identityQuality.toUpperCase()} · ${page.saved.objectNamespaceHash}`} tone={page.saved.identityQuality === 'degraded' ? 'warning' : 'success'} />
        <Fact label="fingerprints" value={`topology ${page.fingerprints.topologyEqual ? 'equal' : 'different'} · semantics ${page.fingerprints.semanticEqual ? 'equal' : 'different'} · objects ${page.fingerprints.objectBindingsEqual ? 'equal' : 'different'} · build provenance ${page.fingerprints.buildIssueProvenanceEqual ? 'equal' : 'different'}`} />
        <Fact label="correspond" value={`${page.correspondence.kind} · ${page.correspondence.comparableLogicalVertices} comparable / ${page.correspondence.incomparableLogicalVertices} incomparable${page.correspondence.reason ? ` · ${page.correspondence.reason}` : ''}`} tone={page.correspondence.kind === 'incomparable' ? 'warning' : 'normal'} />
        <Fact label="changes" value={`${page.counts.changed} changed · ${page.counts.relocated} relocated · ${page.counts.residentOnly} resident-only · ${page.counts.savedOnly} saved-only · ${page.counts.incomparable} incomparable`} />
        <DegradationRows rows={[...page.resident.recoveryDegradations, ...page.saved.recoveryDegradations]} />
      </Col>
    );
  }
  const identity = page.source === 'resident'
    ? `generation ${page.generation} · session ${page.sessionToken}`
    : `SHA ${page.artifact?.sha256 ?? 'UNKNOWN'} · RJMD v${page.artifact?.formatVersion ?? 'UNKNOWN'}`;
  return (
    <Col style={{ width: '100%', paddingTop: 7, paddingBottom: 7, borderBottomWidth: 1, borderColor: accentFor('borderSoft') }}>
      <Fact label="plane" value={`${page.source.toUpperCase()} · ${identity}`} />
      <Fact label="identity" value={`${page.identityQuality.toUpperCase()} · ${page.objectNamespaceHash}`} tone={page.identityQuality === 'degraded' ? 'warning' : 'success'} />
      <Fact label="fingerprint" value={`${page.fingerprint.topologyHash} · ${page.fingerprint.semanticHash} · ${page.fingerprint.objectBindingHash}`} />
      <Fact label="audit" value={page.audit.computed ? `${page.audit.directions} directions${page.audit.overBudget ? ' · OVER BUDGET' : ''}` : 'UNKNOWN — not computed'} tone={!page.audit.computed ? 'warning' : 'normal'} />
      <DegradationRows rows={page.recoveryDegradations} />
    </Col>
  );
}

function FacesView(props: BlobExplorerSurfaceProps & {
  expanded: readonly string[];
  onToggleExpanded: (key: string) => void;
  mode: BlobExplorerModeV1;
  onMode: (mode: BlobExplorerModeV1) => void;
  guardedField: BlobGuardedFieldV1;
  onGuardedField: (field: BlobGuardedFieldV1) => void;
  guardedValue: string;
  onGuardedValue: (value: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  sortOpen: boolean;
  onToggleSort: () => void;
}) {
  const { faceQuery: query, facePage: page, faceError: error } = props;
  const state = blobExplorerFaceState(page, error, props.faceLoading);
  const filters = [
    ...SIMPLE_FILTERS,
    ...FACE_OPERATIONS.map((operation) => ({
      filter: { kind: 'operation_blocked', operation } as FaceTableFilterV1,
      label: `BLOCKED:${operation.replace('_', '-')}`,
    })),
  ];
  const rows = !page ? [] : page.source === 'diff'
    ? page.rows
    : page.rows;
  const guardedDraft = validateBlobGuardedFieldDraft(props.guardedField, props.guardedValue);
  const guardedApplyEnabled = guardedFieldApplyEnabled({
    mode: props.mode,
    coordinatorReady: props.guardedFieldEditEnabled === true,
    historicalPreviewActive: !!props.activePreview,
    stableFaceSelected: props.selectedAddress?.stability === 'stable',
    draftValid: guardedDraft.ok,
    applyHandlerReady: props.onGuardedFieldApply !== undefined,
  });
  return (
    <Col style={{ width: '100%' }}>
      <C.HW_BQuery>
        <C.HW_BQueryRow>
          <Chip label="INSPECT" active={props.mode === 'inspect'} onPress={() => props.onMode('inspect')} />
          <Chip label="GUARDED FIELD EDIT" tone="warning" active={props.mode === 'guarded_field_edit'} onPress={() => props.onMode('guarded_field_edit')} />
        </C.HW_BQueryRow>
        {props.mode === 'guarded_field_edit' ? (
          <C.HW_BGuardBox>
            <C.HW_BGuardWarn>ONLY MATERIAL AND SEMANTIC TABLE IDS ARE WRITABLE HERE</C.HW_BGuardWarn>
            <C.HW_BChipWrap>
              {BLOB_GUARDED_FIELDS.map((field) => (
                <Chip key={field} label={field.replace('_', ' ').toUpperCase()} active={props.guardedField === field} onPress={() => props.onGuardedField(field)} />
              ))}
            </C.HW_BChipWrap>
            {guardedDraft.ok
              ? <C.HW_BInput value={props.guardedValue} onChange={props.onGuardedValue} placeholder="unsigned table id" />
              : <C.HW_BInputBad value={props.guardedValue} onChange={props.onGuardedValue} placeholder="unsigned table id" />}
            {!guardedDraft.ok ? <C.HW_BGuardWarn style={{ color: accentFor('error') }}>{guardedDraft.detail}</C.HW_BGuardWarn> : null}
            {!props.selectedAddress ? <C.HW_BGuardWarn>Select one resident authored face first.</C.HW_BGuardWarn> : null}
            {props.activePreview ? <C.HW_BGuardWarn>Close the read-only historical preview before editing resident fields.</C.HW_BGuardWarn> : null}
            {!props.guardedFieldEditEnabled ? <C.HW_BGuardNote>Apply is locked until the native lease-backed transaction coordinator is ready.</C.HW_BGuardNote> : null}
            {props.guardedFieldEditStatus ? <C.HW_BGuardNote style={{ color: accentFor('textDim') }}>{props.guardedFieldEditStatus}</C.HW_BGuardNote> : null}
            <Chip
              label="VALIDATE + APPLY"
              tone="warning"
              disabled={!guardedApplyEnabled}
              onPress={() => {
                if (!guardedApplyEnabled || !guardedDraft.ok || !props.selectedAddress) return;
                props.onGuardedFieldApply?.({
                  address: props.selectedAddress,
                  field: guardedDraft.draft.field,
                  value: guardedDraft.draft.value,
                });
              }}
            />
          </C.HW_BGuardBox>
        ) : null}
      </C.HW_BQuery>
      {/* THE QUERY HEADER. This was four stacked wrap-rows of chips — mode,
          source, sixteen filters, eight sort columns — each with its own
          padding and divider. At panel width that is five or six wrapped rows
          of chrome standing between you and the face table, which is the dead
          space the pane was called out for. The permanent header is now the
          SOURCE (which plane you are reading) plus one line saying what is
          filtered and how it is sorted; the full chip sets open on demand and
          the ACTIVE ones stay visible either way, so nothing is hidden — only
          the sixteen you are not using. */}
      <C.HW_BQuery>
        <C.HW_BQueryRow>
          {BLOB_EXPLORER_FACE_SOURCES.map((source) => (
            <Chip
              key={source}
              label={source.toUpperCase()}
              active={query.source === source}
              disabled={source === 'preview' && !props.activePreview}
              onPress={() => props.onFaceQueryChange(sourceBlobExplorerFaces(query, source))}
            />
          ))}
        </C.HW_BQueryRow>
        <C.HW_BQueryRow>
          {(() => {
            const Disclosure = props.filtersOpen ? C.HW_BDisclosureOn : C.HW_BDisclosure;
            const DisclosureText = props.filtersOpen ? C.HW_BDisclosureTextOn : C.HW_BDisclosureText;
            return (
              <Disclosure onPress={props.onToggleFilters} tooltip="Show every face filter">
                <DisclosureText>{`FILTERS${query.filters.length ? ` · ${query.filters.length}` : ''}`}</DisclosureText>
                <Icon name={props.filtersOpen ? 'ChevronUp' : 'ChevronDown'} size={9} color={accentFor(props.filtersOpen ? 'primary' : 'textDim')} />
              </Disclosure>
            );
          })()}
          {(() => {
            const Disclosure = props.sortOpen ? C.HW_BDisclosureOn : C.HW_BDisclosure;
            const DisclosureText = props.sortOpen ? C.HW_BDisclosureTextOn : C.HW_BDisclosureText;
            return (
              <Disclosure onPress={props.onToggleSort} tooltip="Choose the sort column">
                <DisclosureText>{`SORT · ${SORT_LABELS[query.sort.column]} ${query.sort.direction === 'asc' ? '↑' : '↓'}`}</DisclosureText>
                <Icon name={props.sortOpen ? 'ChevronUp' : 'ChevronDown'} size={9} color={accentFor(props.sortOpen ? 'primary' : 'textDim')} />
              </Disclosure>
            );
          })()}
        </C.HW_BQueryRow>
        {/* Active filters stay on screen whether or not the set is open —
            a filter you cannot see is a query you cannot explain. */}
        {!props.filtersOpen && query.filters.length ? (
          <C.HW_BChipWrap>
            {query.filters.map((filter) => {
              const label = filters.find((row) => faceFilterKey(row.filter) === faceFilterKey(filter))?.label ?? filter.kind.toUpperCase();
              return <Chip key={faceFilterKey(filter)} label={label} active onPress={() => props.onFaceQueryChange(toggleBlobExplorerFaceFilter(query, filter))} />;
            })}
          </C.HW_BChipWrap>
        ) : null}
        {props.filtersOpen ? (
          <C.HW_BChipWrap>
            {filters.map(({ filter, label }) => {
              const active = query.filters.some((row) => faceFilterKey(row) === faceFilterKey(filter));
              return <Chip key={faceFilterKey(filter)} label={label} active={active} onPress={() => props.onFaceQueryChange(toggleBlobExplorerFaceFilter(query, filter))} />;
            })}
          </C.HW_BChipWrap>
        ) : null}
        {props.sortOpen ? (
          <C.HW_BChipWrap>
            {FACE_TABLE_SORT_COLUMNS.map((column) => (
              <Chip
                key={column}
                label={`${SORT_LABELS[column]}${query.sort.column === column ? query.sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}`}
                active={query.sort.column === column}
                onPress={() => props.onFaceQueryChange(sortBlobExplorerFaces(query, column))}
              />
            ))}
          </C.HW_BChipWrap>
        ) : null}
      </C.HW_BQuery>
      {page ? <FaceIdentity page={page} /> : null}
      {state === 'loading' ? <Fact label="faces" value="LOADING FACE ANALYSIS…" /> : null}
      {state === 'pending' && error?.code === 'analysis_pending' ? (
        <Col style={{ width: '100%', paddingTop: 6, paddingBottom: 6 }}>
          <Fact label="analysis" value={`${error.analysisId} · ${Math.round(error.progress * 100)}% · retry after ${error.retryAfterMs} ms`} tone="warning" />
          <Fact label="plane hash" value={error.planeIdentityHash} />
          <Fact label="detail" value={error.detail} />
        </Col>
      ) : null}
      {state === 'error' && error ? (
        <C.HW_BNoticeError>
          <Fact label={error.code.toUpperCase()} value={error.detail} tone="danger" />
          {'currentGeneration' in error && error.currentGeneration !== undefined
            ? <Fact label="generation" value={String(error.currentGeneration)} tone="warning" />
            : null}
        </C.HW_BNoticeError>
      ) : null}
      {state === 'empty' ? <Fact label="faces" value="NO AUTHORED FACES MATCH THIS QUERY" /> : null}
      {state === 'ready' ? rows.map((item) => {
        const view = blobExplorerFaceRowView(item);
        const selection = faceSelectionForRow(query.source, item);
        const selected = props.selectedAddress
          ? faceAddressKey(props.selectedAddress) === faceAddressKey(selection?.address ?? item.address)
          : false;
        const expanded = props.expanded.includes(view.key);
        return (
          <Col key={view.key} style={{ width: '100%' }}>
            {(() => {
              const RowShell = selected ? C.HW_BRowOn : C.HW_BRow;
              return (
                <RowShell>
                  <C.HW_BRowBody
                    onPress={selection ? () => props.onSelectFace(selection) : undefined}
                    style={selection ? undefined : { opacity: 0.55 }}
                  >
                    <C.HW_BRowTitle>
                      <C.HW_BRowName>{view.name}</C.HW_BRowName>
                      {view.presence ? <C.HW_BRowLine style={{ color: accentFor(view.presence === 'incomparable' ? 'warning' : 'primary'), fontWeight: 800 }}>{view.presence.toUpperCase()}</C.HW_BRowLine> : null}
                    </C.HW_BRowTitle>
                    <C.HW_BRowAddress>{view.address}</C.HW_BRowAddress>
                    <C.HW_BRowLine>{`${view.object} · ${view.material} · ${view.semantic}`}</C.HW_BRowLine>
                    <C.HW_BRowLine>{`${view.surface} · ${view.geometry}`}</C.HW_BRowLine>
                    <C.HW_BRowLine>{view.topology}</C.HW_BRowLine>
                    {view.audit.startsWith('UNKNOWN')
                      ? <C.HW_BRowLineWarn>{`AUDIT · ${view.audit}`}</C.HW_BRowLineWarn>
                      : <C.HW_BRowLine>{`AUDIT · ${view.audit}`}</C.HW_BRowLine>}
                    {view.changes && view.changes !== 'UNCHANGED' ? <C.HW_BRowLineWarn>{`DIFF · ${view.changes}`}</C.HW_BRowLineWarn> : null}
                    {view.reason ? <C.HW_BRowLineWarn>{`REASON · ${view.reason}`}</C.HW_BRowLineWarn> : null}
                    {view.blockedBy !== 'NONE' ? <C.HW_BRowLineWarn>{`BLOCKED BY · ${view.blockedBy}`}</C.HW_BRowLineWarn> : null}
                  </C.HW_BRowBody>
                  <C.HW_BRowExpander
                    onPress={() => props.onToggleExpanded(view.key)}
                    tooltip={expanded ? 'Hide triangle ids' : 'Show the triangle ids behind this face'}
                  >
                    <C.HW_BRowExpanderText>{expanded ? '−' : `+${view.row?.triangleIds.length ?? 0}`}</C.HW_BRowExpanderText>
                  </C.HW_BRowExpander>
                </RowShell>
              );
            })()}
            {expanded ? (
              <C.HW_BTriangles>{`TRIANGLES · ${view.row?.triangleIds.join(', ') || 'none'}`}</C.HW_BTriangles>
            ) : null}
          </Col>
        );
      }) : null}
      {page && page.source !== 'diff' && page.buildIssues.map((issue) => (
        <C.HW_BNotice
          key={`${issue.objectId}:${issue.sourceGroup}:${issue.code}`}
          onPress={props.onSelectBuildIssue ? () => props.onSelectBuildIssue?.({ kind: 'build_issue', source: query.source === 'diff' ? 'resident' : query.source, issue, additive: false, frame: true }) : undefined}
        >
          <C.HW_BNoticeTitle>{`BUILD ISSUE · ${issue.code}`}</C.HW_BNoticeTitle>
          <C.HW_BNoticeBody>{`${issue.objectId} / source group ${issue.sourceGroup} · ${issue.sourceTriangles.length} source tris → groups ${issue.degradedToGroups.join(', ') || 'none'}`}</C.HW_BNoticeBody>
          <C.HW_BNoticeBody style={{ color: accentFor('textSecondary') }}>{issue.detail}</C.HW_BNoticeBody>
        </C.HW_BNotice>
      ))}
      <C.HW_BPager>
        <Chip label="PREVIOUS" disabled={!props.canPageFacesBackward} onPress={props.onPreviousFacePage} />
        <C.HW_BPagerText>
          {page ? `${page.matchedRows}/${page.totalRows} matched · ${page.rows.length} on page${props.selectedTriangles != null ? ` · ${props.selectedTriangles} selected tris` : ''}` : 'no page'}
        </C.HW_BPagerText>
        <Chip label="NEXT" disabled={!page?.nextCursor} onPress={() => page?.nextCursor && props.onFaceQueryChange(pageBlobExplorerFaces(query, page.nextCursor))} />
      </C.HW_BPager>
    </Col>
  );
}

function VersionsView(props: BlobExplorerSurfaceProps & {
  expanded: readonly string[];
  onToggleExpanded: (snapshotId: string) => void;
  label: string;
  note: string;
  onLabel: (value: string) => void;
  onNote: (value: string) => void;
}) {
  const history = props.history;
  return (
    <Col style={{ width: '100%' }}>
      <C.HW_BQuery>
        <C.HW_BGuardNote>Lore revision contains RJMD geometry and embedded mesh channels. Textures, RJSK, manifest, and package sidecars are outside this artifact scope.</C.HW_BGuardNote>
        {props.activePreview ? (
          <C.HW_BGuardBox style={{ borderColor: accentFor('primary') }}>
            <C.HW_BGuardWarn style={{ color: accentFor('primary') }}>HISTORICAL PREVIEW · READ ONLY</C.HW_BGuardWarn>
            <C.HW_BNoticeBody style={{ color: accentFor('textSecondary') }}>{`${props.activePreview.snapshotId} · ${props.activePreview.sha256.slice(0, 12)} · ${props.activePreview.triangleCount} tris`}</C.HW_BNoticeBody>
            <C.HW_BGuardNote>The resident document, selection, generation, and undo/redo remain parked and unchanged.</C.HW_BGuardNote>
            <C.HW_BQueryRow><Chip label="CLOSE PREVIEW" tone="warning" onPress={() => props.onClosePreview?.()} /></C.HW_BQueryRow>
          </C.HW_BGuardBox>
        ) : null}
        <C.HW_BInput value={props.label} onChange={props.onLabel} placeholder="Manual recovery snapshot" />
        <C.HW_BInput value={props.note} onChange={props.onNote} placeholder="optional recovery note" />
        <C.HW_BQueryRow><Chip
          label={props.recoverySnapshotInFlight ? 'CAPTURING RECOVERY SNAPSHOT…' : 'RECOVERY SNAPSHOT'}
          active={props.recoverySnapshotEnabled && !props.recoverySnapshotInFlight}
          disabled={!props.recoverySnapshotEnabled || props.recoverySnapshotInFlight}
          tone="warning"
          onPress={() => props.onRecoverySnapshot(recoverySnapshotDraft(props.label, props.note))}
        /></C.HW_BQueryRow>
        {props.recoverySnapshotStatus ? <C.HW_BGuardWarn>{props.recoverySnapshotStatus}</C.HW_BGuardWarn> : null}
      </C.HW_BQuery>
      {history.loading ? <Fact label="history" value="LOADING RECOVERY HISTORY…" /> : null}
      {history.error ? (
        <Col style={{ width: '100%', gap: 4 }}>
          <Fact label="history error" value={history.error} tone="danger" />
          <C.HW_BQueryRow style={{ paddingLeft: 12, paddingRight: 12 }}><Chip label="RETRY HISTORY" onPress={() => props.onHistoryPage(null)} /></C.HW_BQueryRow>
        </Col>
      ) : null}
      {!history.loading && !history.error && history.rows.length === 0 ? <Fact label="history" value="NO RECOVERY SNAPSHOTS" /> : null}
      {history.rows.map((entry) => {
        if ('state' in entry && entry.state === 'corrupt') {
          return (
            <C.HW_BNoticeError key={entry.snapshotId}>
              <C.HW_BNoticeTitle style={{ color: accentFor('error') }}>{`NON-ACTIONABLE · ${entry.code.toUpperCase()}`}</C.HW_BNoticeTitle>
              <C.HW_BNoticeBody style={{ color: accentFor('textSecondary') }}>{entry.detail}</C.HW_BNoticeBody>
              <C.HW_BNoticeBody>{`${entry.snapshotId} · ${entry.revision ?? 'no revision'} · ${entry.legacyAddress ?? 'no legacy address'}`}</C.HW_BNoticeBody>
            </C.HW_BNoticeError>
          );
        }
        const action = stableHistoryAction(entry)!;
        const expanded = props.expanded.includes(entry.snapshotId);
        const pushTone = entry.pushState === 'pushed' ? 'success' : entry.pushState === 'local' ? 'warning' : 'textFaint';
        return (
          <C.HW_BRow key={entry.snapshotId} style={{ flexDirection: 'column' }}>
            <C.HW_BRowBody>
              <C.HW_BRowTitle>
                <C.HW_BRowName>{entry.label}</C.HW_BRowName>
                <C.HW_BRowLine style={{ color: accentFor(pushTone), fontWeight: 900 }}>{entry.pushState.toUpperCase()}</C.HW_BRowLine>
                <C.HW_BRowLine style={{ color: accentFor(entry.identityQuality === 'degraded' ? 'warning' : 'success'), fontWeight: 900 }}>{entry.identityQuality.toUpperCase()}</C.HW_BRowLine>
              </C.HW_BRowTitle>
              {entry.note ? <C.HW_BRowLine>{entry.note}</C.HW_BRowLine> : null}
              <C.HW_BRowAddress>{`${formatBlobTime(entry.timestampMs)} · ${entry.kind} · revision ${entry.revisionNumber} / ${entry.revision}`}</C.HW_BRowAddress>
              <C.HW_BRowLine>{`${entry.sha256.slice(0, 12)} · ${formatBlobBytes(entry.bytes)} · ${entry.triangles} tris · ${entry.authoredFaces} faces · ${entry.parts} parts · ${entry.logicalVertices} logical verts`}</C.HW_BRowLine>
              <C.HW_BRowAddress>{`snapshot ${entry.snapshotId} · namespace ${entry.objectNamespaceHash} · expires ${formatBlobTime(entry.expiresAtMs)}`}</C.HW_BRowAddress>
              {entry.warning ? <C.HW_BRowLineWarn>{entry.warning}</C.HW_BRowLineWarn> : null}
            </C.HW_BRowBody>
            {entry.recoveryDegradations.length ? (
              <Pressable onPress={() => props.onToggleExpanded(entry.snapshotId)} style={{ width: '100%', paddingLeft: 10, paddingRight: 10, paddingBottom: 3 }}>
                <C.HW_BRowLineWarn>{`${expanded ? 'HIDE' : 'SHOW'} ${entry.recoveryDegradations.length} DEGRADATION CHANNELS`}</C.HW_BRowLineWarn>
              </Pressable>
            ) : null}
            {expanded ? <DegradationRows rows={entry.recoveryDegradations} /> : null}
            <C.HW_BChipWrap style={{ paddingLeft: 10, paddingRight: 10, paddingBottom: 7 }}>
              <Chip label={entry.pinned ? 'UNPIN' : 'PIN'} active={entry.pinned} onPress={() => props.onPin(action, !entry.pinned)} />
              <Chip
                label={props.activePreview?.snapshotId === entry.snapshotId ? 'CLOSE PREVIEW' : 'PREVIEW'}
                active={props.activePreview?.snapshotId === entry.snapshotId}
                onPress={() => props.activePreview?.snapshotId === entry.snapshotId ? props.onClosePreview?.() : props.onPreview(action)}
              />
              <Chip
                label={props.restoreConfirmSnapshotId === entry.snapshotId ? 'CONFIRM RESTORE' : 'RESTORE'}
                tone="warning"
                active={props.restoreConfirmSnapshotId === entry.snapshotId}
                disabled={!recoveryRestoreEnabled(entry, props.restoreEnabled, !!props.activePreview)}
                onPress={() => props.onRestore(action)}
              />
              {props.onCopySnapshotId ? <Chip label="COPY SNAPSHOT ID" onPress={() => props.onCopySnapshotId?.(entry.snapshotId)} /> : null}
            </C.HW_BChipWrap>
          </C.HW_BRow>
        );
      })}
      <C.HW_BPager>
        <Chip label="PREVIOUS" disabled={!props.canPageHistoryBackward} onPress={props.onPreviousHistoryPage} />
        <C.HW_BPagerText>{`${history.rows.length} rows · index ${history.indexedRepair.replace('_', ' ')}`}</C.HW_BPagerText>
        <Chip label="NEXT" disabled={history.nextCursor === null} onPress={() => history.nextCursor && props.onHistoryPage(history.nextCursor)} />
      </C.HW_BPager>
    </Col>
  );
}

/** A block of log lines under a section head — the shape both the journal tail
 *  and the restore commands wanted, written twice with different paddings. */
function LogBlock({ title, lines, empty, command = false }: {
  title: string;
  lines: readonly string[];
  empty: string;
  command?: boolean;
}) {
  const Line = command ? C.HW_BCommandLine : C.HW_BLogLine;
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>{title}</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_KeyText>{lines.length}</C.HW_KeyText>
      </C.HW_SectionHead>
      <Col style={{ width: '100%', gap: 1, paddingLeft: 12, paddingRight: 12 }}>
        {lines.length
          ? lines.map((line, index) => <Line key={`${title}-${index}`}>{line}</Line>)
          : <C.HW_BLogLine>{empty}</C.HW_BLogLine>}
      </Col>
    </C.HW_Section>
  );
}

function ServiceView({ status }: { status: BlobExplorerServerStatusV1 }) {
  const blocked = status.state === 'blocked';
  const tone = blocked ? 'error'
    : status.state === 'local' ? 'warning'
      : status.state === 'ready' ? 'success'
        : 'textFaint';
  return (
    <Col style={{ width: '100%' }}>
      <C.HW_BBanner style={{ borderLeftColor: accentFor(tone) }}>
        <C.HW_BBannerTitle style={{ color: accentFor(tone) }}>{`LORE ${status.state.toUpperCase()}`}</C.HW_BBannerTitle>
        {blocked ? <C.HW_BBannerCopy style={{ color: accentFor('error') }}>LOCAL RECOVERY CAPTURE IS BLOCKED — resolve library and repository failures before relying on snapshots.</C.HW_BBannerCopy> : null}
        {status.state === 'local' ? <C.HW_BBannerCopy style={{ color: accentFor('warning') }}>Local capture remains available; the server is unhealthy or unreachable.</C.HW_BBannerCopy> : null}
      </C.HW_BBanner>
      <C.HW_Section>
        <C.HW_SectionHead>
          <C.HW_AccentBar />
          <C.HW_SectionTitle>SERVICE</C.HW_SectionTitle>
        </C.HW_SectionHead>
        {blobExplorerServiceLines(status).map((line, index) => <Fact key={`${index}-${line}`} label={index === 0 ? 'status' : ''} value={line} tone={blocked && index < 2 ? 'danger' : index === 4 ? 'warning' : 'normal'} />)}
        <Fact label="last prune" value={formatBlobTime(status.retention.lastPruneMs)} />
        <Fact label="next prune" value={formatBlobTime(status.retention.nextPruneMs)} />
        <Fact label="watermark" value={status.retention.remoteWatermark ?? 'UNKNOWN'} />
        <Fact label="history" value={`${status.history.pushed} pushed · ${status.history.local} local · ${status.history.unknown} unknown`} />
        <Fact label="probe" value={`completed ${formatBlobTime(status.probe.lastCompletedMs)} · transition ${formatBlobTime(status.probe.lastTransitionMs)}`} />
        {status.retention.lastError ? <Fact label="prune error" value={status.retention.lastError} tone="danger" /> : null}
      </C.HW_Section>
      <LogBlock title={`JOURNAL · ${status.service.unitName}`} lines={status.service.journalTail} empty="No journal lines." />
      <LogBlock title="RESTORE COMMANDS" lines={status.service.restoreCommands} empty="No restore commands published." command />
    </Col>
  );
}

/**
 * Right-pane recovery workspace. It never mounts a scene, reads a host global,
 * or mutates AppFrame state directly; every operation leaves through a prop.
 */
export default function BlobExplorerSurface(props: BlobExplorerSurfaceProps) {
  const [tab, setTab] = useState<BlobExplorerTab>(props.initialTab ?? 'faces');
  const [mode, setMode] = useState<BlobExplorerModeV1>('inspect');
  const [guardedField, setGuardedField] = useState<BlobGuardedFieldV1>('material');
  const [guardedValue, setGuardedValue] = useState('0');
  const [expandedFaces, setExpandedFaces] = useState<string[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<string[]>([]);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [snapshotNote, setSnapshotNote] = useState('');
  const toggle = (rows: string[], key: string, write: (next: string[]) => void) =>
    write(rows.includes(key) ? rows.filter((row) => row !== key) : [...rows, key]);
  // The surface FLEXES into whatever the focus panel gives it. It used to be a
  // hardcoded 640px tall regardless of the window, which reads as dead space
  // below on a tall window and overflow on a short one — the same bug wearing
  // two faces (req_4775). The tab strip is fixed chrome; the scroll takes the
  // remainder; nothing between them guesses a pixel height.
  return (
    <C.HW_BSurface style={{ minWidth: BLOB_EXPLORER_UI.minimumDataWidth }}>
      <C.HW_BTabStrip>
        {BLOB_EXPLORER_TABS.map((candidate) => {
          const on = tab === candidate;
          const Tab = on ? C.HW_LensTabOn : C.HW_LensTab;
          const Label = on ? C.HW_LensTabLabelOn : C.HW_LensTabLabel;
          return (
            <Tab key={candidate} onPress={() => setTab(candidate)} style={{ height: 22 }}>
              <Label>{candidate.toUpperCase()}</Label>
            </Tab>
          );
        })}
        {/* The C/W width presets were retired by req_4774: the focus panel has ONE
            width now and every pane wears the same left-edge drag, so a second,
            pane-local width control would be two mechanisms disagreeing about
            the same number. The capability moved, it did not disappear. */}
      </C.HW_BTabStrip>
      <C.HW_BScroll showScrollbar>
        {tab === 'faces' ? (
          <FacesView
            {...props}
            expanded={expandedFaces}
            onToggleExpanded={(key) => toggle(expandedFaces, key, setExpandedFaces)}
            mode={mode}
            onMode={setMode}
            guardedField={guardedField}
            onGuardedField={setGuardedField}
            guardedValue={guardedValue}
            onGuardedValue={setGuardedValue}
          />
        ) : tab === 'versions' ? (
          <VersionsView
            {...props}
            expanded={expandedHistory}
            onToggleExpanded={(key) => toggle(expandedHistory, key, setExpandedHistory)}
            label={snapshotLabel}
            note={snapshotNote}
            onLabel={setSnapshotLabel}
            onNote={setSnapshotNote}
          />
        ) : <ServiceView status={props.service} />}
      </C.HW_BScroll>
    </C.HW_BSurface>
  );
}
