# Model Recovery Surface — Phase 5 Reuse Map

## Canonical shape 1 — `FaceAddress`

```text
FaceAddress = { objectId: string, group: u32,
                stability: stable | artifact_rank, artifactFaceOrdinal?: u32 }
ScopedFaceAddress = { sessionToken, generation, address: FaceAddress }
```

Current overlap:

- indexed face ID and group in `indexed_edit_mesh.Face`;
- range/rank ownership in `model_source`;
- package range-object IDs in RJMD semantic JSON/parts metadata;
- Agent Seat selectors and Names panel selections.

Boundary: native owns object ID + group identity/stability and generation. Editor joins display names.
Triangle indices are members, not identity. Saved/resident diff, row selection, preview
selection, and Seat all use this one address.

V1–v4 props without persisted object IDs receive `@rank/<rank>` plus a deterministic
artifact-local ordinal that disambiguates repeated anonymous/`NO_GROUP` faces. It supports
inspection/selection but never enters a cross-plane durable join.

## Canonical shape 2 — `FaceFacts`

One native value beside `indexed_edit_mesh.Face` contains:

```text
area, perimeter, minEdge, maxEdge, centroidEdgeClearance, aspect,
planarityDeviation, convexity, degeneracy[], buildStatus
```

Current overlap:

- triangle area/normal in `mesh_edit.selectionSnapshotJson`;
- Newell normal, concavity, planarity, edge length, and centroid-to-edge-line clearance inside
  `facePolygonFrame`;
- boundary reconstruction inside `buildFaceFromBucket`;
- implicit measurements inside bevel/merge/extrude code.

Extraction boundary: existing predicates remain authoritative. Shared measurement helpers
move only when both mutation and diagnostics call them. `FaceFacts` may expose predicate
outputs; it may not duplicate a tolerance or alternate geometric rule.

Aspect is newly defined once as:

```text
maxEdge / max(2 * centroidEdgeClearance, scaleEpsilon)
```

The definition and scale epsilon live in one native tuning struct and are returned in the
response metadata so tests/UI never guess its meaning.

## Canonical shape 3 — `FaceBuildIssue`

Current malformed-boundary handling degrades a bucket and loses the original group. Refactor
the existing bucket walk to produce:

```text
{ sourceGroup, sourceTriangles[], code, detail }
```

Both indexed import and FaceTableService consume that result. RJMD v5 semantic JSON persists
unresolved issues so save/reopen does not erase why degradation occurred. The importer
chooses whether to degrade; the table reports the exact issue. No second boundary walker exists.

## Canonical shape 4 — `OperationEligibility`

```text
{ operation, status: allowed | blocked | not_analyzed,
  code?, detail?, metrics? }
```

Current overlap:

- global topology-refusal string;
- loop-cut popup/session fallback strings;
- Face→N-gon `last_face_polygon_stage`;
- bool/null returns in bevel, merge, extrude, and solidify;
- Agent Seat post-failure formatting.

Extraction boundary: each operation owner defines a pure/noncommitting predicate and typed
reason. The mutation and diagnostic adapter both invoke it. `FaceTableService` only
aggregates results. An operation without this extraction reports `not_analyzed`.

## Canonical shape 5 — `FaceTableService`

One native service receives an indexed-document view, object-ID mapping, generation/fingerprint,
and optional audit budget. It builds one immutable analysis snapshot per resident generation
or artifact SHA. Query sort/filter/page operations read that snapshot. It:

1. reads `FaceFacts`;
2. runs `mesh_audit` once and aggregates marks through `face_ids`;
3. reads `OperationEligibility`;
4. sorts, filters, and pages;
5. emits `FaceTablePageV1`.

Resident, current saved package, and historical Lore preview call this service. There is no
resident analyzer in `3d.zig`, saved analyzer in `meshdoc_format.zig`, and UI analyzer in
TypeScript as three implementations; those files are adapters into this service.

Scene3D and cold inspection each own the same bounded native analysis worker contract:
capture/copy immutable input on the owner thread, return a discriminated pending receipt,
run facts/audit/operation/diff off-thread, and adopt only when the entire plane identity still
matches. Scene3D retains one resident snapshot keyed by token+generation+namespace/quality;
the cold binding retains a bounded saved/preview cache keyed by SHA plus persisted recovery
provenance. Generation, SHA, namespace, quality, or degradation-list change drops the entry;
paging and column sorting do not rerun audit.

## Canonical shape 6 — `FaceTablePageV1`

The versioned response owns:

- model/source identity, session token/generation or artifact SHA/version;
- identity quality, object-namespace hash, and every typed recovery degradation;
- query echo, totals, cursor, next cursor;
- `auditComputed` and audit budget facts;
- authored rows with `FaceAddress`, numeric metadata, triangle IDs, `FaceFacts`, audit marks,
  and operation matrix;
- build issues that predate/degrade current authored rows.

`runtime/model/faceTable.ts` carries the one TypeScript schema/parser. BlobExplorerSurface,
Agent Seat, and tests import it. React does not store logical/render vertex arrays.
The shared degradation schema/parser lives once in `runtime/model/recoveryArtifact.ts` and is
also imported by the Lore client. Cursor identity includes it, so a sanitized plane cannot
reuse an exact-plane page capability.

## Canonical shape 7 — `PlaneFingerprint` and `FaceDiffRow`

```text
PlaneFingerprint = { artifactSHA?, generation?, topologyHash, semanticHash,
                     objectBindingHash, rowCount }
FaceDiffRow = { address, presence, changedFields[], resident?, saved? }
```

Current overlap:

- aggregate `package diff`;
- meshDoc semantic/range equality helpers;
- Lore SHA/count metadata;
- character topology/semantic hashes.

Boundary: primary comparison identity is object ID + authored group. A connectivity
fingerprint that excludes object membership pairs unmatched rows only when unique on both
sides and reports relocation; ambiguous candidates stay added/removed. Derived metric drift
is reported but does not remap identity.
The existing `compareMeshDocs` same-index triangle helper remains a low-level package tool;
the explorer does not extend its rank assumption.

Logical correspondence is explicit: exact same-artifact identity, the current resident
encoder's transient dense→session receipt, then a unique stable-address/winding/corner-
incidence signature. Decoded RJMD does not grow an imaginary reverse map. Ambiguous fields
are incomparable and block a clean transaction receipt.

## Canonical shape 8 — Scene3D resident-snapshot ABI

The replaceable Scene3D module exports one deep operation:

```text
captureRecoverySnapshot(expectedModel, expectedSessionToken, expectedGeneration,
                        SnapshotSinkV1, SceneCallStatusV1)
  -> caller-owned RJMD v5 bytes + fixed quality/namespace/degradation metadata
```

Current overlap:

- `3d.modelRecoverySnapshot` in static hosts;
- `activeSessionModelIdRef` precheck in AppFrame;
- cold `v8_bindings_lore` direct import of `gpu/3d.zig`.

The ABI becomes the only resident capture path in static and modular builds. Its fixed slots
aggregate every recovered channel and match versioned semantic-JSON provenance; exact is
legal only with zero slots. Lore owns the returned copy after a successful boundary transfer.
The cold duplicate import is severed.

## Canonical shape 9 — typed Lore client

Replace the generic `Record<string,unknown>` facade with versioned request/response types.
The public snapshot request can express only panic capture. Verified normal capture consumes
a package-internal one-use Save receipt, while save/restore/field transaction events consume
native-owned operation/candidate receipts and have no public host/Seat request. AppFrame,
BlobExplorerSurface, Agent Seat, and tests use the same public client. Native error
code/detail, index warning, degradation truth, and pushed/local/unknown state survive the
bridge.

The native service remains the owner of Lore repository policy; no history/pin/status logic
moves into React.

## Canonical shape 10 — one live ModelView bridge

Stage/`ModelDocumentSurface` retain exactly one keyed `ModelView`. Its `ModelFocusBridge`
gains compact inspection/seek/selection methods. `BlobExplorerSurface` is rendered by the
Inspector right-pane system, not inserted into the stage tree and not another editable
viewport. Historical preview is one immutable specimen inside the existing native view.

Existing selection/frame methods are reused. The new selection receipt adds authored address
and generation instead of building another React selection model.

## Canonical shape 11 — native historical adoption transaction

One `3d.zig` operation installs a validated decoded RJMD into the current session with one
journal preimage and one commit. Lore restore, guarded field edit, and future package recovery
reuse it. Remount/reseed is not a restore mechanism because it clears or replaces live history.

The package write remains a separate editor-owned transaction after resident adoption. A
coordinator rolls both forward/back together.

## Canonical shape 12 — native Lore status cache

One background monitor owns bounded health probing, a bounded completion queue, and an
immutable cached status. `v8_bindings_lore.tickDrain(host)` is the only worker→V8 crossing
and emits through `__ffiEmit`; both the status-bar badge and Service tab subscribe to changes.
`tools/lore-hook-health` remains the
prompt-side external check; UI does not shell out to that script or duplicate its thresholds.

## Canonical shape 13 — existing verb dispatch

Default table actions call the existing `ModelToolApi`/application command. Native mutation,
journal, event, dirty-state, semantic propagation, and undo remain in their current owner.
BlobExplorerSurface contains no topology algorithm and no local undo stack.
Every dispatch is wrapped in the same operation-bound native lease used by Save, restore,
and guarded fields; toolbar/Seat commands acquire ephemeral receipts and gizmos hold one for
the gesture, closing the simultaneous-human/agent mutation hole.

## Canonical shape 14 — guarded field-edit transaction

One package/recovery coordinator owns:

```text
native lease + clean full-diff gate → Lore/package predecessors → owned typed candidate
→ resident journal adoption → atomic package install/readback → exact SHA/full diff
→ paired rollback on any failure → best-effort field_edit event after success
```

This coordinator is the only raw-field entry. It never accepts byte offsets or arbitrary
JSON paths. Allowed fields are enumerated by schema version.

## Canonical shape 15 — immutable recovery entries and bounded retention

Each new snapshot owns immutable geometry/event paths beneath a collision-resistant sortable
snapshot ID. Commit one writes and verifies those files; commit two adds a rebuildable index
row referring to commit one. Native reads enforce expiry immediately. Maintenance commits
non-browseable `pruning` tombstones, stages and commits Lore-reported deletes, retains partial
outcomes, and advances confirmed-pushed entries to `remote_prune_pending` until authenticated
push plus remote ancestry prove removal. GC/reclaimed bytes are best effort and separate from
logical deletion. A pin never overrides the hard age ceiling. Service/Seat read the same
external last/next/local/remote/error state.

The previous shared `resident.rjmd` browse reader is severed, but its permanent cutover
scanner first migrates every healthy unexpired legacy event into a byte-verified immutable
entry while preserving the original timestamp/metadata and old→new mapping. Unexpired
corrupt/unmigrated entries surface as non-actionable diagnostics and block path-wide
obliteration until migration or age-out. Only then does the detector obliterate shared-path
history and perform remote cleanup; it stays compiled for repositories not yet cut over.

## Retirements and structural checks

Implementation must sever:

1. `v8_bindings_lore.zig` importing/reading a cold `gpu/3d.zig` resident copy;
2. Lore capture authority based only on `activeSessionModelIdRef`;
3. UI/Seat interpretation of absent operation diagnostics as success;
4. stale shared topology-refusal strings after merge/other operations;
5. any new TypeScript geometry metric, boundary walker, or RJMD byte writer;
6. any historical restore implemented as ModelView remount/original-import fallback;
7. any second Lore command protocol parallel to `runtime/vcs/lore.ts` + Agent Seat action;
8. any per-frame JavaScript polling for face rows or Lore service health.

Structural audits:

```text
rg 'facePolygonFrame|selectedFacesAreCoplanar|buildFaceFromBucket' cart/editor runtime
  -> zero implementations/copies
rg 'DataView|Uint8Array.*doc.blob|writeFile.*doc.blob' cart/editor/stage runtime
  -> zero explorer writers
rg '@import\("gpu/3d.zig"\)' framework/v8_bindings_lore.zig
  -> zero
```

## Execution boundaries

The numbered tape is sequential. Saved/resident diff depends on FaceTableService; capture
depends on the Scene3D ABI; Lore UI depends on immutable history/retention types; restore
depends on native lease admission and exact journal receipts. AppFrame, Inspector, ModelView,
the Scene3D module/runtime, ABI fixtures, and shared Seat tests have one section owner at a
time, so no parallel lane can commit another worker's hub edits.
