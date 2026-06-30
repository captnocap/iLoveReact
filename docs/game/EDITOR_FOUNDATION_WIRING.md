# Editor Foundation — Build-Pass Wiring Checklist

The editor-foundation Zig modules were committed **dormant** (isolated, ast-check
clean, unit tests authored) so they can't break the tree before a build. To bring
them live, apply the wiring below and run the build. Each module's authoritative
`// INTEGRATION:` note lives at the top of its `v8_bindings_*`/test file — this doc
consolidates them so the build pass is one place.

Status legend: ☐ not yet wired · ☑ wired.

## A — Authoring eventbus (`framework/events/`)

☐ **`framework/v8_ingredients.zig`**
- Import near the `v8_bindings_eventbus` import (~line 98):
  `const v8_bindings_editor_bus = @import("events/v8_bindings_editor_bus.zig");`
- Add one INGREDIENTS entry in the always-on block, after the `eventbus` entry (~line 310):
  `.{ .name = "editor_bus", .required = true, .grep_prefix = "", .reg_fn = "registerEditorBus", .mod = v8_bindings_editor_bus },`
- `registerEditorBus()` also calls `editor_bus.init()`, so no separate boot line in `v8_app.zig`.

☐ **`build.zig`** — no production change (pulled into the root module transitively via
the `@import`, like `v8_bindings_eventbus`; deps `v8_runtime.zig` + `storage/sqlite.zig`
already in the graph). To RUN the unit test, add the `test-editor-bus` module/step block
(exact lines in `framework/events/v8_bindings_editor_bus.zig` header / the test file).

## B — Diagnostics host + console (`framework/diag/`)

☐ **`framework/v8_app.zig`** — beside the other binding registrations (~line 4067, near
`v8_bindings_reconciler.register()`):
```zig
const editor_diag = @import("diag/v8_bindings_editor_diag.zig");
// ...
editor_diag.register();   // calls diag_registry.init() + installs the feed sink
```
☐ **`build.zig`** — no change for the two `framework/diag/*.zig` (plain `@import` siblings).
Unit test needs a `build.zig` step — exact `createModule`/`addImport("diag_registry")`/
`addTest` block is in `framework/testing/unit/diag_registry.zig` header (mirrors the layout
test, ~line 927).

## D — Chunk compile-cache scaffolding (`framework/world/`)

☐ **`build.zig`** — add modules `world_compile_cache` (root `framework/world/compile_cache.zig`)
and `world_chunk_dirty` (root `framework/world/chunk_dirty.zig`, with
`addImport("world_compile_cache", …)`), then a test module rooted at
`framework/testing/unit/compile_cache.zig` importing both, plus a `test-world-compile-cache`
step — mirroring the existing `world_gamefile_writer_test` block (~build.zig:1189). Exact lines
in the test file header.
- Dormant otherwise (no existing-file change); whole-map bake stays the fallback.

## E — Hot authoring-state index (`framework/editor/`)

☐ **`framework/events/editor_bus.zig::append()`** — one line right after the existing
broadcast near the end:
```zig
        if (g_broadcaster) |bc| bc(confirmed);
        @import("../editor/hot_index.zig").instance().observe(seq, confirmed); // ← ADD
        return seq;
```
(`confirmed` stays valid; `observe` re-parses independently, never frees it. A
function-pointer alternative is documented in `hot_index.zig` if editor_bus prefers no
`editor/` import.)

☐ **`framework/v8_ingredients.zig`** (always-on block, after the `editor_bus` entry):
```zig
const v8_bindings_hot_index = @import("editor/v8_bindings_hot_index.zig");
.{ .name = "hot_index", .required = true, .grep_prefix = "", .reg_fn = "registerHotIndex", .mod = v8_bindings_hot_index },
```
☐ **`build.zig`** — no production change (reached transitively). For the test: mirror the
`world_gamefile_writer_test` block, providing `world_compile_cache` + `world_chunk_dirty`
modules to both the index and test modules, then a `test-hot-index` step. Full block in the
`// INTEGRATION:` header of `v8_bindings_hot_index.zig` + the test file.

## H slice 1 — Skeleton schema + bones_loader validator (`framework/skeleton/`)

☐ **`build.zig`** — no production change (root reaches the modules transitively). For the test
(mirrors the mesh-import pattern ~build.zig:964; `bones_loader.zig` pulls in `skeleton.zig` via a
sibling import, so one module):
```zig
const bones_loader_test_mod = b.createModule(.{
    .root_source_file = b.path("framework/testing/unit/bones_loader.zig"),
    .target = target, .optimize = optimize, .link_libc = true,
});
bones_loader_test_mod.addImport("bones_loader", b.createModule(.{
    .root_source_file = b.path("framework/skeleton/bones_loader.zig"),
    .target = target, .optimize = optimize, .link_libc = true,
}));
const bones_loader_test = b.addTest(.{ .name = "bones-loader-test", .root_module = bones_loader_test_mod });
b.step("test-bones-loader", "Run the skeleton validator unit tests")
    .dependOn(&b.addRunArtifact(bones_loader_test).step);
```
- **Slice-2 fold (NOT this pass):** `mesh_import.zig`'s `parseGlb`/`visitNode`/`nodeMatrix`
  (~lines 381-423) already walk the glTF node TRS hierarchy — a GLB *is* a bone formation. The
  slice-2 adapter maps each glTF node → a `Bone` and its mesh → `Meshes.per_bone{bone_id,
  geometry_key}`, then hands the `Skeleton` to `validate`. No change to `mesh_import.zig` itself.

## After wiring

- Build via the user's normal `tools/rjit ship <cart>` path (framework changes need a rebuild;
  not covered by `rjit dev` hot reload).
- Run the authored unit tests: `test-editor-bus`, `test-world-compile-cache`, the diag test,
  `test-hot-index`, `test-bones-loader`.
- The TS registries (commands, buildjournal, tunables, editorbus, diag/channel, skeleton) are
  already verified under `tools/v8cli` and need no build to be correct.
