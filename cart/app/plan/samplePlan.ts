// A hand-authored sample plan, used as the rendered placeholder until
// the planning worker is wired in. Mirrors the docs/03 example shape:
// intent + phases of armed cells, each phase with its own exit.

import type { Plan } from './types';

export function makeSamplePlan(seedObjective?: string): Plan {
  return {
    id: 'sample',
    name: 'Sample plan — refactor auth middleware',
    intent: {
      objective:
        seedObjective ||
        'Refactor the auth middleware to satisfy the new compliance requirements without changing observable behavior.',
      constraints: [
        'Do NOT touch /billing or /admin route handlers.',
        'One pull request, ≤ 2 hours wall-clock.',
        'No new third-party dependencies.',
      ],
      exitCriteria: [
        'All existing auth tests pass unchanged.',
        'Reviewer cell signs off (Green Standard: visual + corpus).',
        'Trace shows no halted passes.',
      ],
    },
    phases: [
      {
        id: 'p_explore',
        label: 'Explore',
        rationale:
          'Map the surface: every callsite of the current middleware and every test that exercises it.',
        cells: [
          { id: 'c_grep_callers',  kind: 'reactive',    label: 'Grep current callers',    spec: 'tool:rg:auth-middleware' },
          { id: 'c_read_tests',    kind: 'declarative', label: 'Read auth test corpus',   spec: 'composition:auth-test-corpus' },
        ],
        modifiers: [
          { id: 'm_smart', label: 'Smart model for read', detail: 'opus tier; budget 30k tokens' },
        ],
        exit: 'A list of every callsite + every covering test, written into the run notes.',
      },
      {
        id: 'p_plan',
        label: 'Plan the rewrite',
        rationale: 'Decide the new shape before any code moves.',
        cells: [
          { id: 'c_design_doc',   kind: 'declarative', label: 'Compose a design note', spec: 'composition:design-note' },
          { id: 'c_review_self',  kind: 'reactive',    label: 'Self-review checkpoint', spec: 'rule:self-review' },
        ],
        modifiers: [],
        exit: 'A one-page note approved by the user.',
      },
      {
        id: 'p_write',
        label: 'Write',
        rationale: 'Edit the middleware and update tests in lockstep.',
        cells: [
          { id: 'c_edit', kind: 'reactive',    label: 'Edit middleware',          spec: 'tool:edit:framework/auth' },
          { id: 'c_run',  kind: 'reactive',    label: 'Run auth tests on save',   spec: 'fs:write:framework/auth/**' },
        ],
        modifiers: [
          { id: 'm_fast', label: 'Fast model for edits', detail: 'haiku tier; tight loop' },
        ],
        exit: 'All auth tests green, no other test regressions.',
      },
      {
        id: 'p_review',
        label: 'Review and commit',
        rationale: 'Final pass + the commit ceremony.',
        cells: [
          { id: 'c_reviewer',    kind: 'declarative', label: 'Reviewer cell (Green Standard)', spec: 'composition:reviewer-green' },
          { id: 'c_commit_gate', kind: 'reactive',    label: 'Commit only if reviewer passes', spec: 'rule:gate:reviewer-pass' },
        ],
        modifiers: [],
        exit: 'One commit on main, message summarizes compliance change.',
      },
    ],
  };
}
