# Execution Rules — Loop Discipline

These rules govern how a worker agent executes steps from the execution plan. They are non-negotiable.

## The Execution Loop

For every step:
1. Read the step
2. Do the step
3. Verify the step
4. Mark the step complete
5. Re-read the step (confirm you did what it said, not what you think it said)
6. Re-read the changed file or artifact
7. Move to the next step

## Core Rules

1. **Never skip ahead** because a later step "will cover it."
2. **Never batch-edit multiple files** if the step only names one.
3. **Never treat a report as proof of change.** Reports describe. Files are truth. Re-read the file.
4. **Never treat a grep result as proof of correctness.** Grep finds strings. It doesn't verify semantics.
5. **Never trust input/output parity alone** when the semantic middle has not been named.
6. **`current_step.txt` is always the last completed step**, never the next step to run.

## File Discipline

7. Every edit must be followed by reopening the changed file and confirming the intended line is actually present.
8. Every verification artifact must be written to disk, not held only in memory.
9. If a step depends on an earlier step's artifact, open that artifact directly before proceeding.
10. Never edit a file that is not named by the current step unless the step explicitly permits it.

## Logging Discipline

11. Every blocker must be written to `blocked.txt` with exact step ID and exact reason.
12. Every completed step must be written to `completed.txt` with exact step ID and short verification note.
13. Every report file must include timestamp, step ID, changed files, and verification status.
14. Keep one current-step pointer on disk. Update it after every successful step.
15. If the run stops mid-step, leave the current-step pointer unchanged.

## Build Discipline

16. If a step changes output-affecting code, rerun the smallest available parity check before moving on.
17. If a step changes a hub file (something imported by many others), stop and verify no pending unverified edit remains.

## Commit Discipline

18. No commit is made until the section's own verification steps are satisfied.
19. Every section-close commit message follows the pattern: `migration(<scope>): S<range> step-<nnn> <slug>`
20. Example: `migration(single-agent): S021-050 step-048 workspace-scaffolding`

## Recovery

21. If a step fails: write the failure to `blocked.txt` with the exact error. Do not improvise a workaround.
22. If a step's precondition is not met: check `control_board.md` for the relevant gate. If the gate is false, the section is blocked.
23. If the worker's context is lost (crash, timeout): read `current_step.txt`, read the next step, resume from there.
