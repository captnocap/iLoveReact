# W2 — Extract three exact-duplicate mechanical helpers (math + instance packing)

You are editing copies of three Zig files in `work/`: `3d.zig` (~23k lines — see C1),
`mesh_edit.zig` (~5k lines), `geo.zig` (small; the project's math module, imported by
3d.zig as `math` via `@import("../math/root.zig")` and re-exported through root.zig —
verify how root.zig exposes geo functions by reading `work/geo.zig`'s existing pub fns
and matching their call pattern in the other files, e.g. `math.<name>` vs
`geo.<name>`).

## Absolute constraints

- C1. NEVER read `work/3d.zig` or `work/mesh_edit.zig` end to end (context death).
  Locate every edit with `grep -n` and read ±60 lines with `sed -n`.
- C2. Behavior-identical refactor. You move/replace ONLY the exact code named below.
  Do not reformat, reorder, rename, or "improve" anything else. Surviving lines stay
  byte-identical.
- C3. Comments are part of the behavioral contract: any comment attached to code you
  replace MOVES with the code (into the helper) or stays at the call site if it is
  caller-specific. You may not drop or reword any comment.
- C4. The `pub fn` surface of `3d.zig` and `mesh_edit.zig` must not change (helpers
  you add there are private `fn`). `geo.zig` gains EXACTLY ONE `pub fn`.
- C5. LF endings. No file may gain a `usingnamespace` or `ArenaAllocator`.

## Requirements

- R1. `segDist2` exists byte-identically twice: in `work/3d.zig` and in
  `work/mesh_edit.zig` (`fn segDist2(px: f32, py: f32, ax: f32, ay: f32, bx: f32,
  by: f32) f32`). Add to `work/geo.zig`:
  `pub fn distancePointToSegmentSq(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) f32`
  with the IDENTICAL body, plus a doc comment: `/// Point-to-segment squared distance
  (screen space). Formerly duplicated as segDist2 in gpu/3d.zig and gpu/mesh_edit.zig.`
  Delete both `segDist2` definitions; rewrite their call sites to call the geo helper
  through each file's EXISTING import idiom for math/geo (grep how each file already
  calls geo/math functions and match exactly; if a file has no usable existing import
  path to geo, SKIP that file's conversion and report it rather than adding imports).
- R2. In `work/3d.zig`, `fn makeInstance(` (13 scalar params) has 10 call sites. Add
  directly ABOVE `makeInstance` a private helper that packs an instance from the
  node-field argument pattern those sites share (same field order), with the alpha
  (and, if sites differ only there, color) override as parameters. Convert ONLY the
  call sites whose arguments are plain `node.<field>` accesses (plus the override);
  a site whose arguments involve any other computation stays untouched and is listed
  in REPORT.md as KEPT with its line number. `makeInstance` itself stays unchanged.
- R3. In `work/3d.zig`, the same stride-based instance-row decode (reading position/
  rotation/scale/color floats out of `data` at `row * stride + k` offsets) appears 3
  times. Find them with `grep -n "stride" work/3d.zig`. Extract one private
  `fn instanceFromRow(...)` placed above the first site; convert exactly those sites.
  If you cannot find three sites matching one shared pattern, convert the ones that
  DO match and report the rest as SKIPPED with reasons.
- R4. REPORT.md: per requirement — what was extracted, which call sites converted
  (line numbers), which kept/skipped and why.

## Gate

Run `bash ./verify.sh`. Do not finish until it exits 0. Final message: REPORT.md +
verify output.
