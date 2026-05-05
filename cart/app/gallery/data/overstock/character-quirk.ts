// CharacterQuirk — atomic voice quirks that compose into a Character.
//
// One quirk = one PromptFragment. Quirks are the "signature verbal
// tics" of a character (em-dashes-only, no exclamation marks, signs
// off with a closing thought, time-aware greetings, etc.). They land
// in the character's "who" slot alongside the dial-derived fragments.
//
// ── Why fragment-1:1 and not parametric ──────────────────────────
// Dials cover the parametric dimensions (formal↔casual, etc.).
// Quirks cover the categorical "always do this" / "never do this"
// rules that don't fit on an axis. Each quirk is a single fragment
// the user can opt into or out of.

import type { GalleryDataReference, JsonObject } from '../../types';

export type CharacterQuirkCategory =
  | 'verbal-tic'
  | 'catchphrase'
  | 'formatting-habit'
  | 'signature-greeting'
  | 'signature-signoff'
  | 'emoji-policy'
  | 'format-rule';

export type CharacterQuirkIntensity = 'subtle' | 'distinct' | 'loud';

export type CharacterQuirk = {
  id: string;
  label: string;
  description: string;
  category: CharacterQuirkCategory;
  fragmentId: string;
  intensity?: CharacterQuirkIntensity;
  /** Tags for ergonomic UI grouping. */
  tags?: string[];
  createdAt: string;
  updatedAt: string;
};

const ts = '2026-05-02T00:00:00Z';

export const characterQuirkMockData: CharacterQuirk[] = [
  {
    id: 'quirk_em_dash_only',
    label: 'Em-dashes, never colons',
    description: 'Uses em-dashes instead of colons for emphasis breaks. Reads as crisp / contemplative.',
    category: 'formatting-habit',
    fragmentId: 'frag_quirk_em_dash_only',
    intensity: 'distinct',
    tags: ['typography'],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'quirk_no_exclamation_marks',
    label: 'No exclamation marks',
    description: 'Never uses exclamation marks. Lands as composed / dry.',
    category: 'format-rule',
    fragmentId: 'frag_quirk_no_exclamation_marks',
    intensity: 'distinct',
    tags: ['typography'],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'quirk_signs_off_with_closing_thought',
    label: 'Signs off with a closing thought',
    description: 'Each turn ends with one sentence that names what to think about next.',
    category: 'signature-signoff',
    fragmentId: 'frag_quirk_signs_off_with_closing_thought',
    intensity: 'distinct',
    tags: ['structure'],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'quirk_time_aware_greeting',
    label: 'Time-aware greeting',
    description: 'Opens with a salutation calibrated to the user\'s local time of day.',
    category: 'signature-greeting',
    fragmentId: 'frag_quirk_time_aware_greeting',
    intensity: 'subtle',
    tags: ['warmth'],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'quirk_no_emoji',
    label: 'Never emoji',
    description: 'No emoji ever, even in casual replies.',
    category: 'emoji-policy',
    fragmentId: 'frag_quirk_no_emoji',
    intensity: 'subtle',
    tags: ['typography'],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'quirk_loves_bracketed_asides',
    label: 'Bracketed asides',
    description: 'Uses parenthetical asides as a second voice — wry commentary alongside the main thread.',
    category: 'verbal-tic',
    fragmentId: 'frag_quirk_loves_bracketed_asides',
    intensity: 'distinct',
    tags: ['voice'],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'quirk_numbered_bullets',
    label: 'Numbered bullets',
    description: 'When listing, always numbers — never plain dashes — so the order is part of the meaning.',
    category: 'formatting-habit',
    fragmentId: 'frag_quirk_numbered_bullets',
    intensity: 'subtle',
    tags: ['structure'],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'quirk_salty_sea_captain',
    label: 'Salty sea captain',
    description: 'Reaches for nautical vocabulary in passing — "trim the sails on this PR", "running before the wind", etc.',
    category: 'catchphrase',
    fragmentId: 'frag_quirk_salty_sea_captain',
    intensity: 'loud',
    tags: ['voice', 'theme'],
    createdAt: ts,
    updatedAt: ts,
  },
];

export const characterQuirkSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CharacterQuirk',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label', 'description', 'category', 'fragmentId', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      description: { type: 'string' },
      category: {
        type: 'string',
        enum: [
          'verbal-tic',
          'catchphrase',
          'formatting-habit',
          'signature-greeting',
          'signature-signoff',
          'emoji-policy',
          'format-rule',
        ],
      },
      fragmentId: { type: 'string' },
      intensity: { type: 'string', enum: ['subtle', 'distinct', 'loud'] },
      tags: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const characterQuirkReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Underlying prompt fragment',
    targetSource: 'cart/app/gallery/data/prompt-fragment.ts',
    sourceField: 'fragmentId',
    targetField: 'id',
    summary: 'Each quirk maps 1:1 to the PromptFragment that injects it into the active "who" slot.',
  },
  {
    kind: 'has-many',
    label: 'Characters carrying this quirk',
    targetSource: 'cart/app/gallery/data/character.ts',
    sourceField: 'id',
    targetField: 'quirkIds[]',
  },
];
