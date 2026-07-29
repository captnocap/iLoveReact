# Editor Mesh Integrity — the commit roll call

Active surface: `cart/editor/`. Last verified: 2026-07-28.

## User contract — req_3484

Three weeks of "random chain of events corrupts the model, restart heals it"
(52 fix commits on the mesh/paint surface) share one structure: the mesh doc
has many derived copies whose consistency was hand-written per operation,
verified nowhere, with silent refusal as the only error policy — so the bug
site and the crash site were always operations apart. The user's ruling: stop
patching chains, fix the layer. Slice 1 is the roll call: **every accepted
topology transaction proves the part-ledger invariants at commit, heals what
it can prove, and reports loudly on both surfaces.** No corruption survives
the op that caused it silently.

## Host half — `framework/gpu/3d.zig` `meshIntegrityRollCall`

ARMED at `journalCommit` (every accepted topology op, including gizmo commits
and metadata checkpoints) and after a successful `journalStep` (undo/redo);
RUNS at `meshActionDrain` under a TWO-STRIKE protocol: the first faulty pass
is silent detect-only and re-checks at the next drain (~250ms); only a fault
that survives both passes heals and reports. Both legs are load-bearing,
proven headlessly: a commit-time check read loop cut's half-settled range
table as `unowned=16/32`, and even at drain time the timer can land inside a
gesture's own settle window (`unowned=8` once in three runs of a healthy
chain — loop cut renormalizes after committing inside the same door, but a
single-part doc can settle through later machinery). A real fault never
self-resolves, so two strikes trade ~250ms of latency for zero false alarms.
The alert enqueues into the drain right behind the op events that caused it.
`meshJournalClear` disarms so a pending check never audits the next document.

The check gathers the FULL partition — displayed faces plus every
host-stashed hidden part's groups — and runs `mesh_journal_log.analyze`
(the same prover the right-click journal diagnostics use: `rangesValid`,
`unownedFaces`, `multiplyOwnedFaces`).

Heal ladder (only what can be proven, never a guess):

- overlapping/inverted spans → the req_3032 repair (`ensureDisjointPartRanges`
  → renormalize);
- declared ranges owning no face of the full partition (a merge/delete
  remainder) → `mesh_journal_log.compactOccupiedPartRanges` — the
  compact-emptied-ranges precedent, hidden-part safe because the gather
  includes stashed groups;
- anything else (unowned faces, multiply-owned faces, group-table mismatch)
  → reported intact. A heal that invents ownership would launder corruption
  into a valid-looking partition.

Geometric tripwire (req_3486): the check also scans displayed faces for
EXACT same-winding duplicate faces — `canonicalFaceBits` rotates each face so
its smallest corner leads without changing winding, so `(a,b,c)` and
`(b,c,a)` collide while a reversed twin does not. `fromSoup` collapses these
at the import boundary, so any live one was minted by the op that just
committed (the a196f3b class, caught at its origin instead of shredding N
cuts later). Reversed twins (extrude's interior walls) are legal internal
structure; wire faces (`(a,b,b)` deliberate degenerates) are excluded by the
coincident-corner skip. Report-only — the next indexed lowering collapses
them anyway.

On any fault it logs `[mesh-integrity] roll call after '<op>' …` with the
numbers AND enqueues an `integrity_alert` action event (`ActionKind` ordinal
26, `model.mesh.integrity-alert`) carrying declared part counts before/after
the heal. The alert rides the same ring as authoring events, so it drains in
order right behind the op that caused it.

## Cart half — resync + say so where the user is looking

- `cart/editor/model/nativeMeshEvents.ts` — decodes the new `integrity-alert`
  row (bridge ordinal 26; the `.test.ts` pins it).
- `cart/editor/stage/ModelView.tsx` — `ModelToolApi.resyncFromHost()`:
  re-adopts the host session key if the mirror drifted, re-reads selection
  (`adoptHostSelection`) and part ranges (`resyncPartRanges`) from host truth.
- `cart/editor/shell/AppFrame.tsx` — the action drain loop special-cases
  `integrity-alert`: calls `resyncFromHost` and sets a visible
  `⚠ mesh integrity: …` status naming what was healed. The event still boards
  the editor bus like every native action.

## Bulk triangle recovery — req_3507

`Tris to Quads` is the inverse cleanup operation for a triangulated selection.
In Face mode, select two or more authored triangles and invoke
**Edit → Mesh → Topology → Tris to Quads** (the same action is in the contextual
topology strip). The host finds every compatible pair and commits the whole
sweep as ONE `tris to quads` journal entry; Undo restores the complete prior
group table. Unmatched triangles are deliberately left alone.

The operation is a group-only transaction on the resident indexed mesh:

- `indexed_edit_mesh.Mesh.quadifySelected` considers only one-triangle
  authored faces, pairs across one manifold shared edge, and requires the
  same Outliner part and texture-role material;
- each candidate must be coplanar, same-winding, and form a convex
  four-corner boundary;
- competing candidates are quality-ranked (balanced physical diagonals,
  balanced opposite edges, healthy corners) before a deterministic maximal
  pairing, so a regular triangulated grid recovers its cell quads instead of
  arbitrarily pairing across cell seams;
- `meshTrianglesToQuads` separates opaque and glass candidates before
  pairing, then funnels the result through the SAME
  `commitIndexedFaceGrouping` guard as Merge Faces;
- no resident render triangle is rebuilt or reordered. Exact winding,
  physical diagonal, UV rows, atlas pixels, materials, colors, part
  ownership, and Outliner ranges survive byte-stable. The authored paint
  layout is marked stale because two face islands became one.

The bridge returns `changed` (quads made), so the status line says exactly
what the sweep did. The journal action is append-only ordinal 27
(`model.mesh.tris-to-quads`); `integrity_alert` remains ordinal 26.

## Why commit-time, not gate-time

The pre-existing guards (`ownsExactPartPartition` before an append, the
range-stamp refusal, the save refusal) detect drift but refuse silently, ops
after the cause. The roll call moves detection to the op that first breaks
the invariant, so the terminal line and the status bar name the guilty
operation — the "4 angles to chase" collapse into one line of output.

Slices 2–3 (single commit epilogue for all derived-state fan-out; stable
document handle so JS never adopts keys) are specced in the req_3469–3484
thread and remain open.
