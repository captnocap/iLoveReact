// PlanDeviation — per-divergence event during a CompositionRun's
// Stage 2 (execute).
//
// When the actual execution diverges from the frozen plan, the worker
// must emit a PlanDeviation row. The supervisor judges whether the
// pivot was valid (constraint-compliant, plan-consistent in spirit) or
// invalid (rejection material). Either way the run continues only if
// constraint compliance still holds.

import type { GalleryDataReference, JsonObject } from '../../types';

export type PlanDeviationCategory =
  | 'step-skipped'
  | 'step-added'
  | 'step-replaced'
  | 'order-changed'
  | 'scope-widened'
  | 'scope-narrowed'
  | 'tool-substituted'
  | 'goal-clarified'
  | 'unexpected-condition';

export type PlanDeviationResolution =
  | 'pending'
  | 'approved-pivot'
  | 'rejected-halt'
  | 'reserialized' // halted, replanned, run restarted
  | 'auto-resolved';

export type PlanDeviation = {
  id: string;
  compositionRunId: string;
  workerId: string;
  /** Step in the frozen plan this deviation is rooted at. */
  planStepRef: string;
  category: PlanDeviationCategory;
  expected: string;
  encountered: string;
  /** Worker's proposed adjustment. */
  proposedAdjustment: string;
  /** Worker's stated reason. The supervisor reads this for adversarial-compliance check. */
  reasoning?: string;
  /** Constraint compliance — derived, not the deviation's own choice. */
  constraintCompliant: boolean;
  resolution: PlanDeviationResolution;
  resolutionNote?: string;
  detectedAt: string;
  resolvedAt?: string;
};

export const planDeviationMockData: PlanDeviation[] = [
  {
    id: 'pdev_001',
    compositionRunId: 'crun_001',
    workerId: 'w1',
    planStepRef: 'phase_planning_and_tasks/step3',
    category: 'step-replaced',
    expected: 'Add Composition + CompositionSourceKind shape rows (planned step).',
    encountered: 'Two of the planned mock rows would have identical shapes.',
    proposedAdjustment: 'Cut from 10 mock rows to 8.',
    reasoning: 'Identical shapes add zero diversity to the catalog and bloat the gallery.',
    constraintCompliant: true,
    resolution: 'approved-pivot',
    resolutionNote: 'Supervisor approved — does not affect goal fidelity.',
    detectedAt: '2026-04-25T09:40:00Z',
    resolvedAt: '2026-04-25T09:40:30Z',
  },
];

export const planDeviationSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'PlanDeviation',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'compositionRunId', 'workerId', 'planStepRef', 'category', 'expected', 'encountered', 'proposedAdjustment', 'constraintCompliant', 'resolution', 'detectedAt'],
    properties: {
      id: { type: 'string' },
      compositionRunId: { type: 'string' },
      workerId: { type: 'string' },
      planStepRef: { type: 'string' },
      category: {
        type: 'string',
        enum: ['step-skipped', 'step-added', 'step-replaced', 'order-changed', 'scope-widened', 'scope-narrowed', 'tool-substituted', 'goal-clarified', 'unexpected-condition'],
      },
      expected: { type: 'string' },
      encountered: { type: 'string' },
      proposedAdjustment: { type: 'string' },
      reasoning: { type: 'string' },
      constraintCompliant: { type: 'boolean' },
      resolution: {
        type: 'string',
        enum: ['pending', 'approved-pivot', 'rejected-halt', 'reserialized', 'auto-resolved'],
      },
      resolutionNote: { type: 'string' },
      detectedAt: { type: 'string' },
      resolvedAt: { type: 'string' },
    },
  },
};

export const planDeviationReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Composition run', targetSource: 'cart/app/gallery/data/core/composition-run.ts', sourceField: 'compositionRunId', targetField: 'id' },
  { kind: 'belongs-to', label: 'Worker', targetSource: 'cart/app/gallery/data/core/worker.ts', sourceField: 'workerId', targetField: 'id' },
];
