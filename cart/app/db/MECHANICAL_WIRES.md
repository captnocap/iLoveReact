# Mechanical Wires

The wires that aren't user choice. These run regardless of Rule rows
and cannot be suppressed by the user editing rules in the cockpit.
They implement the safety floor the supervisor architecture spec
requires.

## Currently implemented

### 1. Pathology severity=block → halt-run

When `supervisor:flag-pathology` fires and the referenced Pathology row
has `severity: 'block'`, the wire emits `supervisor:halt-run` with the
firing pathology's id as the reason.

User rules can still emit `flag-pathology:` for `severity: 'warn'`
pathologies without halting. The block path is non-negotiable because
its existence comes from past injury, not user policy.

Lives in: `cart/app/db/mechanical-wires.ts`. Installed by
`installMechanicalWires()`.

## Documented but not yet implementable

These depend on downstream code that doesn't yet exist (verb runner,
run state machine, verifier). Documented here so when the downstream
code lands, the wires get added in this file rather than scattered.

### 2. Stage gates

A CompositionRun terminates only if every gate passes:

1. **Artifact exists** — at least one output artifact was produced.
2. **Artifact is well-formed** — compiles + tests pass.
3. **Constraints satisfied** — every constraint scoped to the run was
   evaluated and passed (or 'unclear' got resolved).
4. **Goal alignment confirmed** — cross-family verifier read the diff
   cold and judged it on-spec.
5. **No unadjudicated pathologies** — every PathologyDetection row for
   the run has resolution != 'pending'.
6. **Workspace clean** — all changes committed, branch ready.

Implementation when run state machine lands: subscribe to
`run:lifecycle` for `state='completed-pending-gates'` and walk the
six gates synchronously. On any gate fail, emit `supervisor:halt-run`
with the gate id as the reason.

### 3. Run termination on verifier 'fail'

When the Stage 3 verifier emits a SupervisorJudgment with verdict
in {'fail', 'plan-was-wrong', 'invalid-pivot', 'pathology-halt'}, the
CompositionRun halts. Distinct from the gate cascade — verifier
judgment is its own track.

Implementation when verifier exists: subscribe to a
`supervisor:verifier-verdict` bus event and route accordingly.

### 4. Bootstrap order

Process startup must establish the substrate in this order:

1. Embedded PG cluster (auto-spawned by framework/pg.zig)
2. `ensureBootstrapped()` — DBs + tables exist
3. `installMechanicalWires()` — safety floor live
4. `bindRules()` — user rules wired
5. Cart-specific compositions / worker spawning

Out of order = user rules can fire before mechanical wires are
listening, which means a 'block'-severity pathology firing during
bootstrap has no halt path.

Implementation: cart's main entry sequences these explicitly. Any
shortcut path (test harnesses, scripts) must follow the same order.

## Why this file is small

The point of the supervisor architecture is to push behavior into Rule
rows the user authors. Mechanical wires are the floor — they exist
because the wire's authority comes from somewhere user policy can't
revoke (past injury, substrate physics, ordering invariants).

If a wire here grows past three or four rules of "we tried to make
this configurable but the failure mode is non-recoverable," that's a
signal it belongs in the substrate, not in user data.
