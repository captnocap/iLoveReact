# gpu/scene3d — the Scene3D module tree (verbatim split of the old gpu/3d.zig, req_4375)

The 23,893-line `framework/gpu/3d.zig` spread across 35 thematic files plus an
orchestrator, with **zero behavior change**. This attempt is the opposite of
the deleted first refactor attempt: nothing here was rewritten, improved, or hand-copied — the
files are **generated from 3d.zig by byte slicing** (`_tool/split3d.zig`), so
every decl body is verbatim by construction and the tool refuses to emit unless
every body byte of the source lands in exactly one output file.

**This tree is LIVE (req_4378):** every former importer of `gpu/3d.zig` now
imports this orchestrator — v8_bindings_core, the scene3d dev modules, the
world_loader runtime, and the headless scene3d unit suites. The original
`gpu/3d.zig` is unreferenced and kept only as the source the split was
generated from; regenerating from it after it drifts would be wrong — the
split files are now the live code.

## Layout

- `root.zig` — the orchestrator. Owns the original module doc, the shared import
  header, **all 225 top-level `var`s** (module state stays in one namespace so
  the `DocState` park/restore trio's `@field(@This(), ...)` reflection keeps
  meaning "the namespace holding the `g_*` globals"), the pinned DocState
  quartet, and one `pub const NAME = @import("part.zig").NAME;` re-export per
  moved decl. A trailing `comptime` block references every part so their layout
  assertions keep firing exactly as they did in one file.
- 35 part files (`formats.zig` … `doc_sessions.zig`) — boundaries sit on the
  original file's own section banners (see `_tool/manifest.txt`). Each part
  replicates the import header (paths adjusted one directory deeper), adds
  `const z3d = @import("root.zig");`, and carries its decls verbatim.
- `_tool/` — the splitter (`split3d.zig`), the grouping manifest
  (`manifest.txt`), and the decl inventory (`inventory.tsv`). Not part of the
  module; run with `tools/zig/zig run`.

## The only three mechanical transformations

1. `z3d.` prefixed onto references to moved top-level names in part files
   (scope-aware: definition sites, field names, labels, dotted accesses, and
   names shadowed by an enclosing container are excluded).
2. `pub ` added to decls that weren't pub — top-level decls and container
   member decls — because callers now live in other files. Visibility widening
   only; no call site changes meaning.
3. Header import paths adjusted for the deeper directory
   (`capture.zig` → `../capture.zig`, `../diag/log.zig` → `../../diag/log.zig`).

Line accounting: 23,893 original → 26,774 across the tree. The +2,881 is
replicated import headers (35 × ~52 lines) + 964 one-line re-exports + file
preambles. Zero duplicated logic, zero added behavior.

## Regenerate

    cd framework/gpu/scene3d/_tool
    ../../../../tools/zig/zig run split3d.zig -- inventory ../../3d.zig   # decl map
    ../../../../tools/zig/zig run split3d.zig -- emit ../../3d.zig manifest.txt ..

The tool hard-fails on parse errors, unassigned decls, empty part files, and
any byte-accounting mismatch.

## Verify

    tools/zig/zig build check-3d-split

Additive build step (`framework/split3d_check_root.zig`): compiles the split
tree with the full app module graph and recursively references every pub decl,
forcing semantic analysis of every moved decl. Status: **green** — compiles,
links, and all 164 pulled-in framework tests pass.

Known pre-existing cosmetic quirk (diagnosed under req_4376): the step prints
a red `failed command: …` block yet succeeds — `zig build` exits 0 and the
summary shows every test passing. The Zig 0.16 build runner renders the
error-message block for any step that produced stderr, **pass or fail**
(`lib/compiler/build_runner.zig:1381`), and that block always ends with the
`failed command:` footer (`:1518`) since `result_failed_command` is populated
on every spawn (`lib/std/Build/Step.zig:356`). The stderr here is the
model_paint density-clamp warning (`model_paint.zig:2707`), printed on purpose
by the passing test "density clamps: a huge face at high density stays inside
the GPU limits". Same rendering hits `test-scene3d-mesh-drag`. Nothing is
failing.
