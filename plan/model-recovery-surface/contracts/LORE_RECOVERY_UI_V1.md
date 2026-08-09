# Contract — Lore Recovery UI v1

## Persistent control

Every open model shows `RECOVERY SNAPSHOT` beside ordinary Save.

- It never invokes ordinary Save.
- It requires the exact visible native session token and generation.
- It accepts an optional label/note; the fast path uses `Manual recovery snapshot`.
- Success shows revision number/short SHA, whether indexing succeeded, and `PUSHED`,
  `LOCAL`, or `UNKNOWN` truthfully.
- Server outage does not disable local capture.
- Missing native residency is a named blocking error and never falls back to package disk.
- Missing/invalid stable object-ID publication does not block panic capture. The event records
  `identityQuality:'degraded'`, deterministic persisted recovery IDs, and every typed
  `recoveryDegradation`; strict face diff/ordinary Save of the pre-capture resident remain
  blocked. No repaired, defaulted, synthesized, or dropped channel is hidden behind one
  generic warning.
- Capture and pin use the Lore repository mutation lock, not the mesh-journal lease. A model
  edit claim cannot suppress the human panic control; token/generation still protect the
  bytes captured during concurrent editing.
- Scene3D nevertheless takes a short owner-thread snapshot-read guard serialized with native
  journal commit/undo/redo, rechecks generation after encoding, and returns one before-or-after
  document—never a torn mixture. This guard is not an actor claim and cannot suppress the
  human panic control.

## Versions tab

Each history row shows:

```text
event timestamp · label · note · panic|normal|save_mismatch|pre_restore|pre_field_edit|restored|field_edit
revision · SHA · bytes · triangles · authored faces · parts · logical vertices
pin · pushed|local|unknown status
exact|degraded · expandable degradation channel/action/reason/count rows
```

Controls:

- Pin/Unpin — commits the snapshot-ID keyed pin registry; revision rewrites never orphan pins.
- Preview — materializes and renders read-only; does not checkout/adopt.
- Restore — requires explicit confirmation and verified pre-restore snapshot.
- Copy Snapshot ID — copies the stable snapshot ID. Lore revision IDs remain visible but may
  be rewritten by push and are refreshed from event-path history.

Every row action sends `{modelId, snapshotId, expectedRevision?, expectedSha256}`. Native
code resolves the current revision from the immutable event path/index, then treats the
rendered revision and SHA as stale-row guards. Preview, restore, pin, and release never use a
rewriteable revision as their sole identity.

## Versioned host protocol

The existing named Lore host doors accept/return these v1 JSON shapes; no generic
`Record<string,unknown>` is public:

```ts
type SnapshotKindV1 =
  | 'panic' | 'normal' | 'save_mismatch'
  | 'pre_restore' | 'pre_field_edit' | 'restored' | 'field_edit'

type RecoveryDegradationChannelV1 =
  | 'object_ids' | 'range_membership' | 'face_groups' | 'materials'
  | 'semantic_membership' | 'semantic_table' | 'logical_topology'

type RecoveryDegradationActionV1 =
  | 'synthesized' | 'repaired' | 'defaulted' | 'dropped'

type RecoveryDegradationReasonV1 =
  | 'missing_or_duplicate_object_id' | 'incoherent_range_membership'
  | 'anonymous_or_invalid_group' | 'invalid_material_index'
  | 'invalid_semantic_membership' | 'invalid_semantic_table'
  | 'missing_or_invalid_logical_topology'

type RecoveryDegradationV1 = {
  channel: RecoveryDegradationChannelV1
  actions: RecoveryDegradationActionV1[]
  reasons: RecoveryDegradationReasonV1[]
  affectedCount: number
}

type PanicSnapshotRequestV1 = {
  version: 1
  modelId: string
  sessionToken: string
  expectedGeneration: number
  kind: 'panic'
  label: string
  note?: string
  push: boolean
}

type NormalSnapshotRequestV1 = {
  version: 1
  modelId: string
  kind: 'normal'
  saveReceiptToken: string
  label: string
  note?: string
  push: boolean
}

type InternalOwnedEventAppendV1 = {
  version: 1
  modelId: string
  kind: 'save_mismatch' | 'pre_restore' | 'pre_field_edit' | 'restored' | 'field_edit'
  operationReceiptToken: string
  ownedCandidateToken: string
  label: string
  note?: string
  push: boolean
}

type HistoryRequestV1 =
  { version: 1; modelId: string; cursor?: string; limit?: number }

type StableRowActionV1 = {
  version: 1
  modelId: string
  snapshotId: string
  expectedRevision?: string
  expectedSha256?: string
}

type PreviewRequestV1 =
  | (StableRowActionV1 & { operation: 'open' })
  | { version: 1; operation: 'release'; capabilityToken: string }

type RestoreCandidateRequestV1 =
  | (StableRowActionV1 & { operation: 'open_candidate' })
  | { version: 1; operation: 'release_candidate'; candidateToken: string }

type PinRequestV1 = StableRowActionV1 & { pinned: boolean; push: boolean }
type StatusRequestV1 = { version: 1 }

type SnapshotReceiptV1 = {
  ok: true; version: 1; snapshotId: string; revision: string; revisionNumber: number
  timestampMs: number; sha256: string; sourceSha256: string; bytes: number
  triangles: number; authoredFaces: number; parts: number; logicalVertices: number
  indexed: boolean; pushState: 'pushed' | 'local' | 'unknown'; warning?: string
  identityQuality: 'exact' | 'degraded'
  objectNamespaceHash: string
  recoveryDegradations: RecoveryDegradationV1[]
}

type HistoryRowV1 = {
  snapshotId: string; revision: string; revisionNumber: number; timestampMs: number
  sha256: string; bytes: number; label: string; note?: string; kind: SnapshotKindV1
  triangles: number; authoredFaces: number; parts: number; logicalVertices: number
  pinned: boolean; pushState: 'pushed' | 'local' | 'unknown'; expiresAtMs: number
  identityQuality: 'exact' | 'degraded'; warning?: string
  objectNamespaceHash: string; recoveryDegradations: RecoveryDegradationV1[]
}

type HistoryCorruptRowV1 = {
  snapshotId: string
  revision: string | null
  timestampMs: number | null
  state: 'corrupt'
  code: 'corrupt_event' | 'hash_mismatch' | 'legacy_unreadable' | 'legacy_migration_failed'
  detail: string
  legacyAddress?: string
  actionsAvailable: false
}

type HistoryEntryV1 = HistoryRowV1 | HistoryCorruptRowV1

type HistoryReceiptV1 = {
  ok: true; version: 1; rows: HistoryEntryV1[]; cursor: string | null
  nextCursor: string | null; indexedRepair: 'not_needed' | 'repaired' | 'partial'
}

type PreviewOpenReceiptV1 = {
  ok: true; version: 1; snapshotId: string; resolvedRevision: string; sha256: string
  formatVersion: number; capabilityToken: string; artifactScope: 'rjmd_geometry'
  identityQuality: 'exact' | 'degraded'; objectNamespaceHash: string
  recoveryDegradations: RecoveryDegradationV1[]
}
type ReleaseReceiptV1 = { ok: true; version: 1; released: boolean; alreadyReleased: boolean }
type RestoreCandidateReceiptV1 = {
  ok: true; version: 1; snapshotId: string; resolvedRevision: string; sha256: string
  formatVersion: number; candidateToken: string; artifactScope: 'rjmd_geometry'
  identityQuality: 'exact' | 'degraded'; objectNamespaceHash: string
  recoveryDegradations: RecoveryDegradationV1[]
}
type PinReceiptV1 = {
  ok: true; version: 1; snapshotId: string; pinned: boolean; revision: string
  pushState: 'pushed' | 'local' | 'unknown'
}

type LoreErrorV1 = {
  ok: false; version: 1
  code:
    | 'invalid_request' | 'invalid_host_response'
    | 'library_unavailable' | 'repository_unavailable'
    | 'no_resident_session' | 'wrong_model' | 'stale_generation'
    | 'snapshot_not_found' | 'snapshot_expired' | 'stale_history_row'
    | 'hash_mismatch' | 'corrupt_event' | 'released_capability'
    | 'restore_coordinator_unavailable' | 'legacy_restore_disabled'
    | 'authorization_failed' | 'server_unavailable' | 'internal_error'
  detail: string
  currentGeneration?: number
  resolvedRevision?: string
  resolvedSha256?: string
}

type ServerStatusV1 = {
  state: 'checking' | 'ready' | 'local' | 'blocked'
  library: { available: boolean; version: string | null }
  repository: { ready: boolean; path: string; revision: string | null }
  service: {
    healthy: boolean; healthUrl: string; httpCode: number | null
    unitName: string; active: boolean; enabled: boolean
    journalTail: string[]; restoreCommands: string[]
  }
  stores: { snapshotRoot: string; localBytes: number; serverBytes: number | null }
  retention: {
    days: 60; nowMs: number; lastPruneMs: number | null; nextPruneMs: number | null
    immediatelyExpired: number; localTombstones: number; remotePendingTombstones: number
    logicallyRemovedEntries: number; logicallyRemovedBytes: number
    physicallyReclaimedBytes: number; remoteWatermark: string | null
    legacyUnexpiredPending: number; legacyCorruptPending: number
    legacyLayoutCutover: boolean
    lastError: string | null
  }
  history: { pushed: number; local: number; unknown: number }
  probe: { lastCompletedMs: number | null; lastTransitionMs: number | null }
}

type StatusReceiptV1 = { ok: true; version: 1; status: ServerStatusV1 }
```

`ServerStatusV1` is the exact cache schema rendered by “Service tab and badge” below. Every
parser rejects missing or
unknown required enum fields as `invalid_host_response`; native error code/detail is never
flattened. There is no public/manual prune request—retention maintenance is internal.

`__lore_snapshot` and Agent Seat accept only `PanicSnapshotRequestV1`. The package Save
coordinator alone may call the non-public verified-Save door with a one-use
`saveReceiptToken` issued after exact package readback. `InternalOwnedEventAppendV1` is a
native coordinator input, not a JSON host/Seat request: its operation receipt and owned
candidate are created and consumed inside the Save/restore/field-edit transaction. Public
JavaScript therefore cannot forge `pre_restore`, `restored`, or any other transaction event,
and no candidate bytes cross JavaScript.

`identityQuality:'exact'` is legal if and only if `recoveryDegradations` is empty. A degraded
receipt/event must contain at least one typed row and a warning derived from those rows.
Unknown channels/actions/reasons are invalid in v1; adding a sanitizer requires a contract
version change, native mapping, and a focused test. Recovery provenance is also persisted in
the RJMD v5 semantic JSON envelope so a dumped/restored artifact cannot lose the warning when
read apart from its Lore index.

Until the lease-backed coordinator is registered, Restore is disabled and the old
disk-replacing door returns `legacy_restore_disabled`; no intermediate build may route a
restore intent into the former implementation.

`event.json` is append-only authority. `history-index.json` is a rebuildable acceleration
hint keyed by snapshot ID. New snapshots use two commits: the first commits and byte-verifies
immutable RJMD/event files; the second indexes the already-known first revision. If the
second commit fails, capture returns durable success with `indexed:false`, and history repairs
it by scanning event paths and resolving their introducing revisions through Lore file history.
Pin state is canonical only in the snapshot-ID keyed pin registry and is joined at read time;
the index never becomes a second pin authority.

Push state is computed from confirmed remote branch ancestry/head and a watermark cached
outside the Lore repository: `pushed` when either proves the revision reached the server,
`local` when a completed comparison proves it did not, and `unknown` when the server cannot
be checked and no watermark proves it.

## Retention

- New entries use immutable `revisions/<snapshotId>/resident.rjmd` and `event.json` paths.
- `snapshotId` sorts by the pre-commit event `timestampMs`, includes collision-resistant
  entropy, is reserved under the repository mutation lock, and is never reused.
- The hard age ceiling is 60 × 24 hours from event `timestampMs`.
- Pinning is a bookmark inside the active window; it does not extend the age ceiling.
- History, preview, restore, and pin enforce the ceiling before scheduled maintenance, so an
  expired entry becomes unavailable immediately.
- Native maintenance commits expired entries as `pruning` tombstones and removes pins,
  hides them, obliterates every immutable path, queries/stages/commits Lore-reported deletes,
  and retains exact partial outcomes for idempotent retry. Only complete tombstones compact.
  GC is best effort; logical invalidation and physically reclaimed bytes are separate facts.
- Entries with `pushed` or `unknown` state become `remote_prune_pending` after local removal.
  Only a completed comparison proving `local` may skip remote cleanup. Authenticated branch
  push propagates rewritten ancestry; the tombstone remains until remote ancestry proves the
  expired revision is gone. Outage/authorization failure stays visible and retryable.
- Maintenance runs after a verified local snapshot and once per native-service day. A prune
  failure never rejects the snapshot; it becomes an explicit Service-tab/Seat status error.
- Mutable maintenance state lives at
  `~/.local/share/reactjit/lore-maintenance/state.json`, outside the Lore worktree.
- The UI shows retention days, next/last prune, local/remote-pending tombstones, logical
  removal counts, physical reclaimed bytes, remote watermark, and last error.
- At cutover, the permanent detector enumerates every historical event/address under the old
  shared `resident.rjmd`/`event.json` paths before any path-wide obliteration. Every valid
  entry younger than 60 days is dumped and byte/hash verified, then copied into a new
  immutable snapshot ID that preserves its original event timestamp, label, note, kind, pin
  when recoverable, metrics, and expiry. An old→new mapping makes retry idempotent.
- An unexpired legacy entry that is corrupt, unreadable, or not yet migrated becomes a
  non-actionable `HistoryCorruptRowV1`/Service diagnostic. Because Lore obliteration is
  path-wide, the shared paths remain physically retained while even one such unexpired entry
  exists. There is no ordinary legacy preview/restore reader: the cutover scanner is the only
  reader and retries migration until the entry succeeds or reaches 60 days.
- Shared-path obliteration begins only after every healthy unexpired entry is verified in the
  immutable layout and every unexpired corrupt/unmigrated entry has either migrated or aged
  out. Pushed/unknown revisions use the same remote-pending ancestry proof, and cutover
  records local/remote completion separately. The detector/retry path remains permanently;
  only the legacy browse reader is severed.

## Preview

`__lore_preview` has paired `open` and `release` operations. Open validates age, event, and
RJMD, retains verified bytes in a native capability registry, and returns an opaque
process-private Lore token plus metadata—never a path. Mesh inspection consumes that token
internally and creates a second opaque Scene3D `previewToken` plus one isolated immutable
specimen. The coordinator owns both tokens. Closing/replacing preview attempts both releases
and reports either error without leaking the other. Preview may show its own face table and
selected rows. It may not:

- change active edit session/token/generation;
- clear selection or undo/redo;
- change dirty state;
- replace a package file;
- invoke original GLB/OBJ import.

## Restore transaction

Restore proceeds only in this order:

1. Acquire the operation-bound native model-write lease for the exact actor/model/session/
   generation and retain it through success or rollback.
2. Capture and byte-verify current resident as `pre_restore`.
3. Read and byte-verify the current package artifact as a durable package predecessor.
4. Open/decode/hash-check the target capability without exposing its path.
5. Adopt target into the same resident session as one mesh journal entry.
6. Persist through package authority with sibling temp, decode/readback, and atomic install.
7. Re-encode resident, reread saved bytes, and compute the full per-field plane diff.
8. Capture owned restored bytes while the verified transaction and lease are still stable.
9. Release the candidate capability and native model-write lease only after the planes match
   or rollback finishes.
10. Commit a `restored` recovery event from the owned bytes; its failure is reported as a
   warning and does not undo an already verified resident/package transaction.

Success requires `resident SHA = target SHA = saved SHA` and zero connectivity, position,
normal, UV, material, semantic, durable face/semantic-label, unresolved build-provenance,
visibility, render-class, and object-membership differences.
Topology/semantic/object hashes alone are insufficient. On package, readback, SHA, or diff
failure, package predecessor is restored and the exact native journal receipt is rolled back
before release. A dirty pre-restore resident and saved predecessor are verified against their
own SHAs; they need not equal each other. Ctrl-Z after success returns the exact pre-restore
resident; Ctrl-Y reapplies target.
For a character package, package authority reruns the existing topology/semantic/object-hash
invalidation policy. A mismatched external RJSK reference is removed from the live manifest
and readiness becomes `needs_bind`; geometry recovery never claims to restore skin weights.

A degraded recovery artifact is restored byte-for-byte with its typed provenance. When its
object IDs were synthesized, Package/Outliner authority adopts the deterministic persisted
recovery namespace and creates matching recovered object rows before publication, so target/
resident/saved SHA and object membership can still be exactly equal. Every historical
degradation remains visible after restore; no rank-based attempt reconstructs unavailable
membership and no other repaired/dropped channel is relabeled exact.

## Guarded field transaction

The guarded editor accepts only `material`, `semantic_region`, and `semantic_instance`.
It requires a native model-write lease, exact session identity, current RJMD v5 saved SHA,
zero pre-edit plane diff, a verified `pre_field_edit` Lore snapshot, and a durable package
predecessor. Native code builds/encodes the candidate, adopts those exact bytes as one
`field_edit` journal entry, then package authority persists and reads back the same bytes.

Any failure rolls both resident and package back while the lease remains held. Success uses
the same explicit exact-SHA and zero connectivity/position/normal/UV/material/semantic/
durable-label/build-provenance/visibility/render-class/object-membership diff rule as restore,
then appends a best-effort `field_edit` event from owned bytes. After success, Ctrl-Z changes
resident only and marks it dirty while saved remains edited; Ctrl-Y returns to the clean
edited state. Undo never silently writes the package.

## Service tab and badge

The UI reads an immutable native status cache containing:

- liblore availability/version;
- local repository ready/revision/path;
- server HTTP health/code;
- user unit active/enabled;
- five journal lines;
- exact restore commands;
- snapshot root;
- local/server store bytes;
- retention horizon, immediate expiry, last/next prune, local/remote tombstones, logical and
  physical removal counts, remote watermark, and last prune error;
- last successful probe and last transition;
- pushed/local/unknown recovery counts when available.

Badge states:

- `READY` — local repository ready and server healthy;
- `LOCAL` — local capture available, server unhealthy/unreachable;
- `BLOCKED` — local repository/library unavailable;
- `CHECKING` — no completed native probe yet.

The background probe never runs on the render thread and emits only changed cached state.

## Artifact-scope disclosure

Every surface states: `Lore revision contains RJMD geometry and embedded mesh channels`.
It does not claim to include textures, RJSK, manifest, or every package sidecar.
