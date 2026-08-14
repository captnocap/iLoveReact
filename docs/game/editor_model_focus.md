# Model Focus panel — the boxed-cell focus body (Section G, model view)

Active surface: `cart/editor/`. Last verified: 2026-08-14.
USER ASK req_4392 — the "Model Focus Handoff" design intake
(`cart/editor/design documents/studio outliner focus panel/`).

## In one sentence

Section G's model pane is the merged Model Focus body — identity header,
SELECTION, SHAPE, SEMANTICS, PART, OUTLINER (the one flexing section), VIEWS —
where **the box is the affordance**: derived facts render as plain text and
every writable value renders as a click-to-edit, drag-to-scrub boxed cell that
commits ONE exact host-journaled transform.

## The laws (from the handoff, all implemented)

- **The box is the affordance.** Writable: pivot, bounds center/radius, part
  position/rotation/scale. No edit icons, no edit modes. Everything else is
  plain text.
- **Click-to-edit in place** (`inspector/EditCell.tsx`): click → inline input
  (primary-tinted border), Enter commits, Esc cancels, blur commits; a
  horizontal drag ≥3px scrubs the number and commits once on release so the
  host journal records one op, never a smear.
- **Overridden reads brighter**: off-default values use `theme:text`, defaults
  use the gold `theme:valNum`; the reserved 18px ↺ column is dim (`#3a4a58`)
  at default and interactive when overridden.
- **Empty sections collapse to one header line** — SELECTION none and VIEWS
  none never reserve body space.

## Mechanism (host fn ↔ JS)

- **`ModelFocusBridge.transformScope(scope, op)`** (`stage/ModelView.tsx`) —
  the ONE write path for every boxed cell. Scope `'model'` / `{lo,hi}` selects
  through `__mesh_select_query` (`kind:'all'` / `kind:'part'` — the same
  selector the Agent Seat compiles to), refuses a scope-clipped selection
  (actionable < matched) rather than half-transforming, and takes the pivot
  from the receipt bbox. Scope `'selection'` applies to what is already
  selected (the SELECTION pivot cell). Ops land through
  `__mesh_transform_translate` / `__mesh_transform_rotate_axis` /
  `__mesh_transform_scale_axis` / `__mesh_gizmo_scale_by` — each one
  host-journaled ("translate exact" etc.), so Ctrl+Z rewinds a cell edit like
  any gizmo drag.
- **SHAPE bounds cells** (`inspector/ModelFocusSections.tsx`): center edits
  translate the whole model by the axis delta; radius edits scale uniformly by
  `new/current` about the selection pivot.
- **PART section**: geometry BAKES transforms — there is no retained per-part
  matrix — so position/rotation/scale surface the SESSION-APPLIED offsets in
  the `editor.part-xform.v1` hot twig (per model+part, in-process, cold start
  resets by design). Every commit applies the delta over the part's authored
  range; ↺ unwinds the lane (rotations unwind in reverse axis order — exact
  for single-axis stacks, approximate for multi-axis). Host undo rewinds
  geometry but not the ledger: the ledger is "what the panel applied", never a
  second source of geometric truth.
- **SELECTION groups**: each edge/face group is a collapsible row with its
  meta compressed onto the group line (`v18–v19 · 0.1429 m · closed · part 0`);
  only the first 4 groups render, then "+ N more · show all". An unassigned
  face-group semantic renders a dashed "assign…" cell into the NAMES pane
  (SEMBLOB-0801: names are rigging data). Truncated native reads surface as a
  quiet `rendering X/Y tris` line, not a gold warning.
- **Identity header** (`ModelIdentityHeader`): thumbnail chip + editable name
  (the one AppFrame rename path) + thumbnail-shot verb; save chip + lore
  `rev N` (from the recovery coordinator's `repository.revision`) +
  Recover/Save verbs. Replaces the two stacked rename bars.

## The merged OUTLINER (`stage/ModelOutliner.tsx`)

One tree owns everything per part: named face regions (dim Tag), logical edge
paths (green Spline), and the mechanical-rig lane — hinge/mount/contact edge
roles (purple Bone). Bone skeletons stay in the RIG tab.

- **Attribution is exact, never guessed** (`data/outlinerFocusTree.ts`, pure +
  own suite): the resident percept now reports each region's authored-group
  span (`framework/gpu/scene3d/edit_semantics.zig` emits `groups:[lo,hi)` per
  region, threaded through `ModelFocusFaceSemanticRow.groupSpan`), and a
  region attaches to the part whose `[lo,hi)` CONTAINS it. Edge paths join by
  `objectId`, which IS the outliner part id at naming time. Anything without
  one exact owner — multi-part regions, pre-field hosts, orphaned objectIds —
  renders in a visible "unattributed" bucket.
- Collapsed part rows compress to a counts summary (`2 rgn · 1 edg · 1 rig`);
  the header shows totals (`17 · 25 rgn · 4 rig`). Clicking a leaf selects its
  geometry (`bridge.selectRegion` / `selectEdgeRegion` — the req_3883/3884
  locate law).
- Row verbs (drag grip / rename / duplicate / delete) appear ONLY on hover and
  the active row. Attachment leaves fold during a drag so drop-target math
  keeps its uniform-row-height invariant.
- The 12-button primitive strip is gone: **+ ADD** opens a dropdown of the
  primitives plus "Import mesh…"; the region/edge/rig legend pins at the foot;
  the outliner flex-fills the height every other section leaves over.

## Known gaps (named, not hand-waved)

- "shares verts → part" chips (in the mock) need a native shared-vertex query
  between part ranges; no such door exists yet.
- Vertex-coordinate and normal cells in SELECTION detail stay read-only —
  per-vertex numeric write needs a select-vertex + translate lane.
- An on-demand MEASURE verb for an over-budget audit does not exist; the audit
  rows keep the honest "not measured".
- Multi-axis PART rotation reset is order-approximate (see above).
