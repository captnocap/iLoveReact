# Phase 7: Severance Build

**This phase exists because "done" is a lie until the old code is gone and the build still passes.**

## The Problem

Workers execute parity sections. They prove the new path produces identical output. They flip the switch. They delete "dead" code. They write a closure summary. They say "done."

Then you delete the legacy path entirely — remove it from view, from imports, from the bundle — and the build falls apart. Multiple times. Because:

1. **Hidden dependencies.** The "dead" code was still imported somewhere the worker didn't check.
2. **Fallback paths.** The switch didn't cover every branch. Some edge case still calls the old code.
3. **Transitive imports.** File A imports file B which imports the "dead" file C. Workers deleted C but not the import chain.
4. **Bundle ordering.** The legacy files were providing globals that the new path accidentally depends on.
5. **Test fixtures.** Tests reference the old path directly.

## The Method

Phase 7 is not cleanup. It is **severance** — a clean cut where the old path is fully removed and the system proves it can stand without it.

### Step sequence:

1. **Archive, don't delete.** Move all legacy files to a `_legacy/` directory or zip. Do not delete yet — you need them for diffing when things break.

2. **Remove all imports.** Grep every file in scope for imports/requires of legacy paths. Remove them. This is where most breakage surfaces.

3. **Remove bundle references.** If there's a load order file, manifest, or bundle config — remove legacy entries.

4. **Clean build — first attempt.** Build from scratch. It will fail. This is expected and correct.

5. **Fix forward, not backward.** Every build error is a hidden dependency the plan missed. Fix it by completing the new path, not by restoring the old one. Record every fix in `reports/severance_fixes.md`.

6. **Clean build — repeat until green.** Iterate. Each cycle should surface fewer errors. If errors increase, something is structurally wrong — stop and reassess.

7. **Run the full test/verification suite.** Not just "does it compile" but "does it produce correct output for every known input."

8. **Delete the archive.** Once the build is green and tests pass, the `_legacy/` directory or zip can be removed (or moved to `archive/` for historical reference).

9. **Write the closure summary.** What was removed, what broke, what was fixed, final state.

## Gate

All four must be true:
- `legacy_deleted: true`
- `clean_build_passes: true`
- `all_tests_pass_without_legacy: true`
- `closure_summary_written: true`

## Why This Is a Phase, Not a Step

Severance is not "delete the old files." It is an iterative debugging process where hidden dependencies surface one at a time. It can take multiple build-fix cycles. Treating it as a single step ("delete legacy code and verify") is exactly the kind of task-shaped row that causes plans to fail at the finish line.

The execution plan must expand Phase 7 into the same level of concrete steps as every other phase: exact files to move, exact imports to grep for, exact build commands to run, exact report fields to write.
