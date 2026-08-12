# Phase 4 — Decomposition: the wave list

Nine codex waves + overflow, strictly sequential, each gated (see EXECUTION_PLAN).
Anchors are TODAY's symbols — every spec instructs: locate by quoted signature/pattern,
NEVER by line offset; a pattern not found ⇒ SKIP + report, never improvise.
All audit findings below originate from req_3830 and were re-anchored 2026-08-11.

## W1 — B3: dead-code deletions [model: spark — pure deletions, airtight list]

Delete each symbol ONLY if verify proves zero references repo-wide (the +7k drift may
have added callers since the audit — a referenced symbol is SKIPPED + reported):

| symbol | file | replacement that stays |
|---|---|---|
| `paintedMeshVerts` | 3d.zig :16523 | `paintedDocumentSnapshot` :6910 |
| `meshGizmoToolRaw` | 3d.zig :11449 | native gesture code reads owning state |
| `meshRetopoBandsClear` | 3d.zig :15533 | specific per-transition resets |
| retired differential-normal helper | 3d.zig (locate: comment about the retired unsafe-edit detector, 7527-era) | concavity Auto-Fix predicate |
| `recordDab` | paint_program.zig :973 | `recordDabShaped` :990 (OP_DAB replay STAYS) |
| `hasPartRanges` | model_source.zig :551 | `partRanges` :557 |
| xray/mirror getters (audit 8025/8032-era) | 3d.zig if still present | callers read mesh_edit directly |

DO NOT touch: `orbitFocus`, `prepareRetopoBandInheritance`/`prepareRetopoBandAppend`,
face-tint machinery, any `pub fn` a binding registers (verify greps v8_bindings_*).

## W2 — B1a: math + instance packing clones [terra]

1. `segDist2` — byte-identical twins at 3d.zig :12555 and mesh_edit.zig :5021.
   Canonical home: `framework/math/geo.zig` as `pub fn distancePointToSegmentSq`
   (same body, doc comment noting the two former homes). Both twins become calls
   (3d.zig imports `math` already as `@import("../math/root.zig")`; mesh_edit
   analogously). Verify: exactly 0 remaining `fn segDist2` definitions.
2. `instanceFromNode` — `makeInstance` (3d.zig :19439, 13 scalar params) has 10 call
   sites passing the same node fields. New private `fn instanceFromNode(node, …)`
   beside makeInstance; convert ONLY the call sites whose arguments are the plain
   node-field pattern (an alpha/color override variant parameter is allowed);
   sites with genuinely different math are SKIPPED + reported.
3. `instanceFromRow` — the stride-based instance-row decode repeated 3× (14406/15134/
   15730-era; locate by the stride indexing pattern). One private decoder.

## W3 — B1b: GPU boilerplate clones [terra]

1. Diffuse texture binding pair (13482/13568-era; near the diffuse cache banner
   :18402 and `getDiffuseSampler` :18127): view+sampler-validate+bind-group+failure
   cleanup → `createDiffuseTextureBinding(...)`. UPLOAD POLICY STAYS AT CALLERS
   (one is content-cached, one mutates in place — audit warning).
2. `ensureGroundPipeline` :19651 / `ensureRegionPipeline` :19747 — shared
   `buildFormulaPipeline(cfg)` for shader assembly/compile-progress/module/layout/
   vertex/fragment/pipeline creation. The depth comparisons stay EXPLICIT per caller
   (.less ground vs .less_equal region — different rendering behavior, audit warning).
3. Region-slot find/claim + data install pair (11908/11961-era; today inside/near
   `setRegionSlotBound` :16957 and the formula path): `findOrClaimRegionSlot()` +
   `installRegionData()`.
4. Storage bind-pool triple init (12601/12637/12689-era: ground, live-region,
   skin-palette pools; near `growStaticPool` :16735 region): parameterized
   `initStorageBindPool(...)`.

## W4 — B1c: editor-side clone pairs [terra]

1. Extrusion result-metadata install + rollback tail duplicated between
   `meshTopoExtrudeFace` :2637 and `meshTopoExtrudeRegion` :2883 (1811/2088-era
   blocks): `installExtrusionResultMetadata(...)` centralizing rollback. The two
   topology algorithms stay separate (audit warning).
2. Retopo band-plan install pair (10545/10566-era; near `retopoBandPlanJson` :15413
   family): shared journal/capture/clear/install/commit tail →
   `installRetopoBandPlan(...)`.
3. Overlay triangle decode ×4 (9182–9271-era; in the overlay renderer): decode three
   positions, normal/centroid, backface reject, project →
   `projectVisibleTriangle(...)`. Each overlay's coloring/grouping logic stays.
4. Gizmo arm hit-testing pair (8567/8626-era; near `gizmoArmEnd` :12552):
   `gizmoArmHitDistanceSq(...)`.

## W5 — B2 pilot: prologue helpers + one family [sol — the design-bearing wave]

Adds the THREE new helpers (exact APIs in REUSE_MAP.md): `requireEditableMesh`,
`requireScopedSelectionMask`, allocator params on `collectCurrentFaceColors`/
`capturePartOfFaces` (both PRIVATE — pub surface frozen). Converts the delete/weld/
hide-show family as pilot (well covered by part-sync-parity + mesh-port-parity).
Every converted fn: modern idiom (jalloc, defer-per-allocation, or committed-flag for
escaping captures), helpers replace inline prologue, mutation core + journal calls
byte-preserved. Exemplar shipped in workdir: `meshSolidifySelection` :10593 excerpt.

## W6 — B2: topology transactions [sol — highest fragility]

extrude face/region/edge, create face, loop cut begin/preview/end (:4470–:4770),
connect vertices, symmetrize, bevel session ops. Loop-cut/bevel captures ESCAPE into
session state (g_lc/g_bevel) — committed-flag idiom, NEVER plain defer-free, NEVER
arena. Suites: mesh-port-parity covers these directly; known basic-cut/loopcut
baseline drift — compare to W0 baseline.

## W7 — B2: selection/semantics + retopo state + tool state [terra]

Direct selection ops, scope/part-range mirrors, semantic-region assignment, selectors,
retopo band planning/manual bands/ghost, picking/marquee/scope fns (13500–16789 and
11148–11500 regions).

## W8 — B2: paint/UV façade [terra]

Fill/brush/mirrored/polygon painting doors, paint undo/layers, atlas density/fit,
UV-island ops, UV rect/corner apply, restore/auto-size/project, atlas replace/import/
resize/palette/sampling/variants (15600–16789 region + paint doors earlier).

## W9 — B2: higher modeling ops residue [terra]

duplicate/mirror part, path array, detach, merge parts, flip/normalize winding, merge
faces, tri-to-quad preview/commit, glass partition, concavity repair — whatever the
W5–W8 OPS lists didn't already cover in 8700–11500.

## Overflow queue (quota burn after W9, in order)

- OF1: mesh_edit.zig `distinctFaceEdges()` (4 sites :2592/:2635/:2780/:2819-era) +
  retopo band-summary/bbox pair (:320/:397-era) [luna].
- OF2: model_paint.zig `rayTri` → call `rayTriBary` (:1804/:1824-era) + canonical-UV
  prep pair (:1325/:1381-era) [luna].
- OF3: world_window.zig :237 / panel_window.zig :224 shared surface/blit construction
  → `WindowSurfaceBlitter` [terra].
- OF4: Phase-C manifest generation [sol, READ-ONLY]: emit `reports/c_manifest.csv`
  (symbol → chapter assignment for all 698 fns + 505 top-level decls + which g_*
  globals each chapter touches), from fn_map + banner structure. No source changes.
- OF5: comparison fan-out — rerun W6-class conversions on a scratch copy under the
  other model tier; grade both; keep the better (pure quota burn, zero risk).

## NOT decomposed on purpose (audit + rulings)

Journal snapshot sites (43, differ on purpose) · local vector helpers (different
thresholds) · hashKey fns (cache identity) · render-pass descriptors (depth/load
differences are real) · anything in §Non-goals of THESIS.md.

Gate: all_high_fragility_units_decomposed: **true**
