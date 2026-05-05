// ManifestDimensionDef — catalog of canonical dimensions tracked on
// the user manifest.
//
// Each definition is a *named axis* the assistant tries to understand
// the user along (communication style, decision drivers, value
// hierarchy, …). The catalog is curated reference data — adding a
// dimension means committing to a way the assistant might calibrate
// against it. The user-manifest.ts row holds the user's *current
// values* against these dimensions, with confidence scores.
//
// ── coverageWeight ─────────────────────────────────────────────────
// Drives the quiz engine's sampling priority. When a dimension's
// confidence is low and its coverageWeight is high, the engine
// over-samples it in the next quiz (PRD §3.2 "Confidence Scoring").
// Mid-confidence + low-weight dimensions stay quiet.

import type { GalleryDataReference, JsonObject } from '../../types';

export type ManifestDimensionAxis = 'bipolar' | 'multipolar' | 'categorical' | 'scalar';

export type ManifestDimensionDef = {
  id: string;
  label: string;
  description: string;
  axis: ManifestDimensionAxis;
  /** For categorical / multipolar dimensions, the legal option strings. */
  options?: string[];
  /** For bipolar dimensions, the two pole labels. */
  poles?: { left: string; right: string };
  valueWhenMissing?: string | number;
  /** 0..1 — sampling priority when confidence is low. */
  coverageWeight: number;
  createdAt: string;
  updatedAt: string;
};

const ts = '2026-05-02T00:00:00Z';

export const manifestDimensionDefMockData: ManifestDimensionDef[] = [
  {
    id: 'dim_communication_style',
    label: 'Communication style',
    description: 'How the user phrases input. Terse / verbose / emotional / clinical.',
    axis: 'multipolar',
    options: ['terse', 'verbose', 'emotional', 'clinical', 'narrative'],
    coverageWeight: 0.9,
    valueWhenMissing: 'terse',
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dim_decision_drivers',
    label: 'Decision drivers',
    description: 'What the user prioritizes when making a call. Gut / data / social proof / principle.',
    axis: 'multipolar',
    options: ['gut', 'data', 'social-proof', 'principle', 'precedent'],
    coverageWeight: 0.7,
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dim_stress_responses',
    label: 'Stress responses',
    description: 'How the user behaves under pressure. Withdraw / attack / deflect / solve.',
    axis: 'multipolar',
    options: ['withdraw', 'attack', 'deflect', 'solve', 'narrate'],
    coverageWeight: 0.6,
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dim_curiosity_patterns',
    label: 'Curiosity patterns',
    description: 'Breadth-vs-depth and safe-vs-fringe disposition of the user\'s curiosity.',
    axis: 'bipolar',
    poles: { left: 'breadth-fringe', right: 'depth-safe' },
    coverageWeight: 0.5,
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dim_value_hierarchy',
    label: 'Value hierarchy',
    description: 'Top-N values the user repeatedly invokes. Achievement / connection / stability / novelty / control.',
    axis: 'categorical',
    options: ['achievement', 'connection', 'stability', 'novelty', 'control', 'craft', 'autonomy'],
    coverageWeight: 0.85,
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dim_humor_alignment',
    label: 'Humor alignment',
    description: 'Which humor flavors land. Dark / wholesome / absurd / dry / none.',
    axis: 'multipolar',
    options: ['dark', 'wholesome', 'absurd', 'dry', 'self-deprecating', 'none'],
    coverageWeight: 0.55,
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dim_trust_cadence',
    label: 'Trust cadence',
    description: 'How quickly the user grants trust. Instant / earned / rare / never.',
    axis: 'bipolar',
    poles: { left: 'instant', right: 'never' },
    coverageWeight: 0.7,
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dim_argument_style',
    label: 'Argument style',
    description: 'How the user engages with disagreement. Combat / discuss / avoid / mediate.',
    axis: 'multipolar',
    options: ['combat', 'discuss', 'avoid', 'mediate', 'pivot'],
    coverageWeight: 0.65,
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dim_metaphor_affinity',
    label: 'Metaphor affinity',
    description:
      'Which metaphor families the user picks up vs bounces off. Used by the quiz engine\'s reframing pass to choose the next question\'s metaphor scaffold.',
    axis: 'categorical',
    options: ['music', 'cooking', 'gaming', 'nautical', 'sports', 'plants', 'machinery', 'narrative'],
    coverageWeight: 0.4,
    createdAt: ts,
    updatedAt: ts,
  },
];

export const manifestDimensionDefSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ManifestDimensionDef',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label', 'description', 'axis', 'coverageWeight', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      description: { type: 'string' },
      axis: { type: 'string', enum: ['bipolar', 'multipolar', 'categorical', 'scalar'] },
      options: { type: 'array', items: { type: 'string' } },
      poles: {
        type: 'object',
        additionalProperties: false,
        required: ['left', 'right'],
        properties: {
          left: { type: 'string' },
          right: { type: 'string' },
        },
      },
      valueWhenMissing: { type: ['string', 'number'] },
      coverageWeight: { type: 'number', minimum: 0, maximum: 1 },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const manifestDimensionDefReferences: GalleryDataReference[] = [
  {
    kind: 'has-many',
    label: 'ManifestDimension instances',
    targetSource: 'cart/app/gallery/data/user-manifest.ts',
    sourceField: 'id',
    targetField: 'dimensions[].dimensionId',
    summary: 'Each user-manifest dimension entry references one definition.',
  },
  {
    kind: 'has-many',
    label: 'Quiz sessions targeting',
    targetSource: 'cart/app/gallery/data/quiz-session.ts',
    sourceField: 'id',
    targetField: 'dimensionsTargeted[]',
  },
];
