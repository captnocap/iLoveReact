# Phase 3 — Flow Map (how control/data actually move)

## The op flow (what Phase B rewrites the *edges* of, never the core)

```
JS door (v8_bindings_core.zig, ~136 doors)
  → pub fn mesh*/paint*/uv* in 3d.zig
      [PROLOGUE — the redundancy lives here]
      g_topo_refusal reset · guard chain (paint target? mode? resident mesh?
      tri_count? selection? scope intersection?) → topoRefuse(reason) + return
      capture: groups (captureFaceGroups | inline loop) · colors
      (collectCurrentFaceColors) · parts (capturePartOfFaces) · materials
      [MUTATION CORE — untouched by Phase B]
      mesh_edit / indexed_edit_mesh / model_source / model_paint algorithms;
      session state for preview ops (g_lc, g_bevel) — captures ESCAPE into it
      [JOURNAL — untouched]
      journalSnapshotCurrent/ForNewAction(label) → mutate → journalCommit(&snap)
      | journalDiscard(&snap); undo/redo install via journalInstall*
      [EPILOGUE — untouched]
      replace resident mesh, reintern GPU geometry, emit native action event
  → return bool/JSON to JS
```

Two allocation lifetimes in the prologue decide the idiom:
- **op-temporary** (masks, scratch): freed before return on every path → modern idiom
  is immediate `defer jalloc.free(x)`.
- **escaping** (loop-cut/bevel base meshes, colors stored into session state): freed by
  the SESSION later (lcFree etc.) → free-on-early-exit only; modern idiom is
  `var committed = false; defer if (!committed) …free…;` then `committed = true` at
  the store. NEVER arena these.

## Render flow (Phase B touches only duplicated blocks, W2–W3)

frame → drawScene (encoder-self-contained) → camera/lights/fog/frustum → collect
skinned figures → shadow pass → resolve geometry+textures (intern caches, diffuse
texture cache keyed by content hash) → batch static/dynamic instances (makeInstance
×10 sites, stride-row decode ×3) → pipeline selection (ground/region formula pipelines
ensureGroundPipeline/ensureRegionPipeline; grass/water/frond/skinned/live-region) →
opaque → transparent (per-mesh sort, depth-write OFF — contract) → detached targets
for pop-out windows on their own schedule.

## Build/verify flows

- Main binary: build.zig → v8_app/engine → @import chain reaches gpu/3d.zig.
- Dev module: build.zig `-Ddev-scene3d-module` → dev_scene3d_module_root.zig →
  dev_modules/scene3d_module.zig (`@import("../gpu/3d.zig")` + v8_bindings_scene3d).
  An unimported sibling file is invisible to both roots (safe clone).
- Suites build the editor themselves (`SHIP_RUN_PACKAGE=0 rjit ship editor`), all
  build paths serialize on the ship flock — sequential grading queues naturally.

## Codex flow (tonight)

build-workdir.sh slices CURRENT file → /tmp workdir (copy + spec + verify + refs)
→ `codex exec` (workspace-write; CANNOT touch the live tree) → inner loop against
verify.sh (ast-check 0.04 s + structural greps, quiet) → I grade: promote copy into
live tree → build + suites vs baselines → scope-diff audit + private probes →
commit (ratchet) or `git checkout --` (revert). Next wave slices the NEW file.

Gate: flow_map_traces_all_live_paths: **true**
