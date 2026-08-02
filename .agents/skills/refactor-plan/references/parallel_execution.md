# Parallel Execution

Once the execution plan exists (Phase 6 complete, `all_steps_pass_integrity_check: true`), the steps can be parallelized across multiple worker agents.

## Partitioning Rules

1. **Section boundaries are independence boundaries.** Each section in the execution plan has its own step range, its own scope, and its own verification gates. Workers get a section, not individual steps.

2. **Setup sections run first, sequentially.** Workspace scaffolding, canonical source capture, and harness setup must complete before any parity or change sections can start. These produce the artifacts that later sections depend on.

3. **Parity sections can run in parallel** if they touch different subsystems. Two sections that modify different files and verify different output slices are independent. Check the files touched — if there's no overlap, parallelize.

4. **Switch, cleanup, and verification sections run last, sequentially.** These depend on all parity sections being complete.

## Worker Briefing

Each worker agent receives:
- The section range (e.g., "Steps 141-165: Preamble Parity")
- The full execution plan (for context — but they only execute their range)
- The control board (to check precondition gates)
- The relevant contract file (if the section has one)

The worker does NOT receive:
- Permission to edit files outside their section's scope
- Permission to skip steps
- Permission to "fix" things they notice outside their range

If a worker encounters a problem outside their section, they write it to `blocked.txt` and continue with their own section.

## Commit Discipline

Each worker commits at section boundaries only. Commit message format:
```
migration(<scope>): S<range> step-<nnn> <slug>
```

Workers do NOT push. The coordinator reviews section commits and pushes.

## Coordination

The coordinator (human or orchestration agent):
1. Runs setup sections (001-140 or equivalent)
2. Identifies which parity sections are independent
3. Launches parallel workers for independent sections
4. Waits for all parity sections to complete
5. Runs switch/cleanup/verification sections sequentially
6. Reviews all commits, pushes

## Section Independence Checklist

Before parallelizing two sections, verify:
- [ ] No shared files modified (check the step file paths)
- [ ] No shared report fields written (check the control board fields)
- [ ] No ordering dependency (section B doesn't read section A's output)
- [ ] Both sections' precondition gates are already true
