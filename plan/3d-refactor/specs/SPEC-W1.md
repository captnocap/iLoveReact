# W1 — Delete superseded dead functions (pure deletion, nothing else)

You are editing copies of three Zig source files from a larger project. The files are
in `work/`: `3d.zig` (~23k lines), `paint_program.zig`, `model_source.zig`. Reference
material is in `ref/`. You change code ONLY by deleting the functions listed below.

## Absolute constraints

- C1. NEVER read any file in `work/` end to end — `work/3d.zig` alone is ~275k tokens
  and will kill your context. Locate targets with `grep -n "fn <name>"` and read only
  ±40 lines around each hit with `sed -n`.
- C2. Pure deletions only. Do not rewrite, reformat, rename, reorder, "improve", or
  touch ANY surviving line, comment, or blank line. No new code of any kind.
- C3. Delete a function ONLY if `ref/references_report.txt` lists it with `refs=0`.
  A candidate with `refs>0` is SKIPPED (see SKIP protocol). This report was computed
  against the whole repository; you cannot recompute it and must not try.
- C4. Files use LF line endings; keep them LF.
- C5. Do not touch: any function not on the list, `orbitFocus`,
  `prepareRetopoBandInheritance`, `prepareRetopoBandAppend`, `recordDabShaped`,
  `partRanges`, anything containing `journal`, the `// ════` banner comments.

## Requirements

Each target = the complete function: its `pub fn`/`fn` line through its closing
brace, PLUS its immediately preceding doc comment block (`///` lines) if one exists,
PLUS any blank line that would otherwise double up. Nothing more.

- R1. In `work/3d.zig` delete `pub fn paintedMeshVerts` (superseded by
  `paintedDocumentSnapshot`, which stays).
- R2. In `work/3d.zig` delete `pub fn meshGizmoToolRaw`.
- R3. In `work/3d.zig` delete `pub fn meshRetopoBandsClear`.
- R4. In `work/paint_program.zig` delete `pub fn recordDab` (exactly the one whose
  signature does NOT contain `spec:`; `recordDabShaped` stays untouched).
- R5. In `work/model_source.zig` delete `pub fn hasPartRanges` (`partRanges` stays).
- R6. Write `REPORT.md`: one line per requirement — `R<n> <symbol> DELETED
  (lines <a>-<b>)` or `R<n> <symbol> SKIPPED: <reason>`.

## SKIP protocol

If a symbol is absent, appears with `refs>0` in the report, or its boundaries are in
any way ambiguous to you: do NOT delete it; record the SKIP with the reason in
REPORT.md. Skipping is success; guessing is failure.

## Gate

Run `bash ./verify.sh`. Do not finish until it exits 0. Your final message: the
REPORT.md content and the verify.sh output.
