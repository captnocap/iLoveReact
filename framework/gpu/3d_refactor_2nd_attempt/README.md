# 3d_refactor_2nd_attempt — the verbatim split of gpu/3d.zig (req_4375)

The 23,893-line `framework/gpu/3d.zig` spread across 35 thematic files plus an
orchestrator, with **zero behavior change**. This attempt is the opposite of
`3d_refactor/`: nothing here was rewritten, improved, or hand-copied — the
files are **generated from 3d.zig by byte slicing** (`_tool/split3d.zig`), so
every decl body is verbatim by construction and the tool refuses to emit unless
every body byte of the source lands in exactly one output file.

Nothing imports this tree yet. The shipping build still compiles the original
`gpu/3d.zig`; cutting importers over to this directory is a later, separate step.

## Layout

- `3d.zig` — the orchestrator. Owns the original module doc, the shared import
  header, **all 225 top-level `var`s** (module state stays in one namespace so
  the `DocState` park/restore trio's `@field(@This(), ...)` reflection keeps
  meaning "the namespace holding the `g_*` globals"), the pinned DocState
  quartet, and one `pub const NAME = @import("part.zig").NAME;` re-export per
  moved decl. A trailing `comptime` block references every part so their layout
  assertions keep firing exactly as they did in one file.
- 35 part files (`formats.zig` … `doc_sessions.zig`) — boundaries sit on the
  original file's own section banners (see `_tool/manifest.txt`). Each part
  replicates the import header (paths adjusted one directory deeper), adds
  `const z3d = @import("3d.zig");`, and carries its decls verbatim.
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

    cd framework/gpu/3d_refactor_2nd_attempt/_tool
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

Known pre-existing quirk: the `zig build` run-step reports `failed command`
for this target **and** for the existing `test-scene3d-mesh-drag` alike, while
both test binaries exit 0 with all tests passing when run directly from
`.zig-cache/o/...`. That harness `--listen` quirk predates this work.
