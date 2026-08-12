# W5 — Prologue helpers + pilot family conversion to the file's modern idiom

You are editing `work/3d.zig`, a copy of one 23k-line file from a Zig 0.16 project's
native 3D model editor. This file contains TWO generations of the same patterns; your
job is to add three small helpers and convert the pilot list of functions in
`ref/OPS.txt` from the OLD idiom to the file's own MODERN idiom. `ref/
exemplar_solidify.txt` shows the modern idiom verbatim — match it, do not invent.

## Absolute constraints

- C1. NEVER read work/3d.zig end to end (~275k tokens = context death). grep + sed
  ranges only.
- C2. Convert ONLY functions listed in ref/OPS.txt. Every other line stays
  byte-identical. Do not reformat, reorder, rename, or improve anything else.
- C3. Behavior-identical. The MUTATION CORE of each op (everything between the
  prologue and the return path — mesh_edit/model_source/model_paint calls, journal
  calls `journalSnapshotCurrent`/`journalSnapshotForNewAction`/`journalCommit`/
  `journalDiscard`, resident-mesh replacement, event emission) is untouched: same
  calls, same order, same arguments.
- C4. Every `topoRefuse("...")` string is byte-frozen — tooling parses them. Strings
  may MOVE (into a helper) but never change, and every refusal that fires today on a
  given early-exit path must still fire on that same path.
- C5. Comments are part of the behavioral contract. Comments in replaced prologue
  code MOVE into the helper (if they describe the shared rule) or stay at the call
  site (if op-specific). Zero comment lines may be dropped or reworded. Doc comments
  with req_ ids especially.
- C6. No `pub fn` added/removed/changed (helpers are private `fn`). No
  ArenaAllocator, no usingnamespace, no new files, no new imports.
- C7. LF endings.

## The idioms (copy exactly)

Allocation, op-temporary (freed on every path inside the fn today):
```zig
const mask = jalloc.alloc(bool, n) catch { topoRefuse("<the op's existing string>"); return null; };
defer jalloc.free(mask);
```
Allocation, ESCAPING (stored into longer-lived session/global state on success —
e.g. loop-cut/bevel base meshes/colors): the committed-flag form, because errdefer
does not fire on plain `return null`:
```zig
var committed = false;
const colors = collectCurrentFaceColors(jalloc) orelse return null;
defer if (!committed) jalloc.free(colors);
// … after the store into session state, on the success path:
committed = true;
```
NEVER convert a buffer freed by session teardown (lcFree etc.) to a plain defer.

## Requirements

- R1. Add near `fn topoRefuse` (grep it) two private helpers, exactly:
  ```zig
  const EditableMesh = struct { verts: []const f32, tri_count: u32 };
  fn requireEditableMesh() ?EditableMesh
  ```
  refusing via the existing strings ("no editable mesh is resident", "the mesh has
  no triangles") when `g_edit_verts` is null or `g_edit_count / 3 == 0`; and
  ```zig
  const ScopedSelection = struct { mask: []bool, selected: u32 };
  fn requireScopedSelectionMask(a: std.mem.Allocator, tri_count: u32) ?ScopedSelection
  ```
  reproducing EXACTLY the existing mask pattern found in `meshLoopCutFaceBegin`
  (grep it; read that region): the `@max(tri_count, model_paint.faceCount())`
  allocation WITH its req_4114 comment block moved along, `@memset`,
  `mesh_edit.buildDeleteMask`, the "no faces are selected" refusal, the per-face
  `faceInScopePub` intersection loop WITH its comment, and the "every selected face
  is outside the focused part's scope" refusal. Returned mask length is tri_count
  (slice it); `selected` is the in-scope count.
- R2. Change `fn collectCurrentFaceColors()` to
  `fn collectCurrentFaceColors(a: std.mem.Allocator)` and
  `fn capturePartOfFaces()` to `fn capturePartOfFaces(a: std.mem.Allocator)` —
  bodies allocate from `a` instead of `std.heap.c_allocator`. Update EVERY caller in
  the file (grep them all) to pass `jalloc` (which IS c_allocator — an alias defined
  in the file; behavior identical). Callers NOT on OPS.txt change ONLY the argument
  list, nothing else in them.
- R3. For each function in ref/OPS.txt: replace its hand-rolled prologue with calls
  to `requireEditableMesh()` / `requireScopedSelectionMask(jalloc, em.tri_count)`
  where the op's existing prologue matches those patterns; convert its allocations to
  the two idioms above (classify each: does the pointer escape into state that
  outlives the function? then committed-flag; else defer). Free-ladders in
  `orelse`/`catch` arms disappear. Guard ORDER within each op is preserved (same
  refusal fires first on the same bad input).
- R4. An op whose prologue deviates from the shared patterns (extra guards, different
  mask semantics, mode checks beyond face): convert what matches, keep the rest
  inline UNCHANGED, and list the residue in REPORT.md. When in doubt: SKIP the whole
  op with a reason. Skipping is success; guessing is failure.
- R5. REPORT.md: per OPS.txt entry — CONVERTED (which idioms applied, which escape
  classifications made) / PARTIAL (what stayed inline and why) / SKIPPED (why).

## Gate

Run `bash ./verify.sh`. Do not finish until it exits 0. Final message: REPORT.md +
verify output.
