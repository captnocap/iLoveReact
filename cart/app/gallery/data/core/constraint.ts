// Constraint — declarative invariant attached to Settings, Goal, Plan,
// or Task. The "donts" that travel with the work.
//
// ── Why this exists ───────────────────────────────────────────────
// A model agent's value is its ability to adjust mid-execution
// (integrateMorePepper). That same flexibility is what produces
// drift unless there are *boundaries that travel with the work*.
// Constraints are the boundaries.
//
// Privacy.tools.denied bounds *capabilities* (you cannot use Bash).
// Constraint bounds *behaviors* (you may use the Edit tool, but not
// to swap salt for pepper inside this Task).
//
// ── How they compose ─────────────────────────────────────────────
// At runtime, the active constraint set for a Task is the UNION of:
//   1. Settings-scope constraints  (always-on rules)
//   2. Goal-scope constraints      (objective-bound invariants)
//   3. Plan-scope constraints      (approach-bound rules)
//   4. Task-scope constraints      (this-step rules)
//
// Constraints are respected at the phase listed in `appliesDuring`:
// 'plan' filters proposals, 'act' filters execution moves, 'adjust'
// filters mid-execution course corrections, 'always' applies in
// every phase.
//
// ── The salt-for-pepper rule ─────────────────────────────────────
// The whole point: a Task may say "season the chicken." The worker
// can decide HOW to season (planNote), can adjust how much pepper
// based on tasting (executionAdjustments). What it CANNOT do is
// substitute salt for pepper — that's a substitution constraint
// with severity=hard. Adjustment ≠ replacement.

import type { GalleryDataReference, JsonObject } from '../../types';

export type ConstraintScopeKind = 'settings' | 'goal' | 'plan' | 'task';

export type ConstraintKind =
  | 'substitution' // do not swap X for Y
  | 'action-forbidden' // do not do Z
  | 'side-effect' // do not produce side-effect W
  | 'irreversible' // this would be unrecoverable; ask before doing
  | 'safety' // would harm user, system, or third party
  | 'scope' // stay within boundaries (paths, modules, repos)
  | 'temporal'; // do not do this until / after a condition

export type ConstraintSeverity = 'hard' | 'soft' | 'advisory';

export type ConstraintViolationResponse =
  | 'block' // refuse to proceed; surface to user
  | 'warn' // emit a warning; proceed cautiously
  | 'log' // record for review; proceed
  | 'reframe-goal'; // stop; treat as a goal-reframe trigger

export type ConstraintPhase = 'plan' | 'act' | 'adjust' | 'always';

export type Constraint = {
  id: string;
  scopeKind: ConstraintScopeKind;
  scopeTargetId: string; // settings.id / goal.id / plan.id / task.id
  kind: ConstraintKind;
  statement: string;
  rationale?: string;
  severity: ConstraintSeverity;
  violationResponse: ConstraintViolationResponse;
  appliesDuring: ConstraintPhase[];
  derivedFromSemanticMemoryId?: string;
  createdAt: string;
  createdBy: 'user' | 'agent' | 'system';
};

export const constraintMockData: Constraint[] = [
  // ── Settings-scope (always-on) ─────────────────────────────────────
  {
    id: 'cnst_no_force_push_main',
    scopeKind: 'settings',
    scopeTargetId: 'settings_default',
    kind: 'action-forbidden',
    statement: 'Do not git push --force to main.',
    rationale:
      'Parallel sessions step on each other if branches diverge. Force-push to main can destroy work from other workers.',
    severity: 'hard',
    violationResponse: 'block',
    appliesDuring: ['always'],
    createdAt: '2026-03-01T00:00:00Z',
    createdBy: 'user',
  },
  {
    id: 'cnst_frozen_dirs',
    scopeKind: 'settings',
    scopeTargetId: 'settings_default',
    kind: 'scope',
    statement: 'Do not edit, chmod, or unlock archive/, love2d/, or tsz/.',
    rationale: 'These are frozen reference trees; modifying them invalidates the comparison they exist for.',
    severity: 'hard',
    violationResponse: 'block',
    appliesDuring: ['always'],
    derivedFromSemanticMemoryId: 'smem_frozen_dirs',
    createdAt: '2026-04-18T00:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'cnst_no_explore',
    scopeKind: 'settings',
    scopeTargetId: 'settings_default',
    kind: 'action-forbidden',
    statement: 'Do not invoke the Explore agent in this repo.',
    rationale:
      'Explore produced materially false feature reports here (~57% false-claim rate). Direct reads are faster and correct.',
    severity: 'hard',
    violationResponse: 'block',
    appliesDuring: ['plan', 'act'],
    derivedFromSemanticMemoryId: 'smem_no_explore',
    createdAt: '2026-04-01T00:00:00Z',
    createdBy: 'user',
  },
  {
    id: 'cnst_strict_no_bash',
    scopeKind: 'settings',
    scopeTargetId: 'settings_work_strict',
    kind: 'action-forbidden',
    statement: 'Do not invoke Bash, WebFetch, or Write under the strict profile.',
    rationale: 'Strict profile is review-only. These tools belong to the personal profile.',
    severity: 'hard',
    violationResponse: 'block',
    appliesDuring: ['always'],
    createdAt: '2026-04-12T00:00:00Z',
    createdBy: 'user',
  },

  // ── Goal-scope ────────────────────────────────────────────────────
  {
    id: 'cnst_catalog_goal_no_breakage',
    scopeKind: 'goal',
    scopeTargetId: 'goal_data_shape_catalog',
    kind: 'side-effect',
    statement: 'Do not break existing data-shape stories while adding new ones.',
    rationale: 'Existing 50+ shapes are referenced by stories already; renames cascade.',
    severity: 'hard',
    violationResponse: 'block',
    appliesDuring: ['act', 'adjust'],
    createdAt: '2026-04-24T08:00:00Z',
    createdBy: 'agent',
  },
  {
    id: 'cnst_strict_no_unrelated_changes',
    scopeKind: 'goal',
    scopeTargetId: 'goal_strict_review_engagement',
    kind: 'scope',
    statement: 'Do not modify any file. Read-only review.',
    rationale: 'Engagement is review-only; the client expects no commits.',
    severity: 'hard',
    violationResponse: 'block',
    appliesDuring: ['always'],
    createdAt: '2026-04-12T14:00:00Z',
    createdBy: 'user',
  },

  // ── Plan-scope ────────────────────────────────────────────────────
  {
    id: 'cnst_phase4_no_existing_rewrite',
    scopeKind: 'plan',
    scopeTargetId: 'plan_gallery_data_shapes',
    kind: 'side-effect',
    statement:
      'Do not rewrite existing shape files unless explicitly retrofitting (e.g. plan.goalId rewire). Add new shapes alongside.',
    severity: 'soft',
    violationResponse: 'warn',
    appliesDuring: ['act', 'adjust'],
    createdAt: '2026-04-24T08:00:00Z',
    createdBy: 'user',
  },

  // ── Task-scope (the salt-for-pepper case) ────────────────────────
  {
    id: 'cnst_task_task_ts_keep_existing',
    scopeKind: 'task',
    scopeTargetId: 'task_task_ts',
    kind: 'side-effect',
    statement: 'Do not change existing mock rows except to add the new approach fields.',
    rationale:
      'Other shapes reference these task ids. Mutating their meaning breaks downstream consistency.',
    severity: 'soft',
    violationResponse: 'warn',
    appliesDuring: ['adjust'],
    createdAt: '2026-04-24T09:30:00Z',
    createdBy: 'agent',
  },

  // ── An advisory soft-constraint ──────────────────────────────────
  {
    id: 'cnst_no_emojis',
    scopeKind: 'settings',
    scopeTargetId: 'settings_default',
    kind: 'side-effect',
    statement: 'Do not put emojis in code, docs, or commit messages unless explicitly asked.',
    severity: 'advisory',
    violationResponse: 'log',
    appliesDuring: ['act'],
    createdAt: '2026-03-01T00:00:00Z',
    createdBy: 'user',
  },

  // ── Irreversible action (require ask-before) ─────────────────────
  {
    id: 'cnst_irreversible_db_drop',
    scopeKind: 'settings',
    scopeTargetId: 'settings_default',
    kind: 'irreversible',
    statement: 'Do not run DROP TABLE, TRUNCATE, or rm -rf without explicit user confirmation.',
    severity: 'hard',
    violationResponse: 'block',
    appliesDuring: ['always'],
    createdAt: '2026-03-01T00:00:00Z',
    createdBy: 'user',
  },
];

export const constraintSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Constraint',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'scopeKind',
      'scopeTargetId',
      'kind',
      'statement',
      'severity',
      'violationResponse',
      'appliesDuring',
      'createdAt',
      'createdBy',
    ],
    properties: {
      id: { type: 'string' },
      scopeKind: { type: 'string', enum: ['settings', 'goal', 'plan', 'task'] },
      scopeTargetId: { type: 'string' },
      kind: {
        type: 'string',
        enum: [
          'substitution',
          'action-forbidden',
          'side-effect',
          'irreversible',
          'safety',
          'scope',
          'temporal',
        ],
      },
      statement: { type: 'string' },
      rationale: { type: 'string' },
      severity: { type: 'string', enum: ['hard', 'soft', 'advisory'] },
      violationResponse: {
        type: 'string',
        enum: ['block', 'warn', 'log', 'reframe-goal'],
      },
      appliesDuring: {
        type: 'array',
        items: { type: 'string', enum: ['plan', 'act', 'adjust', 'always'] },
      },
      derivedFromSemanticMemoryId: { type: 'string' },
      createdAt: { type: 'string' },
      createdBy: { type: 'string', enum: ['user', 'agent', 'system'] },
    },
  },
};

export const constraintReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Scope target — Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'scopeTargetId (when scopeKind=settings)',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Scope target — Goal',
    targetSource: 'cart/app/gallery/data/goal.ts',
    sourceField: 'scopeTargetId (when scopeKind=goal)',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Scope target — Plan',
    targetSource: 'cart/app/gallery/data/plan.ts',
    sourceField: 'scopeTargetId (when scopeKind=plan)',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Scope target — Task',
    targetSource: 'cart/app/gallery/data/task.ts',
    sourceField: 'scopeTargetId (when scopeKind=task)',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Derived from semantic memory',
    targetSource: 'cart/app/gallery/data/semantic-memory.ts',
    sourceField: 'derivedFromSemanticMemoryId',
    targetField: 'id',
    summary:
      'When a constraint is promoted from a learned fact rather than declared up front, this preserves the source.',
  },
];
