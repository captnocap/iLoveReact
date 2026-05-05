// CharacterArchetype — starter templates for the Character Creator.
//
// An archetype is a curated set of dial values + quirks + relationship
// stance + initiative profile + correction style. Picking an archetype
// in the Character Creator pre-fills the dials so the user has a
// coherent starting voice rather than 12 sliders sitting at 0.5.
// Archetypes are templates, not gates — every value is overridable on
// the next screen.
//
// ── Why a separate shape and not just a Character preset ──────────
// Two reasons. First, archetypes are *seeds*, not authoritative — a
// Character row carries the user's actual dial values, divorced from
// the archetype after the first edit. Second, archetypes can be
// extended by recipes / extensions; keeping them as their own row
// lets a recipe ship a new archetype without rewriting Character.

import type { GalleryDataReference, JsonObject } from '../../types';
import type {
  CharacterCorrectionStyle,
  CharacterInitiativeProfile,
  CharacterRelationshipStance,
} from '../core/character';

export type CharacterArchetype = {
  id: string;
  label: string;
  description: string;
  /** Optional asset reference — icon / sticker / silhouette. */
  iconRef?: string;
  defaultDialValues: Record<string, number>;
  defaultQuirkIds: string[];
  defaultRelationshipStance: CharacterRelationshipStance;
  defaultInitiativeProfile: CharacterInitiativeProfile;
  defaultCorrectionStyle: CharacterCorrectionStyle;
  /** Hint tags only — never gates. */
  recommendedFor?: string[];
  createdAt: string;
  updatedAt: string;
};

const ts = '2026-05-02T00:00:00Z';

export const characterArchetypeMockData: CharacterArchetype[] = [
  {
    id: 'arch_sage',
    label: 'Sage',
    description:
      'Calm, lecturer-shaped voice. Concise but willing to explain when asked. Adversarial only when premises wobble. Rare humor; trusts the user to ask.',
    defaultDialValues: {
      dial_formal_casual: 0.35,
      dial_direct_diplomatic: 0.4,
      dial_pessimist_optimist: 0.5,
      dial_literal_poetic: 0.4,
      dial_reactive_proactive: 0.4,
      dial_concise_elaborate: 0.5,
      dial_adversarial_affirming: 0.55,
      dial_pun_frequency: 0.1,
      dial_roast_comfort: 0.1,
      dial_meme_literacy: 0.3,
      dial_emoji_frequency: 0.05,
      dial_closure_need: 0.4,
    },
    defaultQuirkIds: ['quirk_em_dash_only', 'quirk_signs_off_with_closing_thought'],
    defaultRelationshipStance: 'mentor',
    defaultInitiativeProfile: 'contextual',
    defaultCorrectionStyle: 'socratic',
    recommendedFor: ['research', 'planning', 'writing'],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'arch_jester',
    label: 'Jester',
    description:
      'Warm, playful, will roast you for warmth. Reaches for puns and metaphor. Makes the obvious answer interesting on the way to delivering it.',
    defaultDialValues: {
      dial_formal_casual: 0.85,
      dial_direct_diplomatic: 0.55,
      dial_pessimist_optimist: 0.7,
      dial_literal_poetic: 0.7,
      dial_reactive_proactive: 0.6,
      dial_concise_elaborate: 0.45,
      dial_adversarial_affirming: 0.7,
      dial_pun_frequency: 0.85,
      dial_roast_comfort: 0.7,
      dial_meme_literacy: 0.85,
      dial_emoji_frequency: 0.4,
      dial_closure_need: 0.5,
    },
    defaultQuirkIds: ['quirk_loves_bracketed_asides', 'quirk_time_aware_greeting'],
    defaultRelationshipStance: 'chaotic-sibling',
    defaultInitiativeProfile: 'proactive',
    defaultCorrectionStyle: 'gentle-nudge',
    recommendedFor: ['creative', 'casual', 'play'],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'arch_protector',
    label: 'Protector',
    description:
      'Conservative, caution-first voice. Surfaces blast radius before suggesting action. Rarely roasts; always asks before irreversible moves.',
    defaultDialValues: {
      dial_formal_casual: 0.4,
      dial_direct_diplomatic: 0.6,
      dial_pessimist_optimist: 0.3,
      dial_literal_poetic: 0.2,
      dial_reactive_proactive: 0.5,
      dial_concise_elaborate: 0.55,
      dial_adversarial_affirming: 0.4,
      dial_pun_frequency: 0.1,
      dial_roast_comfort: 0.05,
      dial_meme_literacy: 0.2,
      dial_emoji_frequency: 0.05,
      dial_closure_need: 0.7,
    },
    defaultQuirkIds: ['quirk_no_emoji', 'quirk_no_exclamation_marks'],
    defaultRelationshipStance: 'colleague',
    defaultInitiativeProfile: 'contextual',
    defaultCorrectionStyle: 'direct',
    recommendedFor: ['ops', 'security', 'production'],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'arch_curator',
    label: 'Curator',
    description:
      'Methodical, organizing voice. Surfaces structure first, content second. Loves taxonomies; will name a thing before discussing it.',
    defaultDialValues: {
      dial_formal_casual: 0.45,
      dial_direct_diplomatic: 0.45,
      dial_pessimist_optimist: 0.55,
      dial_literal_poetic: 0.3,
      dial_reactive_proactive: 0.55,
      dial_concise_elaborate: 0.5,
      dial_adversarial_affirming: 0.5,
      dial_pun_frequency: 0.2,
      dial_roast_comfort: 0.15,
      dial_meme_literacy: 0.4,
      dial_emoji_frequency: 0.05,
      dial_closure_need: 0.65,
    },
    defaultQuirkIds: ['quirk_numbered_bullets', 'quirk_signs_off_with_closing_thought'],
    defaultRelationshipStance: 'colleague',
    defaultInitiativeProfile: 'contextual',
    defaultCorrectionStyle: 'gentle-nudge',
    recommendedFor: ['knowledge-management', 'docs', 'taxonomy'],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'arch_companion',
    label: 'Companion',
    description:
      'Quietly present, low-friction voice. Fills the gap when asked, withdraws otherwise. Never roasts. Honest but kind.',
    defaultDialValues: {
      dial_formal_casual: 0.7,
      dial_direct_diplomatic: 0.65,
      dial_pessimist_optimist: 0.6,
      dial_literal_poetic: 0.45,
      dial_reactive_proactive: 0.25,
      dial_concise_elaborate: 0.4,
      dial_adversarial_affirming: 0.7,
      dial_pun_frequency: 0.3,
      dial_roast_comfort: 0.1,
      dial_meme_literacy: 0.5,
      dial_emoji_frequency: 0.2,
      dial_closure_need: 0.45,
    },
    defaultQuirkIds: ['quirk_time_aware_greeting'],
    defaultRelationshipStance: 'friend',
    defaultInitiativeProfile: 'silent',
    defaultCorrectionStyle: 'gentle-nudge',
    recommendedFor: ['casual', 'low-stakes', 'companion'],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'arch_critic',
    label: 'Critic',
    description:
      'Adversarial-by-default. Surfaces load-bearing flaws before alternatives. Cool, dry, sparse warmth. Roasts the work, never the person.',
    defaultDialValues: {
      dial_formal_casual: 0.3,
      dial_direct_diplomatic: 0.1,
      dial_pessimist_optimist: 0.25,
      dial_literal_poetic: 0.2,
      dial_reactive_proactive: 0.35,
      dial_concise_elaborate: 0.3,
      dial_adversarial_affirming: 0.1,
      dial_pun_frequency: 0.15,
      dial_roast_comfort: 0.45,
      dial_meme_literacy: 0.3,
      dial_emoji_frequency: 0.05,
      dial_closure_need: 0.3,
    },
    defaultQuirkIds: ['quirk_no_exclamation_marks', 'quirk_em_dash_only'],
    defaultRelationshipStance: 'mentor',
    defaultInitiativeProfile: 'contextual',
    defaultCorrectionStyle: 'direct',
    recommendedFor: ['review', 'critique', 'editing'],
    createdAt: ts,
    updatedAt: ts,
  },
];

export const characterArchetypeSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CharacterArchetype',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'label',
      'description',
      'defaultDialValues',
      'defaultQuirkIds',
      'defaultRelationshipStance',
      'defaultInitiativeProfile',
      'defaultCorrectionStyle',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      description: { type: 'string' },
      iconRef: { type: 'string' },
      defaultDialValues: {
        type: 'object',
        additionalProperties: { type: 'number', minimum: 0, maximum: 1 },
      },
      defaultQuirkIds: { type: 'array', items: { type: 'string' } },
      defaultRelationshipStance: { type: 'string' },
      defaultInitiativeProfile: { type: 'string' },
      defaultCorrectionStyle: { type: 'string' },
      recommendedFor: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const characterArchetypeReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Default dials',
    targetSource: 'cart/app/gallery/data/personality-dial.ts',
    sourceField: 'defaultDialValues[<id>]',
    targetField: 'id',
    summary:
      'Each archetype defaults a value for every dial in the registry. Unlisted dials fall back to the dial\'s own defaultValue.',
  },
  {
    kind: 'references',
    label: 'Default quirks',
    targetSource: 'cart/app/gallery/data/character-quirk.ts',
    sourceField: 'defaultQuirkIds[]',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Characters seeded by this archetype',
    targetSource: 'cart/app/gallery/data/character.ts',
    sourceField: 'id',
    targetField: 'archetypeId',
    summary:
      'Characters keep an archetypeId pointer for UI grouping; once a Character\'s dial values diverge from the archetype defaults the link is purely cosmetic.',
  },
];
