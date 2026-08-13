/**
 * Low-level declarative door to the native Lore snapshot chain.
 *
 * The backend owns request validation and response schemas. This module keeps
 * React/UI code out of the host-global namespace while deliberately preserving
 * the JSON-object boundary until the version-browser UI defines its views.
 * Importing this file is also the source-driven `has-lore` build signal.
 */

import { callHost } from '../ffi';
import {
  parseRecoveryArtifactProvenanceV1,
  type RecoveryArtifactProvenanceV1,
  type RecoveryDegradationV1,
} from '../model/recoveryArtifact';

declare module '../ffi' {
  interface HostCalls {
    __lore_snapshot(requestJson: string): string;
    __lore_history(requestJson: string): string;
    __lore_preview(requestJson: string): string;
    __mesh_preview_session(requestJson: string): string;
    __lore_restore(requestJson: string): string;
    __model_recovery_transaction(requestJson: string): string;
    __lore_pin(requestJson: string): string;
    __lore_server_status(requestJson: string): string;
  }
}

// Public recovery protocol. Ordinary Save uses the separate package-internal
// receipt module; no generic event-kind or arbitrary Record door is exported.

export type RecoverySnapshotKindV1 =
  | 'panic' | 'normal' | 'save_mismatch'
  | 'pre_restore' | 'pre_field_edit' | 'restored' | 'field_edit';

export type PanicSnapshotRequestV1 = {
  version: 1;
  modelId: string;
  sessionToken: string;
  expectedGeneration: number;
  kind: 'panic';
  label: string;
  note?: string;
  push: boolean;
};

export type RecoveryHistoryRequestV1 = { version: 1; modelId: string; cursor?: string; limit?: number };
export type StableRecoveryRowActionV1 = {
  version: 1;
  modelId: string;
  snapshotId: string;
  expectedRevision?: string;
  expectedSha256?: string;
};
export type RecoveryPreviewRequestV1 =
  | (StableRecoveryRowActionV1 & { operation: 'open' })
  | { version: 1; operation: 'release'; capabilityToken: string };
export type RecoveryPinRequestV1 = StableRecoveryRowActionV1 & { pinned: boolean; push: boolean };
export type RecoveryRestoreCandidateRequestV1 =
  | (StableRecoveryRowActionV1 & { operation: 'open_candidate' })
  | { version: 1; operation: 'release_candidate'; candidateToken: string };
export type RecoveryRestoreCandidateOpenReceiptV1 = RecoveryArtifactProvenanceV1 & {
  ok: true;
  version: 1;
  snapshotId: string;
  resolvedRevision: string;
  sha256: string;
  formatVersion: 5;
  candidateToken: string;
  artifactScope: 'rjmd_geometry';
};
export type RecoveryRestoreCandidateReceiptV1 = RecoveryRestoreCandidateOpenReceiptV1 | RecoveryReleaseReceiptV1;
export type ModelRestoreRequestV1 = {
  version: 1;
  operation: 'restore';
  modelId: string;
  sessionToken: string;
  expectedGeneration: number;
  snapshotId: string;
  resolvedRevision: string;
  expectedSha256: string;
  expectedObjectNamespaceHash: string;
  candidateToken: string;
  push: boolean;
};
export const RECOVERY_RESTORE_CHANGED_FIELD_COUNT_V1 = 16 as const;
export type ModelRestoreReceiptV1 = {
  ok: true;
  version: 1;
  modelId: string;
  snapshotId: string;
  resolvedRevision: string;
  sha256: string;
  generationBefore: number;
  generationAfter: number;
  journalActionId: number;
  manifestSha256: string;
  characterBindingInvalidated: boolean;
  residentSha256: string;
  savedSha256: string;
  diff: {
    proofHash: string;
    topologyHash: string;
    semanticHash: string;
    objectBindingHash: string;
    authoredFaces: number;
    logicalVertices: number;
    comparableLogicalVertices: number;
    visibilityIncomparableRows: number;
    changedFieldCounts: number[];
    relocated: 0;
    residentOnly: 0;
    savedOnly: 0;
  };
  undo: { available: true; actionId: number };
};
export type RecoveryStatusRequestV1 = { version: 1 };
export const RECOVERY_STATUS_CHANNEL_V1 = 'lore:status-changed' as const;

export const LORE_ERROR_CODES_V1 = [
  'invalid_request', 'invalid_host_response', 'library_unavailable', 'repository_unavailable',
  'no_resident_session', 'wrong_model', 'stale_generation', 'snapshot_not_found',
  'snapshot_expired', 'stale_history_row', 'hash_mismatch', 'corrupt_event',
  'released_capability', 'restore_coordinator_unavailable', 'legacy_restore_disabled',
  'authorization_failed', 'server_unavailable', 'busy', 'internal_error',
] as const;
export type LoreErrorCodeV1 = typeof LORE_ERROR_CODES_V1[number];
export type LoreErrorV1 = {
  ok: false;
  version: 1;
  code: LoreErrorCodeV1;
  detail: string;
  currentGeneration?: number;
  resolvedRevision?: string;
  resolvedSha256?: string;
};

export type RecoverySnapshotReceiptV1 = RecoveryArtifactProvenanceV1 & {
  ok: true;
  version: 1;
  snapshotId: string;
  revision: string;
  revisionNumber: number;
  timestampMs: number;
  sha256: string;
  sourceSha256: string;
  bytes: number;
  triangles: number;
  authoredFaces: number;
  parts: number;
  logicalVertices: number;
  indexed: boolean;
  pushState: 'pushed' | 'local' | 'unknown';
  warning?: string;
};

export type RecoveryHistoryRowV1 = RecoveryArtifactProvenanceV1 & {
  snapshotId: string;
  revision: string;
  revisionNumber: number;
  timestampMs: number;
  sha256: string;
  bytes: number;
  label: string;
  note?: string;
  kind: RecoverySnapshotKindV1;
  triangles: number;
  authoredFaces: number;
  parts: number;
  logicalVertices: number;
  pinned: boolean;
  pushState: 'pushed' | 'local' | 'unknown';
  expiresAtMs: number;
  warning?: string;
};
export type RecoveryHistoryCorruptRowV1 = {
  snapshotId: string;
  revision: string | null;
  timestampMs: number | null;
  state: 'corrupt';
  code: 'corrupt_event' | 'hash_mismatch' | 'legacy_unreadable' | 'legacy_migration_failed';
  detail: string;
  legacyAddress?: string;
  actionsAvailable: false;
};
export type RecoveryHistoryEntryV1 = RecoveryHistoryRowV1 | RecoveryHistoryCorruptRowV1;
export type RecoveryHistoryReceiptV1 = {
  ok: true;
  version: 1;
  rows: RecoveryHistoryEntryV1[];
  cursor: string | null;
  nextCursor: string | null;
  indexedRepair: 'not_needed' | 'repaired' | 'partial';
};

export type RecoveryPreviewOpenReceiptV1 = RecoveryArtifactProvenanceV1 & {
  ok: true;
  version: 1;
  snapshotId: string;
  resolvedRevision: string;
  sha256: string;
  formatVersion: number;
  capabilityToken: string;
  artifactScope: 'rjmd_geometry';
};
export type RecoveryReleaseReceiptV1 = { ok: true; version: 1; released: boolean; alreadyReleased: boolean };
export type RecoveryPreviewReceiptV1 = RecoveryPreviewOpenReceiptV1 | RecoveryReleaseReceiptV1;
export type MeshPreviewSessionOpenRequestV1 = RecoveryArtifactProvenanceV1 & {
  version: 1;
  operation: 'open';
  capabilityToken: string;
  modelId: string;
  snapshotId: string;
  resolvedRevision: string;
  expectedSha256: string;
};
export type MeshPreviewSessionReleaseRequestV1 = {
  version: 1;
  operation: 'release';
  capabilityToken: string;
  previewToken: string;
};
export type MeshPreviewSessionOpenReceiptV1 = {
  ok: true;
  version: 1;
  previewToken: string;
  modelId: string;
  snapshotId: string;
  resolvedRevision: string;
  sha256: string;
  formatVersion: number;
  triangleCount: number;
  readOnly: true;
};
export type MeshPreviewSessionReleaseReceiptV1 = {
  ok: true;
  version: 1;
  sceneReleased: boolean;
  capabilityReleased: boolean;
  capabilityAlreadyReleased: boolean;
};
export type MeshPreviewSessionRequestV1 = MeshPreviewSessionOpenRequestV1 | MeshPreviewSessionReleaseRequestV1;
export type MeshPreviewSessionReceiptV1 = MeshPreviewSessionOpenReceiptV1 | MeshPreviewSessionReleaseReceiptV1;
export type RecoveryPinReceiptV1 = {
  ok: true;
  version: 1;
  snapshotId: string;
  pinned: boolean;
  revision: string;
  pushState: 'pushed' | 'local' | 'unknown';
};

export type RecoveryServerStatusV1 = {
  state: 'checking' | 'ready' | 'local' | 'blocked';
  library: { available: boolean; version: string | null };
  repository: { ready: boolean; path: string; revision: string | null };
  service: {
    healthy: boolean; healthUrl: string; httpCode: number | null;
    unitName: string; active: boolean; enabled: boolean;
    journalTail: string[]; restoreCommands: string[];
  };
  stores: { snapshotRoot: string; localBytes: number; serverBytes: number | null };
  retention: {
    days: 60; nowMs: number; lastPruneMs: number | null; nextPruneMs: number | null;
    immediatelyExpired: number; localTombstones: number; remotePendingTombstones: number;
    logicallyRemovedEntries: number; logicallyRemovedBytes: number;
    physicallyReclaimedBytes: number; remoteWatermark: string | null;
    legacyUnexpiredPending: number; legacyCorruptPending: number;
    legacyLayoutCutover: boolean; lastError: string | null;
  };
  history: { pushed: number; local: number; unknown: number };
  probe: { lastCompletedMs: number | null; lastTransitionMs: number | null };
};
export type RecoveryStatusReceiptV1 = { ok: true; version: 1; status: RecoveryServerStatusV1 };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const sha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const nullableFinite = (value: unknown): value is number | null => value === null || finite(value);
// Zig's JSON encoder represents a null optional as JSON null. The public TS
// contract represents the same state by omitting the optional field, so wire
// parsers accept both forms and normalize null away at this boundary.
const optionalWireString = (value: unknown): value is string | null | undefined =>
  value === undefined || value === null || string(value);
function withoutNullWarning(value: Record<string, unknown>): Record<string, unknown> {
  if (value.warning !== null) return value;
  const { warning: _warning, ...normalized } = value;
  return normalized;
}
const pushState = (value: unknown): value is 'pushed' | 'local' | 'unknown' =>
  value === 'pushed' || value === 'local' || value === 'unknown';
const snapshotKind = (value: unknown): value is RecoverySnapshotKindV1 =>
  ['panic', 'normal', 'save_mismatch', 'pre_restore', 'pre_field_edit', 'restored', 'field_edit'].includes(String(value));
const PRIVATE_RECOVERY_ARTIFACT_FIELDS = [
  'path', 'geometryPath', 'packageGeometryPath', 'packageDir', 'spoolPath',
  'residentPath', 'eventPath', 'bytes', 'base64', 'candidateBytes',
] as const;
const privateRecoveryArtifactField = (key: string): boolean => {
  const normalized = key.replace(/[_-]/g, '').toLowerCase();
  return PRIVATE_RECOVERY_ARTIFACT_FIELDS.some((field) =>
    field.replace(/[_-]/g, '').toLowerCase() === normalized) ||
    normalized === 'path' || normalized.endsWith('path') ||
    normalized === 'bytes' || normalized.endsWith('bytes') ||
    normalized === 'base64' || normalized.endsWith('base64');
};
function leaksPrivateRecoveryArtifact(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return false;
  const object = value as object;
  if (seen.has(object)) return false;
  seen.add(object);
  if (Array.isArray(value)) return value.some((item) => leaksPrivateRecoveryArtifact(item, seen));
  const record = value as Record<string, unknown>;
  return Object.entries(record).some(([key, item]) =>
    privateRecoveryArtifactField(key) || leaksPrivateRecoveryArtifact(item, seen));
}

export function parseLoreErrorV1(value: unknown): LoreErrorV1 | null {
  if (!isRecord(value) || value.ok !== false || value.version !== 1 ||
    !LORE_ERROR_CODES_V1.includes(value.code as LoreErrorCodeV1) || !string(value.detail) ||
    (value.currentGeneration !== undefined && !integer(value.currentGeneration)) ||
    (value.resolvedRevision !== undefined && !string(value.resolvedRevision)) ||
    (value.resolvedSha256 !== undefined && !string(value.resolvedSha256))) return null;
  return value as LoreErrorV1;
}

function provenance(value: unknown): RecoveryArtifactProvenanceV1 | null {
  return parseRecoveryArtifactProvenanceV1(value);
}

export function parseRecoverySnapshotReceiptV1(value: unknown): RecoverySnapshotReceiptV1 | LoreErrorV1 | null {
  if (isRecord(value) && value.ok === false) return parseLoreErrorV1(value);
  if (!isRecord(value) || value.ok !== true || value.version !== 1 || !string(value.snapshotId) ||
    !string(value.revision) || !integer(value.revisionNumber) || !finite(value.timestampMs) ||
    !string(value.sha256) || !string(value.sourceSha256) || !integer(value.bytes) ||
    !integer(value.triangles) || !integer(value.authoredFaces) || !integer(value.parts) ||
    !integer(value.logicalVertices) || typeof value.indexed !== 'boolean' || !pushState(value.pushState) ||
    !optionalWireString(value.warning)) return null;
  const parsed = provenance(value);
  return parsed ? { ...withoutNullWarning(value), ...parsed } as RecoverySnapshotReceiptV1 : null;
}

function parseHistoryEntry(value: unknown): RecoveryHistoryEntryV1 | null {
  if (!isRecord(value) || !string(value.snapshotId)) return null;
  if (value.state === 'corrupt') {
    if (!nullableString(value.revision) || !nullableFinite(value.timestampMs) ||
      !['corrupt_event', 'hash_mismatch', 'legacy_unreadable', 'legacy_migration_failed'].includes(String(value.code)) ||
      !string(value.detail) || value.actionsAvailable !== false ||
      (value.legacyAddress !== undefined && !string(value.legacyAddress))) return null;
    return value as RecoveryHistoryCorruptRowV1;
  }
  if (!string(value.revision) || !integer(value.revisionNumber) || !finite(value.timestampMs) ||
    !string(value.sha256) || !integer(value.bytes) || !string(value.label) ||
    (value.note !== undefined && typeof value.note !== 'string') || !snapshotKind(value.kind) ||
    !integer(value.triangles) || !integer(value.authoredFaces) || !integer(value.parts) ||
    !integer(value.logicalVertices) || typeof value.pinned !== 'boolean' || !pushState(value.pushState) ||
    !finite(value.expiresAtMs) || !optionalWireString(value.warning)) return null;
  const parsed = provenance(value);
  return parsed ? { ...withoutNullWarning(value), ...parsed } as RecoveryHistoryRowV1 : null;
}

export function parseRecoveryHistoryReceiptV1(value: unknown): RecoveryHistoryReceiptV1 | LoreErrorV1 | null {
  if (isRecord(value) && value.ok === false) return parseLoreErrorV1(value);
  if (!isRecord(value) || value.ok !== true || value.version !== 1 || !Array.isArray(value.rows) ||
    !nullableString(value.cursor) || !nullableString(value.nextCursor) ||
    !['not_needed', 'repaired', 'partial'].includes(String(value.indexedRepair))) return null;
  const rows: RecoveryHistoryEntryV1[] = [];
  for (const row of value.rows) {
    const parsed = parseHistoryEntry(row);
    if (!parsed) return null;
    rows.push(parsed);
  }
  return { ok: true, version: 1, rows, cursor: value.cursor, nextCursor: value.nextCursor, indexedRepair: value.indexedRepair as any };
}

export function parseRecoveryPreviewReceiptV1(value: unknown): RecoveryPreviewReceiptV1 | LoreErrorV1 | null {
  if (isRecord(value) && value.ok === false) return parseLoreErrorV1(value);
  if (!isRecord(value) || value.ok !== true || value.version !== 1) return null;
  if (leaksPrivateRecoveryArtifact(value)) return null;
  if ('released' in value) return typeof value.released === 'boolean' && typeof value.alreadyReleased === 'boolean'
    ? value as RecoveryReleaseReceiptV1 : null;
  if (!string(value.snapshotId) || !string(value.resolvedRevision) || !string(value.sha256) ||
    !integer(value.formatVersion) || !string(value.capabilityToken) || value.artifactScope !== 'rjmd_geometry') return null;
  const parsed = provenance(value);
  return parsed ? { ...(value as any), ...parsed } : null;
}

export function parseRecoveryRestoreCandidateReceiptV1(value: unknown): RecoveryRestoreCandidateReceiptV1 | LoreErrorV1 | null {
  if (isRecord(value) && value.ok === false) return parseLoreErrorV1(value);
  if (!isRecord(value) || value.ok !== true || value.version !== 1) return null;
  if (leaksPrivateRecoveryArtifact(value)) return null;
  if ('released' in value) return typeof value.released === 'boolean' && typeof value.alreadyReleased === 'boolean'
    ? value as RecoveryReleaseReceiptV1 : null;
  if (!string(value.snapshotId) || !sha256(value.resolvedRevision) || !sha256(value.sha256) ||
    value.formatVersion !== 5 || !string(value.candidateToken) || value.artifactScope !== 'rjmd_geometry') return null;
  const parsed = provenance(value);
  return parsed?.identityQuality === 'exact' && parsed.recoveryDegradations.length === 0
    ? { ...(value as any), ...parsed } : null;
}

export function parseModelRestoreReceiptV1(value: unknown): ModelRestoreReceiptV1 | LoreErrorV1 | null {
  if (isRecord(value) && value.ok === false) return parseLoreErrorV1(value);
  if (isRecord(value) && leaksPrivateRecoveryArtifact(value)) return null;
  if (!isRecord(value) || value.ok !== true || value.version !== 1 || !string(value.modelId) ||
    !string(value.snapshotId) || !sha256(value.resolvedRevision) || !sha256(value.sha256) ||
    !integer(value.generationBefore) || !integer(value.generationAfter) || !integer(value.journalActionId) ||
    !sha256(value.manifestSha256) ||
    typeof value.characterBindingInvalidated !== 'boolean' || !sha256(value.residentSha256) ||
    !sha256(value.savedSha256) || !isRecord(value.diff) || !isRecord(value.undo)) return null;
  const diff = value.diff;
  if (!sha256(diff.proofHash) || !sha256(diff.topologyHash) || !sha256(diff.semanticHash) ||
    !sha256(diff.objectBindingHash) || !integer(diff.authoredFaces) || !integer(diff.logicalVertices) ||
    !integer(diff.comparableLogicalVertices) || !integer(diff.visibilityIncomparableRows) ||
    !Array.isArray(diff.changedFieldCounts) ||
    diff.changedFieldCounts.length !== RECOVERY_RESTORE_CHANGED_FIELD_COUNT_V1 ||
    !diff.changedFieldCounts.every((count) => count === 0) || diff.relocated !== 0 ||
    diff.residentOnly !== 0 || diff.savedOnly !== 0 || value.undo.available !== true ||
    !integer(value.undo.actionId) || value.undo.actionId !== value.journalActionId ||
    value.residentSha256 !== value.sha256 || value.savedSha256 !== value.sha256) return null;
  return value as ModelRestoreReceiptV1;
}

export function parseMeshPreviewSessionReceiptV1(value: unknown): MeshPreviewSessionReceiptV1 | LoreErrorV1 | null {
  if (isRecord(value) && value.ok === false) return parseLoreErrorV1(value);
  if (!isRecord(value) || value.ok !== true || value.version !== 1) return null;
  if (leaksPrivateRecoveryArtifact(value)) return null;
  if ('sceneReleased' in value) {
    return typeof value.sceneReleased === 'boolean' && typeof value.capabilityReleased === 'boolean' &&
      typeof value.capabilityAlreadyReleased === 'boolean'
      ? value as MeshPreviewSessionReleaseReceiptV1 : null;
  }
  return string(value.previewToken) && string(value.modelId) && string(value.snapshotId) &&
    string(value.resolvedRevision) && string(value.sha256) && integer(value.formatVersion) &&
    integer(value.triangleCount) && value.readOnly === true
    ? value as MeshPreviewSessionOpenReceiptV1 : null;
}

export function parseRecoveryPinReceiptV1(value: unknown): RecoveryPinReceiptV1 | LoreErrorV1 | null {
  if (isRecord(value) && value.ok === false) return parseLoreErrorV1(value);
  return isRecord(value) && value.ok === true && value.version === 1 && string(value.snapshotId) &&
    typeof value.pinned === 'boolean' && string(value.revision) && pushState(value.pushState)
    ? value as RecoveryPinReceiptV1 : null;
}

export function parseRecoveryStatusReceiptV1(value: unknown): RecoveryStatusReceiptV1 | LoreErrorV1 | null {
  if (isRecord(value) && value.ok === false) return parseLoreErrorV1(value);
  if (!isRecord(value) || value.ok !== true || value.version !== 1 || !isRecord(value.status)) return null;
  const status = value.status;
  if (!['checking', 'ready', 'local', 'blocked'].includes(String(status.state)) ||
    !isRecord(status.library) || typeof status.library.available !== 'boolean' || !nullableString(status.library.version) ||
    !isRecord(status.repository) || typeof status.repository.ready !== 'boolean' || !string(status.repository.path) || !nullableString(status.repository.revision) ||
    !isRecord(status.service) || typeof status.service.healthy !== 'boolean' || !string(status.service.healthUrl) ||
    !(status.service.httpCode === null || integer(status.service.httpCode)) || !string(status.service.unitName) ||
    typeof status.service.active !== 'boolean' || typeof status.service.enabled !== 'boolean' ||
    !Array.isArray(status.service.journalTail) || !status.service.journalTail.every((row) => typeof row === 'string') ||
    !Array.isArray(status.service.restoreCommands) || !status.service.restoreCommands.every((row) => typeof row === 'string') ||
    !isRecord(status.stores) || !string(status.stores.snapshotRoot) || !integer(status.stores.localBytes) ||
    !(status.stores.serverBytes === null || integer(status.stores.serverBytes)) ||
    !isRecord(status.retention) || status.retention.days !== 60 ||
    !isRecord(status.history) || !integer(status.history.pushed) || !integer(status.history.local) || !integer(status.history.unknown) ||
    !isRecord(status.probe)) return null;
  const retentionNumbers = ['nowMs', 'immediatelyExpired', 'localTombstones', 'remotePendingTombstones', 'logicallyRemovedEntries', 'logicallyRemovedBytes', 'physicallyReclaimedBytes', 'legacyUnexpiredPending', 'legacyCorruptPending'];
  if (retentionNumbers.some((key) => !finite(status.retention[key])) ||
    !nullableFinite(status.retention.lastPruneMs) || !nullableFinite(status.retention.nextPruneMs) ||
    !nullableString(status.retention.remoteWatermark) || typeof status.retention.legacyLayoutCutover !== 'boolean' ||
    !nullableString(status.retention.lastError) || !nullableFinite(status.probe.lastCompletedMs) ||
    !nullableFinite(status.probe.lastTransitionMs)) return null;
  return value as RecoveryStatusReceiptV1;
}

function strictRequest<T>(
  name: string,
  payload: unknown,
  parse: (value: unknown) => T | LoreErrorV1 | null,
): T | LoreErrorV1 {
  const raw = callHost<string | null>(name, null, JSON.stringify(payload));
  if (raw === null) return { ok: false, version: 1, code: 'library_unavailable', detail: `${name} is unavailable` };
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { return { ok: false, version: 1, code: 'invalid_host_response', detail: `${name} returned invalid JSON` }; }
  return parse(value) ?? { ok: false, version: 1, code: 'invalid_host_response', detail: `${name} returned an invalid v1 receipt` };
}

export const captureRecoverySnapshotV1 = (payload: PanicSnapshotRequestV1): RecoverySnapshotReceiptV1 | LoreErrorV1 =>
  strictRequest('__lore_snapshot', payload, parseRecoverySnapshotReceiptV1);
export const recoveryHistoryV1 = (payload: RecoveryHistoryRequestV1): RecoveryHistoryReceiptV1 | LoreErrorV1 =>
  strictRequest('__lore_history', payload, parseRecoveryHistoryReceiptV1);
export const recoveryPreviewV1 = (payload: RecoveryPreviewRequestV1): RecoveryPreviewReceiptV1 | LoreErrorV1 =>
  strictRequest('__lore_preview', payload, parseRecoveryPreviewReceiptV1);
export const recoveryRestoreCandidateV1 = (payload: RecoveryRestoreCandidateRequestV1): RecoveryRestoreCandidateReceiptV1 | LoreErrorV1 =>
  strictRequest('__lore_restore', payload, parseRecoveryRestoreCandidateReceiptV1);
export const restoreModelTransactionV1 = (payload: ModelRestoreRequestV1): ModelRestoreReceiptV1 | LoreErrorV1 =>
  strictRequest('__model_recovery_transaction', payload, parseModelRestoreReceiptV1);
export const meshPreviewSessionV1 = (payload: MeshPreviewSessionRequestV1): MeshPreviewSessionReceiptV1 | LoreErrorV1 =>
  strictRequest('__mesh_preview_session', payload, parseMeshPreviewSessionReceiptV1);
export const recoveryPinV1 = (payload: RecoveryPinRequestV1): RecoveryPinReceiptV1 | LoreErrorV1 =>
  strictRequest('__lore_pin', payload, parseRecoveryPinReceiptV1);
export const recoveryStatusV1 = (payload: RecoveryStatusRequestV1 = { version: 1 }): RecoveryStatusReceiptV1 | LoreErrorV1 =>
  strictRequest('__lore_server_status', payload, parseRecoveryStatusReceiptV1);

export type { RecoveryDegradationV1 };
