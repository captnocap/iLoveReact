// Goal — the objective in the user's words. The thing the user wants
// to be true. Distinct from Plan (the *approach*): a Plan is HOW we
// pursue a Goal; the Goal is WHAT we are after.
//
// ── Why this exists, in one sentence ────────────────────────────────
// "The objective is to eat dinner" is what the agent loses when it
// starts treating each sub-step as its own scopable concern. Goal
// pins the objective to data so it can never be lost in
// decomposition — every Plan, Phase, Task, and (eventually) prompt
// can resolve "what is this for, originally?" in one hop.
//
// ── The type-mismatch trap ─────────────────────────────────────────
// User input is goal-shaped. ("I want X to be true.") When the
// worker mistakes goal-shaped input for task-shaped input, every
// "should I also do Y" / "let me confirm scope" becomes friction —
// because the user already gave the only thing that matters: the
// objective. Decomposition was never theirs to ratify.
//
// Default rule for any user message: produce a Goal first. Promote
// to a Plan when the path is non-obvious. Surface confirmation only
// when the goal *itself* is ambiguous — never when sub-steps are.
//
// ── The fractal Plan/Act invariant ─────────────────────────────────
// At every level — Goal → Plan → Phase → TaskGraph → Task → and
// inside each Task — there is a (deliberate, then act) cycle. Those
// two phases are SEQUENTIAL within a single actor: you cannot
// planToSeason() and season() at the same time. Deliberation gets
// captured *on the same row* as the act it precedes. It never
// becomes a sibling Task or sub-Plan or sub-Goal. See task.ts
// `approachNote` for the leaf-level home.

import type { GalleryDataReference, JsonObject } from '../../types';

export type GoalOriginActor = 'user' | 'agent' | 'system';
export type GoalStatus = 'open' | 'achieved' | 'abandoned' | 'reframed';

/**
 * Temporal scope tells the worker how much effort to invest.
 *   momentary — one-shot, in-the-moment, do-not-overplan
 *   session   — within this conversation/sitting
 *   project   — bounded by a project lifecycle
 *   long-term — spans projects / sessions; recurring
 */
export type GoalScopeDuration = 'momentary' | 'session' | 'project' | 'long-term';

export type ReferenceArtifactKind =
  | 'image'
  | 'url'
  | 'file'
  | 'video'
  | 'code-snippet'
  | 'transcript';

export type ReferenceArtifact = {
  id: string;
  kind: ReferenceArtifactKind;
  ref: string; // path / URL / data-uri
  caption?: string;
  /**
   * Optional pointer at the Interpretation that extracted rubric
   * dimensions from this artifact.
   */
  interpretedByInterpretationId?: string;
};

export type Goal = {
  id: string;
  workspaceId: string;
  projectId?: string;
  originActor: GoalOriginActor;
  /**
   * The literal phrasing — what the user actually said. Untranslated,
   * unedited. Workers reference this back when checking "did I drift
   * from what was asked?"
   */
  userTurnText?: string;
  /**
   * The objective restated cleanly. Free of how-language. "Have
   * dinner ready by 7" not "boil water then cook chicken."
   */
  statement: string;
  /**
   * How much effort to invest. Workers consult this before
   * elaborating into a full Plan.
   */
  scopeDuration?: GoalScopeDuration;
  /**
   * Reference media the user attached. The interpreter pass extracts
   * implicit OutcomeRubric dimensions from each artifact at
   * goal-formalize time. The screenshot IS most of the spec — verbal
   * critique is the deltas.
   */
  referenceArtifacts?: ReferenceArtifact[];
  /**
   * The recognition contract for this Goal. Workers self-check
   * proposed adjustments against the rubric before surfacing.
   */
  outcomeRubricId?: string;
  /**
   * What does done look like, in human terms. Not measurable
   * criteria — that lives on Plan.successCriteria.
   */
  successDescription?: string;
  parentGoalId?: string;
  childGoalIds?: string[];
  status: GoalStatus;
  achievedByPlanId?: string;
  achievedAt?: string;
  reframedToGoalId?: string;
  abandonReason?: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
};

export const goalMockData: Goal[] = [
  {
    id: 'goal_data_shape_catalog',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_carts',
    originActor: 'user',
    userTurnText:
      'Hey so look at our data shapes inside of the component gallery, the files come from the scaffold of the script gallery-component.js --data and there is linking between data shapes for reference. We have a small surface in. We have a LOT to cover.',
    statement:
      'Build a comprehensive, linked, gallery-rendered catalog of the data shapes used across the cockpit / worker / inference layers.',
    successDescription:
      'Every shape has typed fields, a schema, mock rows that exercise edge cases, and reference links to the shapes it relates to. Forward dangles are tracked and closed as later shapes land.',
    scopeDuration: 'project',
    status: 'open',
    createdAt: '2026-04-24T08:00:00Z',
    updatedAt: '2026-04-25T09:35:00Z',
    tags: ['catalog', 'foundational'],
  },
  {
    id: 'goal_hot_reload_state',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_runtime',
    originActor: 'user',
    userTurnText: 'state needs to actually persist across hot reload, not just useState — useHotState',
    statement:
      'useHotState slots survive a hot reload — editing a cart .tsx file does not clobber in-memory state.',
    successDescription:
      'Saving a cart file rebundles, the framework re-evals, and the slot for every useHotState call is preserved with its prior value. No state lost on edit.',
    status: 'open',
    createdAt: '2026-04-22T13:55:00Z',
    updatedAt: '2026-04-22T15:10:00Z',
    tags: ['hooks', 'hot-reload'],
  },
  {
    id: 'goal_kimi_adapter',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_carts',
    parentGoalId: 'goal_data_shape_catalog',
    originActor: 'agent',
    statement:
      'Add Kimi to the supported provider set so the worker can spawn against a moonshot connection.',
    successDescription:
      'A Kimi-shaped raw-event file exists, an adapter row maps it to the normalized WorkerEvent contract, and a worker spawned with conn_kimi can produce a session whose transcript replays correctly.',
    status: 'open',
    createdAt: '2026-04-25T09:10:00Z',
    updatedAt: '2026-04-25T09:35:00Z',
    tags: ['provider', 'kimi'],
  },
  {
    id: 'goal_strict_review_engagement',
    workspaceId: 'ws_client_project',
    projectId: 'proj_client_engagement',
    originActor: 'user',
    userTurnText: 'review the auth changes for the client; do not write anything, just flag issues',
    statement:
      'Surface defects, naming concerns, and risky refactors in the client\'s auth changes — read-only review, no writes.',
    successDescription:
      'A reviewer pass produces an annotated list of concerns. No files modified. Output respects the strict privacy policy (no Bash, no Web).',
    status: 'achieved',
    achievedByPlanId: 'plan_client_auth_review_imaginary',
    achievedAt: '2026-04-12T15:30:00Z',
    createdAt: '2026-04-12T14:00:00Z',
    updatedAt: '2026-04-12T15:30:00Z',
    tags: ['review', 'client', 'strict'],
  },
  {
    id: 'goal_old_smith_attempt',
    workspaceId: 'ws_reactjit',
    originActor: 'user',
    statement: 'Compile .tsz to JS via the Smith pipeline.',
    status: 'reframed',
    reframedToGoalId: 'goal_v8_default_runtime',
    abandonReason:
      'Reframed after the 50-day Smith detour — the load-bearing problem was not Smith vs JS, it was a synchronous npx tsc call in the React reconciler path. Replaced with the V8-default runtime goal.',
    createdAt: '2026-02-25T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
    tags: ['frozen', 'past'],
  },
  {
    id: 'goal_v8_default_runtime',
    workspaceId: 'ws_reactjit',
    originActor: 'user',
    statement: 'V8 is the default runtime; QJS is legacy maintenance-only.',
    successDescription:
      'scripts/ship builds V8. Click latency on a cart drops from ~1800ms to ~40ms. QJS path still compiles for back-compat but nothing new is built on it.',
    status: 'achieved',
    achievedAt: '2026-04-18T00:00:00Z',
    createdAt: '2026-04-15T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
    tags: ['runtime', 'v8', 'achieved'],
  },
  // ── New shape exemplars: rubric + reference-artifact + scopeDuration
  {
    id: 'goal_dinner_spaghetti',
    workspaceId: 'ws_reactjit',
    originActor: 'user',
    userTurnText: 'lets just have spaghetti tonight',
    statement: 'Make spaghetti for dinner; recognizable, hot, balanced.',
    successDescription:
      'A plate of spaghetti, eaten with satisfaction; not too peppery this time.',
    scopeDuration: 'momentary',
    outcomeRubricId: 'rubric_spaghetti_dinner',
    parentGoalId: undefined,
    status: 'open',
    createdAt: '2026-04-25T17:55:00Z',
    updatedAt: '2026-04-25T17:55:00Z',
    tags: ['dinner', 'cooking-metaphor'],
  },
  {
    id: 'goal_ui_from_screenshot',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_carts',
    originActor: 'user',
    userTurnText:
      'build me this — but the X part is wrong. fix that, otherwise match the screenshot.',
    statement: 'Build a UI component matching the screenshot, with the X behavior fixed.',
    scopeDuration: 'session',
    referenceArtifacts: [
      {
        id: 'ref_screenshot_001',
        kind: 'image',
        ref: '/uploads/shot.png',
        caption: 'Screenshot of the target component from another product',
        interpretedByInterpretationId: 'interp_screenshot_001',
      },
    ],
    outcomeRubricId: 'rubric_ui_from_screenshot',
    status: 'open',
    createdAt: '2026-04-25T10:30:00Z',
    updatedAt: '2026-04-25T11:20:00Z',
    tags: ['ui', 'reference-driven'],
  },
];

export const goalSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Goal',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'workspaceId', 'originActor', 'statement', 'status', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      workspaceId: { type: 'string' },
      projectId: { type: 'string' },
      originActor: { type: 'string', enum: ['user', 'agent', 'system'] },
      userTurnText: { type: 'string' },
      statement: { type: 'string' },
      successDescription: { type: 'string' },
      scopeDuration: {
        type: 'string',
        enum: ['momentary', 'session', 'project', 'long-term'],
      },
      referenceArtifacts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind', 'ref'],
          properties: {
            id: { type: 'string' },
            kind: {
              type: 'string',
              enum: ['image', 'url', 'file', 'video', 'code-snippet', 'transcript'],
            },
            ref: { type: 'string' },
            caption: { type: 'string' },
            interpretedByInterpretationId: { type: 'string' },
          },
        },
      },
      outcomeRubricId: { type: 'string' },
      parentGoalId: { type: 'string' },
      childGoalIds: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: ['open', 'achieved', 'abandoned', 'reframed'] },
      achievedByPlanId: { type: 'string' },
      achievedAt: { type: 'string' },
      reframedToGoalId: { type: 'string' },
      abandonReason: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
};

export const goalReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Workspace', targetSource: 'cart/app/gallery/data/workspace.ts', sourceField: 'workspaceId', targetField: 'id' },
  {
    kind: 'references',
    label: 'Project',
    targetSource: 'cart/app/gallery/data/project.ts',
    sourceField: 'projectId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Plans (in service of this goal)',
    targetSource: 'cart/app/gallery/data/plan.ts',
    sourceField: 'id',
    targetField: 'goalId',
    summary:
      'Plan.goalId is required — every Plan exists to advance some Goal. A Goal may be served by multiple Plans over time (e.g. a long-lived goal with several attempt-Plans).',
  },
  {
    kind: 'references',
    label: 'Parent goal (DAG)',
    targetSource: 'cart/app/gallery/data/goal.ts',
    sourceField: 'parentGoalId',
    targetField: 'id',
    summary:
      'Goals form a DAG via parent links. Sub-goals are how complex objectives decompose; they do NOT replace the parent — the parent stays open until all relevant children resolve.',
  },
  {
    kind: 'references',
    label: 'Achieved by plan',
    targetSource: 'cart/app/gallery/data/plan.ts',
    sourceField: 'achievedByPlanId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Reframed-to goal',
    targetSource: 'cart/app/gallery/data/goal.ts',
    sourceField: 'reframedToGoalId',
    targetField: 'id',
    summary:
      'Reframing is honest abandonment with a forwarding address — keeps the original goal recoverable as context.',
  },
  {
    kind: 'has-many',
    label: 'Tasks (denormalized goal pointer)',
    targetSource: 'cart/app/gallery/data/task.ts',
    sourceField: 'id',
    targetField: 'goalId',
    summary:
      'Tasks may carry a denormalized goalId so a worker picking up a task in isolation can resolve "what is this for, originally" in one read instead of walking up to the Plan.',
  },
  {
    kind: 'references',
    label: 'Outcome rubric',
    targetSource: 'cart/app/gallery/data/outcome-rubric.ts',
    sourceField: 'outcomeRubricId',
    targetField: 'id',
    summary:
      'The recognition contract for this Goal. Workers self-check proposed adjustments against it; user rejections cite specific dimensions.',
  },
  {
    kind: 'references',
    label: 'Reference artifacts → Interpretation',
    targetSource: 'cart/app/gallery/data/interpretation.ts',
    sourceField: 'referenceArtifacts[].interpretedByInterpretationId',
    targetField: 'id',
    summary:
      'Each reference artifact (screenshot, link, code) is processed by a model into rubric dimensions. The Interpretation row records that reasoning pass.',
  },
];
