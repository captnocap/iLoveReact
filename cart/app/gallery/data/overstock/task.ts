// Task — the atomic work unit. Sits inside a TaskGraph; connects to
// other Tasks via TaskDependency rows.
//
// Kept deliberately simple: no subtask trees (use a nested TaskGraph
// if you need hierarchy), no time-estimate-vs-actual feature creep.
// A task is done or it is not. Decomposition happens at the graph
// level.
//
// ── The fractal Plan/Act invariant lives here ─────────────────────
// Every Task carries a tiny (deliberate, then act) cycle inside it.
// You cannot planToSeason() and season() at the same time — they
// are sequential within one actor.
//
// `approachNote` is where the deliberation goes. It is captured
// inline on the same row as the act it precedes. It is NOT a
// sub-Task. Do not spawn a sub-Task to hold "decide how to do this
// Task" — that is the over-decomposition trap and it is what makes
// the agent feel out of alignment with the user.
//
// Read goalId before acting. The whole point of this Task is to
// advance that Goal — if the action does not, stop and check why.

import type { GalleryDataReference, JsonObject } from '../../types';

export type TaskKind =
  | 'code' // write / edit code
  | 'research' // inquiry — typically links to a Research row
  | 'review' // review someone else's output
  | 'docs' // write docs / comments / summaries
  | 'analysis' // analyze / measure
  | 'ops' // run / deploy / ship
  | 'verify'; // test / confirm

export type TaskStatus =
  | 'pending'
  | 'ready' // deps satisfied, awaiting pickup
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'cancelled';

export type Task = {
  id: string;
  taskGraphId: string;
  /**
   * Denormalized pointer to the Goal this Task ultimately serves.
   * Optional because it can always be resolved by walking
   * TaskGraph → PlanningPhase → Plan.goalId, but having it on the
   * row means a worker picking up a task in isolation can read the
   * objective in one query — closes the "what is this for" trap.
   */
  goalId?: string;
  label: string;
  description?: string;
  kind: TaskKind;
  status: TaskStatus;
  assignedWorkerId?: string;
  /**
   * The deliberation phase: what the worker decided to do BEFORE
   * acting. Captured inline. NOT a sub-task. If you find yourself
   * wanting to spawn a sub-task to hold a decision about this task,
   * write the decision here instead.
   */
  approachNote?: string;
  approachDecidedAt?: string;
  /**
   * The act phase began at this time. MUST be >= approachDecidedAt
   * when both are set — deliberation strictly precedes action
   * within a single actor.
   */
  executionStartedAt?: string;
  /**
   * Mid-execution course corrections. The third behavior, distinct
   * from plan and act: the model observes reality during the act
   * and chooses to do something different than the entry plan.
   *
   * This is *not* drift. It is the value-add of using a model. A
   * script cannot integrateMorePepper(); a model can.
   *
   * Adjustments are bounded by Constraints. Adding pepper because
   * tasting revealed blandness is fine. Substituting pepper for
   * salt is not — that is a substitution-class constraint
   * violation. The runtime resolver checks each adjustment against
   * the active constraint set before applying.
   *
   * If an adjustment would change the *goal itself*, it is not
   * an adjustment — it is a Goal-reframe. Stop and surface to user.
   */
  executionAdjustments?: Array<{
    id: string;
    observedAt: string;
    observation: string; // what I noticed mid-act
    adjustment: string; // what I changed (or proposed)
    reason?: string; // why
    /**
     * Lifecycle:
     *   proposed — drafted, not yet applied; awaiting approval window
     *   applied  — went into effect
     *   rejected — vetoed by user before application
     *   reverted — applied, then undone after user intervened
     *   modified — replaced with a different adjustment
     */
    status: 'proposed' | 'applied' | 'rejected' | 'reverted' | 'modified';
    proposedAt: string;
    appliedAt?: string;
    rejectedAt?: string;
    revertedAt?: string;
    /**
     * If true, the worker waits for explicit approval before applying.
     * If false, the worker proceeds and the user may revert via
     * UserIntervention if needed.
     */
    approvalRequired?: boolean;
    /** Risk flag from rubric self-check (e.g. dimension threshold near). */
    riskNotes?: string;
    /** Set when a UserIntervention resolved this adjustment. */
    resolvedByInterventionId?: string;
  }>;
  artifactRefs?: string[]; // files / PRs produced by this task
  researchId?: string; // if this is a research task, the Research row
  blockedReason?: string;
  /**
   * @deprecated prefer executionStartedAt for clarity. Retained
   * because earlier mock rows still set it; treat the two as
   * synonymous for back-compat.
   */
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export const taskMockData: Task[] = [
  {
    id: 'task_plan_ts',
    taskGraphId: 'tg_phase_planning',
    label: 'Fill cart/app/gallery/data/plan.ts',
    kind: 'code',
    status: 'completed',
    assignedWorkerId: 'w1',
    artifactRefs: ['cart/app/gallery/data/plan.ts'],
    startedAt: '2026-04-24T09:25:30Z',
    endedAt: '2026-04-24T09:26:30Z',
    createdAt: '2026-04-24T09:25:00Z',
    updatedAt: '2026-04-24T09:26:30Z',
  },
  {
    id: 'task_phase_ts',
    taskGraphId: 'tg_phase_planning',
    label: 'Fill planning-phase.ts',
    kind: 'code',
    status: 'completed',
    assignedWorkerId: 'w1',
    artifactRefs: ['cart/app/gallery/data/planning-phase.ts'],
    startedAt: '2026-04-24T09:27:00Z',
    endedAt: '2026-04-24T09:28:00Z',
    createdAt: '2026-04-24T09:25:00Z',
    updatedAt: '2026-04-24T09:28:00Z',
  },
  {
    id: 'task_graph_ts',
    taskGraphId: 'tg_phase_planning',
    label: 'Fill task-graph.ts',
    kind: 'code',
    status: 'completed',
    assignedWorkerId: 'w1',
    artifactRefs: ['cart/app/gallery/data/task-graph.ts'],
    startedAt: '2026-04-24T09:28:30Z',
    endedAt: '2026-04-24T09:29:30Z',
    createdAt: '2026-04-24T09:25:00Z',
    updatedAt: '2026-04-24T09:29:30Z',
  },
  {
    id: 'task_task_ts',
    taskGraphId: 'tg_phase_planning',
    goalId: 'goal_data_shape_catalog',
    label: 'Fill task.ts',
    kind: 'code',
    status: 'in_progress',
    assignedWorkerId: 'w1',
    approachNote:
      'Mirror the existing data shapes: TS types + mock array + JSON schema + references[]. Use 8–10 rows that exercise the status ladder. Do not decompose this into sub-tasks — the deliberation is "how to fill the file"; the act is "fill the file."',
    approachDecidedAt: '2026-04-24T09:29:50Z',
    executionStartedAt: '2026-04-24T09:30:00Z',
    executionAdjustments: [
      {
        id: 'adj_cut_to_8',
        observedAt: '2026-04-25T09:40:00Z',
        observation:
          'While writing, realized two of the planned mock rows would have identical shapes — adds noise without exercising new fields.',
        adjustment:
          'Cut from 10 rows to 8; promoted the cut-row\'s edge case into one of the kept rows.',
        reason:
          'Same shape coverage, less noise. Within scope; does not change the goal of "fill task.ts with representative rows."',
        status: 'applied',
        proposedAt: '2026-04-25T09:39:55Z',
        appliedAt: '2026-04-25T09:40:00Z',
      },
      {
        id: 'adj_self_referential',
        observedAt: '2026-04-25T09:45:00Z',
        observation:
          'After Constraint shape landed, the in-progress task_task_ts row was an obvious place to demonstrate executionAdjustments.',
        adjustment:
          'Added this very executionAdjustments array as a self-referential demo — task documents its own course corrections.',
        reason:
          'The shape gallery is more legible when its mock data exercises the shape it lives in.',
        status: 'applied',
        proposedAt: '2026-04-25T09:44:55Z',
        appliedAt: '2026-04-25T09:45:00Z',
      },
      {
        id: 'adj_split_into_subtasks',
        observedAt: '2026-04-25T19:00:00Z',
        observation:
          'Considering whether to split the rich-shape adjustments retrofit into its own sub-task for traceability.',
        adjustment: 'Spawn sub-tasks for each of the six retrofits.',
        reason: '(none — was a worse-shaped impulse than the inline approach)',
        status: 'rejected',
        proposedAt: '2026-04-25T19:00:00Z',
        rejectedAt: '2026-04-25T19:00:30Z',
        approvalRequired: true,
        riskNotes:
          'Crosses the "do not decompose deliberation into sub-tasks" doctrine on this Task; flagged before applying.',
        resolvedByInterventionId: 'intv_pending_example',
      },
    ],
    startedAt: '2026-04-24T09:30:00Z',
    createdAt: '2026-04-24T09:25:00Z',
    updatedAt: '2026-04-24T09:30:00Z',
  },
  {
    id: 'task_dep_ts',
    taskGraphId: 'tg_phase_planning',
    label: 'Fill task-dependency.ts',
    kind: 'code',
    status: 'ready',
    createdAt: '2026-04-24T09:25:00Z',
    updatedAt: '2026-04-24T09:25:00Z',
  },
  {
    id: 'task_research_ts',
    taskGraphId: 'tg_phase_planning',
    label: 'Fill research.ts',
    kind: 'code',
    status: 'pending',
    createdAt: '2026-04-24T09:25:00Z',
    updatedAt: '2026-04-24T09:25:00Z',
  },
  {
    id: 'task_hot_min_repro',
    taskGraphId: 'tg_hot_repro',
    goalId: 'goal_hot_reload_state',
    label: 'Minimum repro: editable cart that should retain state',
    description: 'Create a cart with a single useHotState counter; edit the file; expect counter to persist.',
    kind: 'verify',
    status: 'completed',
    assignedWorkerId: 'worker_sub_02',
    approachNote:
      'Smallest cart possible — one button, one counter, one save. Click 3 times, edit a comment, save, observe counter. Do not add anything else.',
    approachDecidedAt: '2026-04-22T14:00:00Z',
    executionStartedAt: '2026-04-22T14:00:30Z',
    createdAt: '2026-04-22T14:00:00Z',
    updatedAt: '2026-04-22T14:15:00Z',
  },
  {
    id: 'task_hot_trace',
    taskGraphId: 'tg_hot_repro',
    label: 'Trace slot cache rebuild on remount',
    kind: 'analysis',
    status: 'completed',
    assignedWorkerId: 'worker_sub_02',
    artifactRefs: ['framework/hotstate.zig'],
    createdAt: '2026-04-22T14:15:00Z',
    updatedAt: '2026-04-22T14:30:00Z',
  },
  {
    id: 'task_tidy_warn_1',
    taskGraphId: 'tg_adhoc_cleanup',
    label: 'Silence noisy dev-host warn: "unused capture"',
    kind: 'code',
    status: 'pending',
    createdAt: '2026-04-24T09:00:00Z',
    updatedAt: '2026-04-24T09:00:00Z',
  },
  {
    id: 'task_tidy_warn_2',
    taskGraphId: 'tg_adhoc_cleanup',
    label: 'Remove stale TODO in framework/layout.zig',
    kind: 'code',
    status: 'pending',
    createdAt: '2026-04-24T09:00:00Z',
    updatedAt: '2026-04-24T09:00:00Z',
  },
];

export const taskSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Task',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'taskGraphId', 'label', 'kind', 'status', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      taskGraphId: { type: 'string' },
      goalId: { type: 'string' },
      label: { type: 'string' },
      description: { type: 'string' },
      kind: {
        type: 'string',
        enum: ['code', 'research', 'review', 'docs', 'analysis', 'ops', 'verify'],
      },
      status: {
        type: 'string',
        enum: ['pending', 'ready', 'in_progress', 'blocked', 'completed', 'cancelled'],
      },
      assignedWorkerId: { type: 'string' },
      approachNote: { type: 'string' },
      approachDecidedAt: { type: 'string' },
      executionStartedAt: { type: 'string' },
      executionAdjustments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'observedAt', 'observation', 'adjustment', 'status', 'proposedAt'],
          properties: {
            id: { type: 'string' },
            observedAt: { type: 'string' },
            observation: { type: 'string' },
            adjustment: { type: 'string' },
            reason: { type: 'string' },
            status: {
              type: 'string',
              enum: ['proposed', 'applied', 'rejected', 'reverted', 'modified'],
            },
            proposedAt: { type: 'string' },
            appliedAt: { type: 'string' },
            rejectedAt: { type: 'string' },
            revertedAt: { type: 'string' },
            approvalRequired: { type: 'boolean' },
            riskNotes: { type: 'string' },
            resolvedByInterventionId: { type: 'string' },
          },
        },
      },
      artifactRefs: { type: 'array', items: { type: 'string' } },
      researchId: { type: 'string' },
      blockedReason: { type: 'string' },
      startedAt: { type: 'string' },
      endedAt: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const taskReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Task graph', targetSource: 'cart/app/gallery/data/task-graph.ts', sourceField: 'taskGraphId', targetField: 'id' },
  {
    kind: 'references',
    label: 'Goal (objective this serves)',
    targetSource: 'cart/app/gallery/data/goal.ts',
    sourceField: 'goalId',
    targetField: 'id',
    summary:
      'Denormalized for one-hop "what is this for, originally" reads. Fall back to walking TaskGraph → PlanningPhase → Plan.goalId when not set.',
  },
  {
    kind: 'has-many',
    label: 'Constraints (task-scope)',
    targetSource: 'cart/app/gallery/data/constraint.ts',
    sourceField: 'id',
    targetField: 'scopeTargetId (when scopeKind=task)',
    summary:
      'Active constraints on this task. Each executionAdjustment is checked against the active set before being applied.',
  },
  {
    kind: 'references',
    label: 'Assigned worker',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'assignedWorkerId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Research (if kind=research)',
    targetSource: 'cart/app/gallery/data/research.ts',
    sourceField: 'researchId',
    targetField: 'id',
    summary: 'A research-kind task typically has a Research row as its artifact.',
  },
  {
    kind: 'has-many',
    label: 'Dependencies — upstream',
    targetSource: 'cart/app/gallery/data/task-dependency.ts',
    sourceField: 'id',
    targetField: 'downstreamTaskId',
    summary: 'Deps where this task is the downstream side (things that block it).',
  },
  {
    kind: 'has-many',
    label: 'Dependencies — downstream',
    targetSource: 'cart/app/gallery/data/task-dependency.ts',
    sourceField: 'id',
    targetField: 'upstreamTaskId',
    summary: 'Deps where this task is the upstream side (things it blocks).',
  },
];
