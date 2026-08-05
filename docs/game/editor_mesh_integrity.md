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

## Whole-topology triangle recovery — req_3507 + req_3511–3513

`Tris to Quads` is a model-wide planner, not a selected-face mutation. Enter
Face mode and invoke **Edit → Mesh → Topology → Tris to Quads** (also exposed
by the contextual topology strip, including when no face is selected). The
editor first paints a scanning card, then opens a reversible live dry run:
proposed source diagonals disappear from the real topology overlay while the
card reports quads recovered, paired/single triangles, authored faces
before/after, compatible pairings, and triangles with competing choices.
Nothing is journaled or dirtied as an authored operation until **Apply**.
**Cancel**, the close button, and Esc restore the exact pre-scan face groups
and selection with no undo entry.

The host owns the complete `meshQuadifyBegin` → `meshQuadifyPreview` →
`meshQuadifyEnd` session:

- every live one-triangle authored face is considered; selection is preserved
  only so Cancel can restore it;
- candidate triangles must share exactly one manifold edge plus Outliner part,
  texture-role material, alpha class, plane, and winding;
- the resulting boundary must contain four durable non-collinear corners.
  Concave pairs remain legal because two-face Merge Faces already accepts
  them; the sweep intentionally uses the same useful pair contract instead of
  the stricter convex-only raw-import heuristic;
- opaque and glass candidate graphs are solved independently, preventing one
  authored face from crossing render passes;
- Edmonds' blossom algorithm computes an **exact maximum-cardinality
  matching** over each complete compatibility graph. A locally attractive
  middle seam can no longer strand two recoverable end pairs;
- candidate ordering only chooses *which* maximum is shown. The popup cycles
  deterministic **Balanced**, **Short seams**, and **Alternate flow**
  evaluations; all retain the maximum quad count, and a plan signature makes
  distinct alternatives visible;
- each evaluation clones the captured base, so cycling never compounds the
  previous preview. Apply adopts the current group-only result as one
  `tris to quads` journal entry; Undo/Redo move the entire sweep atomically.

No resident render triangle is rebuilt or reordered. Exact winding, physical
diagonals, UV rows, atlas pixels, materials, colors, part ownership, and
Outliner ranges survive byte-stable. Apply marks the authored paint layout
stale because two face islands became one; preview and Cancel restore its
prior state.

Read-only fixture proof on `Torso_Female003` (req_3513): 6,831 resident
triangles / 6,783 authored faces yielded 1,156 compatible pairings and 292
triangles with competing choices. Every evaluation recovered the exact
maximum of **925 quads**, projecting **6,783 → 5,858 authored faces**; the
three plan signatures were distinct. Cancel left history at 0/0. Apply made
one `tris to quads` undo entry; Undo and Redo restored/reapplied the complete
925-quad grouping.

The journal action remains append-only ordinal 27
(`model.mesh.tris-to-quads`); `integrity_alert` remains ordinal 26. The legacy
`__mesh_topo_tris_to_quads` bridge drives Balanced begin/preview/apply only for
automation; the interactive editor always requires the dry-run confirmation.

## Merge Faces — the dissolve commit (req_3771)

Merge Faces fuses a coplanar face selection into one authored face
(`meshMergeSelectedFaces` / `__mesh_topo_merge_faces`). Two commit paths,
chosen by what the fused boundary keeps:

- **Byte-stable (group-only)** — when every corner the recorded resident rows
  reference survives on the clean boundary (a plain two-triangle → quad fuse),
  the resident render mesh is untouched: the seam disappears purely because
  the triangles now share one group; winding, UVs, atlas pixels, colours, part
  ownership, and Outliner ranges stay byte-identical
  (`commitIndexedFaceGrouping`).
- **Dissolve (re-tessellate)** — when the clean boundary DROPS corners (the
  inverse of a loop cut: seam verts turned collinear, grid centres turned
  interior) and the loop is CONVEX, the face is rebuilt from its clean loop
  through the same `lower()` + install path Loop Cut uses. The dead verts
  actually leave the resident soup instead of lingering as selectable dots no
  authored edge runs through (the req_3771 screenshot). The loop keeps its
  original per-corner UVs, so paint over one contiguous atlas region (the
  cut-then-merge case) stays where it was.

Concave fusions ALWAYS stay byte-stable even with dropped corners: `lower()`'s
loop tessellation is a fan, and re-fanning a concave perimeter reverses render
triangles (the bookshelf-side corruption, unit-pinned in
`framework/testing/unit/mesh_edit.zig`). A vert still referenced by a
neighbouring face's rows honestly survives until that neighbour merges or
welds too.

Headless proof (RJIT_MESHOPS): cube → ring loop cut (20 tris / 12 welded
verts) → pick + merge the top halves (18 tris, verts stay 12 — the ring verts
still corner the neighbouring cut faces) → merge the right-face halves
(16 tris, **12 → 11 verts**: the ring vert shared only by the two merged faces
dissolves). Undo/redo restore the exact pre/post rows under the one
`merge faces` journal entry.

Repair recipe for a face merged BEFORE this fix (dead verts already baked
inside one authored face): merge it with any coplanar neighbour — the dissolve
detection covers every source corner missing from the fused boundary, so the
old debris drops with it. For an isolated face, loop cut it once and merge the
halves back.

### T-junction seams merge in one shot (req_3800)

Seam cancellation is geometric, not id-exact. A T-junction seam — one face
spans in a single edge run what the facing side splits at a mid-run vertex
(cuts landing at different heights per column produce these) — is the same
geometry as an exactly-shared edge and dissolves the same way: before the
directed-edge cancellation, `mergeFaceIds` splits every selected face's edge
at any selection vertex lying strictly inside it (line tolerance
`max(MERGE_FACE_PLANE_ABS_EPS, len × MERGE_FACE_PLANE_REL_EPS)`, endpoints
excluded by `IMPORT_WELD_EPS`), so partially-overlapping seam runs decompose
into sub-edges that cancel exactly. Previously such a region refused to merge
one-shot and forced the user through staged sub-merges (whose collinear-drop
happened to dissolve the offending T-verts) — a fake restriction, since the
staged path reached the same single face. Genuine refusals stand: holed
selections (two boundary loops) and pinched boundaries (two outgoing boundary
edges at one vertex) still return null. The TS twin
(`cart/editor/model/editMesh.ts mergeFaces`) carries the identical split rule.
Unit-pinned in `framework/testing/unit/mesh_edit.zig` and
`cart/editor/model/editMesh.test.ts`.

**Cracked seams only merge when they can re-tessellate (req_3805).** A
cancelled T-split seam is a physical crack: the spanning side has no welded
vertex along the overlap, so its byte-stable rows keep rendering an open edge
INSIDE the fused face. A convex result re-tessellates (the dissolve commit),
which rebuilds the rows from the clean loop and stitches the crack. A CONCAVE
result never re-tessellates (a re-fan flips rows), so a concave fusion over
cracked seams — the user's horseshoe-around-a-hole, two columns bridged only
by a small quad — would commit an authored face that lies about its own
topology: lingering interior edges, centre dot floating over the void. Both
twins now refuse exactly that combination (`fragment_keys` ∩ cancelled seams +
`loopIsConcavePositions`); concave fusions over EXACT seams (the supported
req_3771 bookshelf class) and convex fusions over cracked seams stay legal.

## Outliner row ↔ range reconciler — req_3763 (P0-1/P0-2)

The roll call proves the HOST partition; the outliner ROW table (cart state)
had its own failure mode. `__modelPartRangesChanged` re-stamped rows by rank
only when row count equalled range count, and silently dropped the update
otherwise — a permanent latch, because the blocked re-stamp was the only
mechanism that could re-converge them. Any native-door undo across a
structural boundary (the Agent Seat's `undo` calls `__mesh_undo` directly,
bypassing the shell's note-restore in `meshUndoRedo`) armed it, and from then
on every row addressed foreign geometry (the police_sedan corruption:
19 native parts, 13 frozen rows, "Cabin" selecting a seat backrest).

Now (`cart/editor/shell/AppFrame.tsx`):

- counts equal → rank re-stamp, unchanged fast path;
- counts differ → **deferred reconcile** (~280ms — a structural op's own
  handler gets its beat to land the row): re-read live truth, then restore
  rows from the journal note the host itself restored with the geometry
  (`__mesh_journal_note()` read-back — row identity, names, colors survive an
  undo/redo no matter which path drove it), else **rebuild from geometry** —
  one follow-patch sweep tallies each range's dominant semantic region and
  mints `part:rebuild:*` rows named after it. Loud on both surfaces
  (`[partsync]` line + status). Never a silent no-op.
- `meshUndoRedo` refuses to apply a note whose row count disagrees with the
  host ranges (blind application was how a desync installed itself) and hands
  off to the same reconciler.
- Manual door: `__editor_reconcile_parts()`.

Regression: `tools/part-sync-parity` (RJIT_MESHOPS ops `shellparts` /
`shelladd` / `shelldetach` / `reconcile` / `partsdump`) proves A1–A6
(add / loop-cut re-stamp / cut undo / detach / native-door undo heal via
note with ids preserved / post-mismatch re-stamps still flow), B (a
native-only detach the shell never mirrored → geometry rebuild), and C
(region extrude partition + undo settle).

## Why commit-time, not gate-time

The pre-existing guards (`ownsExactPartPartition` before an append, the
range-stamp refusal, the save refusal) detect drift but refuse silently, ops
after the cause. The roll call moves detection to the op that first breaks
the invariant, so the terminal line and the status bar name the guilty
operation — the "4 angles to chase" collapse into one line of output.

Slices 2–3 (single commit epilogue for all derived-state fan-out; stable
document handle so JS never adopts keys) are specced in the req_3469–3484
thread and remain open.
