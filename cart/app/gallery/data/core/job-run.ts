// JobRun — one row per execution attempt of a Job. Append-only;
// status mutations on the row are mirrored as Event rows (Phase 4c)
// in the same DB transaction so the audit log and current state
// never diverge.
//
// `progress` is a denormalized current-position so "is this 1% or
// 95% done" renders in the cockpit without scanning events. The
// `lastUpdateAt` field doubles as a heartbeat — the reaper uses it
// to detect stalled runs.
//
// Retries: a retry is its own JobRun row, with `retryOfRunId`
// pointing at the previous attempt and `attemptNumber` incremented.
// This preserves the failure history of every attempt instead of
// overwriting status.

import type { GalleryDataReference, JsonObject } from '../../types';

export type JobRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed-out'
  | 'skipped';

export type JobRunTriggeredBy = 'schedule' | 'event' | 'manual' | 'retry' | 'one-shot';

export type JobRunProgress = {
  current: number;
  total: number;
  units: 'rows' | 'bytes' | 'tokens' | 'tasks' | 'percent';
  /** Heartbeat — used by the reaper to detect stalled runs. */
  lastUpdateAt: string;
  /** Optional human-readable status message ("embedding batch 12/47"). */
  message?: string;
};

export type JobRun = {
  id: string;
  jobId: string;
  workerId?: string;
  attemptNumber: number;
  retryOfRunId?: string;
  status: JobRunStatus;
  triggeredBy: JobRunTriggeredBy;
  triggeredByEventId?: string; // when triggeredBy='event' — Phase 4c link
  progress?: JobRunProgress;
  outputArtifactRefs?: string[];
  outputSummary?: string; // one-line takeaway for the cockpit
  errorMessage?: string;
  errorKind?: 'transient' | 'permanent' | 'config' | 'budget' | 'unknown';
  scheduledAt?: string;
  queuedAt: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  costUsd?: number;
};

export const jobRunMockData: JobRun[] = [
  // Recent successful embed batch
  {
    id: 'jrun_embed_te3_seq_42',
    jobId: 'job_embed_semantic_memory_te3small',
    workerId: 'worker_sup_01',
    attemptNumber: 1,
    status: 'completed',
    triggeredBy: 'schedule',
    progress: {
      current: 18,
      total: 18,
      units: 'rows',
      lastUpdateAt: '2026-04-25T09:30:42Z',
      message: 'Embedded 18 stale semantic-memory rows.',
    },
    outputSummary: '18 rows re-embedded; 0 errors.',
    scheduledAt: '2026-04-25T09:30:00Z',
    queuedAt: '2026-04-25T09:30:00Z',
    startedAt: '2026-04-25T09:30:00Z',
    endedAt: '2026-04-25T09:30:42Z',
    durationMs: 42_000,
    costUsd: 0.0011,
  },
  // Currently running
  {
    id: 'jrun_consolidate_002',
    jobId: 'job_consolidate_memory',
    workerId: 'w1',
    attemptNumber: 1,
    status: 'running',
    triggeredBy: 'schedule',
    progress: {
      current: 3,
      total: 7,
      units: 'tasks',
      lastUpdateAt: '2026-04-25T09:35:12Z',
      message: 'Promoted 3 of 7 evictable working-memory slots to episodic.',
    },
    scheduledAt: '2026-04-25T09:30:00Z',
    queuedAt: '2026-04-25T09:30:00Z',
    startedAt: '2026-04-25T09:30:05Z',
  },
  // Reaper run — fast, low overhead
  {
    id: 'jrun_reaper_2026_04_25_09_35',
    jobId: 'job_claim_reaper',
    attemptNumber: 1,
    status: 'completed',
    triggeredBy: 'schedule',
    outputSummary: '1 stale claim transitioned to abandoned.',
    queuedAt: '2026-04-25T09:35:00Z',
    startedAt: '2026-04-25T09:35:00Z',
    endedAt: '2026-04-25T09:35:00.180Z',
    durationMs: 180,
  },
  // Daily budget reset
  {
    id: 'jrun_budget_reset_2026_04_25',
    jobId: 'job_budget_daily_reset',
    attemptNumber: 1,
    status: 'completed',
    triggeredBy: 'schedule',
    outputSummary: 'Wrote reset markers for 3 daily-period budgets.',
    outputArtifactRefs: [
      'budget-ledger:led_reset_global_2026_04_25',
      'budget-ledger:led_reset_opus_2026_04_25',
      'budget-ledger:led_reset_tokens_2026_04_25',
    ],
    queuedAt: '2026-04-25T00:00:00Z',
    startedAt: '2026-04-25T00:00:00Z',
    endedAt: '2026-04-25T00:00:00.640Z',
    durationMs: 640,
  },
  // Failed run with retry — first attempt
  {
    id: 'jrun_embed_te3_seq_38_attempt1',
    jobId: 'job_embed_semantic_memory_te3small',
    workerId: 'worker_sup_01',
    attemptNumber: 1,
    status: 'failed',
    triggeredBy: 'schedule',
    errorMessage: 'OpenAI 503 — service temporarily unavailable.',
    errorKind: 'transient',
    progress: {
      current: 6,
      total: 18,
      units: 'rows',
      lastUpdateAt: '2026-04-25T08:45:14Z',
    },
    scheduledAt: '2026-04-25T08:45:00Z',
    queuedAt: '2026-04-25T08:45:00Z',
    startedAt: '2026-04-25T08:45:00Z',
    endedAt: '2026-04-25T08:45:18Z',
    durationMs: 18_000,
  },
  // Same job, retry after backoff — succeeded
  {
    id: 'jrun_embed_te3_seq_38_attempt2',
    jobId: 'job_embed_semantic_memory_te3small',
    workerId: 'worker_sup_01',
    attemptNumber: 2,
    retryOfRunId: 'jrun_embed_te3_seq_38_attempt1',
    status: 'completed',
    triggeredBy: 'retry',
    progress: {
      current: 18,
      total: 18,
      units: 'rows',
      lastUpdateAt: '2026-04-25T08:46:42Z',
      message: 'Embedded 18 rows after 30s backoff.',
    },
    outputSummary: '18 rows re-embedded; recovered from prior 503.',
    queuedAt: '2026-04-25T08:45:48Z',
    startedAt: '2026-04-25T08:46:00Z',
    endedAt: '2026-04-25T08:46:42Z',
    durationMs: 42_000,
    costUsd: 0.0011,
  },
];

export const jobRunSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'JobRun',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'jobId', 'attemptNumber', 'status', 'triggeredBy', 'queuedAt'],
    properties: {
      id: { type: 'string' },
      jobId: { type: 'string' },
      workerId: { type: 'string' },
      attemptNumber: { type: 'number' },
      retryOfRunId: { type: 'string' },
      status: {
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed', 'cancelled', 'timed-out', 'skipped'],
      },
      triggeredBy: {
        type: 'string',
        enum: ['schedule', 'event', 'manual', 'retry', 'one-shot'],
      },
      triggeredByEventId: { type: 'string' },
      progress: {
        type: 'object',
        additionalProperties: false,
        required: ['current', 'total', 'units', 'lastUpdateAt'],
        properties: {
          current: { type: 'number' },
          total: { type: 'number' },
          units: { type: 'string', enum: ['rows', 'bytes', 'tokens', 'tasks', 'percent'] },
          lastUpdateAt: { type: 'string' },
          message: { type: 'string' },
        },
      },
      outputArtifactRefs: { type: 'array', items: { type: 'string' } },
      outputSummary: { type: 'string' },
      errorMessage: { type: 'string' },
      errorKind: { type: 'string', enum: ['transient', 'permanent', 'config', 'budget', 'unknown'] },
      scheduledAt: { type: 'string' },
      queuedAt: { type: 'string' },
      startedAt: { type: 'string' },
      endedAt: { type: 'string' },
      durationMs: { type: 'number' },
      costUsd: { type: 'number' },
    },
  },
};

export const jobRunReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Job', targetSource: 'cart/app/gallery/data/job.ts', sourceField: 'jobId', targetField: 'id' },
  {
    kind: 'references',
    label: 'Worker',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'workerId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Retry-of run',
    targetSource: 'cart/app/gallery/data/job-run.ts',
    sourceField: 'retryOfRunId',
    targetField: 'id',
    summary: 'Forms a retry chain — each attempt is its own row, linked back to the previous one.',
  },
  {
    kind: 'references',
    label: 'Triggering event',
    targetSource: 'cart/app/gallery/data/event.ts',
    sourceField: 'triggeredByEventId',
    targetField: 'id',
    summary: 'When triggeredBy=event, points at the Event row that fired the run.',
  },
  {
    kind: 'has-many',
    label: 'Lifecycle events',
    targetSource: 'cart/app/gallery/data/event.ts',
    sourceField: 'id',
    targetField: 'subjectId (where subjectKind=\'job-run\')',
    summary:
      'Every status transition (queued → running → progress → completed/failed) emits an Event row in the same transaction. Status field is the cached current state; events are the transition log.',
  },
];
