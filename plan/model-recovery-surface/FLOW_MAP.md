# Model Recovery Surface — Phase 3 Flow Map

## 1. Open and retain one live model session

```text
workspace model tab
→ ModelDocumentSurface checks whether durable geometry has ever been declared
→ declared durable RJMD must read/decode/hash or open refuses visibly
→ import/primitive seed is considered only for a never-persisted model
→ ModelView adopts/resumes native Scene3D session
→ AppFrame publishes stable range object IDs
→ native returns opaque session token + generation + resident=true only after publication
→ ModelDocumentSurface retains token for this document lifecycle
→ optional BlobExplorerSurface renders in the Inspector right pane
```

The explorer never mounts a second editable model and never treats
`activeSessionModelIdRef` as proof of residency. A tab switch parks the native token; a
background table request names that exact token. A present-but-unreadable durable document
never invokes its original GLB/OBJ or primitive seed.

## 2. Resident authored-face table

```text
Faces tab / tools/seat face-table
→ query {source:resident, sessionToken, expectedGeneration, sort, filters, cursor, limit}
→ Scene3D module resolves the exact resident token
→ copy one immutable bounded analysis input without changing selection or journal
→ return analysis_pending {analysisId,planeIdentityHash,progress,retryAfterMs}
→ owner worker enumerates alive authored Face rows and canonical Face facts
→ worker runs mesh_audit once, aggregates marks through face_ids/source_triangles,
   and invokes supported operation predicates without committing previews
→ owner adopts only if token+generation+identity quality+namespace still match
→ main-thread drain emits mesh-analysis-ready; UI refreshes or Seat retries boundedly
→ sort/filter/page the immutable analysis snapshot
→ response page {generation,identityQuality,objectNamespaceHash,recoveryDegradations,
                 totals,auditComputed,rows,nextCursor}
→ editor joins semantic/part/material display labels
→ UI and Seat present the same row order and status codes
```

Branch points:

- missing token or nonresident token → `no_resident_session`, no fallback;
- stale generation → `stale_generation` with current generation, no row selection/mutation;
- indexed reconstruction degraded a source group → row/build issue retains original group
  and triangle membership;
- audit budget exhausted → `auditComputed:false`, intersection/reachability cells unknown;
- operation lacks a complete canonical predicate → `not_analyzed`, never `allowed`.

## 3. Saved authored-face table

```text
Faces source=SAVED
→ package authority resolves manifest-declared geometry artifact
→ native confined read
→ meshdoc_format.decodeDocument (v1–v5)
→ isolated indexed reconstruction with retained build issues
→ enqueue the same owned-input FaceTableService worker as resident
→ return pending, then completion only for the exact SHA/identity/provenance
→ response tagged saved artifact path + SHA + format version + degradation truth
```

No TypeScript parser computes geometry metrics. An unreadable or unsupported artifact is a
typed saved-plane error and never falls back to original GLB/OBJ or primitive seed.

## 4. Saved ↔ resident diff

```text
resident FaceTableSnapshot + saved FaceTableSnapshot
→ assert model ID/object namespace
→ resolve logical correspondence by exact artifact identity, current encode receipt,
   or unique stable-address/winding/corner-incidence signature
→ join stable FaceAddress(objectId, authoredGroup)
→ uniquely pair unmatched stable rows by connectivity fingerprint as relocated
→ leave ambiguous pairs resident_only + saved_only; artifact-rank rows incomparable
→ row presence: both | relocated | resident_only | saved_only | incomparable
→ for both: compare connectivity fingerprint + material + semantic + object membership
→ compare derived metrics separately (not identity)
→ emit exact changed fields and plane SHAs/generation
→ filter/sort/page diff rows
```

Different triangle counts do not make the whole documents incomparable. A row becomes
incomparable only when its address or required format/correspondence fact cannot be
established, and each affected field plus reason is carried on that row. Decoded RJMD never
pretends to contain the encoder-only dense→session remap.

## 5. Row → viewport selection

```text
resident/diff row press
→ __mesh_face_select {sessionToken, expectedGeneration,
                       target:{kind:face,address:{objectId,group}}, additive:false,frame:true}
→ native validates token, generation, object membership, and group
→ native selects every render triangle belonging to that authored face
→ native frames selection with existing selectionFrame/orbit authority
→ native emits selection event {generation, objectId, group, selectedTriangles}
→ table highlights only after positive receipt
```

A saved-only row targets the isolated saved-preview specimen and cannot alter live selection.

## 6. Viewport → row highlight

```text
native face selection changes
→ existing selection bridge resolves selected authored group(s)
→ compact event {sessionToken, generation, addresses[]}
→ BlobExplorerSurface matches current page
→ matching row highlights and scrolls into view
→ absent page calls native cursorForFaceAddress with the active sort/filter
→ native returns the containing cursor or a named filtered-out result
```

React stores addresses and compact rows only, never vertex/corner arrays.

## 7. Panic recovery snapshot

```text
Recovery Snapshot control / Seat lore snapshot
→ request names model ID + exact native session token + expected generation
→ cold V8 host calls Scene3D module ABI
→ module atomically resolves token and returns an owned recovery Snapshot/current RJMD bytes
→ recovery encoder preserves valid channels and records every synthesized/repaired/
   defaulted/dropped channel in ABI metadata plus RJMD semantic JSON
→ Lore SnapshotService cross-validates bytes/metadata; exact iff degradations=[]
→ first local Lore commit: immutable resident.rjmd + canonical event.json
→ first revision is materialized and SHA/bytes compared
→ second Lore commit indexes that already-known revision
→ index failure returns durable indexed:false and is repaired by history
→ optional push runs after repository mutation lock is released
→ UI receives revision, event timestamp, counts, index state, pushed|local|unknown,
   identity quality, namespace, and typed degradation rows
→ history query refreshes
```

The ABI call replaces the current direct cold-host import of `gpu/3d.zig`. A missing or
stale session is a named refusal; package disk bytes are never substituted.

## 8. Ordinary Save snapshot

```text
ordinary package Save
→ acquire operation-bound native model-write lease
→ ABI-6 strict encoder returns one owned resident candidate
→ retain durable package predecessor
→ atomic write/read/decode/hash those exact candidate bytes
→ in-module full diff requires zero changed/incomparable durable fields
→ success publishes manifest, issues one-use verified-Save receipt, and commits Lore kind=normal
→ mismatch restores/readbacks predecessor, leaves resident intact, commits
   Lore kind=save_mismatch natively from retained candidate/operation receipt,
   and returns named failure
→ release lease in every path
```

Lore failure does not roll back a valid package Save. A geometry mismatch cannot overwrite
the predecessor and is preserved as `save_mismatch`; any Save failure leaves the independent
panic control available.

## 9. History and pin

```text
Versions tab open / snapshot completes / pin changes
→ loreHistory {modelId,cursor,limit}
→ enforce timestampMs + 60 days before browse
→ rebuild index hints from verified committed event paths when needed
→ committed event.json rows + committed pin registry + remote ancestry/watermark truth
→ typed UI rows (no blob decode)

pin press
→ lorePin {modelId,snapshotId,pinned,push:true}
→ committed pin registry revision
→ exact row updates from response
```

Seat admission classifies history/status/preview as reads and public panic snapshot/pin/
restore intent as recovery/model mutations. Normal and transaction event appends have no
public Seat/JavaScript request.

## 10. Revision preview

```text
history row Preview sends snapshotId + expected revision/SHA guards
→ lorePreview resolves current event-path revision, validates guards/age/event/RJMD,
   and returns opaque Lore capability
→ mesh inspection consumes capability internally; no path crosses JavaScript
→ native preview door returns isolated Scene3D token/specimen
→ Scene3D shaded render/pick dispatch targets preview while resident stays parked
→ screen-space overlay draws preview selection accents only
→ saved face table for that revision can select/highlight preview groups
→ close/next preview attempts paired Scene3D-token + Lore-capability release
```

Preview does not adopt an edit session, replace package geometry, change native selection,
or add an undo entry.

## 10a. Recovery retention

```text
verified local snapshot / once-per-native-service-day maintenance
→ every read already enforces timestampMs + 60 days
→ repair/rebuild history index hint from immutable events
→ partition expired entries
→ commit expired entries as pruning tombstones and remove their pins
→ Lore-obliterate paths, query status, stage deletes, commit maintenance revision
→ retain partial path outcomes and retry idempotently
→ known-pushed entries become remote_prune_pending
→ authenticated branch push rewrites ancestry; verify remote revision disappears
→ compact only locally/remote-complete tombstones; run GC best effort
→ persist mutable state outside repository and separate logical/physical counts
→ Service tab + Seat status read the same facts
```

Legacy cutover first enumerates every shared-path revision. Each healthy unexpired entry is
dumped/verified and copied to an immutable snapshot preserving its original timestamp and
metadata; old→new mappings make retry idempotent. An unexpired corrupt/unmigrated entry is a
non-actionable history/Service diagnostic and physically blocks broad shared-path
obliteration until it migrates or reaches 60 days. There is no ordinary legacy browse
fallback. A prune error leaves an idempotent tombstone for retry and does not turn an already
verified snapshot into a failure.

## 11. Revision restore

```text
history row Restore sends snapshotId + expected revision/SHA guards
→ explicit confirmation names resolved revision/time/counts and artifact scope
→ panic snapshot current resident as kind=pre_restore
→ require verified preimage revision
→ open opaque target capability and decode selected revision without exposing a path
→ Scene3D adopts every RJMD channel into the same token as one journal transaction
→ package authority transactionally writes current geometry artifact/manifest reference
→ re-encode resident + read saved; require resident=target=saved SHA and zero full diff
→ on success mark document clean/current and append restored event from owned bytes
→ on disk failure restore package predecessor and undo resident journal transaction
```

Ctrl-Z after success installs the exact pre-restore resident snapshot; Ctrl-Y reapplies the
historical document. Original imports and primitive seeds are never restore fallbacks.

## 12. Lore service health

```text
native background status worker (bounded cadence, short timeout)
→ library/repository/server/unit/store facts
→ bounded completion queue caches only the latest immutable transition
→ v8_bindings_lore.tickDrain(host) calls __ffiEmit on the main thread
→ runtime/ffi subscriber reads the cached status only on changed event
→ status-bar badge + Service tab consume cache
```

The render thread and React frame loop never execute curl/systemctl or poll per frame. Panic
capture remains local/offline when the server is unhealthy.

## 13. Default verb mutation

```text
row detail action (rename/material/glass/delete/merge/...)
→ AppFrame acquires receipt bound to actor/op/model/token/generation
→ existing ModelToolApi/application command carries that receipt
→ native journal boundary validates the same operation lease
→ existing operation predicate and mutation
→ one existing mesh journal commit
→ new generation event
→ resident table refresh + saved/resident staleness badge
```

The explorer does not implement geometry operations or alternate undo. Direct toolbar/Seat
commands use ephemeral one-operation receipts and gizmos hold one from begin through
commit/cancel, so human and agent writes cannot interleave.

## 14. Guarded typed-field mutation

```text
explicit FIELD EDIT mode
→ acquire native model-write lease and refuse when full resident/saved diff is nonzero
→ validate field allowlist and typed candidate
→ create/verify Lore and durable package predecessors
→ build/encode/decode owned candidate through native meshdoc_format authority
→ adopt candidate into resident as one field_edit journal transaction
→ persist identical bytes through sibling temp/readback/atomic install
→ require resident=candidate=saved SHA and full diff=clean
→ release lease; append best-effort field_edit event from owned bytes
```

Any failure restores both package predecessor and resident receipt before lease release.
After success, undo changes resident only and makes the saved diff dirty; redo returns clean.

## 15. Cold reopen proof

```text
Save/restore/snapshot complete
→ fully terminate editor process
→ reopen package from durable RJMD only
→ native module establishes resident token
→ Faces resident/saved diff is clean
→ Lore history/pins remain visible without taking another snapshot
→ preview selected old revision without disturbing resident
```
