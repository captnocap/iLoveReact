# Phase 1 — Inventory: framework/gpu/3d.zig

Facts only. Measured 2026-08-11 against the working tree (file DIRTY, see §7).
Primary evidence: req_3830 (three codex research passes: capability map, duplication
audit, dead-code audit — `tools/request show req_3830`) re-verified and re-anchored
against today's file where load-bearing.

## 1. The file

- `framework/gpu/3d.zig` — **23,041 lines** (~275k tokens; exceeds a codex exec
  context window on its own — no executor may ever read it whole).
- Was 16,083 lines at req_3830's audit (2026-08-05). **+7k lines in 6 days.**
- 698 `fn` (314 `pub fn`), 505 top-level const/var, 96 struct types, **0 inline tests**.
- Comment share 16% (~2,600 comment lines) — third-densest GPU file; comments carry
  req-ids, rulings, and forbidden-alternative rationale (USER: they are part of the
  behavioral contract).
- Full function map with line numbers: `state/fn_map.txt` (698 rows, W0 regenerates).

## 2. The three systems inside it (req_3830 map, proportions re-checked)

| Region (today, approx) | System | Content |
|---|---|---|
| 1–692 | wire formats + camera | packed vertex/instance formats, uniforms, retained geometry cache, GLB/OBJ stash, native orbit camera (`orbitSetLocked` :484, `orbitFocus` :578) |
| 693–7236 | model-authoring backend I | `topoRefuse` :693, `cloneIndexedEditMeshOrImport` :714, `collectCurrentFaceColors` :1467, topology transactions (extrude :2637/:2883, loop cut :4470, bevel, connect, symmetrize, delete/weld), `capturePartOfFaces` :3898, part/doc ops (`captureFaceGroups` :5866, `paintedDocumentSnapshot` :6910) |
| 7237–8700 | journal | `const jalloc` :7237, snapshot/commit/discard/undo/redo (`journalSnapshotCurrent` :7911, `journalCommit` :8080), integrity roll-calls |
| 8700–11500 | model-authoring backend II | higher modeling ops (duplicate/mirror/path-array/detach/merge/flip/quadify/glass, `meshSolidifySelection` :10593), retopo state (:11148–:11368, `prepareRetopoBandInheritance` :11247), tool state (`meshGizmoToolRaw` :11449) |
| 11500–13500 | overlays + gizmos | gizmo render/hit (`gizmoArmEnd` :12552, `segDist2` :12555), grid, axes, mannequin, vertex/edge/face/UV/retopo overlays, marquee |
| 13500–16789 | selection/semantics + paint/UV façade | selectors, semantic regions, materials, retopo band planning (`retopoBandPlanJson` :15413, `meshRetopoBandsClear` :15533), paint fill/brush/layers, atlas ops, `paintedMeshVerts` :16523 |
| 16790–23041 | Scene3D renderer + GPU lifecycle | pipeline state banner :16790, init/deinit :17275, diffuse texture cache :18402 (`getDiffuseSampler` :18127), public API :19265, detached targets :19326, instance pools (`growStaticPool` :16735), `makeInstance` :19439, formula pipelines (`ensureGroundPipeline` :19651, `ensureRegionPipeline` :19747), render graph tail |

Roughly 71% is editor backend, 29% renderer/GPU — matches req_3830's 70% at 16k.

## 3. Import surface

- **28 files** reference `gpu/3d.zig` (engine.zig, layout.zig, v8_app.zig,
  v8_bindings_core.zig, world_loader/*, world/*, dev_modules/scene3d_*, gpu/shaders.zig,
  gpu/static_instance_policy.zig, game/camera.zig, diag/*, testing/unit/scene3d_*).
- **Two build roots** compile it: the main binary AND the modular dev host
  (`-Ddev-scene3d-module` → `framework/dev_scene3d_module_root.zig` →
  `dev_modules/scene3d_module.zig` builds it into a hot-reloadable .so).
- ~30 satellite modules already extracted under `framework/gpu/` (mesh_edit,
  indexed_edit_mesh, model_paint, model_source, paint_program, paint_islands,
  mesh_journal_log, mesh_semantics, path_array, historical_preview, …). 3d.zig is the
  orchestration hub holding the shared mutable `g_*` state.

## 4. Idioms present (two generations)

- **OLD** (e.g. `meshLoopCutFaceBegin` :4470): `std.heap.c_allocator` + hand-rolled
  free-ladder repeated in every `orelse`/error arm; inline faceGroupOf capture loops.
- **MODERN** (e.g. `meshSolidifySelection` :10593, req_3797-era): `jalloc` + immediate
  `defer jalloc.free(x)` / `defer x.deinit(jalloc)` after every allocation; calls
  existing capture helpers (`captureFaceGroups`, `capturePartOfFaces`).
- Counts: 651 `std.heap.c_allocator` refs, 303 `jalloc` refs, 447 `.free(` calls of
  which only 151 are defer-paired; 58 `g_edit_verts orelse` guards; 21 call sites each
  for `collectCurrentFaceColors()` / `capturePartOfFaces()`; 30 `topoRefuse(` sites.

## 5. Verification surface (what "same results" means)

- `tools/mesh-port-parity` — headless; builds editor (`SHIP_RUN_PACKAGE=0 rjit ship
  editor`), replays resident ops vs editMesh.ts expectations under v8cli.
- `tools/part-sync-parity` — headless; outliner-row ↔ part-range sync incl. native-door
  undo (A1–A6, B, E scenarios); asserts via partsdump files.
- `zig build test-scene3d-mesh-drag` — headless retained-cache two-drag regression.
- `tools/rjit shot editor …` — self-capture smoke (PNG well-formed, exit 0).
- KNOWN PRE-EXISTING DRIFT: basic-cut / loopcut seat suites drift predates req_3763
  (memory: project_mesh_parity_suites_status) → gates compare against W0-captured
  baselines, not absolute green.
- `zig ast-check framework/gpu/3d.zig`: 0.04 s, exit 0 today — the free inner gate.

## 6. Dead / never-wired (req_3830 audit, user-ratified 2026-08-05)

USER RULING: superseded ⇒ deletable; loosely-hanging ⇒ likely never wired, keep.
Names re-anchored today; the +7k drift means EVERY deletion must re-prove
zero-references at execution time (audit line numbers are stale).

Delete candidates (superseded, replacement live):
`paintedMeshVerts` :16523 (superseded by `paintedDocumentSnapshot` :6910),
`meshGizmoToolRaw` :11449 (native gesture code owns/reads the state),
`meshRetopoBandsClear` :15533 (lifecycle paths call specific resets directly),
`recordDab` paint_program.zig:973 (superseded by `recordDabShaped` :990 — OP_DAB
replay support STAYS), `hasPartRanges` model_source.zig:551 (consumers use
`partRanges` :557), the retired differential-normal helper (7527-era, locate by its
"retired detector" comment; superseded by concavity Auto-Fix), xray/mirror getters if
still present (audit 8025/8032-era; my greps no longer find them — may already be gone).

KEEP (never-wired or deliberate): `orbitFocus` :578 (eclipsed API seam — user decides),
`prepareRetopoBandInheritance` :11247 + `prepareRetopoBandAppend` :11255 (genuine
missing hookup, unit-tested in testing/unit/mesh_edit.zig — wiring it is a BEHAVIOR
CHANGE, out of scope), legacy face-tint skeleton in mesh_edit.zig (hot-reload
compatibility, policy-sensitive), test-only fns (pointFromBary, baryOfPointOnFace,
mesh_semantics.unnamedCount).

## 7. Working-tree state (must resolve at W0)

- DIRTY: `framework/gpu/3d.zig` (~122 changed lines), `framework/v8_bindings_core.zig`
  (~23), `build.zig` (~22); UNTRACKED: `framework/v8_bindings_scene3d.zig` (5-line
  stub). This is in-flight dev-scene3d-module wiring.
- Large dirty set across `cart/editor/` from parallel lanes (affects suite baselines —
  baselines are captured against whatever W0 freezes).

## 8. Hazards standing in this file (oracle)

- `resetForReload` flushes GPU intern caches on dev reload but must NEVER clear the
  active edit mesh / `g_edit_key` (HIGH, editor_hot_reload).
- `g_pipeline_transparent`: depth-write OFF, per-mesh sort, no self-occlusion — the
  ordering/config is a contract (req_3562).
- meshdoc legacy fallback silently soups quads (memory: meshdoc_legacy_fallback) —
  journal/mesh install paths are not to be "simplified".

Gate: inventory_complete_and_verified: **true**
