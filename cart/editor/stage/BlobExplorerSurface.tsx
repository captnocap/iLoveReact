import { useState } from 'react';
import {
  Box,
  Col,
  Pressable,
  Row,
  ScrollView,
  Text,
  TextInput,
} from '@reactjit/runtime/primitives';
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
  height?: number;
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
  defaultHeight: 640,
  chromeHeight: 42,
  minimumDataWidth: 320,
  rowPadding: 9,
  controlHeight: 25,
} as const;

const COLORS = {
  panel: '#0d1119',
  panelRaised: '#121925',
  row: '#101720',
  rowSelected: '#1b3553',
  border: '#253044',
  borderSoft: '#1b2534',
  text: '#d8e4f3',
  dim: '#93a3b8',
  faint: '#657386',
  primary: '#76b5e8',
  success: '#82c7a0',
  warning: '#e0b86b',
  error: '#ee8a8a',
  degraded: '#d59a68',
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

function TinyButton({ label, active = false, disabled = false, tone = 'normal', onPress }: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  tone?: 'normal' | 'warning' | 'danger';
  onPress?: () => void;
}) {
  const color = tone === 'danger' ? COLORS.error : tone === 'warning' ? COLORS.warning : active ? COLORS.primary : COLORS.dim;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={{
        height: BLOB_EXPLORER_UI.controlHeight,
        paddingLeft: 8,
        paddingRight: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: active ? color : COLORS.border,
        borderRadius: 5,
        backgroundColor: active ? '#18304a' : COLORS.panelRaised,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text noWrap style={{ color, fontSize: 9, fontWeight: 800, fontFamily: 'ui-monospace' }}>{label}</Text>
    </Pressable>
  );
}

function Fact({ label, value, tone = 'normal' }: {
  label: string;
  value: string;
  tone?: 'normal' | 'warning' | 'danger' | 'success';
}) {
  const color = tone === 'danger' ? COLORS.error
    : tone === 'warning' ? COLORS.warning
      : tone === 'success' ? COLORS.success
        : COLORS.text;
  return (
    <Row style={{ width: '100%', minHeight: 22, gap: 8, paddingLeft: 10, paddingRight: 10, alignItems: 'flex-start' }}>
      <Text noWrap style={{ width: 88, color: COLORS.faint, fontSize: 9, fontWeight: 700, fontFamily: 'ui-monospace' }}>{label}</Text>
      <Text style={{ flexGrow: 1, minWidth: 0, color, fontSize: 10, fontFamily: 'ui-monospace' }}>{value}</Text>
    </Row>
  );
}

function DegradationRows({ rows }: { rows: readonly RecoveryDegradationV1[] }) {
  if (!rows.length) return null;
  return (
    <Col style={{ width: '100%', gap: 3, paddingTop: 4, paddingBottom: 5 }}>
      {recoveryDegradationLines(rows).map((line, index) => (
        <Text key={`${line}-${index}`} style={{ color: COLORS.degraded, fontSize: 9, fontFamily: 'ui-monospace' }}>{line}</Text>
      ))}
    </Col>
  );
}

function FaceIdentity({ page }: { page: BlobExplorerFacePage }) {
  if (page.source === 'diff') {
    return (
      <Col style={{ width: '100%', paddingTop: 7, paddingBottom: 7, borderBottomWidth: 1, borderColor: COLORS.borderSoft }}>
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
    <Col style={{ width: '100%', paddingTop: 7, paddingBottom: 7, borderBottomWidth: 1, borderColor: COLORS.borderSoft }}>
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
      <Col style={{ width: '100%', gap: 5, padding: 8, borderBottomWidth: 1, borderColor: COLORS.borderSoft }}>
        <Row style={{ width: '100%', gap: 5, flexWrap: 'wrap' }}>
          <TinyButton label="INSPECT" active={props.mode === 'inspect'} onPress={() => props.onMode('inspect')} />
          <TinyButton label="GUARDED FIELD EDIT" active={props.mode === 'guarded_field_edit'} onPress={() => props.onMode('guarded_field_edit')} />
        </Row>
        {props.mode === 'guarded_field_edit' ? (
          <Col style={{ width: '100%', gap: 5, padding: 7, backgroundColor: COLORS.panelRaised, borderWidth: 1, borderColor: COLORS.border, borderRadius: 5 }}>
            <Text style={{ color: COLORS.warning, fontSize: 9, fontWeight: 800 }}>ONLY MATERIAL AND SEMANTIC TABLE IDS ARE WRITABLE HERE</Text>
            <Row style={{ width: '100%', gap: 4, flexWrap: 'wrap' }}>
              {BLOB_GUARDED_FIELDS.map((field) => (
                <TinyButton key={field} label={field.replace('_', ' ').toUpperCase()} active={props.guardedField === field} onPress={() => props.onGuardedField(field)} />
              ))}
            </Row>
            <TextInput
              value={props.guardedValue}
              onChange={props.onGuardedValue}
              placeholder="unsigned table id"
              style={{ width: '100%', height: 25, paddingLeft: 8, paddingRight: 8, borderWidth: 1, borderColor: guardedDraft.ok ? COLORS.border : COLORS.error, borderRadius: 5, backgroundColor: COLORS.panel, color: COLORS.text, fontSize: 10 }}
            />
            {!guardedDraft.ok ? <Text style={{ color: COLORS.error, fontSize: 9 }}>{guardedDraft.detail}</Text> : null}
            {!props.selectedAddress ? <Text style={{ color: COLORS.warning, fontSize: 9 }}>Select one resident authored face first.</Text> : null}
            {props.activePreview ? <Text style={{ color: COLORS.warning, fontSize: 9 }}>Close the read-only historical preview before editing resident fields.</Text> : null}
            {!props.guardedFieldEditEnabled ? <Text style={{ color: COLORS.faint, fontSize: 9 }}>Apply is locked until the native lease-backed transaction coordinator is ready.</Text> : null}
            {props.guardedFieldEditStatus ? <Text style={{ color: COLORS.dim, fontSize: 9 }}>{props.guardedFieldEditStatus}</Text> : null}
            <TinyButton
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
          </Col>
        ) : null}
      </Col>
      <Row style={{ width: '100%', gap: 5, padding: 8, flexWrap: 'wrap', borderBottomWidth: 1, borderColor: COLORS.borderSoft }}>
        {BLOB_EXPLORER_FACE_SOURCES.map((source) => (
          <TinyButton
            key={source}
            label={source.toUpperCase()}
            active={query.source === source}
            disabled={source === 'preview' && !props.activePreview}
            onPress={() => props.onFaceQueryChange(sourceBlobExplorerFaces(query, source))}
          />
        ))}
      </Row>
      <Row style={{ width: '100%', gap: 4, padding: 8, flexWrap: 'wrap', borderBottomWidth: 1, borderColor: COLORS.borderSoft }}>
        {filters.map(({ filter, label }) => {
          const active = query.filters.some((row) => faceFilterKey(row) === faceFilterKey(filter));
          return <TinyButton key={faceFilterKey(filter)} label={label} active={active} onPress={() => props.onFaceQueryChange(toggleBlobExplorerFaceFilter(query, filter))} />;
        })}
      </Row>
      <Row style={{ width: '100%', gap: 4, padding: 8, flexWrap: 'wrap', borderBottomWidth: 1, borderColor: COLORS.borderSoft }}>
        {FACE_TABLE_SORT_COLUMNS.map((column) => (
          <TinyButton
            key={column}
            label={`${SORT_LABELS[column]}${query.sort.column === column ? query.sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}`}
            active={query.sort.column === column}
            onPress={() => props.onFaceQueryChange(sortBlobExplorerFaces(query, column))}
          />
        ))}
      </Row>
      {page ? <FaceIdentity page={page} /> : null}
      {state === 'loading' ? <Fact label="faces" value="LOADING FACE ANALYSIS…" /> : null}
      {state === 'pending' && error?.code === 'analysis_pending' ? (
        <Col style={{ width: '100%', paddingTop: 12, paddingBottom: 12 }}>
          <Fact label="analysis" value={`${error.analysisId} · ${Math.round(error.progress * 100)}% · retry after ${error.retryAfterMs} ms`} tone="warning" />
          <Fact label="plane hash" value={error.planeIdentityHash} />
          <Fact label="detail" value={error.detail} />
        </Col>
      ) : null}
      {state === 'error' && error ? (
        <Col style={{ width: '100%', paddingTop: 12, paddingBottom: 12, backgroundColor: '#30191d' }}>
          <Fact label={error.code.toUpperCase()} value={error.detail} tone="danger" />
          {'currentGeneration' in error && error.currentGeneration !== undefined
            ? <Fact label="generation" value={String(error.currentGeneration)} tone="warning" />
            : null}
        </Col>
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
          <Col key={view.key} style={{ width: '100%', borderBottomWidth: 1, borderColor: COLORS.borderSoft, backgroundColor: selected ? COLORS.rowSelected : COLORS.row }}>
            <Row style={{ width: '100%', alignItems: 'stretch' }}>
              <Pressable
                onPress={selection ? () => props.onSelectFace(selection) : undefined}
                style={{ flexGrow: 1, minWidth: 0, padding: BLOB_EXPLORER_UI.rowPadding, opacity: selection ? 1 : 0.55 }}
              >
                <Row style={{ width: '100%', gap: 7, alignItems: 'center' }}>
                  <Text style={{ flexGrow: 1, minWidth: 0, color: COLORS.text, fontSize: 11, fontWeight: 800 }}>{view.name}</Text>
                  {view.presence ? <Text noWrap style={{ color: view.presence === 'incomparable' ? COLORS.warning : COLORS.primary, fontSize: 8, fontWeight: 800 }}>{view.presence.toUpperCase()}</Text> : null}
                </Row>
                <Text style={{ color: COLORS.faint, fontSize: 9, fontFamily: 'ui-monospace' }}>{view.address}</Text>
                <Text style={{ color: COLORS.dim, fontSize: 9 }}>{`${view.object} · ${view.material} · ${view.semantic}`}</Text>
                <Text style={{ color: COLORS.dim, fontSize: 9 }}>{`${view.surface} · ${view.geometry}`}</Text>
                <Text style={{ color: COLORS.dim, fontSize: 9 }}>{view.topology}</Text>
                <Text style={{ color: view.audit.startsWith('UNKNOWN') ? COLORS.warning : COLORS.dim, fontSize: 9 }}>{`AUDIT · ${view.audit}`}</Text>
                {view.changes ? <Text style={{ color: view.changes === 'UNCHANGED' ? COLORS.faint : COLORS.warning, fontSize: 9 }}>{`DIFF · ${view.changes}`}</Text> : null}
                {view.reason ? <Text style={{ color: COLORS.warning, fontSize: 9 }}>{`REASON · ${view.reason}`}</Text> : null}
                <Text style={{ color: view.blockedBy === 'NONE' ? COLORS.faint : COLORS.warning, fontSize: 9 }}>{`BLOCKED BY · ${view.blockedBy}`}</Text>
              </Pressable>
              <Pressable onPress={() => props.onToggleExpanded(view.key)} style={{ width: 38, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderColor: COLORS.borderSoft }}>
                <Text style={{ color: COLORS.primary, fontSize: 10, fontWeight: 900 }}>{expanded ? '−' : `+${view.row?.triangleIds.length ?? 0}`}</Text>
              </Pressable>
            </Row>
            {expanded ? (
              <Text style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 8, color: COLORS.primary, fontSize: 9, fontFamily: 'ui-monospace' }}>
                {`TRIANGLES · ${view.row?.triangleIds.join(', ') || 'none'}`}
              </Text>
            ) : null}
          </Col>
        );
      }) : null}
      {page && page.source !== 'diff' && page.buildIssues.map((issue) => (
        <Pressable
          key={`${issue.objectId}:${issue.sourceGroup}:${issue.code}`}
          onPress={props.onSelectBuildIssue ? () => props.onSelectBuildIssue?.({ kind: 'build_issue', source: query.source === 'diff' ? 'resident' : query.source, issue, additive: false, frame: true }) : undefined}
          style={{ width: '100%', padding: 9, backgroundColor: '#2b2116', borderBottomWidth: 1, borderColor: '#4b3520' }}
        >
          <Text style={{ color: COLORS.warning, fontSize: 10, fontWeight: 800 }}>{`BUILD ISSUE · ${issue.code}`}</Text>
          <Text style={{ color: COLORS.dim, fontSize: 9 }}>{`${issue.objectId} / source group ${issue.sourceGroup} · ${issue.sourceTriangles.length} source tris → groups ${issue.degradedToGroups.join(', ') || 'none'}`}</Text>
          <Text style={{ color: COLORS.text, fontSize: 9 }}>{issue.detail}</Text>
        </Pressable>
      ))}
      <Row style={{ width: '100%', gap: 6, alignItems: 'center', padding: 8, borderTopWidth: 1, borderColor: COLORS.border }}>
        <TinyButton label="PREVIOUS" disabled={!props.canPageFacesBackward} onPress={props.onPreviousFacePage} />
        <Text style={{ flexGrow: 1, minWidth: 0, color: COLORS.faint, fontSize: 9, fontFamily: 'ui-monospace' }}>
          {page ? `${page.matchedRows}/${page.totalRows} matched · ${page.rows.length} on page${props.selectedTriangles != null ? ` · ${props.selectedTriangles} selected tris` : ''}` : 'no page'}
        </Text>
        <TinyButton label="NEXT" disabled={!page?.nextCursor} onPress={() => page?.nextCursor && props.onFaceQueryChange(pageBlobExplorerFaces(query, page.nextCursor))} />
      </Row>
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
      <Col style={{ width: '100%', padding: 9, gap: 6, borderBottomWidth: 1, borderColor: COLORS.border }}>
        <Text style={{ color: COLORS.text, fontSize: 10, fontWeight: 800 }}>Lore revision contains RJMD geometry and embedded mesh channels</Text>
        <Text style={{ color: COLORS.faint, fontSize: 9 }}>Textures, RJSK, manifest, and package sidecars are outside this artifact scope.</Text>
        {props.activePreview ? (
          <Col style={{ width: '100%', gap: 4, padding: 7, backgroundColor: '#17273a', borderWidth: 1, borderColor: COLORS.primary, borderRadius: 5 }}>
            <Text style={{ color: COLORS.primary, fontSize: 10, fontWeight: 900 }}>HISTORICAL PREVIEW · READ ONLY</Text>
            <Text style={{ color: COLORS.text, fontSize: 9, fontFamily: 'ui-monospace' }}>{`${props.activePreview.snapshotId} · ${props.activePreview.sha256.slice(0, 12)} · ${props.activePreview.triangleCount} tris`}</Text>
            <Text style={{ color: COLORS.faint, fontSize: 9 }}>The resident document, selection, generation, and undo/redo remain parked and unchanged.</Text>
            <TinyButton label="CLOSE PREVIEW" tone="warning" onPress={() => props.onClosePreview?.()} />
          </Col>
        ) : null}
        <TextInput value={props.label} onChange={props.onLabel} placeholder="Manual recovery snapshot" style={{ width: '100%', height: 25, paddingLeft: 8, paddingRight: 8, borderWidth: 1, borderColor: COLORS.border, borderRadius: 5, backgroundColor: COLORS.panelRaised, color: COLORS.text, fontSize: 10 }} />
        <TextInput value={props.note} onChange={props.onNote} placeholder="optional recovery note" style={{ width: '100%', height: 25, paddingLeft: 8, paddingRight: 8, borderWidth: 1, borderColor: COLORS.border, borderRadius: 5, backgroundColor: COLORS.panelRaised, color: COLORS.text, fontSize: 10 }} />
        <TinyButton
          label={props.recoverySnapshotInFlight ? 'CAPTURING RECOVERY SNAPSHOT…' : 'RECOVERY SNAPSHOT'}
          active={props.recoverySnapshotEnabled && !props.recoverySnapshotInFlight}
          disabled={!props.recoverySnapshotEnabled || props.recoverySnapshotInFlight}
          tone="warning"
          onPress={() => props.onRecoverySnapshot(recoverySnapshotDraft(props.label, props.note))}
        />
        {props.recoverySnapshotStatus ? <Text style={{ color: COLORS.warning, fontSize: 9, fontFamily: 'ui-monospace' }}>{props.recoverySnapshotStatus}</Text> : null}
      </Col>
      {history.loading ? <Fact label="history" value="LOADING RECOVERY HISTORY…" /> : null}
      {history.error ? (
        <Col style={{ width: '100%', gap: 4 }}>
          <Fact label="history error" value={history.error} tone="danger" />
          <TinyButton label="RETRY HISTORY" onPress={() => props.onHistoryPage(null)} />
        </Col>
      ) : null}
      {!history.loading && !history.error && history.rows.length === 0 ? <Fact label="history" value="NO RECOVERY SNAPSHOTS" /> : null}
      {history.rows.map((entry) => {
        if ('state' in entry && entry.state === 'corrupt') {
          return (
            <Col key={entry.snapshotId} style={{ width: '100%', padding: 10, gap: 3, backgroundColor: '#30191d', borderBottomWidth: 1, borderColor: '#61323a' }}>
              <Text style={{ color: COLORS.error, fontSize: 10, fontWeight: 900 }}>{`NON-ACTIONABLE · ${entry.code.toUpperCase()}`}</Text>
              <Text style={{ color: COLORS.text, fontSize: 9 }}>{entry.detail}</Text>
              <Text style={{ color: COLORS.faint, fontSize: 9, fontFamily: 'ui-monospace' }}>{`${entry.snapshotId} · ${entry.revision ?? 'no revision'} · ${entry.legacyAddress ?? 'no legacy address'}`}</Text>
            </Col>
          );
        }
        const action = stableHistoryAction(entry)!;
        const expanded = props.expanded.includes(entry.snapshotId);
        const pushTone = entry.pushState === 'pushed' ? COLORS.success : entry.pushState === 'local' ? COLORS.warning : COLORS.faint;
        return (
          <Col key={entry.snapshotId} style={{ width: '100%', padding: 10, gap: 4, backgroundColor: COLORS.row, borderBottomWidth: 1, borderColor: COLORS.borderSoft }}>
            <Row style={{ width: '100%', gap: 7, alignItems: 'center' }}>
              <Text style={{ flexGrow: 1, minWidth: 0, color: COLORS.text, fontSize: 11, fontWeight: 900 }}>{entry.label}</Text>
              <Text noWrap style={{ color: pushTone, fontSize: 9, fontWeight: 900 }}>{entry.pushState.toUpperCase()}</Text>
              <Text noWrap style={{ color: entry.identityQuality === 'degraded' ? COLORS.degraded : COLORS.success, fontSize: 9, fontWeight: 900 }}>{entry.identityQuality.toUpperCase()}</Text>
            </Row>
            {entry.note ? <Text style={{ color: COLORS.dim, fontSize: 9 }}>{entry.note}</Text> : null}
            <Text style={{ color: COLORS.faint, fontSize: 9, fontFamily: 'ui-monospace' }}>{`${formatBlobTime(entry.timestampMs)} · ${entry.kind} · revision ${entry.revisionNumber} / ${entry.revision}`}</Text>
            <Text style={{ color: COLORS.dim, fontSize: 9 }}>{`${entry.sha256.slice(0, 12)} · ${formatBlobBytes(entry.bytes)} · ${entry.triangles} tris · ${entry.authoredFaces} faces · ${entry.parts} parts · ${entry.logicalVertices} logical verts`}</Text>
            <Text style={{ color: COLORS.faint, fontSize: 9, fontFamily: 'ui-monospace' }}>{`snapshot ${entry.snapshotId} · namespace ${entry.objectNamespaceHash} · expires ${formatBlobTime(entry.expiresAtMs)}`}</Text>
            {entry.warning ? <Text style={{ color: COLORS.degraded, fontSize: 9 }}>{entry.warning}</Text> : null}
            {entry.recoveryDegradations.length ? (
              <Pressable onPress={() => props.onToggleExpanded(entry.snapshotId)} style={{ width: '100%', paddingTop: 3, paddingBottom: 3 }}>
                <Text style={{ color: COLORS.degraded, fontSize: 9, fontWeight: 800 }}>{`${expanded ? 'HIDE' : 'SHOW'} ${entry.recoveryDegradations.length} DEGRADATION CHANNELS`}</Text>
              </Pressable>
            ) : null}
            {expanded ? <DegradationRows rows={entry.recoveryDegradations} /> : null}
            <Row style={{ width: '100%', gap: 5, flexWrap: 'wrap', paddingTop: 3 }}>
              <TinyButton label={entry.pinned ? 'UNPIN' : 'PIN'} active={entry.pinned} onPress={() => props.onPin(action, !entry.pinned)} />
              <TinyButton
                label={props.activePreview?.snapshotId === entry.snapshotId ? 'CLOSE PREVIEW' : 'PREVIEW'}
                active={props.activePreview?.snapshotId === entry.snapshotId}
                onPress={() => props.activePreview?.snapshotId === entry.snapshotId ? props.onClosePreview?.() : props.onPreview(action)}
              />
              <TinyButton
                label={props.restoreConfirmSnapshotId === entry.snapshotId ? 'CONFIRM RESTORE' : 'RESTORE'}
                tone="warning"
                active={props.restoreConfirmSnapshotId === entry.snapshotId}
                disabled={!recoveryRestoreEnabled(entry, props.restoreEnabled, !!props.activePreview)}
                onPress={() => props.onRestore(action)}
              />
              {props.onCopySnapshotId ? <TinyButton label="COPY SNAPSHOT ID" onPress={() => props.onCopySnapshotId?.(entry.snapshotId)} /> : null}
            </Row>
          </Col>
        );
      })}
      <Row style={{ width: '100%', gap: 6, padding: 8, alignItems: 'center', borderTopWidth: 1, borderColor: COLORS.border }}>
        <TinyButton label="PREVIOUS" disabled={!props.canPageHistoryBackward} onPress={props.onPreviousHistoryPage} />
        <Text style={{ flexGrow: 1, minWidth: 0, color: COLORS.faint, fontSize: 9 }}>{`${history.rows.length} rows · index ${history.indexedRepair.replace('_', ' ')}`}</Text>
        <TinyButton label="NEXT" disabled={history.nextCursor === null} onPress={() => history.nextCursor && props.onHistoryPage(history.nextCursor)} />
      </Row>
    </Col>
  );
}

function ServiceView({ status }: { status: BlobExplorerServerStatusV1 }) {
  const blocked = status.state === 'blocked';
  const stateColor = blocked ? COLORS.error
    : status.state === 'local' ? COLORS.warning
      : status.state === 'ready' ? COLORS.success
        : COLORS.faint;
  return (
    <Col style={{ width: '100%' }}>
      <Col style={{ width: '100%', padding: 12, gap: 4, backgroundColor: blocked ? '#44191f' : COLORS.panelRaised, borderBottomWidth: 1, borderColor: blocked ? '#833642' : COLORS.border }}>
        <Text style={{ color: stateColor, fontSize: blocked ? 15 : 13, fontWeight: 900 }}>{`LORE ${status.state.toUpperCase()}`}</Text>
        {blocked ? <Text style={{ color: COLORS.error, fontSize: 10, fontWeight: 800 }}>LOCAL RECOVERY CAPTURE IS BLOCKED — resolve library and repository failures before relying on snapshots.</Text> : null}
        {status.state === 'local' ? <Text style={{ color: COLORS.warning, fontSize: 10 }}>Local capture remains available; the server is unhealthy or unreachable.</Text> : null}
      </Col>
      <Col style={{ width: '100%', paddingTop: 9, paddingBottom: 9 }}>
        {blobExplorerServiceLines(status).map((line, index) => <Fact key={`${index}-${line}`} label={index === 0 ? 'status' : ''} value={line} tone={blocked && index < 2 ? 'danger' : index === 4 ? 'warning' : 'normal'} />)}
        <Fact label="last prune" value={formatBlobTime(status.retention.lastPruneMs)} />
        <Fact label="next prune" value={formatBlobTime(status.retention.nextPruneMs)} />
        <Fact label="watermark" value={status.retention.remoteWatermark ?? 'UNKNOWN'} />
        <Fact label="history" value={`${status.history.pushed} pushed · ${status.history.local} local · ${status.history.unknown} unknown`} />
        <Fact label="probe" value={`completed ${formatBlobTime(status.probe.lastCompletedMs)} · transition ${formatBlobTime(status.probe.lastTransitionMs)}`} />
        {status.retention.lastError ? <Fact label="prune error" value={status.retention.lastError} tone="danger" /> : null}
      </Col>
      <Col style={{ width: '100%', padding: 10, gap: 4, borderTopWidth: 1, borderColor: COLORS.border }}>
        <Text style={{ color: COLORS.dim, fontSize: 9, fontWeight: 800 }}>{`JOURNAL · ${status.service.unitName}`}</Text>
        {status.service.journalTail.length
          ? status.service.journalTail.map((line, index) => <Text key={`journal-${index}`} style={{ color: COLORS.faint, fontSize: 9, fontFamily: 'ui-monospace' }}>{line}</Text>)
          : <Text style={{ color: COLORS.faint, fontSize: 9 }}>No journal lines.</Text>}
      </Col>
      <Col style={{ width: '100%', padding: 10, gap: 4, borderTopWidth: 1, borderColor: COLORS.border }}>
        <Text style={{ color: COLORS.dim, fontSize: 9, fontWeight: 800 }}>RESTORE COMMANDS</Text>
        {status.service.restoreCommands.length
          ? status.service.restoreCommands.map((line, index) => <Text key={`command-${index}`} style={{ color: COLORS.primary, fontSize: 9, fontFamily: 'ui-monospace' }}>{line}</Text>)
          : <Text style={{ color: COLORS.faint, fontSize: 9 }}>No restore commands published.</Text>}
      </Col>
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
  const height = props.height ?? BLOB_EXPLORER_UI.defaultHeight;
  const toggle = (rows: string[], key: string, write: (next: string[]) => void) =>
    write(rows.includes(key) ? rows.filter((row) => row !== key) : [...rows, key]);
  return (
    <Col style={{ width: '100%', minWidth: BLOB_EXPLORER_UI.minimumDataWidth, height, backgroundColor: COLORS.panel, borderLeftWidth: 1, borderColor: COLORS.border }}>
      <Row style={{ width: '100%', height: BLOB_EXPLORER_UI.chromeHeight, alignItems: 'stretch', borderBottomWidth: 1, borderColor: COLORS.border }}>
        {BLOB_EXPLORER_TABS.map((candidate) => (
          <Pressable key={candidate} onPress={() => setTab(candidate)} style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === candidate ? '#17273a' : COLORS.panelRaised, borderBottomWidth: 2, borderBottomColor: tab === candidate ? COLORS.primary : 'transparent' }}>
            <Text noWrap style={{ color: tab === candidate ? COLORS.primary : COLORS.dim, fontSize: 10, fontWeight: 900, letterSpacing: 0.7 }}>{candidate.toUpperCase()}</Text>
          </Pressable>
        ))}
        {(['compact', 'wide'] as const).map((preset) => (
          <Pressable
            key={preset}
            tooltip={`${preset === 'wide' ? 'Widen' : 'Compact'} Blob Explorer`}
            onPress={() => props.onWidthPreset(preset)}
            style={{
              width: 32,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: props.widthPreset === preset ? '#18304a' : COLORS.panelRaised,
              borderLeftWidth: 1,
              borderColor: COLORS.border,
            }}
          >
            <Text noWrap style={{ color: props.widthPreset === preset ? COLORS.primary : COLORS.faint, fontSize: 9, fontWeight: 900 }}>
              {preset === 'wide' ? 'W' : 'C'}
            </Text>
          </Pressable>
        ))}
      </Row>
      <ScrollView style={{ width: '100%', height: Math.max(1, height - BLOB_EXPLORER_UI.chromeHeight) }} showScrollbar>
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
      </ScrollView>
    </Col>
  );
}
