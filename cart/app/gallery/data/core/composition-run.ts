// CompositionRun — one execution of a multi-stage Composition (the
// spec's stage-orchestrator concept; not to be confused with our
// `prompt-composition.ts` row, which is the prompt-assembly composer).
//
// Per-execution snapshots, not refs. The frozen plan, the constraints
// in effect, the pathology floor — all snapshotted into JSONB columns
// so editing a Recipe later does not silently rewrite history of runs
// that used it.
//
// Runs end on verified completion (the gate cascade in the spec). The
// `terminationCause` records *why* — pass / fail / regress /
// plan-insufficient / pathology-halt / budget-exhausted / user-cancel.
//
// `convergenceData` records the dialectic-loop outcome: how many
// branches diverged, how many converged, whether cross-family
// agreement was reached. Used for calibration.

import type { GalleryDataReference, JsonObject } from '../../types';

export type CompositionRunStatus =
  | 'queued'
  | 'stage1-planning'
  | 'stage1-frozen' // plan + constraints frozen, ready to execute
  | 'stage2-executing'
  | 'stage3-verifying'
  | 'completed'
  | 'failed'
  | 'halted'
  | 'cancelled';

export type CompositionRunTerminationCause =
  | 'pass'
  | 'fail-constraint'
  | 'fail-pathology'
  | 'fail-verifier'
  | 'regress' // bounce back to stage 2 within budget
  | 'plan-insufficient' // stage-3 verdict
  | 'budget-exhausted'
  | 'pathology-halt'
  | 'user-cancel'
  | 'still-running';

export type CompositionRunVerdict = 'pass' | 'fail' | 'regress' | 'plan-insufficient';

export type CompositionRunConvergence = {
  /** Number of independent branches Stage 2 spawned. */
  branchCount: number;
  /** Number that reached the same conclusion. */
  agreementCount: number;
  /** Cross-model-family agreements (independent reasoning signal). */
  crossFamilyAgreementCount: number;
  /** Adversarial-check outcome when one was run. */
  adversarialCheckOutcome?: 'confirmed' | 'overturned' | 'inconclusive';
};

export type CompositionRunUserAcceptance = {
  verdict: 'accepted' | 'rejected' | 'partial' | 'unrated';
  /** Cite specific rubric dimensions when verdict='partial'. */
  citedDimensionIds?: string[];
  note?: string;
  recordedAt: string;
};

export type CompositionRun = {
  id: string;
  /** FK → composition.ts (the future stage-orchestrator entity). For
   *  now, may point at a Plan + recipe combination via planId/recipeId. */
  compositionId?: string;
  planId?: string;
  goalId?: string;
  workspaceId?: string;
  /** Snapshots — frozen at run start. */
  stage1RecipeSnapshot: Record<string, unknown>;
  stage2ConfigSnapshot: Record<string, unknown>;
  stage3RecipeSnapshot: Record<string, unknown>;
  /** Constraint id list snapshotted. The actual rows are read from the
   *  constraint store at evaluation time, but the *set* is frozen here. */
  constraintIdsSnapshot: string[];
  /** Pathology id list active at run start. */
  pathologyIdsSnapshot: string[];
  status: CompositionRunStatus;
  verdict?: CompositionRunVerdict;
  terminationCause: CompositionRunTerminationCause;
  /** How many regression bounces happened before final verdict. */
  regressionCount: number;
  convergenceData?: CompositionRunConvergence;
  /** User's calibration ground truth — recorded post-completion. */
  userAcceptance?: CompositionRunUserAcceptance;
  workerIds: string[];
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  costUsd?: number;
};

export const compositionRunMockData: CompositionRun[] = [
  {
    id: 'crun_001',
    planId: 'plan_gallery_data_shapes',
    goalId: 'goal_data_shape_catalog',
    workspaceId: 'ws_reactjit',
    stage1RecipeSnapshot: { recipeId: 'rec_plan_gallery_v1', frozen: true },
    stage2ConfigSnapshot: { workerCount: 3, retryBudget: 2 },
    stage3RecipeSnapshot: { verifierFamily: 'fam_gpt_5', mode: 'cold-read' },
    constraintIdsSnapshot: ['cnst_no_force_push_main', 'cnst_frozen_dirs', 'cnst_phase4_no_existing_rewrite'],
    pathologyIdsSnapshot: ['pat_session_kill_pattern', 'pat_indiscriminate_stage', 'pat_skip_hooks', 'pat_explore_in_repo'],
    status: 'completed',
    verdict: 'pass',
    terminationCause: 'pass',
    regressionCount: 0,
    convergenceData: { branchCount: 1, agreementCount: 1, crossFamilyAgreementCount: 0 },
    workerIds: ['w1'],
    startedAt: '2026-04-24T08:00:00Z',
    endedAt: '2026-04-24T09:35:00Z',
    durationMs: 5_700_000,
    costUsd: 1.42,
  },
];

export const compositionRunSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CompositionRun',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'stage1RecipeSnapshot', 'stage2ConfigSnapshot', 'stage3RecipeSnapshot', 'constraintIdsSnapshot', 'pathologyIdsSnapshot', 'status', 'terminationCause', 'regressionCount', 'workerIds', 'startedAt'],
    properties: {
      id: { type: 'string' },
      compositionId: { type: 'string' },
      planId: { type: 'string' },
      goalId: { type: 'string' },
      workspaceId: { type: 'string' },
      stage1RecipeSnapshot: { type: 'object', additionalProperties: true },
      stage2ConfigSnapshot: { type: 'object', additionalProperties: true },
      stage3RecipeSnapshot: { type: 'object', additionalProperties: true },
      constraintIdsSnapshot: { type: 'array', items: { type: 'string' } },
      pathologyIdsSnapshot: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: ['queued', 'stage1-planning', 'stage1-frozen', 'stage2-executing', 'stage3-verifying', 'completed', 'failed', 'halted', 'cancelled'] },
      verdict: { type: 'string', enum: ['pass', 'fail', 'regress', 'plan-insufficient'] },
      terminationCause: {
        type: 'string',
        enum: ['pass', 'fail-constraint', 'fail-pathology', 'fail-verifier', 'regress', 'plan-insufficient', 'budget-exhausted', 'pathology-halt', 'user-cancel', 'still-running'],
      },
      regressionCount: { type: 'number' },
      convergenceData: {
        type: 'object',
        additionalProperties: false,
        required: ['branchCount', 'agreementCount', 'crossFamilyAgreementCount'],
        properties: {
          branchCount: { type: 'number' },
          agreementCount: { type: 'number' },
          crossFamilyAgreementCount: { type: 'number' },
          adversarialCheckOutcome: { type: 'string', enum: ['confirmed', 'overturned', 'inconclusive'] },
        },
      },
      userAcceptance: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict', 'recordedAt'],
        properties: {
          verdict: { type: 'string', enum: ['accepted', 'rejected', 'partial', 'unrated'] },
          citedDimensionIds: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
          recordedAt: { type: 'string' },
        },
      },
      workerIds: { type: 'array', items: { type: 'string' } },
      startedAt: { type: 'string' },
      endedAt: { type: 'string' },
      durationMs: { type: 'number' },
      costUsd: { type: 'number' },
    },
  },
};

export const compositionRunReferences: GalleryDataReference[] = [
  { kind: 'references', label: 'Plan', targetSource: 'cart/app/gallery/data/core/plan.ts', sourceField: 'planId', targetField: 'id' },
  { kind: 'references', label: 'Goal', targetSource: 'cart/app/gallery/data/core/goal.ts', sourceField: 'goalId', targetField: 'id' },
  { kind: 'references', label: 'Workers', targetSource: 'cart/app/gallery/data/core/worker.ts', sourceField: 'workerIds[]', targetField: 'id' },
  {
    kind: 'has-many',
    label: 'Plan deviations',
    targetSource: 'cart/app/gallery/data/core/plan-deviation.ts',
    sourceField: 'id',
    targetField: 'compositionRunId',
  },
  {
    kind: 'has-many',
    label: 'Supervisor judgments',
    targetSource: 'cart/app/gallery/data/core/supervisor-judgment.ts',
    sourceField: 'id',
    targetField: 'compositionRunId',
  },
];
