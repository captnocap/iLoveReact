// CharacterCompatibility — derived friction / match score between a
// Character and a UserManifest.
//
// ── Why a row, not a pure function ─────────────────────────────
// The score IS computed from the two inputs, but storing the result
// lets the UI show *frozen* friction alerts (with their evidence
// quiz pointers) without recomputing on every render. The
// `computedAt` timestamp says when the snapshot is from; if either
// side has changed since, the UI flags the row as stale and a
// recompute is queued.
//
// ── Friction examples ─────────────────────────────────────────
// - chaotic-sibling stance × 'never' trust cadence
// - high adversarial dial × 'avoid' argument style
// - high pun_frequency × 'none' humor alignment
// - 'silent' initiative profile × 'verbose' communication style
// (the user prefers being talked-to, the character won't)

import type { GalleryDataReference, JsonObject } from '../../types';

export type CompatibilityFrictionSeverity = 'soft' | 'hard';

export type FrictionAlert = {
  /** ManifestDimensionDef.id the friction reads against. */
  dimensionId: string;
  severity: CompatibilityFrictionSeverity;
  description: string;
  evidenceQuizIds: string[];
};

export type RecommendedAdjustmentTargetKind = 'dial' | 'archetype' | 'quirk' | 'stance' | 'initiative' | 'correction';

export type RecommendedAdjustment = {
  targetKind: RecommendedAdjustmentTargetKind;
  /** Id of the dial / archetype / quirk / stance enum value. */
  targetId: string;
  currentValue: string | number;
  suggestedValue: string | number;
  reason: string;
};

export type CharacterCompatibility = {
  id: string;
  characterId: string;
  userManifestId: string;
  /** 0..1 — higher means lower friction. */
  alignmentScore: number;
  frictionAlerts: FrictionAlert[];
  recommendedAdjustments: RecommendedAdjustment[];
  computedAt: string;
};

export const characterCompatibilityMockData: CharacterCompatibility[] = [
  {
    id: 'compat_default_local',
    characterId: 'char_default',
    userManifestId: 'manifest_local',
    alignmentScore: 0.87,
    frictionAlerts: [],
    recommendedAdjustments: [],
    computedAt: '2026-05-01T22:02:30Z',
  },
  {
    id: 'compat_chaos_local',
    characterId: 'char_chaos_sibling',
    userManifestId: 'manifest_local',
    alignmentScore: 0.42,
    frictionAlerts: [
      {
        dimensionId: 'dim_communication_style',
        severity: 'hard',
        description:
          'User\'s communication style reads terse with high confidence; this character\'s pun + bracketed-aside quirks land as noise rather than warmth.',
        evidenceQuizIds: ['quiz_obsolete_file_format', 'quiz_gas_station_snack'],
      },
      {
        dimensionId: 'dim_humor_alignment',
        severity: 'soft',
        description:
          'Manifest reads dry humor at modest confidence with one contradictory signal. Loud roast + pun dials may overshoot before the manifest stabilizes.',
        evidenceQuizIds: ['quiz_pressure_metaphor'],
      },
    ],
    recommendedAdjustments: [
      {
        targetKind: 'dial',
        targetId: 'dial_pun_frequency',
        currentValue: 0.85,
        suggestedValue: 0.4,
        reason: 'Hold the puns until manifest humor confidence > 0.7.',
      },
      {
        targetKind: 'dial',
        targetId: 'dial_concise_elaborate',
        currentValue: 0.45,
        suggestedValue: 0.25,
        reason: 'User reads as terse — keep the chaos but trim the wordcount.',
      },
      {
        targetKind: 'stance',
        targetId: 'chaotic-sibling',
        currentValue: 'chaotic-sibling',
        suggestedValue: 'friend',
        reason: 'Trust cadence is "earned" at low confidence; lean closer to friend until trust stabilizes.',
      },
    ],
    computedAt: '2026-05-01T22:02:35Z',
  },
];

export const characterCompatibilitySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CharacterCompatibility',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'characterId',
      'userManifestId',
      'alignmentScore',
      'frictionAlerts',
      'recommendedAdjustments',
      'computedAt',
    ],
    properties: {
      id: { type: 'string' },
      characterId: { type: 'string' },
      userManifestId: { type: 'string' },
      alignmentScore: { type: 'number', minimum: 0, maximum: 1 },
      frictionAlerts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['dimensionId', 'severity', 'description', 'evidenceQuizIds'],
          properties: {
            dimensionId: { type: 'string' },
            severity: { type: 'string', enum: ['soft', 'hard'] },
            description: { type: 'string' },
            evidenceQuizIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      recommendedAdjustments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['targetKind', 'targetId', 'currentValue', 'suggestedValue', 'reason'],
          properties: {
            targetKind: {
              type: 'string',
              enum: ['dial', 'archetype', 'quirk', 'stance', 'initiative', 'correction'],
            },
            targetId: { type: 'string' },
            currentValue: { type: ['string', 'number'] },
            suggestedValue: { type: ['string', 'number'] },
            reason: { type: 'string' },
          },
        },
      },
      computedAt: { type: 'string' },
    },
  },
};

export const characterCompatibilityReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Character',
    targetSource: 'cart/app/gallery/data/character.ts',
    sourceField: 'characterId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'User manifest',
    targetSource: 'cart/app/gallery/data/user-manifest.ts',
    sourceField: 'userManifestId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Dimensions surfaced',
    targetSource: 'cart/app/gallery/data/manifest-dimension.ts',
    sourceField: 'frictionAlerts[].dimensionId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Evidence quizzes',
    targetSource: 'cart/app/gallery/data/quiz-session.ts',
    sourceField: 'frictionAlerts[].evidenceQuizIds[]',
    targetField: 'id',
  },
];
