// Job — the *definition* of work that happens automatically. Recurring
// (cron / interval), one-shot async (long-running batch), or
// triggered (fire when an event-hook matches).
//
// A Job is not the work itself — that lives in JobRun rows. The Job
// row is what you edit; JobRun rows are what get appended.
//
// Relation to other shapes:
//   - `action.kind` describes what to do; the spec object is shaped
//     per kind (an embed-batch carries an EmbeddingModelId + filter,
//     a budget-reset carries a budgetId, etc.).
//   - `trigger.eventHookId` (Phase 4c forward link) lets a hook fire
//     this job. Hooks-trigger-jobs is how event reactivity composes.
//   - `ownerWorkerId` pins the job to one worker if it must run in a
//     specific runtime; null = any worker may pick it up.

import type { GalleryDataReference, JsonObject } from '../../types';

export type JobKind = 'recurring' | 'one-shot' | 'on-event';

export type JobActionKind =
  | 'embed-batch' // (re-)embed entities into the embedding store
  | 'consolidate-memory' // promote working → episodic, episodic → semantic
  | 'reaper' // sweep stale claims / abandoned workers
  | 'budget-reset' // write reset markers to budget-ledger
  | 'webhook-pull' // pull state from an external service
  | 'webhook-push' // push state to an external service
  | 'rollup' // periodic aggregation (cost / token rollups)
  | 'reindex' // rebuild a derived index
  | 'custom'; // user-defined; spec carries everything

export type JobTrigger = {
  /** Cron expression (e.g. "0 3 * * *"). One of cron/intervalMs/eventHookId/manual must be set. */
  cron?: string;
  /** Fixed-period interval in ms (e.g. every 1800000 = 30min). */
  intervalMs?: number;
  /** Forward link to event-hook.ts (Phase 4c). When that hook fires, this job is queued. */
  eventHookId?: string;
  /** Manual = no automatic trigger; only fires when explicitly enqueued. */
  manual?: boolean;
};

export type JobRetryPolicy = {
  maxAttempts: number;
  backoffMs: number;
  /** Multiplier per retry: 2.0 = exponential doubling, 1.0 = constant. */
  backoffFactor: number;
  /** Cap on backoff growth. */
  maxBackoffMs?: number;
};

export type JobStatus = 'active' | 'paused' | 'disabled';

export type Job = {
  id: string;
  settingsId: string;
  label: string;
  summary: string;
  kind: JobKind;
  trigger: JobTrigger;
  action: {
    kind: JobActionKind;
    spec: Record<string, unknown>;
  };
  ownerWorkerId?: string;
  maxConcurrentRuns: number;
  retryPolicy: JobRetryPolicy;
  status: JobStatus;
  lastRunId?: string;
  nextScheduledAt?: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
};

export const jobMockData: Job[] = [
  {
    id: 'job_embed_semantic_memory_te3small',
    settingsId: 'settings_default',
    label: 'Re-embed semantic memory (te3-small)',
    summary:
      'Embed any semantic-memory rows whose contentHash differs from the latest embedding under text-embedding-3-small.',
    kind: 'recurring',
    trigger: { cron: '*/15 * * * *' }, // every 15 minutes
    action: {
      kind: 'embed-batch',
      spec: {
        entityKind: 'semantic-memory',
        embeddingModelId: 'text-embedding-3-small',
        filter: { onlyMissingOrStale: true },
        batchSize: 64,
      },
    },
    maxConcurrentRuns: 1,
    retryPolicy: { maxAttempts: 3, backoffMs: 30_000, backoffFactor: 2.0, maxBackoffMs: 600_000 },
    status: 'active',
    lastRunId: 'jrun_embed_te3_seq_42',
    nextScheduledAt: '2026-04-25T09:45:00Z',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T09:30:00Z',
    tags: ['embedding', 'recurring'],
  },
  {
    id: 'job_consolidate_memory',
    settingsId: 'settings_default',
    label: 'Consolidate working → episodic',
    summary: 'Every 30 min, scan working-memory for evictable slots and promote relevant ones into episodic-memory.',
    kind: 'recurring',
    trigger: { intervalMs: 30 * 60 * 1000 },
    action: {
      kind: 'consolidate-memory',
      spec: {
        from: 'working-memory',
        to: 'episodic-memory',
        relevanceFloor: 0.4,
      },
    },
    maxConcurrentRuns: 1,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000, backoffFactor: 1.0 },
    status: 'active',
    nextScheduledAt: '2026-04-25T10:00:00Z',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T09:30:00Z',
    tags: ['memory', 'consolidation'],
  },
  {
    id: 'job_claim_reaper',
    settingsId: 'settings_default',
    label: 'Reap stale task claims',
    summary: 'Every minute, transition active task-claims with stale heartbeats to abandoned.',
    kind: 'recurring',
    trigger: { intervalMs: 60_000 },
    action: {
      kind: 'reaper',
      spec: {
        target: 'task-claim',
        staleAfterMs: 60_000,
      },
    },
    maxConcurrentRuns: 1,
    retryPolicy: { maxAttempts: 1, backoffMs: 0, backoffFactor: 1.0 },
    status: 'active',
    nextScheduledAt: '2026-04-25T09:36:00Z',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T09:35:00Z',
    tags: ['reaper', 'parallelism'],
  },
  {
    id: 'job_budget_daily_reset',
    settingsId: 'settings_default',
    label: 'Daily budget reset',
    summary: 'At midnight UTC, append a kind=reset row to budget-ledger for every budget with period=day.',
    kind: 'recurring',
    trigger: { cron: '0 0 * * *' },
    action: {
      kind: 'budget-reset',
      spec: {
        period: 'day',
      },
    },
    maxConcurrentRuns: 1,
    retryPolicy: { maxAttempts: 5, backoffMs: 60_000, backoffFactor: 2.0, maxBackoffMs: 3_600_000 },
    status: 'active',
    nextScheduledAt: '2026-04-26T00:00:00Z',
    lastRunId: 'jrun_budget_reset_2026_04_25',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
    tags: ['budget', 'reset'],
  },
  {
    id: 'job_reembed_semantic_to_bge',
    settingsId: 'settings_default',
    label: 'One-shot: re-embed semantic memory with bge-m3',
    summary:
      'Migrate every semantic-memory row to a bge-m3 embedding so the local-runtime path can search the same store. ~7000 rows expected.',
    kind: 'one-shot',
    trigger: { manual: true },
    action: {
      kind: 'embed-batch',
      spec: {
        entityKind: 'semantic-memory',
        embeddingModelId: 'bge-m3',
        filter: {},
        batchSize: 128,
      },
    },
    maxConcurrentRuns: 1,
    retryPolicy: { maxAttempts: 3, backoffMs: 60_000, backoffFactor: 2.0 },
    status: 'paused',
    createdAt: '2026-04-24T20:00:00Z',
    updatedAt: '2026-04-24T20:00:00Z',
    tags: ['embedding', 'migration', 'one-shot'],
  },
  {
    id: 'job_promote_research_finding',
    settingsId: 'settings_default',
    label: 'Promote research findings to semantic memory',
    summary:
      'When a research-finding crosses confidence + reinforcement threshold, promote it to a semantic-memory row.',
    kind: 'on-event',
    trigger: { eventHookId: 'hook_finding_promotion' }, // forward link, Phase 4c
    action: {
      kind: 'custom',
      spec: {
        confidenceFloor: 0.85,
        reinforcementFloor: 3,
      },
    },
    maxConcurrentRuns: 4,
    retryPolicy: { maxAttempts: 2, backoffMs: 5_000, backoffFactor: 1.0 },
    status: 'active',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
    tags: ['research', 'memory', 'event-driven'],
  },
];

export const jobSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Job',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'settingsId',
      'label',
      'summary',
      'kind',
      'trigger',
      'action',
      'maxConcurrentRuns',
      'retryPolicy',
      'status',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      label: { type: 'string' },
      summary: { type: 'string' },
      kind: { type: 'string', enum: ['recurring', 'one-shot', 'on-event'] },
      trigger: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cron: { type: 'string' },
          intervalMs: { type: 'number' },
          eventHookId: { type: 'string' },
          manual: { type: 'boolean' },
        },
      },
      action: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'spec'],
        properties: {
          kind: {
            type: 'string',
            enum: [
              'embed-batch',
              'consolidate-memory',
              'reaper',
              'budget-reset',
              'webhook-pull',
              'webhook-push',
              'rollup',
              'reindex',
              'custom',
            ],
          },
          spec: { type: 'object', additionalProperties: true },
        },
      },
      ownerWorkerId: { type: 'string' },
      maxConcurrentRuns: { type: 'number' },
      retryPolicy: {
        type: 'object',
        additionalProperties: false,
        required: ['maxAttempts', 'backoffMs', 'backoffFactor'],
        properties: {
          maxAttempts: { type: 'number' },
          backoffMs: { type: 'number' },
          backoffFactor: { type: 'number' },
          maxBackoffMs: { type: 'number' },
        },
      },
      status: { type: 'string', enum: ['active', 'paused', 'disabled'] },
      lastRunId: { type: 'string' },
      nextScheduledAt: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
};

export const jobReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Settings', targetSource: 'cart/app/gallery/data/settings.ts', sourceField: 'settingsId', targetField: 'id' },
  {
    kind: 'has-many',
    label: 'Job runs',
    targetSource: 'cart/app/gallery/data/job-run.ts',
    sourceField: 'id',
    targetField: 'jobId',
    summary:
      'Each execution writes a JobRun row. lastRunId is denormalized on the Job for fast "is it currently running" checks.',
  },
  {
    kind: 'references',
    label: 'Owning worker',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'ownerWorkerId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Triggering event hook',
    targetSource: 'cart/app/gallery/data/event-hook.ts',
    sourceField: 'trigger.eventHookId',
    targetField: 'id',
    summary:
      'When the hook matches, this job is queued. Hook.action.spec.jobId points back here, closing the loop.',
  },
];
