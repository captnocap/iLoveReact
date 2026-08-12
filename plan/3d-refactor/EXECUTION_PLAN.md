# Phase 6 — Execution Plan (the overnight runbook)

Self-sufficient: a fresh session can drive this. Driver = Claude (supervisor);
executor = codex CLI (quota window closes 2026-08-12 10:40). Everything runs on main,
no branches/worktrees (repo law). Codex never touches the live tree — it works on
copies in /tmp workdirs (workspace-write sandbox); promotion is a `cp` by the driver.

Paths: PLAN=plan/3d-refactor · repo root assumed CWD · scripts in $PLAN/scripts/.
Board: note progress on req_4259 per wave (`tools/request note req_4259 --by <you>`).

## Step 0 — FREEZE (driver, no codex)

0.1 `git status --porcelain` — inventory the dirty set. Stage EXPLICIT paths (never
    -A): the scene3d wiring (`build.zig framework/gpu/3d.zig
    framework/v8_bindings_core.zig framework/v8_bindings_scene3d.zig`) commit
    `checkpoint(scene3d): land in-flight dev-module wiring before 3d refactor freeze (USER ASK req_4259)`;
    then the remaining dirty cart/editor+docs set as
    `checkpoint: pre-3d-refactor tree freeze (USER ASK req_4259)`. Record the freeze
    sha in state/freeze_sha.txt.
0.2 `cp framework/gpu/3d.zig framework/gpu/3d_frozen.zig.ref` (unimported ⇒ inert;
    the .ref suffix keeps it out of zig compilation entirely). NOT committed — local
    breadcrumb only (repo publish rules); diffs run against git anyway.
0.3 Regenerate refs: `grep -nE '^(pub )?fn ' framework/gpu/3d.zig >
    $PLAN/state/fn_map.txt`; `grep -E '^pub fn ' framework/gpu/3d.zig | sort >
    $PLAN/state/pub_surface.txt` (+ same for mesh_edit.zig, paint_program.zig,
    model_source.zig into state/pub_surface_<file>.txt).
0.4 Baselines (serialize; ~10–20 min total): run and tee full output to
    $PLAN/contracts/: `SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor` (build sanity),
    `zig build test-scene3d-mesh-drag` → mesh_drag.txt, `tools/mesh-port-parity` →
    mesh_port.txt, `tools/part-sync-parity` → part_sync.txt. Record exit codes in
    contracts/exit_codes.txt. A FAILING baseline is recorded as the baseline (known
    drift) — the per-wave gate is "no new deltas vs these files", not absolute green.
0.5 Gate `freeze_committed_and_baselines_captured` → control_board.md.

## Wave loop — for W in W1 W2 W3 W4 W5 W6 W7 W8 W9 (then overflow OF1…OF5)

1. AUTHOR SPEC (driver): specs/SPEC-<W>.md from DECOMPOSITION_MAP §<W> +
   REUSE_MAP APIs + the spec template rules (specs/SPEC-TEMPLATE-RULES.md).
   W1/W2/W5 are pre-written tonight; W3/W4/W6–W9 are authored between waves from
   their pinned decomposition data (mechanical transcription, all anchors present).
2. BUILD WORKDIR: `$PLAN/scripts/build-workdir.sh <W>` → /tmp/codex-3d/<W>/
   (fresh copy of target file(s) from the LIVE tree, SPEC.md, verify.sh, ref/
   pub_surface + fn_map + exemplar excerpt; B2 waves also ref/OPS.txt = the wave's
   op-name list grepped from the live file at build time).
3. LAUNCH (background Bash, capture log):
   `cd /tmp/codex-3d/<W> && codex exec -m <model per DECOMPOSITION> --sandbox
   workspace-write --skip-git-repo-check "$(cat SPEC.md)" > codex.log 2>&1`
   Models: W1 spark · W2–W4 terra · W5–W6 sol · W7–W9 terra · OF luna/terra.
   While a wave runs, the driver authors the next spec — never idles, never polls.
4. GRADE (driver; never trust codex's checklist):
   a. Re-run `bash verify.sh` in the workdir myself — must exit 0.
   b. `$PLAN/scripts/grade-wave.sh <W>` — asserts clean tree, promotes work/ copies
      onto the live paths, runs build + the three suites, diffs suite output vs
      contracts/ baselines, runs scope-containment diff (all hunks inside the wave's
      declared symbols/regions) and the private probes (scripts/private-probes.sh —
      NEVER shipped into a workdir).
   c. PASS → commit explicit paths: `refactor(3d): <wave title> (USER ASK req_4259)`;
      append per-requirement scorecard to reports/sections/<W>.md; board-note.
      FAIL → `git checkout -- <paths>` (tree returns to last ratchet commit), write
      reports/live_risks/<W>-fail.md with codex.log excerpt + failing check. One
      relaunch with the failure quoted in an amended spec; a second fail parks the
      wave (SKIP, morning report) and the loop continues — later waves don't depend
      on earlier ones beyond the shrinking file.
5. Advance state/current_step.txt; next wave slices the NEW live file.

## Rules the driver must hold all night

- SEQUENTIAL waves on the live tree (interconnected file — repo law; the ship flock
  serializes builds anyway). Parallel codex ONLY for OF5 comparison runs in scratch
  dirs that are never promoted directly.
- Codex context ceiling: specs forbid whole-file reads; verify.sh stays quiet (one
  line per check); if a run dies near the ceiling, inventory work/3d.zig against the
  workdir's pristine copy — often only the final report was lost; grade what landed.
- An external commit appearing mid-run (parallel lane): re-run 0.3–0.4 baselines
  before the next promote; never checkout over unstaged work that isn't ours.
- No suite may be "fixed" to pass a wave. Suites/baselines are read-only tonight.
- Killing a stuck codex: `kill <exact PID>` only (repo law: never pattern-kill).

## Morning report (driver, before 10:40)

reports/MORNING.md: per-wave scorecards table, net line delta (`wc -l` vs 23,041),
c_allocator/free/defer counts vs INVENTORY §4, skipped items with reasons, parked
waves, overflow completed, quota spent, and the Phase-C readiness note (OF4 manifest
if it ran). Move req_4259 → review with the paragraph + shas. Post-B freeze:
`state/postB_sha.txt`.

## Phase 7 — Severance (folded into each wave; full pass at the end)

Phase B's "legacy" = the duplicated inline bodies and dead fns themselves; each wave's
verify proves the old pattern is GONE in its region (grep-counts) while behavior holds
(suites) — severance is therefore continuous. The final severance check before the
morning report: `grep -c "fn segDist2" == 0 across gpu/`, W1 symbols absent
repo-wide, no `_old`/scratch files left in framework/ (the .ref breadcrumb excepted,
untracked), `git status` clean, full suite pass vs baselines one last time.
closure_summary_written → control_board.md.
