// TaskClaim — the atomic "I am taking this task" row. The storage
// engine becomes the lock: a UNIQUE index on (taskId, status='active')
// rejects a second concurrent claim. Whoever's INSERT lands first
// owns the task; everyone else gets a constraint violation and
// retries against a different task.
//
// This is the trick filesystems use for atomic file create. No
// app-level mutex, no two-phase protocol, no lease renewal — just
// one round-trip and the DB does the work.
//
// Lifecycle:
//   active        — claim is held; worker is executing
//   released      — worker explicitly handed back (no completion)
//   completed     — worker finished, taskId is now done
//   abandoned     — worker died / timed out; claim is reclaimable
//   superseded    — another claim took over (e.g. supervisor handoff)
//
// Only `active` claims block other claimers via the UNIQUE index.
// Once a claim transitions out of `active`, the index is free.

import type { GalleryDataReference, JsonObject } from '../../types';

export type TaskClaimStatus =
  | 'active'
  | 'released'
  | 'completed'
  | 'abandoned'
  | 'superseded';

export type TaskClaim = {
  id: string;
  taskId: string;
  workerId: string;
  workstreamId?: string;
  status: TaskClaimStatus;
  claimedAt: string;
  releasedAt?: string;
  heartbeatAt?: string; // last "still alive" tick — used to detect abandonment
  abandonAfterMs?: number; // claim is reclaimable if heartbeat goes stale
  outcome?: 'success' | 'partial' | 'failure';
  outcomeNote?: string;
  supersededByClaimId?: string;
};

export const taskClaimMockData: TaskClaim[] = [
  {
    id: 'claim_w1_task_task_ts',
    taskId: 'task_task_ts',
    workerId: 'w1',
    workstreamId: 'ws_phase4_parallelism',
    status: 'active',
    claimedAt: '2026-04-25T09:30:00Z',
    heartbeatAt: '2026-04-25T09:30:30Z',
    abandonAfterMs: 60_000,
  },
  {
    id: 'claim_w1_task_plan_ts',
    taskId: 'task_plan_ts',
    workerId: 'w1',
    status: 'completed',
    claimedAt: '2026-04-24T09:25:30Z',
    releasedAt: '2026-04-24T09:26:30Z',
    heartbeatAt: '2026-04-24T09:26:30Z',
    outcome: 'success',
  },
  {
    id: 'claim_sub02_hot_repro',
    taskId: 'task_hot_min_repro',
    workerId: 'worker_sub_02',
    status: 'completed',
    claimedAt: '2026-04-22T14:00:00Z',
    releasedAt: '2026-04-22T14:15:00Z',
    outcome: 'success',
  },
  {
    id: 'claim_abandoned_example',
    taskId: 'task_tidy_warn_2',
    workerId: 'worker_old_session',
    status: 'abandoned',
    claimedAt: '2026-04-23T20:00:00Z',
    heartbeatAt: '2026-04-23T20:00:00Z',
    releasedAt: '2026-04-23T20:01:30Z',
    abandonAfterMs: 60_000,
    outcomeNote:
      'Worker process exited without releasing. Heartbeat went stale; reaper transitioned to abandoned. Task is now reclaimable by a fresh INSERT.',
  },
];

export const taskClaimSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'TaskClaim',
  description:
    'Storage layer is expected to enforce a UNIQUE index on (taskId) WHERE status=\'active\'. The unique constraint is the lock; race resolution happens at insert-time.',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'taskId', 'workerId', 'status', 'claimedAt'],
    properties: {
      id: { type: 'string' },
      taskId: { type: 'string' },
      workerId: { type: 'string' },
      workstreamId: { type: 'string' },
      status: {
        type: 'string',
        enum: ['active', 'released', 'completed', 'abandoned', 'superseded'],
      },
      claimedAt: { type: 'string' },
      releasedAt: { type: 'string' },
      heartbeatAt: { type: 'string' },
      abandonAfterMs: { type: 'number' },
      outcome: { type: 'string', enum: ['success', 'partial', 'failure'] },
      outcomeNote: { type: 'string' },
      supersededByClaimId: { type: 'string' },
    },
  },
};

export const taskClaimReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Task',
    targetSource: 'cart/app/gallery/data/task.ts',
    sourceField: 'taskId',
    targetField: 'id',
    summary:
      'A claim points at the task it locks. The storage engine\'s UNIQUE index on (taskId, status=\'active\') is what makes the claim race-free.',
  },
  {
    kind: 'belongs-to',
    label: 'Worker',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'workerId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Workstream',
    targetSource: 'cart/app/gallery/data/workstream.ts',
    sourceField: 'workstreamId',
    targetField: 'id',
    summary:
      'Optional — claims made within a workstream context inherit its priority and isolation boundary.',
  },
  {
    kind: 'references',
    label: 'Superseding claim',
    targetSource: 'cart/app/gallery/data/task-claim.ts',
    sourceField: 'supersededByClaimId',
    targetField: 'id',
    summary: 'When a supervisor hands a task to a different worker, the old claim transitions to `superseded` pointing at the new one.',
  },
];
