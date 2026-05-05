// EventHook — a subscription rule. Says "when an Event matching X
// happens, do Y." This is the reactive layer that ties the event bus
// to actions: queue a Job, spawn a Worker, mark a status, notify the
// user, emit another Event.
//
// Hooks are profile-scoped (settingsId) — strict profiles can have
// stricter or different reactions than personal profiles. The
// resolver finds all enabled hooks whose match.* selectors satisfy
// an incoming Event and dispatches their actions in declaration
// order, all within the same DB transaction as the Event append.
//
// ── Cooldowns and rate limits ─────────────────────────────────
// `cooldownMs` prevents thrashing when a hook would otherwise fire
// many times in quick succession. `maxFires` is for one-shot hooks
// ("notify once when budget hits 80%"). `fireCount` is the running
// total — never reset.
//
// ── How this closes loops in the catalog ─────────────────────
// - Job.trigger.eventHookId: a Job is queued when its hook matches.
// - Constraint violation → hook → notify-user action.
// - Goal.achieved → hook → run a "wrap-up" job that promotes
//   findings, updates semantic memory, etc.
// - Worker.lifecycle-changed → hook → reaper checks.

import type { GalleryDataReference, JsonObject } from '../../types';

export type EventHookActionKind =
  | 'queue-job' // append a JobRun row for the named Job
  | 'spawn-worker' // create a new Worker row
  | 'emit-event' // append a fresh Event (causalEventId set automatically)
  | 'mark-status' // update a row's status field
  | 'notify-user' // surface to the cockpit UI / user inbox
  | 'cancel' // cancel a workstream / job-run / claim
  | 'custom'; // user-defined; spec carries everything

export type EventHookMatchSelector = {
  /**
   * Match by Event.kind. Supports exact string, comma-list, or '*'
   * suffix wildcard. Examples: 'task.completed', 'task.*',
   * 'job-run.completed,job-run.failed'.
   */
  kind: string;
  subjectKind?: string;
  /** Optional payload-shape filter — keys must equal these values. */
  payloadEquals?: Record<string, unknown>;
  /** Optional scope filter — only fire for events in these scopes. */
  workspaceId?: string;
  projectId?: string;
};

export type EventHookAction = {
  kind: EventHookActionKind;
  spec: Record<string, unknown>;
};

export type EventHook = {
  id: string;
  settingsId: string;
  label: string;
  summary?: string;
  enabled: boolean;
  match: EventHookMatchSelector;
  action: EventHookAction;
  /** Hard cap on lifetime fires; null = unlimited. */
  maxFires?: number;
  fireCount: number;
  /** Min interval between two fires; null = no cooldown. */
  cooldownMs?: number;
  lastFiredAt?: string;
  createdAt: string;
  updatedAt: string;
};

export const eventHookMockData: EventHook[] = [
  // The forward link from job.ts
  {
    id: 'hook_finding_promotion',
    settingsId: 'settings_default',
    label: 'Promote research findings to semantic memory',
    summary:
      'When a research-finding crosses confidence + reinforcement threshold, queue the promotion job.',
    enabled: true,
    match: {
      kind: 'research.finding-promoted',
      subjectKind: 'research',
    },
    action: {
      kind: 'queue-job',
      spec: { jobId: 'job_promote_research_finding' },
    },
    fireCount: 0,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  },
  // Constraint violation surfacing
  {
    id: 'hook_constraint_block_notify',
    settingsId: 'settings_default',
    label: 'Notify user on hard constraint block',
    summary:
      'When the resolver blocks an action due to a hard constraint, surface it. The user needs to know — silently failing is worse than asking.',
    enabled: true,
    match: {
      kind: 'constraint.violated',
      payloadEquals: { response: 'block' },
    },
    action: {
      kind: 'notify-user',
      spec: {
        channel: 'cockpit-inbox',
        priority: 'high',
        title: 'Action blocked by constraint',
      },
    },
    fireCount: 1,
    lastFiredAt: '2026-04-23T20:01:30Z',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-23T20:01:30Z',
  },
  // Reaper integration
  {
    id: 'hook_worker_terminated_reap',
    settingsId: 'settings_default',
    label: 'Reap stale claims when a worker terminates',
    summary: 'A terminated worker may hold active claims. Queue an out-of-band reaper run.',
    enabled: true,
    match: {
      kind: 'worker.terminated',
      subjectKind: 'worker',
    },
    action: {
      kind: 'queue-job',
      spec: { jobId: 'job_claim_reaper', triggeredByEventField: 'subjectId' },
    },
    cooldownMs: 5_000,
    fireCount: 3,
    lastFiredAt: '2026-04-23T20:01:00Z',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-23T20:01:00Z',
  },
  // Goal-reframe surface
  {
    id: 'hook_goal_reframed_notify',
    settingsId: 'settings_default',
    label: 'Surface goal reframes',
    summary:
      'When the user (or agent on user request) reframes a Goal, log it visibly so the catalog of past intents stays honest.',
    enabled: true,
    match: { kind: 'goal.reframed' },
    action: {
      kind: 'notify-user',
      spec: { channel: 'cockpit-inbox', priority: 'medium', title: 'Goal reframed' },
    },
    fireCount: 1,
    lastFiredAt: '2026-04-18T00:00:00Z',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
  },
  // Budget threshold
  {
    id: 'hook_budget_threshold_warn',
    settingsId: 'settings_default',
    label: 'Warn at 80% of any daily budget',
    summary: 'Single-fire-per-period warning hook — once you are warned, you are warned.',
    enabled: true,
    match: {
      kind: 'budget.threshold-warned',
      payloadEquals: { percent: 80 },
    },
    action: {
      kind: 'notify-user',
      spec: { channel: 'cockpit-inbox', priority: 'medium', title: 'Budget approaching daily cap' },
    },
    cooldownMs: 24 * 60 * 60 * 1000,
    fireCount: 0,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  },
  // Workstream merge — automate the easy cases
  {
    id: 'hook_workstream_merged_celebrate',
    settingsId: 'settings_default',
    label: 'Auto-promote workstream merge to episodic memory',
    summary:
      'When a workstream merges cleanly (no conflicts), spawn a small consolidation job that writes an EpisodicMemory entry summarizing what landed.',
    enabled: true,
    match: {
      kind: 'workstream.merged',
      payloadEquals: { hadConflicts: false },
    },
    action: {
      kind: 'queue-job',
      spec: { jobId: 'job_consolidate_memory', focus: 'recent-merge' },
    },
    fireCount: 0,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  },
  // Disabled / archived hook
  {
    id: 'hook_smith_dsuite_runner',
    settingsId: 'settings_default',
    label: '(disabled) Run d-suite on every Smith change',
    summary:
      'Old reactive harness from the Smith era. Disabled because Smith is frozen.',
    enabled: false,
    match: { kind: 'task.completed', payloadEquals: { tags: 'smith' } },
    action: {
      kind: 'queue-job',
      spec: { jobId: 'job_dsuite_run_imaginary' },
    },
    fireCount: 218,
    lastFiredAt: '2026-04-17T23:00:00Z',
    createdAt: '2026-02-15T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
  },
  // Strict profile — different action for the same event
  {
    id: 'hook_strict_constraint_pause',
    settingsId: 'settings_work_strict',
    label: 'Pause workstream on any constraint violation',
    summary:
      'In the strict profile, even a soft constraint violation pauses the workstream and surfaces — no silent proceed.',
    enabled: true,
    match: { kind: 'constraint.violated' },
    action: {
      kind: 'mark-status',
      spec: { entity: 'workstream', subjectField: 'workerId.workstreamId', status: 'paused' },
    },
    fireCount: 0,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
];

export const eventHookSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'EventHook',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'settingsId',
      'label',
      'enabled',
      'match',
      'action',
      'fireCount',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      label: { type: 'string' },
      summary: { type: 'string' },
      enabled: { type: 'boolean' },
      match: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: { type: 'string' },
          subjectKind: { type: 'string' },
          payloadEquals: { type: 'object', additionalProperties: true },
          workspaceId: { type: 'string' },
          projectId: { type: 'string' },
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
              'queue-job',
              'spawn-worker',
              'emit-event',
              'mark-status',
              'notify-user',
              'cancel',
              'custom',
            ],
          },
          spec: { type: 'object', additionalProperties: true },
        },
      },
      maxFires: { type: 'number' },
      fireCount: { type: 'number' },
      cooldownMs: { type: 'number' },
      lastFiredAt: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const eventHookReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary:
      'Hooks are profile-scoped — the strict profile can have different reactions than the personal profile to the same Event kind.',
  },
  {
    kind: 'references',
    label: 'Job (action target)',
    targetSource: 'cart/app/gallery/data/job.ts',
    sourceField: 'action.spec.jobId (when action.kind=queue-job)',
    targetField: 'id',
    summary: 'Closes the loop with Job.trigger.eventHookId — Hook fires Job, Job consults Hook to know what fired it.',
  },
  {
    kind: 'has-many',
    label: 'Events (matched against)',
    targetSource: 'cart/app/gallery/data/event.ts',
    sourceField: 'id',
    targetField: 'kind (via match.kind)',
    summary: 'When an Event is appended, the resolver scans enabled hooks for matches and dispatches actions.',
  },
];
