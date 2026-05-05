// Rule — IF (event matches) THEN (consequence). The reactive substrate
// the catalog uses to wire events to actions: queue jobs, spawn workers,
// halt runs, flag pathologies, fire other rules, etc.
//
// Replaces the older EventHook shape on 2026-05-05. EventHook was the
// same idea but flatter — Rule adds:
//   - chained firing via `triggersRule`
//   - broader `scope` than profile-scoped only (now: global / composition
//     / run / session / project)
//   - `priority` for deterministic ordering when many rules match
//   - more consequence kinds (invoke-verb, flag-pathology, halt-run, …)
//
// Per-fire history lives in rule-firing.ts (one row per consequence
// dispatch). Rule.fireCount + lastFiredAt are denorm convenience for the
// row, not a substitute for the firing log.
//
// ── Cooldowns and rate limits ─────────────────────────────────
// `cooldownMs` prevents thrashing when a rule would otherwise fire many
// times in quick succession. `maxFires` is for one-shot rules ("notify
// once when budget hits 80%"). `fireCount` is the running total — never
// reset.
//
// ── How this closes loops in the catalog ─────────────────────
// - Job.trigger.eventHookId: a Job is queued when its rule matches.
// - Constraint violation → rule → notify-user / halt-run consequence.
// - Goal.achieved → rule → run a "wrap-up" job that promotes
//   findings, updates semantic memory, etc.
// - Worker.lifecycle-changed → rule → reaper checks.
// - Pathology detection → rule → flag-pathology + halt-run.

import type { GalleryDataReference, JsonObject } from '../../types';

export type RuleConsequenceKind =
  // Existing (preserved from EventHook)
  | 'queue-job' // append a JobRun row for the named Job
  | 'spawn-worker' // create a new Worker row
  | 'emit-event' // append a fresh Event (causalEventId set automatically)
  | 'mark-status' // update a row's status field
  | 'notify-user' // surface to the cockpit UI / user inbox
  | 'cancel' // cancel a workstream / job-run / claim
  | 'custom' // user-defined; spec carries everything
  // New (per spec)
  | 'inject-message' // inject a message into a worker's input stream
  | 'invoke-verb' // call a WorkerVerb on the active worker
  | 'halt-run' // stop the active CompositionRun
  | 'flag-pathology' // append a PathologyDetection row
  | 'kick-to-supervisor' // escalate to the active Supervisor
  | 'fire-rule' // chained rule firing (legacy alias of triggersRule)
  | 'modify-assembly' // mutate the active prompt-composition assembly
  | 'set-variable' // set a run-scoped variable
  | 'send-notification' // out-of-band notification (slack/email/etc.)
  | 'commit-state'; // persist a snapshot of run state

export type RuleScope =
  | 'global' // applies cluster-wide
  | 'settings' // profile-scoped (legacy default — same as old EventHook)
  | 'project' // bounded by a Project
  | 'composition' // applies during a specific Composition (work definition)
  | 'run' // applies for the duration of one CompositionRun
  | 'session'; // applies for one WorkerSession

export type RuleMatchSelector = {
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

export type RuleConsequence = {
  kind: RuleConsequenceKind;
  spec: Record<string, unknown>;
  /**
   * Chained rule firing. When set, after this consequence completes,
   * the named Rule is fired with the consequence's result available
   * as the triggering event's payload. Forms rule chains explicitly,
   * separately from the implicit chain via emitted events.
   */
  triggersRule?: string;
};

export type Rule = {
  id: string;
  /**
   * Profile pointer when scope='settings'. For other scopes the
   * scopeTargetId carries the binding (e.g. compositionId, runId).
   * Kept on every row so the resolver can filter cheaply.
   */
  settingsId: string;
  scope: RuleScope;
  scopeTargetId?: string; // e.g. composition.id when scope='composition'
  label: string;
  summary?: string;
  enabled: boolean;
  /** Lower fires first when multiple rules match. Default 100. */
  priority: number;
  match: RuleMatchSelector;
  consequence: RuleConsequence;
  /** Hard cap on lifetime fires; null = unlimited. */
  maxFires?: number;
  fireCount: number;
  /** Min interval between two fires; null = no cooldown. */
  cooldownMs?: number;
  lastFiredAt?: string;
  createdAt: string;
  updatedAt: string;
};

export const ruleMockData: Rule[] = [
  // The forward link from job.ts
  {
    id: 'rule_finding_promotion',
    settingsId: 'settings_default',
    scope: 'settings',
    label: 'Promote research findings to semantic memory',
    summary:
      'When a research-finding crosses confidence + reinforcement threshold, queue the promotion job.',
    enabled: true,
    priority: 100,
    match: {
      kind: 'research.finding-promoted',
      subjectKind: 'research',
    },
    consequence: {
      kind: 'queue-job',
      spec: { jobId: 'job_promote_research_finding' },
    },
    fireCount: 0,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  },
  // Constraint violation surfacing
  {
    id: 'rule_constraint_block_notify',
    settingsId: 'settings_default',
    scope: 'settings',
    label: 'Notify user on hard constraint block',
    summary:
      'When the resolver blocks an action due to a hard constraint, surface it. The user needs to know — silently failing is worse than asking.',
    enabled: true,
    priority: 50,
    match: {
      kind: 'constraint.violated',
      payloadEquals: { response: 'block' },
    },
    consequence: {
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
    id: 'rule_worker_terminated_reap',
    settingsId: 'settings_default',
    scope: 'settings',
    label: 'Reap stale claims when a worker terminates',
    summary: 'A terminated worker may hold active claims. Queue an out-of-band reaper run.',
    enabled: true,
    priority: 100,
    match: {
      kind: 'worker.terminated',
      subjectKind: 'worker',
    },
    consequence: {
      kind: 'queue-job',
      spec: { jobId: 'job_claim_reaper', triggeredByEventField: 'subjectId' },
    },
    cooldownMs: 5_000,
    fireCount: 3,
    lastFiredAt: '2026-04-23T20:01:00Z',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-23T20:01:00Z',
  },
  // Pathology detection — chained rule firing
  {
    id: 'rule_pathology_detected_halt',
    settingsId: 'settings_default',
    scope: 'global',
    label: 'Halt run + flag pathology when one fires',
    summary:
      'Cluster-wide: any pathology firing halts the active CompositionRun and chains into the supervisor escalation rule.',
    enabled: true,
    priority: 1,
    match: { kind: 'pathology.detected' },
    consequence: {
      kind: 'halt-run',
      spec: { reason: 'pathology' },
      triggersRule: 'rule_supervisor_escalate_pathology',
    },
    fireCount: 0,
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  // Chained target — escalates to supervisor
  {
    id: 'rule_supervisor_escalate_pathology',
    settingsId: 'settings_default',
    scope: 'global',
    label: 'Kick to supervisor on halted run',
    summary: 'Triggered by rule_pathology_detected_halt. Escalates the halted run to the active supervisor for adjudication.',
    enabled: true,
    priority: 1,
    match: { kind: 'rule.fired', payloadEquals: { ruleId: 'rule_pathology_detected_halt' } },
    consequence: {
      kind: 'kick-to-supervisor',
      spec: { surface: 'cockpit-inbox', priority: 'critical' },
    },
    fireCount: 0,
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  // Goal-reframe surface
  {
    id: 'rule_goal_reframed_notify',
    settingsId: 'settings_default',
    scope: 'settings',
    label: 'Surface goal reframes',
    summary:
      'When the user (or agent on user request) reframes a Goal, log it visibly so the catalog of past intents stays honest.',
    enabled: true,
    priority: 100,
    match: { kind: 'goal.reframed' },
    consequence: {
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
    id: 'rule_budget_threshold_warn',
    settingsId: 'settings_default',
    scope: 'settings',
    label: 'Warn at 80% of any daily budget',
    summary: 'Single-fire-per-period warning rule — once you are warned, you are warned.',
    enabled: true,
    priority: 100,
    match: {
      kind: 'budget.threshold-warned',
      payloadEquals: { percent: 80 },
    },
    consequence: {
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
    id: 'rule_workstream_merged_celebrate',
    settingsId: 'settings_default',
    scope: 'settings',
    label: 'Auto-promote workstream merge to episodic memory',
    summary:
      'When a workstream merges cleanly (no conflicts), spawn a small consolidation job that writes an EpisodicMemory entry summarizing what landed.',
    enabled: true,
    priority: 100,
    match: {
      kind: 'workstream.merged',
      payloadEquals: { hadConflicts: false },
    },
    consequence: {
      kind: 'queue-job',
      spec: { jobId: 'job_consolidate_memory', focus: 'recent-merge' },
    },
    fireCount: 0,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  },
  // Disabled / archived rule
  {
    id: 'rule_smith_dsuite_runner',
    settingsId: 'settings_default',
    scope: 'settings',
    label: '(disabled) Run d-suite on every Smith change',
    summary:
      'Old reactive harness from the Smith era. Disabled because Smith is frozen.',
    enabled: false,
    priority: 100,
    match: { kind: 'task.completed', payloadEquals: { tags: 'smith' } },
    consequence: {
      kind: 'queue-job',
      spec: { jobId: 'job_dsuite_run_imaginary' },
    },
    fireCount: 218,
    lastFiredAt: '2026-04-17T23:00:00Z',
    createdAt: '2026-02-15T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
  },
  // Strict profile — different consequence for the same event
  {
    id: 'rule_strict_constraint_pause',
    settingsId: 'settings_work_strict',
    scope: 'settings',
    label: 'Pause workstream on any constraint violation',
    summary:
      'In the strict profile, even a soft constraint violation pauses the workstream and surfaces — no silent proceed.',
    enabled: true,
    priority: 50,
    match: { kind: 'constraint.violated' },
    consequence: {
      kind: 'mark-status',
      spec: { entity: 'workstream', subjectField: 'workerId.workstreamId', status: 'paused' },
    },
    fireCount: 0,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
];

export const ruleSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Rule',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'settingsId',
      'scope',
      'label',
      'enabled',
      'priority',
      'match',
      'consequence',
      'fireCount',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      scope: {
        type: 'string',
        enum: ['global', 'settings', 'project', 'composition', 'run', 'session'],
      },
      scopeTargetId: { type: 'string' },
      label: { type: 'string' },
      summary: { type: 'string' },
      enabled: { type: 'boolean' },
      priority: { type: 'number' },
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
      consequence: {
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
              'inject-message',
              'invoke-verb',
              'halt-run',
              'flag-pathology',
              'kick-to-supervisor',
              'fire-rule',
              'modify-assembly',
              'set-variable',
              'send-notification',
              'commit-state',
            ],
          },
          spec: { type: 'object', additionalProperties: true },
          triggersRule: { type: 'string' },
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

export const ruleReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/core/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary:
      'Default profile binding. Rules with scope!=settings still carry settingsId for filter cheapness, but their effective scope is set by `scope` + `scopeTargetId`.',
  },
  {
    kind: 'references',
    label: 'Job (consequence target)',
    targetSource: 'cart/app/gallery/data/core/job.ts',
    sourceField: 'consequence.spec.jobId (when consequence.kind=queue-job)',
    targetField: 'id',
    summary:
      'Closes the loop with Job.trigger.eventHookId — Rule fires Job, Job consults Rule to know what fired it.',
  },
  {
    kind: 'references',
    label: 'Chained rule',
    targetSource: 'cart/app/gallery/data/core/rule.ts',
    sourceField: 'consequence.triggersRule',
    targetField: 'id',
    summary:
      'Rules can fire other rules explicitly via triggersRule. Distinct from the implicit chain via emitted events; explicit is auditable + deterministic.',
  },
  {
    kind: 'has-many',
    label: 'Rule firings (per-fire log)',
    targetSource: 'cart/app/gallery/data/core/rule-firing.ts',
    sourceField: 'id',
    targetField: 'ruleId',
    summary:
      'Every time a rule fires, a RuleFiring row is appended with the triggering event, consequence taken, and chain links. Rule.fireCount + lastFiredAt are denorm summaries of this log.',
  },
  {
    kind: 'has-many',
    label: 'Events (matched against)',
    targetSource: 'cart/app/gallery/data/core/event.ts',
    sourceField: 'id',
    targetField: 'kind (via match.kind)',
    summary: 'When an Event is appended, the resolver scans enabled rules for matches and dispatches consequences.',
  },
];
