// Event — the generic, typed event bus row. Distinct from
// worker-event.ts (which is provider-event-normalized, only emitted
// by adapters reducing raw frames from a backend).
//
// Event is the *internal* signaling layer: every status transition,
// claim acquisition, budget consumption, constraint check, job-run
// lifecycle, worker lifecycle, goal achievement — all become Event
// rows. Subscribers (EventHook rows) match on kind + subject + payload
// and take action (queue a job, spawn a worker, notify the user).
//
// ── Why both this and worker-event ──────────────────────────────
// worker-event is what came off a backend's wire (provider-shaped,
// foreign-source-of-truth). Event is what we generated internally
// (system-shaped, our-source-of-truth). Confusing them by folding
// would mean losing the distinction between "the model said X" and
// "our system observed Y."
//
// ── Status field, transition log, both ─────────────────────────
// Per the earlier design call: most entities (Task, JobRun, Worker,
// Goal, ...) carry a `status` field on their row for fast "right
// now" queries. Each transition ALSO emits an Event row in the same
// DB transaction so the audit log and the cached state never
// diverge. They answer different questions:
//   - row.status: "what state is this in right now?"
//   - event log: "how did it get here, when, and why?"

import type { GalleryDataReference, JsonObject } from '../../types';

/**
 * Event kinds use a dotted namespace: <subjectKind>.<verb>.
 * Verbs are typically past-tense — events describe things that happened.
 */
export type EventKind =
  // task lifecycle
  | 'task.created'
  | 'task.claimed'
  | 'task.started'
  | 'task.adjusted'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  // job lifecycle
  | 'job-run.queued'
  | 'job-run.started'
  | 'job-run.progressed'
  | 'job-run.completed'
  | 'job-run.failed'
  | 'job-run.timed-out'
  // worker lifecycle
  | 'worker.spawned'
  | 'worker.lifecycle-changed'
  | 'worker.terminated'
  // goal lifecycle
  | 'goal.opened'
  | 'goal.achieved'
  | 'goal.reframed'
  | 'goal.abandoned'
  // plan / phase lifecycle
  | 'plan.activated'
  | 'plan.completed'
  | 'planning-phase.transitioned'
  // workstream / merge
  | 'workstream.forked'
  | 'workstream.merged'
  | 'merge-conflict.detected'
  | 'merge-conflict.resolved'
  | 'barrier.satisfied'
  // memory / budget
  | 'memory.consolidation-completed'
  | 'budget.threshold-warned'
  | 'budget.threshold-blocked'
  // constraint
  | 'constraint.violated'
  | 'constraint.respected' // logged for advisory-severity hits
  // user-facing
  | 'user.input-received'
  | 'user.notified'
  // research / retrieval
  | 'research.finding-promoted'
  | 'retrieval.executed';

export type EventSubjectKind =
  | 'task'
  | 'job'
  | 'job-run'
  | 'worker'
  | 'workstream'
  | 'goal'
  | 'plan'
  | 'planning-phase'
  | 'merge-proposal'
  | 'merge-conflict'
  | 'barrier'
  | 'budget'
  | 'constraint'
  | 'user'
  | 'research'
  | 'retrieval-query'
  | 'memory'
  | 'system';

export type EventActorKind = 'user' | 'agent' | 'system';

export type Event = {
  id: string;
  occurredAt: string;
  kind: EventKind;
  subjectKind: EventSubjectKind;
  subjectId: string;
  actorKind: EventActorKind;
  actorId?: string; // user.id / worker.id / 'system'
  workspaceId?: string;
  projectId?: string;
  sessionId?: string; // worker-session if applicable
  workerId?: string;
  /**
   * Kind-specific payload. Schema lives outside this row — each kind
   * has an implicit shape (e.g. 'task.completed' carries
   * { artifactRefs, durationMs, costUsd }).
   */
  payload?: Record<string, unknown>;
  /**
   * The event that caused this one. Replay traces follow this chain
   * to reconstruct "what set off what."
   */
  causalEventId?: string;
  /**
   * Groups events from one logical operation. All transitions of a
   * single Task share its correlationId so a UI can render the
   * task's full timeline by filtering on this.
   */
  correlationId?: string;
};

export const eventMockData: Event[] = [
  {
    id: 'evt_user_input_001',
    occurredAt: '2026-04-24T08:00:00Z',
    kind: 'user.input-received',
    subjectKind: 'user',
    subjectId: 'user_local',
    actorKind: 'user',
    actorId: 'user_local',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_carts',
    payload: {
      text: 'Hey so look at our data shapes inside of the component gallery...',
    },
    correlationId: 'corr_data_shape_catalog_kickoff',
  },
  {
    id: 'evt_goal_opened_data_shapes',
    occurredAt: '2026-04-24T08:00:05Z',
    kind: 'goal.opened',
    subjectKind: 'goal',
    subjectId: 'goal_data_shape_catalog',
    actorKind: 'agent',
    actorId: 'worker_sup_01',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_carts',
    causalEventId: 'evt_user_input_001',
    correlationId: 'corr_data_shape_catalog_kickoff',
  },
  {
    id: 'evt_task_claimed_001',
    occurredAt: '2026-04-25T09:30:00Z',
    kind: 'task.claimed',
    subjectKind: 'task',
    subjectId: 'task_task_ts',
    actorKind: 'agent',
    actorId: 'w1',
    workerId: 'w1',
    workspaceId: 'ws_reactjit',
    payload: { claimId: 'claim_w1_task_task_ts' },
    correlationId: 'corr_task_task_ts',
  },
  {
    id: 'evt_task_adjusted_001',
    occurredAt: '2026-04-25T09:40:00Z',
    kind: 'task.adjusted',
    subjectKind: 'task',
    subjectId: 'task_task_ts',
    actorKind: 'agent',
    actorId: 'w1',
    workerId: 'w1',
    payload: {
      observation: 'Two of the planned mock rows would have identical shapes.',
      adjustment: 'Cut from 10 rows to 8.',
      withinConstraints: true,
    },
    correlationId: 'corr_task_task_ts',
  },
  {
    id: 'evt_constraint_violated_demo',
    occurredAt: '2026-04-23T20:01:30Z',
    kind: 'constraint.violated',
    subjectKind: 'constraint',
    subjectId: 'cnst_irreversible_db_drop',
    actorKind: 'agent',
    actorId: 'worker_old_session',
    payload: {
      attemptedAction: "rm -rf /tmp/agent-sandbox/old",
      response: 'block',
      surfaceToUser: true,
    },
    correlationId: 'corr_old_session_cleanup',
  },
  {
    id: 'evt_job_run_completed_reaper',
    occurredAt: '2026-04-25T09:35:00.180Z',
    kind: 'job-run.completed',
    subjectKind: 'job-run',
    subjectId: 'jrun_reaper_2026_04_25_09_35',
    actorKind: 'system',
    actorId: 'system',
    payload: {
      jobId: 'job_claim_reaper',
      durationMs: 180,
      outputSummary: '1 stale claim transitioned to abandoned.',
    },
    correlationId: 'corr_reaper_2026_04_25_09_35',
  },
  {
    id: 'evt_barrier_satisfied_memory',
    occurredAt: '2026-04-24T09:25:00Z',
    kind: 'barrier.satisfied',
    subjectKind: 'barrier',
    subjectId: 'barrier_legacy_satisfied_example',
    actorKind: 'system',
    actorId: 'system',
    payload: {
      satisfiedWorkstreamIds: ['ws_consolidate_memory'],
      onSatisfiedAction: 'merge',
      resultMergeProposalId: 'merge_phase2_memory_tiers',
    },
    correlationId: 'corr_phase2_consolidation',
  },
  {
    id: 'evt_goal_reframed_smith',
    occurredAt: '2026-04-18T00:00:00Z',
    kind: 'goal.reframed',
    subjectKind: 'goal',
    subjectId: 'goal_old_smith_attempt',
    actorKind: 'user',
    actorId: 'user_local',
    payload: {
      reframedToGoalId: 'goal_v8_default_runtime',
      reason:
        'After 50 days of Smith work, the load-bearing problem turned out to be a sync npx tsc call in the React reconciler path — not Smith vs JS.',
    },
    correlationId: 'corr_smith_v8_reframe',
  },
];

export const eventSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Event',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'occurredAt', 'kind', 'subjectKind', 'subjectId', 'actorKind'],
    properties: {
      id: { type: 'string' },
      occurredAt: { type: 'string' },
      kind: { type: 'string' },
      subjectKind: { type: 'string' },
      subjectId: { type: 'string' },
      actorKind: { type: 'string', enum: ['user', 'agent', 'system'] },
      actorId: { type: 'string' },
      workspaceId: { type: 'string' },
      projectId: { type: 'string' },
      sessionId: { type: 'string' },
      workerId: { type: 'string' },
      payload: { type: 'object', additionalProperties: true },
      causalEventId: { type: 'string' },
      correlationId: { type: 'string' },
    },
  },
};

export const eventReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Subject (polymorphic)',
    targetSource: 'cart/app/gallery/data/(varies by subjectKind)',
    sourceField: '(subjectKind, subjectId)',
    targetField: 'id',
    summary: 'Polymorphic FK — subjectKind names the target table; subjectId is the row in that table.',
  },
  {
    kind: 'references',
    label: 'Causal event',
    targetSource: 'cart/app/gallery/data/event.ts',
    sourceField: 'causalEventId',
    targetField: 'id',
    summary: 'Forms the chain "what set off what." Replay tooling walks this in reverse.',
  },
  {
    kind: 'has-many',
    label: 'Hooks (matched on this kind)',
    targetSource: 'cart/app/gallery/data/event-hook.ts',
    sourceField: 'kind',
    targetField: 'match.kind',
    summary:
      'When an Event is appended, the resolver finds all enabled EventHook rows whose match.* selectors satisfy the event and queues their actions.',
  },
  {
    kind: 'references',
    label: 'Worker / actor',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'workerId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Session',
    targetSource: 'cart/app/gallery/data/worker-session.ts',
    sourceField: 'sessionId',
    targetField: 'id',
  },
];
