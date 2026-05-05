// SupervisorJudgment — per-judgment record from the supervisor.
//
// Three independent axes (the spec's two-axis adjudication plus the
// pathology track):
//   - planAdherence: 'on-plan' | 'off-plan'
//   - constraintCompliance: 'compliant' | 'violated' | 'unclear'
//   - pathologyCompliance: 'clean' | 'detected'
//
// Plan adherence is informational. Constraint compliance is the actual
// gate. Pathology runs in parallel and can halt regardless of the
// other two.
//
// `constraintsEvaluated[]` makes the judgment auditable — for each
// constraint id, what the supervisor concluded. Lets the verifier
// cross-check whether a "compliant" verdict actually examined the
// load-bearing constraint.

import type { GalleryDataReference, JsonObject } from '../../types';

export type PlanAdherence = 'on-plan' | 'off-plan';
export type ConstraintCompliance = 'compliant' | 'violated' | 'unclear';
export type PathologyCompliance = 'clean' | 'detected';

export type SupervisorVerdict =
  | 'nominal' // on-plan + compliant + clean
  | 'plan-was-wrong' // on-plan + violated → reserialize
  | 'valid-pivot' // off-plan + compliant → log + continue
  | 'invalid-pivot' // off-plan + violated → reject + halt
  | 'pathology-halt' // pathology fired → halt regardless
  | 'unclear-needs-clarification';

export type SupervisorConstraintEvaluation = {
  constraintId: string;
  verdict: 'pass' | 'fail' | 'unclear';
  evidence?: string;
};

export type SupervisorJudgment = {
  id: string;
  compositionRunId: string;
  /** The Worker step / output being judged. */
  workerId: string;
  /** Pointer at the artifact being judged: a ModelOutput id, a
   *  VerbInvocation id, or a PlanDeviation id. Polymorphic via subjectKind. */
  subjectKind: 'model-output' | 'verb-invocation' | 'plan-deviation' | 'tool-call';
  subjectId: string;
  /** Model that produced the judgment (the supervisor's own model). */
  judgedByModelId: string;
  /** Three-axis evaluation. */
  planAdherence: PlanAdherence;
  constraintCompliance: ConstraintCompliance;
  pathologyCompliance: PathologyCompliance;
  /** Per-constraint breakdown. The supervisor must examine each
   *  load-bearing constraint and record a verdict. */
  constraintsEvaluated: SupervisorConstraintEvaluation[];
  verdict: SupervisorVerdict;
  reasoning: string;
  /** When verdict='pathology-halt', which pathology fired. */
  triggeredPathologyDetectionId?: string;
  judgedAt: string;
  durationMs?: number;
};

export const supervisorJudgmentMockData: SupervisorJudgment[] = [
  {
    id: 'sjudg_001',
    compositionRunId: 'crun_001',
    workerId: 'w1',
    subjectKind: 'plan-deviation',
    subjectId: 'pdev_001',
    judgedByModelId: 'claude-opus-4-7',
    planAdherence: 'off-plan',
    constraintCompliance: 'compliant',
    pathologyCompliance: 'clean',
    constraintsEvaluated: [
      { constraintId: 'cnst_phase4_no_existing_rewrite', verdict: 'pass', evidence: 'Adjustment cuts mock rows; does not rewrite existing shape files.' },
      { constraintId: 'cnst_catalog_goal_no_breakage', verdict: 'pass', evidence: 'Existing shape stories unaffected.' },
    ],
    verdict: 'valid-pivot',
    reasoning: 'Off-plan adjustment is constraint-compliant and improves catalog quality. Approved.',
    judgedAt: '2026-04-25T09:40:25Z',
    durationMs: 1_800,
  },
];

export const supervisorJudgmentSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SupervisorJudgment',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'compositionRunId', 'workerId', 'subjectKind', 'subjectId', 'judgedByModelId', 'planAdherence', 'constraintCompliance', 'pathologyCompliance', 'constraintsEvaluated', 'verdict', 'reasoning', 'judgedAt'],
    properties: {
      id: { type: 'string' },
      compositionRunId: { type: 'string' },
      workerId: { type: 'string' },
      subjectKind: { type: 'string', enum: ['model-output', 'verb-invocation', 'plan-deviation', 'tool-call'] },
      subjectId: { type: 'string' },
      judgedByModelId: { type: 'string' },
      planAdherence: { type: 'string', enum: ['on-plan', 'off-plan'] },
      constraintCompliance: { type: 'string', enum: ['compliant', 'violated', 'unclear'] },
      pathologyCompliance: { type: 'string', enum: ['clean', 'detected'] },
      constraintsEvaluated: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['constraintId', 'verdict'],
          properties: {
            constraintId: { type: 'string' },
            verdict: { type: 'string', enum: ['pass', 'fail', 'unclear'] },
            evidence: { type: 'string' },
          },
        },
      },
      verdict: {
        type: 'string',
        enum: ['nominal', 'plan-was-wrong', 'valid-pivot', 'invalid-pivot', 'pathology-halt', 'unclear-needs-clarification'],
      },
      reasoning: { type: 'string' },
      triggeredPathologyDetectionId: { type: 'string' },
      judgedAt: { type: 'string' },
      durationMs: { type: 'number' },
    },
  },
};

export const supervisorJudgmentReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Composition run', targetSource: 'cart/app/gallery/data/core/composition-run.ts', sourceField: 'compositionRunId', targetField: 'id' },
  { kind: 'belongs-to', label: 'Worker', targetSource: 'cart/app/gallery/data/core/worker.ts', sourceField: 'workerId', targetField: 'id' },
  { kind: 'references', label: 'Judging model', targetSource: 'cart/app/gallery/data/core/model.ts', sourceField: 'judgedByModelId', targetField: 'id' },
  {
    kind: 'references',
    label: 'Constraints evaluated',
    targetSource: 'cart/app/gallery/data/core/constraint.ts',
    sourceField: 'constraintsEvaluated[].constraintId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Triggered pathology detection',
    targetSource: 'cart/app/gallery/data/core/pathology-detection.ts',
    sourceField: 'triggeredPathologyDetectionId',
    targetField: 'id',
  },
];
