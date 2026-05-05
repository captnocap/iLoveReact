// OutcomeRubric — multi-dimensional model of "what good looks like" for
// a Goal (or Plan or Task). The recognition contract that lets the
// agent self-check proposed adjustments and lets the user reject
// them with a non-arbitrary basis.
//
// ── Why dimensions are not enough on their own ────────────────────
// A flat dimension list ("salt level: balanced") doesn't survive
// real-world judgment. The user might tolerate bland spaghetti but
// will not tolerate "served french fries instead." That all-or-
// nothing recognition test is the gestaltInvariant — if violated,
// the goal is failed regardless of how the dimensions scored.
//
// ── Posture is the load-bearing field ──────────────────────────
// Every dimension carries a `posture` that tells the agent how to
// treat it during execution:
//   invariant  — never violate. Triggers reframe-goal if hit.
//   strict     — user specified; deviation needs explicit approval.
//   preferred  — soft target; deviation needs cause.
//   delegated  — user trusts agent judgment; deliver without asking.
//   unknown    — user can't specify; agent decides freely.
// Same dimension across two Goals can have different postures —
// "noodle brand" is delegated for spaghetti, strict for an Italian
// grandmother's birthday dinner.
//
// ── Source tracks where each dimension came from ────────────────
//   user-stated         — explicit verbal/written from user
//   inferred-from-reference — extracted from an attached image/link
//   agent-derived       — agent inferred from goal context
//   episode-learned     — promoted from a past EpisodicMemory.lesson
// Resolver weights user-stated > inferred-from-reference >
// episode-learned > agent-derived when conflicts arise.

import type { GalleryDataReference, JsonObject } from '../../types';

export type RubricScopeKind = 'goal' | 'plan' | 'task';

export type RubricDimensionKind =
  | 'foundational' // must be present
  | 'structural' // shape / form / layout
  | 'behavioral' // acts like X
  | 'sensory' // looks / feels / reads / tastes
  | 'quality' // good not just complete
  | 'anti-pattern'; // known failure mode

export type RubricDimensionPosture =
  | 'invariant' // never violate; gestalt-grade
  | 'strict' // user spec; deviation needs approval
  | 'preferred' // soft target; deviation needs cause
  | 'delegated' // user trusts agent; deliver
  | 'unknown'; // user can't specify; agent decides

export type RubricDimensionSource =
  | 'user-stated'
  | 'inferred-from-reference'
  | 'agent-derived'
  | 'episode-learned';

export type RubricDimensionWeight = 'critical' | 'important' | 'nice-to-have';

export type RubricEvaluationMode = 'human-judgment' | 'automated-check' | 'both';

export type RubricUserKnowledgeLevel =
  | 'specific' // user knows exactly what good is
  | 'rough' // user has a rough idea
  | 'recognition-only' // user can judge outcome but not intermediate steps
  | 'none'; // user is delegating completely

export type RubricDimension = {
  id: string;
  kind: RubricDimensionKind;
  name: string;
  expected: string; // what good looks like for this dimension
  failureSignals: string[]; // markers that say it's wrong
  posture: RubricDimensionPosture;
  source: RubricDimensionSource;
  userKnowledgeLevel: RubricUserKnowledgeLevel;
  weight: RubricDimensionWeight;
  evaluatedBy: RubricEvaluationMode;
  automatedCheckSkillId?: string;
  derivedFromArtifactRef?: string; // when source=inferred-from-reference
  derivedFromEpisodeId?: string; // when source=episode-learned
};

export type GestaltInvariant = {
  description: string; // "looks/plates/eats like spaghetti"
  failureMode: string; // "if violated, goal is failed regardless of dimension scores"
};

export type OutcomeRubric = {
  id: string;
  scopeKind: RubricScopeKind;
  scopeTargetId: string;
  label: string;
  gestaltInvariant: GestaltInvariant;
  dimensions: RubricDimension[];
  knownDisasters: string[]; // top-level disaster signals
  authoredBy: 'user' | 'agent' | 'system';
  derivedFromInterpretationId?: string; // FK to interpretation.ts
  createdAt: string;
  updatedAt: string;
};

export const outcomeRubricMockData: OutcomeRubric[] = [
  {
    id: 'rubric_spaghetti_dinner',
    scopeKind: 'goal',
    scopeTargetId: 'goal_dinner_spaghetti',
    label: 'Spaghetti — recognizable, balanced, hot',
    gestaltInvariant: {
      description:
        'Recognizably spaghetti — long pasta, red sauce, plated as a single mound or twirl. Eats like spaghetti.',
      failureMode:
        'If the dish is not recognizably spaghetti (served as a salad, swapped to french fries, deconstructed beyond recognition), the goal is failed regardless of how the dimensions scored.',
    },
    dimensions: [
      {
        id: 'dim_foundational_ingredients',
        kind: 'foundational',
        name: 'core ingredients present',
        expected: 'Long pasta + tomato-based sauce + some fat (oil or cheese).',
        failureSignals: ['no pasta', 'no sauce', 'cold dish'],
        posture: 'invariant',
        source: 'user-stated',
        userKnowledgeLevel: 'specific',
        weight: 'critical',
        evaluatedBy: 'human-judgment',
      },
      {
        id: 'dim_taste_balance',
        kind: 'sensory',
        name: 'salt level',
        expected: 'Balanced; pasta water salted; sauce seasoned to mid-range, not aggressive.',
        failureSignals: ['oversalted', 'flavorless', 'overpoweringly bitter'],
        posture: 'preferred',
        source: 'user-stated',
        userKnowledgeLevel: 'rough',
        weight: 'important',
        evaluatedBy: 'human-judgment',
      },
      {
        id: 'dim_pepper_level',
        kind: 'sensory',
        name: 'pepper level',
        expected: 'Light; finishing pepper, not aggressive.',
        failureSignals: ['drowning in pepper', 'every bite is pepper'],
        posture: 'strict',
        source: 'episode-learned',
        userKnowledgeLevel: 'recognition-only',
        weight: 'important',
        evaluatedBy: 'human-judgment',
        derivedFromEpisodeId: 'ep_spaghetti_too_pepper_2026_03',
      },
      {
        id: 'dim_pasta_doneness',
        kind: 'structural',
        name: 'pasta doneness',
        expected: 'Al dente — bite resistance, not mushy, not raw.',
        failureSignals: ['mushy', 'raw center', 'broken strands'],
        posture: 'preferred',
        source: 'inferred-from-reference',
        userKnowledgeLevel: 'rough',
        weight: 'important',
        evaluatedBy: 'both',
        derivedFromArtifactRef: 'reference:past-spaghetti-photo-good',
      },
      {
        id: 'dim_plating',
        kind: 'sensory',
        name: 'plating',
        expected: 'Single mound or twirl on a deep plate, sauce coating the strands.',
        failureSignals: ['scattered like salad', 'sauce pooled separately'],
        posture: 'preferred',
        source: 'inferred-from-reference',
        userKnowledgeLevel: 'recognition-only',
        weight: 'nice-to-have',
        evaluatedBy: 'human-judgment',
      },
      {
        id: 'dim_pan_choice',
        kind: 'structural',
        name: 'cooking pan',
        expected: 'Anything wide and deep enough to boil pasta and reduce sauce.',
        failureSignals: [],
        posture: 'delegated',
        source: 'agent-derived',
        userKnowledgeLevel: 'none',
        weight: 'nice-to-have',
        evaluatedBy: 'human-judgment',
      },
      {
        id: 'dim_noodle_brand',
        kind: 'structural',
        name: 'noodle brand',
        expected: 'Whatever is in the pantry; brand does not matter.',
        failureSignals: [],
        posture: 'delegated',
        source: 'agent-derived',
        userKnowledgeLevel: 'none',
        weight: 'nice-to-have',
        evaluatedBy: 'human-judgment',
      },
    ],
    knownDisasters: [
      'served as anything other than spaghetti (gestalt failure)',
      'cold',
      'inedible due to seasoning excess',
    ],
    authoredBy: 'user',
    createdAt: '2026-04-25T10:00:00Z',
    updatedAt: '2026-04-25T10:00:00Z',
  },
  // ── Real-world analog: build-this-screenshot UI rubric ──────────────
  {
    id: 'rubric_ui_from_screenshot',
    scopeKind: 'goal',
    scopeTargetId: 'goal_ui_from_screenshot',
    label: 'Build the screenshotted UI — gestalt match, fix what I called out',
    gestaltInvariant: {
      description:
        'Recognizably the same component family as the screenshot. Same overall layout grid, same density, same hierarchy.',
      failureMode:
        'If a stranger looking at the result and the screenshot would not say "same component, slightly different version," the gestalt has failed.',
    },
    dimensions: [
      {
        id: 'dim_screenshot_layout',
        kind: 'structural',
        name: 'layout grid',
        expected: 'Same column structure and spatial relationships as the screenshot.',
        failureSignals: ['column count differs', 'header position differs'],
        posture: 'invariant',
        source: 'inferred-from-reference',
        userKnowledgeLevel: 'recognition-only',
        weight: 'critical',
        evaluatedBy: 'human-judgment',
        derivedFromArtifactRef: 'goal:goal_ui_from_screenshot:referenceArtifacts[0]',
      },
      {
        id: 'dim_user_called_out_X',
        kind: 'anti-pattern',
        name: 'avoid the X behavior the user explicitly disliked',
        expected:
          'Do not reproduce the over-eager hover-tooltips behavior — show on click only.',
        failureSignals: ['tooltip appears on hover', 'tooltip appears without click'],
        posture: 'strict',
        source: 'user-stated',
        userKnowledgeLevel: 'specific',
        weight: 'critical',
        evaluatedBy: 'human-judgment',
      },
      {
        id: 'dim_type_hierarchy',
        kind: 'sensory',
        name: 'type hierarchy',
        expected: 'Title / subtitle / body sizes that read with the same rhythm as the screenshot.',
        failureSignals: ['everything one size', 'reversed weight'],
        posture: 'preferred',
        source: 'inferred-from-reference',
        userKnowledgeLevel: 'recognition-only',
        weight: 'important',
        evaluatedBy: 'human-judgment',
      },
      {
        id: 'dim_pixel_exact',
        kind: 'sensory',
        name: 'exact pixel values',
        expected: 'Close enough; do not pixel-hunt the original.',
        failureSignals: [],
        posture: 'delegated',
        source: 'agent-derived',
        userKnowledgeLevel: 'none',
        weight: 'nice-to-have',
        evaluatedBy: 'automated-check',
      },
    ],
    knownDisasters: [
      'reproduces the X behavior the user explicitly called out as unwanted',
      'unrecognizable from the screenshot at a glance',
    ],
    authoredBy: 'user',
    derivedFromInterpretationId: 'interp_screenshot_001',
    createdAt: '2026-04-25T10:30:00Z',
    updatedAt: '2026-04-25T10:30:00Z',
  },
];

const dimensionSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'kind',
    'name',
    'expected',
    'failureSignals',
    'posture',
    'source',
    'userKnowledgeLevel',
    'weight',
    'evaluatedBy',
  ],
  properties: {
    id: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['foundational', 'structural', 'behavioral', 'sensory', 'quality', 'anti-pattern'],
    },
    name: { type: 'string' },
    expected: { type: 'string' },
    failureSignals: { type: 'array', items: { type: 'string' } },
    posture: {
      type: 'string',
      enum: ['invariant', 'strict', 'preferred', 'delegated', 'unknown'],
    },
    source: {
      type: 'string',
      enum: ['user-stated', 'inferred-from-reference', 'agent-derived', 'episode-learned'],
    },
    userKnowledgeLevel: {
      type: 'string',
      enum: ['specific', 'rough', 'recognition-only', 'none'],
    },
    weight: { type: 'string', enum: ['critical', 'important', 'nice-to-have'] },
    evaluatedBy: { type: 'string', enum: ['human-judgment', 'automated-check', 'both'] },
    automatedCheckSkillId: { type: 'string' },
    derivedFromArtifactRef: { type: 'string' },
    derivedFromEpisodeId: { type: 'string' },
  },
};

export const outcomeRubricSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'OutcomeRubric',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'scopeKind',
      'scopeTargetId',
      'label',
      'gestaltInvariant',
      'dimensions',
      'knownDisasters',
      'authoredBy',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      scopeKind: { type: 'string', enum: ['goal', 'plan', 'task'] },
      scopeTargetId: { type: 'string' },
      label: { type: 'string' },
      gestaltInvariant: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'failureMode'],
        properties: {
          description: { type: 'string' },
          failureMode: { type: 'string' },
        },
      },
      dimensions: { type: 'array', items: dimensionSchema },
      knownDisasters: { type: 'array', items: { type: 'string' } },
      authoredBy: { type: 'string', enum: ['user', 'agent', 'system'] },
      derivedFromInterpretationId: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const outcomeRubricReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Scope target (Goal / Plan / Task)',
    targetSource: 'cart/app/gallery/data/(goal|plan|task).ts',
    sourceField: '(scopeKind, scopeTargetId)',
    targetField: 'id',
    summary: 'Polymorphic FK. The scoped entity references back via outcomeRubricId.',
  },
  {
    kind: 'references',
    label: 'Derived from interpretation',
    targetSource: 'cart/app/gallery/data/interpretation.ts',
    sourceField: 'derivedFromInterpretationId',
    targetField: 'id',
    summary:
      'When the rubric was extracted by a model from prompt + reference artifacts, this points at the Interpretation row. Auditable provenance.',
  },
  {
    kind: 'references',
    label: 'Episode-learned dimensions',
    targetSource: 'cart/app/gallery/data/episodic-memory.ts',
    sourceField: 'dimensions[].derivedFromEpisodeId',
    targetField: 'id',
    summary: 'Dimensions promoted from past lessons trace back to the episode that taught them.',
  },
  {
    kind: 'references',
    label: 'Automated-check skills',
    targetSource: 'cart/app/gallery/data/skill.ts',
    sourceField: 'dimensions[].automatedCheckSkillId',
    targetField: 'id',
    summary: 'Dimensions that can be machine-evaluated point at the Skill that scores them.',
  },
];
