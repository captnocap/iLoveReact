// UserIntervention — the user stepping in mid-execution. The "that's
// cooked, stop" moment, structured.
//
// ── Why this is its own row, not just an Event ──────────────────
// Interventions need queryable status (is the worker still acting on
// stale state? did it actually obey?), they have outcomes that
// affect downstream rows (constraints spawned, goals reframed), and
// they are user-grain authority — they outrank agent self-judgment.
// Burying them in the event log makes them harder to find when they
// are actively the most important rows in the system.
//
// ── outcome='too-late' is honest ───────────────────────────────
// Sometimes the act has already shipped by the time the user
// intervenes. The intervention does not pretend to undo it — it
// transitions to outcome='too-late' and feeds a Constraint going
// forward (so the same mistake does not happen twice) and an
// EpisodicMemory.lesson (so future plans avoid the trap).

import type { GalleryDataReference, JsonObject } from '../../types';

export type UserInterventionKind =
  | 'reject-adjustment' // veto a proposed/applied adjustment
  | 'modify-adjustment' // replace it with a different adjustment
  | 'pause-task' // stop here, do not continue without me
  | 'cancel-task' // abandon this task
  | 'redirect-task' // change what this task should do
  | 'reframe-goal' // the goal itself was wrong
  | 'add-constraint' // codify a new "from now on" rule
  | 'approve-explicitly'; // green-light something that was waiting

export type UserInterventionStatus = 'pending' | 'consumed' | 'overridden';

export type UserInterventionOutcome =
  | 'worker-obeyed'
  | 'worker-objected'
  | 'too-late'
  | 'partially-applied';

export type UserIntervention = {
  id: string;
  workerId: string;
  taskId?: string;
  goalId?: string;
  /** When intervening on a specific proposed/applied adjustment. */
  targetAdjustmentId?: string;
  kind: UserInterventionKind;
  reason?: string;
  /** For kind='modify-adjustment'. */
  replacementAdjustment?: {
    adjustment: string;
    reason: string;
  };
  /** For kind='redirect-task'. */
  redirectInstruction?: string;
  /** Set when intervention spawned downstream rows. */
  spawnedConstraintId?: string;
  spawnedReframedGoalId?: string;
  spawnedEpisodeId?: string;
  /** Cite the rubric dimension that grounds the rejection, if any. */
  rubricDimensionId?: string;
  status: UserInterventionStatus;
  outcome?: UserInterventionOutcome;
  receivedAt: string;
  consumedAt?: string;
};

export const userInterventionMockData: UserIntervention[] = [
  {
    id: 'intv_pepper_reject',
    workerId: 'w1',
    taskId: 'task_make_spaghetti',
    goalId: 'goal_dinner_spaghetti',
    targetAdjustmentId: 'adj_propose_more_pepper',
    kind: 'reject-adjustment',
    reason:
      "More pepper won't fix this — last time we drowned it in pepper and it was inedible. Salt is the actual lever.",
    spawnedConstraintId: 'cnst_no_more_pepper_this_dish',
    rubricDimensionId: 'dim_pepper_level',
    status: 'consumed',
    outcome: 'worker-obeyed',
    receivedAt: '2026-04-25T18:32:14Z',
    consumedAt: '2026-04-25T18:32:15Z',
  },
  {
    id: 'intv_modify_ui_layout',
    workerId: 'w1',
    taskId: 'task_build_screenshot_ui',
    goalId: 'goal_ui_from_screenshot',
    targetAdjustmentId: 'adj_use_3col_grid',
    kind: 'modify-adjustment',
    reason: 'Three columns broke the gestalt — keep it as 4 like the screenshot.',
    replacementAdjustment: {
      adjustment: 'Use 4-column grid; keep title placement matching the screenshot.',
      reason: 'gestaltInvariant on rubric_ui_from_screenshot is invariant-posture for layout grid.',
    },
    rubricDimensionId: 'dim_screenshot_layout',
    status: 'consumed',
    outcome: 'worker-obeyed',
    receivedAt: '2026-04-25T11:15:00Z',
    consumedAt: '2026-04-25T11:15:30Z',
  },
  {
    id: 'intv_pause_for_clarify',
    workerId: 'worker_sub_02',
    taskId: 'task_refactor_auth',
    kind: 'pause-task',
    reason: 'Hold on — I need to think about whether this refactor scope is actually what I want.',
    status: 'consumed',
    outcome: 'worker-obeyed',
    receivedAt: '2026-04-25T14:02:00Z',
    consumedAt: '2026-04-25T14:02:01Z',
  },
  {
    id: 'intv_too_late_example',
    workerId: 'worker_old_session',
    taskId: 'task_old_cleanup',
    targetAdjustmentId: 'adj_already_applied',
    kind: 'reject-adjustment',
    reason: 'Wait, do not delete that file.',
    status: 'consumed',
    outcome: 'too-late',
    spawnedConstraintId: 'cnst_no_delete_without_ask',
    spawnedEpisodeId: 'ep_lost_file_lesson',
    receivedAt: '2026-04-23T20:01:31Z',
    consumedAt: '2026-04-23T20:01:32Z',
  },
  {
    id: 'intv_reframe_goal',
    workerId: 'worker_sup_01',
    goalId: 'goal_old_smith_attempt',
    kind: 'reframe-goal',
    reason:
      "After 50 days the load-bearing problem turned out to be a sync npx tsc call, not Smith vs JS. The goal was wrong all along.",
    spawnedReframedGoalId: 'goal_v8_default_runtime',
    status: 'consumed',
    outcome: 'worker-obeyed',
    receivedAt: '2026-04-18T00:00:00Z',
    consumedAt: '2026-04-18T00:00:01Z',
  },
  {
    id: 'intv_pending_example',
    workerId: 'w1',
    taskId: 'task_task_ts',
    targetAdjustmentId: 'adj_split_into_subtasks',
    kind: 'reject-adjustment',
    reason: 'Do not decompose this — fill the file inline. The deliberation is part of the act.',
    status: 'pending',
    receivedAt: '2026-04-25T19:00:00Z',
  },
];

export const userInterventionSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'UserIntervention',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'workerId', 'kind', 'status', 'receivedAt'],
    properties: {
      id: { type: 'string' },
      workerId: { type: 'string' },
      taskId: { type: 'string' },
      goalId: { type: 'string' },
      targetAdjustmentId: { type: 'string' },
      kind: {
        type: 'string',
        enum: [
          'reject-adjustment',
          'modify-adjustment',
          'pause-task',
          'cancel-task',
          'redirect-task',
          'reframe-goal',
          'add-constraint',
          'approve-explicitly',
        ],
      },
      reason: { type: 'string' },
      replacementAdjustment: {
        type: 'object',
        additionalProperties: false,
        required: ['adjustment', 'reason'],
        properties: {
          adjustment: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      redirectInstruction: { type: 'string' },
      spawnedConstraintId: { type: 'string' },
      spawnedReframedGoalId: { type: 'string' },
      spawnedEpisodeId: { type: 'string' },
      rubricDimensionId: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'consumed', 'overridden'] },
      outcome: {
        type: 'string',
        enum: ['worker-obeyed', 'worker-objected', 'too-late', 'partially-applied'],
      },
      receivedAt: { type: 'string' },
      consumedAt: { type: 'string' },
    },
  },
};

export const userInterventionReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Worker (being intervened on)',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'workerId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Task',
    targetSource: 'cart/app/gallery/data/task.ts',
    sourceField: 'taskId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Goal',
    targetSource: 'cart/app/gallery/data/goal.ts',
    sourceField: 'goalId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Targeted adjustment',
    targetSource: 'cart/app/gallery/data/task.ts',
    sourceField: 'targetAdjustmentId',
    targetField: 'executionAdjustments[].id',
    summary:
      'When intervention is on a specific proposed/applied adjustment. Worker marks the adjustment status to rejected/reverted.',
  },
  {
    kind: 'references',
    label: 'Spawned constraint',
    targetSource: 'cart/app/gallery/data/constraint.ts',
    sourceField: 'spawnedConstraintId',
    targetField: 'id',
    summary:
      'A rejection often promotes to a "from now on do not do this" rule. The constraint inherits posture/severity from the intervention.',
  },
  {
    kind: 'references',
    label: 'Spawned reframed goal',
    targetSource: 'cart/app/gallery/data/goal.ts',
    sourceField: 'spawnedReframedGoalId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Spawned episode',
    targetSource: 'cart/app/gallery/data/episodic-memory.ts',
    sourceField: 'spawnedEpisodeId',
    targetField: 'id',
    summary: 'Especially for outcome=too-late — the lesson lives on as an episodic record.',
  },
  {
    kind: 'references',
    label: 'Cited rubric dimension',
    targetSource: 'cart/app/gallery/data/outcome-rubric.ts',
    sourceField: 'rubricDimensionId',
    targetField: 'dimensions[].id',
    summary:
      'When the rejection is grounded in a specific dimension, citing it makes the intervention non-arbitrary and feeds rubric refinement.',
  },
];
