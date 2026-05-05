// UserManifest — the assistant's evolving read of the user.
//
// Distinct from `User.preferences.accommodations[]` (the *declared*
// trait list captured by onboarding Step 3). The manifest is the
// *inferred* model the assistant builds over time through quizzes,
// conversational moments, and explicit confirmations.
//
// ── Confidence per dimension ───────────────────────────────────
// Each dimension carries a 0..1 confidence score. Low confidence
// drives the quiz engine to over-sample (anti-repetition + coverage
// logic lives on quiz-session.ts and manifest-dimension.ts). High
// confidence + a contradicting answer triggers the anomaly-detection
// lane: queue a gentle re-check quiz rather than silently overwrite.
//
// ── Provenance ──────────────────────────────────────────────────
// `sourceQuizIds` and `contradictoryQuizIds` keep an audit trail. A
// dimension with one source and zero contradictions reads as a
// fresh inference; one with five sources and one contradiction
// reads as a stable read with a flagged anomaly.

import type { GalleryDataReference, JsonObject } from '../../types';

export type ManifestDimension = {
  dimensionId: string;
  /** Free string — the value space depends on the dimension's axis. */
  currentValue: string | number;
  confidence: number;
  lastReinforcedAt: string;
  sourceQuizIds: string[];
  contradictoryQuizIds: string[];
  provenanceNote?: string;
};

export type UserManifest = {
  id: string;
  userId: string;
  version: number;
  dimensions: ManifestDimension[];
  /** Free-form themes the assistant has noticed across sessions. */
  recurringThemes: string[];
  lastQuizAt?: string;
  createdAt: string;
  updatedAt: string;
};

export const userManifestMockData: UserManifest[] = [
  {
    id: 'manifest_local',
    userId: 'user_local',
    version: 4,
    dimensions: [
      {
        dimensionId: 'dim_communication_style',
        currentValue: 'terse',
        confidence: 0.92,
        lastReinforcedAt: '2026-05-01T10:30:00Z',
        sourceQuizIds: ['quiz_obsolete_file_format', 'quiz_gas_station_snack', 'quiz_island_item'],
        contradictoryQuizIds: [],
        provenanceNote: 'Reinforced across three unrelated quizzes; high confidence.',
      },
      {
        dimensionId: 'dim_decision_drivers',
        currentValue: 'principle',
        confidence: 0.7,
        lastReinforcedAt: '2026-04-30T18:00:00Z',
        sourceQuizIds: ['quiz_island_item'],
        contradictoryQuizIds: [],
      },
      {
        dimensionId: 'dim_stress_responses',
        currentValue: 'solve',
        confidence: 0.55,
        lastReinforcedAt: '2026-04-29T11:00:00Z',
        sourceQuizIds: ['quiz_pressure_metaphor'],
        contradictoryQuizIds: [],
      },
      {
        dimensionId: 'dim_curiosity_patterns',
        currentValue: 'depth-safe',
        confidence: 0.6,
        lastReinforcedAt: '2026-04-28T08:15:00Z',
        sourceQuizIds: ['quiz_obsolete_file_format'],
        contradictoryQuizIds: [],
      },
      {
        dimensionId: 'dim_value_hierarchy',
        currentValue: 'craft',
        confidence: 0.8,
        lastReinforcedAt: '2026-05-01T22:00:00Z',
        sourceQuizIds: ['quiz_gas_station_snack', 'quiz_island_item'],
        contradictoryQuizIds: [],
        provenanceNote: 'Both metaphor scaffolds landed on craft over achievement.',
      },
      {
        dimensionId: 'dim_humor_alignment',
        currentValue: 'dry',
        confidence: 0.45,
        lastReinforcedAt: '2026-04-27T20:00:00Z',
        sourceQuizIds: ['quiz_pressure_metaphor'],
        contradictoryQuizIds: ['quiz_obsolete_file_format'],
        provenanceNote:
          'One quiz read dry, one read absurd. Manifest holds dry pending a re-check quiz.',
      },
      {
        dimensionId: 'dim_trust_cadence',
        currentValue: 'earned',
        confidence: 0.4,
        lastReinforcedAt: '2026-04-26T14:00:00Z',
        sourceQuizIds: ['quiz_island_item'],
        contradictoryQuizIds: [],
      },
      {
        dimensionId: 'dim_argument_style',
        currentValue: 'discuss',
        confidence: 0.35,
        lastReinforcedAt: '2026-04-25T17:00:00Z',
        sourceQuizIds: [],
        contradictoryQuizIds: [],
        provenanceNote: 'Inferred from conversation rather than a quiz; low confidence.',
      },
      {
        dimensionId: 'dim_metaphor_affinity',
        currentValue: 'cooking',
        confidence: 0.5,
        lastReinforcedAt: '2026-05-01T22:00:00Z',
        sourceQuizIds: ['quiz_gas_station_snack'],
        contradictoryQuizIds: [],
      },
    ],
    recurringThemes: [
      'Goal-shaped input, not implementation-shaped',
      'Dislikes verbose answers regardless of correctness',
      'Tracks outcomes by behavior over code-reading',
    ],
    lastQuizAt: '2026-05-01T22:00:00Z',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-05-01T22:00:00Z',
  },
];

export const userManifestSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'UserManifest',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'userId', 'version', 'dimensions', 'recurringThemes', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      version: { type: 'integer', minimum: 1 },
      dimensions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'dimensionId',
            'currentValue',
            'confidence',
            'lastReinforcedAt',
            'sourceQuizIds',
            'contradictoryQuizIds',
          ],
          properties: {
            dimensionId: { type: 'string' },
            currentValue: { type: ['string', 'number'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            lastReinforcedAt: { type: 'string' },
            sourceQuizIds: { type: 'array', items: { type: 'string' } },
            contradictoryQuizIds: { type: 'array', items: { type: 'string' } },
            provenanceNote: { type: 'string' },
          },
        },
      },
      recurringThemes: { type: 'array', items: { type: 'string' } },
      lastQuizAt: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const userManifestReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'User',
    targetSource: 'cart/app/gallery/data/user.ts',
    sourceField: 'userId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Dimension definitions',
    targetSource: 'cart/app/gallery/data/manifest-dimension.ts',
    sourceField: 'dimensions[].dimensionId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Quiz sessions',
    targetSource: 'cart/app/gallery/data/quiz-session.ts',
    sourceField: 'id',
    targetField: 'userManifestId',
  },
  {
    kind: 'references',
    label: 'Source quizzes (per dimension)',
    targetSource: 'cart/app/gallery/data/quiz-session.ts',
    sourceField: 'dimensions[].sourceQuizIds[]',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Contradictory quizzes (per dimension)',
    targetSource: 'cart/app/gallery/data/quiz-session.ts',
    sourceField: 'dimensions[].contradictoryQuizIds[]',
    targetField: 'id',
    summary:
      'When a quiz answer disagrees with the current manifest value, it lands here rather than overwriting. The anomaly-detection lane queues a re-check quiz to resolve.',
  },
];
