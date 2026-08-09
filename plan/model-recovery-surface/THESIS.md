# Model Recovery Surface — Phase 2 Thesis

## Current shape

Lore is a native recovery service with six JSON doors, but its only editor consumers are
the post-Save coordinator and Agent Seat. No visible control or browser exists. In modular
development builds, the Lore binding can read a cold duplicate of Scene3D state instead of
the module containing the visible model.

Mesh evidence is split across triangle selection JSON, aggregate audit counts, operation
popup refusal strings, and package-level summaries. There is no authored-face row that
joins geometry, meaning, ownership, derived defects, and operation refusals. Resident and
saved state are compared only by aggregate counts. A human and an agent can therefore see
different evidence and cannot select the precise row that explains a refusal.

## Target shape

One model-recovery workspace is available from every open model document without remounting
or duplicating its live `ModelView`.

```text
Stage center: one persistent live ModelView
Inspector right pane: BlobExplorerSurface
├─ Faces      resident | saved | diff
├─ Versions   Lore history | pin | preview | restore
└─ Service    Lore health | stores | repository | recovery commands
Every Inspector Save presentation: independent Recovery Snapshot control
Persistent status bar: Lore CHECKING | READY | LOCAL | BLOCKED badge
```

The Faces tab consumes a native `FaceTableService`. Authored faces are primary rows and
triangles expand underneath. The service analyzes one indexed document, runs `mesh_audit`
once, invokes the exact predicates owned by each supported operation, and returns paged,
generation-scoped rows. Owner threads only capture bounded immutable input; facts, audit,
operation eligibility, and full diff run on native workers and publish an identity-matched
completion event. It emits `not_analyzed` for every operation without a complete canonical
predicate. UI and Agent Seat consume the same response contract.

The saved plane is decoded only by `meshdoc_format`; the resident plane is acquired only
through the actual Scene3D module ABI. A face address is `(stable objectId, authored group)`
within a declared document generation. The diff joins those addresses first, then recognizes
only unique connectivity-fingerprint relocations; it reports relocated/added/removed/changed/
incomparable rows rather than aligning triangles by array rank.

A declared durable geometry reference is authoritative on open: read/decode/version/hash
failure is visible and never falls back to the original import or a primitive seed. Stable
object IDs are published before a resident session becomes inspectable. Logical IDs remain
plane-local; full diff uses exact artifact identity, a current encoder receipt, or unique
structural incidence correspondence and names ambiguous fields instead of guessing.

Lore capture receives an owned resident snapshot from the actual Scene3D module in the same
host call. Panic capture refuses neither missing object-ID publication nor another recoverable
channel defect: it persists every synthesis/repair/default/drop as typed provenance in the
ABI, RJMD, event, history, preview, face table, and UI; `exact` is legal only with no such
rows. History, preview, pin, and status remain native service operations. Preview
creates an isolated read-only RJMD render key and never changes the active edit session.
Restore first creates a recovery revision of the current resident, then installs the
validated historical RJMD into that same resident session as one mesh-journal transaction,
persists it transactionally, and leaves Ctrl-Z able to recover the pre-restore state.
New revisions use immutable per-snapshot Lore paths so native maintenance can permanently
obliterate artifacts older than 60 days locally, propagate rewritten ancestry to the server,
and report logical invalidation separately from physical reclamation. A pin remains a
browsing bookmark during the window; the age ceiling still wins on every read.
Legacy shared-path history is not discarded at cutover: every healthy entry still inside
the 60-day window is byte-verified and migrated with its original timestamp/metadata first.
An unexpired corrupt/unmigrated entry is visible as a non-actionable diagnostic and delays
path-wide obliteration until migration or age-out; no ordinary compatibility browse reader
survives.

Default edits from the table dispatch existing model verbs. Guarded field edit is a
separate explicit mode over typed fields; it captures both Lore/package predecessors, builds
and adopts one native journal candidate, persists those exact bytes, verifies exact SHA plus
a zero full-plane diff, and rolls both planes back on any failure. No UI or TypeScript module
reads/writes blob offsets.

## Thesis

**The change is: make model recovery and mesh truth one inspectable surface backed by the
same native authored-face predicates, resident session, saved decoder, selection authority,
and Lore revision chain used by the editor itself.**

## Done standard

1. An open modular-development editor model can create a panic revision whose preview SHA
   and bytes equal the exact visible resident snapshot; `no resident model document` cannot
   arise from a cold duplicate of Scene3D state, and every sanitized channel is named.
2. A persistent Recovery Snapshot control is visible beside ordinary Save and remains
   independent of Save validation. Its result names revision, index state, and truthful
   pushed/local/unknown state.
3. The recovery workspace shows paged Lore history with timestamp, label/note, kind,
   triangle/authored-face/part/logical-vertex counts, byte size, SHA, pin state, identity
   quality, and expandable typed recovery degradations.
4. A Lore badge remains visible with the explorer closed; Service details show library
   version, repository state, server health, unit state,
   journal tail, local/server store sizes, and restore commands. A native background probe
   reports state changes without render-thread or per-frame JavaScript polling.
5. Lore reads enforce a hard 60-day horizon immediately; maintenance reports next/last prune,
   local/remote tombstones, server ancestry cleanup, logical versus physical removal, and
   retains/migrates every healthy legacy entry younger than the horizon before obliteration.
6. Preview renders a selected historical RJMD without checkout, package replacement,
   session adoption, selection loss, or undo-history mutation.
7. Restore is explicitly confirmed, creates a pre-restore revision, installs into the same
   native session as exactly one journal entry, persists with readback verification, and
   requires resident/target/saved SHA equality plus zero full diff, and supports exact
   Ctrl-Z/Ctrl-Y across topology, logical IDs, semantics, materials, ranges, and selection.
8. `tools/seat face-table --sort area --filter malformed` and the Faces tab consume the
   identical versioned host response. Sorting area ascending puts a 2 mm sliver first in the
   focused fixture.
9. Every row includes generation-scoped identity, triangle membership, object/part,
   material, semantic role/name join, area, centroid-edge clearance, edge extrema, documented aspect,
   planarity deviation, convexity, degeneracy, boundary/build state, audit state, and a
   structured operation matrix.
10. `auditComputed:false` and operation `not_analyzed` remain visibly unknown. They never
   render as clean or allowed.
11. Selecting a resident row atomically validates generation, selects the exact authored
    group, frames it, and returns the selected count. Native viewport selection highlights
    and uses a native address seek to scroll to the corresponding page without a second
    geometry copy or forward cursor scan in React.
12. Saved/resident diff reports relocated, added, removed, changed, and incomparable faces
    with exact fields. A save that drops semantics, ranges, or connectivity is directly
    selectable and blocks a false success report.
13. Verb edits use the existing native journal and one undo row. Guarded field edits refuse
    dirty resident/saved disagreement, unsupported formats/fields, stale generation, missing
    preimage, or failed readback and restore both planes on any mid-transaction failure.
14. Focused Zig and TypeScript suites, the modular-host integration test, ReleaseFast editor
    ship, cold reopen, and a 60-second spikewatch run pass. No model asset is committed.

## What does not change

- RJMD v1–v4 remain readable for prop inspection. New writes use current v5 only.
- Existing four-influence GPU skinning, character-rig, paint, UV, Outliner, and prop Rig
  behavior are not redesigned here.
- Lore remains an independent recovery journal; ordinary Save keeps package transaction
  authority but now writes one exact owned resident candidate, restores its predecessor on
  mismatch, and records `normal` or `save_mismatch` independently.
- Agent Seat remains the canonical automation API. No parallel shell/command protocol is
  added.
- Display names are presentation data; object ID, authored group, semantic stable ID, and
  generation remain the identity fields.
- No arbitrary vertex/float editor, hex view, byte offset, or direct filesystem writer is
  introduced.
- Full-package Lore versioning (textures, RJSK, manifest, all sidecars) is not claimed by
  geometry revisions. The UI labels the artifact scope honestly.
- Every toolbar, gizmo, Seat, explorer, Save, restore, and guarded-field mutation meets one
  operation-bound native journal lease; reads and selection remain lease-free.
