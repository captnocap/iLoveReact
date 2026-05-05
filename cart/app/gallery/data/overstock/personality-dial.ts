// PersonalityDial — catalog of bipolar trait spectrums.
//
// A dial is a continuous 0..1 axis with two labelled poles (Formal ↔
// Casual, Direct ↔ Diplomatic, etc.). Each Character holds a
// `dialValues: Record<dialId, number>` map; at request-resolve time
// the dial value selects/interpolates which `PromptFragment` rows
// contribute (and at what weight) to the character's `who` slot.
//
// ── Why "dial" and not "trait" ─────────────────────────────────
// Trait is overloaded — `User.preferences.accommodations[]` already
// uses it for declared user-side traits. Dials are *parametric inputs
// to a Character's voice composition*. Bipolar by default; near-zero
// or near-one values produce strong fragment selection, mid-range
// values omit both poles (i.e. neutral voice).
//
// ── How fragmentMappings resolve ───────────────────────────────
// Each entry says "at this dial value, this fragment fires with this
// weight." The resolver picks the entry(ies) closest to the current
// value and feeds them into the active "who" composition slot. A
// soft step function — values near 0.5 produce no contribution,
// values near 0 fire the leftLabel fragment, values near 1 fire
// rightLabel.

import type { GalleryDataReference, JsonObject } from '../../types';

export type PersonalityDialFragmentMapping = {
  /** Dial value (0..1) at which this fragment is the strongest match. */
  atValue: number;
  /** PromptFragment.id firing at this value. */
  fragmentId: string;
  /** Composer hint: how loudly this fragment contributes. 0..1. */
  weight: number;
};

export type PersonalityDial = {
  id: string;
  label: string;
  leftLabel: string;
  rightLabel: string;
  axisDescription: string;
  /** Default if a Character row does not set a value for this dial. */
  defaultValue: number;
  fragmentMappings: PersonalityDialFragmentMapping[];
  createdAt: string;
  updatedAt: string;
};

const ts = '2026-05-02T00:00:00Z';

export const personalityDialMockData: PersonalityDial[] = [
  {
    id: 'dial_formal_casual',
    label: 'Formal ↔ Casual',
    leftLabel: 'Formal',
    rightLabel: 'Casual',
    axisDescription:
      'How buttoned-up the voice reads. Formal: full sentences, no contractions, professional. Casual: contractions, colloquial, friend-shaped.',
    defaultValue: 0.6,
    fragmentMappings: [
      { atValue: 0.05, fragmentId: 'frag_dial_formal_low', weight: 1.0 },
      { atValue: 0.95, fragmentId: 'frag_dial_formal_high', weight: 1.0 },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dial_direct_diplomatic',
    label: 'Direct ↔ Diplomatic',
    leftLabel: 'Direct',
    rightLabel: 'Diplomatic',
    axisDescription:
      'Direct: leads with the answer; willing to disagree. Diplomatic: hedges, contextualizes, softens the edge before delivery.',
    defaultValue: 0.25,
    fragmentMappings: [
      { atValue: 0.05, fragmentId: 'frag_dial_direct_low', weight: 1.0 },
      { atValue: 0.95, fragmentId: 'frag_dial_direct_high', weight: 1.0 },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dial_pessimist_optimist',
    label: 'Pessimistic ↔ Optimistic',
    leftLabel: 'Pessimistic',
    rightLabel: 'Optimistic',
    axisDescription:
      'Pessimistic: surfaces what could go wrong first. Optimistic: surfaces what could go right first. Both should still hit the same correctness.',
    defaultValue: 0.4,
    fragmentMappings: [
      { atValue: 0.05, fragmentId: 'frag_dial_pessimist_low', weight: 1.0 },
      { atValue: 0.95, fragmentId: 'frag_dial_pessimist_high', weight: 1.0 },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dial_literal_poetic',
    label: 'Literal ↔ Poetic',
    leftLabel: 'Literal',
    rightLabel: 'Poetic',
    axisDescription:
      'Literal: direct mapping of words to meaning, no metaphor unless asked. Poetic: leans on metaphor, evocative phrasing, image over fact.',
    defaultValue: 0.3,
    fragmentMappings: [
      { atValue: 0.05, fragmentId: 'frag_dial_literal_low', weight: 1.0 },
      { atValue: 0.95, fragmentId: 'frag_dial_literal_high', weight: 1.0 },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dial_reactive_proactive',
    label: 'Reactive ↔ Proactive',
    leftLabel: 'Reactive',
    rightLabel: 'Proactive',
    axisDescription:
      'Reactive: waits for the user to drive; never offers unprompted thoughts. Proactive: pings, suggests, asks follow-ups, surfaces relevant info.',
    defaultValue: 0.45,
    fragmentMappings: [
      { atValue: 0.05, fragmentId: 'frag_dial_reactive_low', weight: 1.0 },
      { atValue: 0.95, fragmentId: 'frag_dial_reactive_high', weight: 1.0 },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dial_concise_elaborate',
    label: 'Concise ↔ Elaborate',
    leftLabel: 'Concise',
    rightLabel: 'Elaborate',
    axisDescription:
      'Concise: shortest viable response; user can ask for more. Elaborate: walks through reasoning, shows work, lists alternatives.',
    defaultValue: 0.15,
    fragmentMappings: [
      { atValue: 0.05, fragmentId: 'frag_dial_concise_low', weight: 1.0 },
      { atValue: 0.95, fragmentId: 'frag_dial_concise_high', weight: 1.0 },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dial_adversarial_affirming',
    label: 'Adversarial ↔ Affirming',
    leftLabel: 'Adversarial',
    rightLabel: 'Affirming',
    axisDescription:
      'Adversarial: challenges premises by default; argues for the strongest counter. Affirming: builds on the user\'s framing rather than questioning it.',
    defaultValue: 0.5,
    fragmentMappings: [
      { atValue: 0.05, fragmentId: 'frag_dial_adversarial_low', weight: 1.0 },
      { atValue: 0.95, fragmentId: 'frag_dial_adversarial_high', weight: 1.0 },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dial_pun_frequency',
    label: 'No puns ↔ Frequent puns',
    leftLabel: 'No puns',
    rightLabel: 'Frequent puns',
    axisDescription:
      'How often the voice reaches for wordplay. At extremes: zero puns ever / a pun in every other paragraph.',
    defaultValue: 0.15,
    fragmentMappings: [
      { atValue: 0.05, fragmentId: 'frag_dial_pun_low', weight: 1.0 },
      { atValue: 0.95, fragmentId: 'frag_dial_pun_high', weight: 1.0 },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dial_roast_comfort',
    label: 'No roast ↔ Roast freely',
    leftLabel: 'No roast',
    rightLabel: 'Roast freely',
    axisDescription:
      'How comfortable the voice is with light teasing / roasting. Low values forbid it; high values lean into it as warmth.',
    defaultValue: 0.2,
    fragmentMappings: [
      { atValue: 0.05, fragmentId: 'frag_dial_roast_low', weight: 1.0 },
      { atValue: 0.95, fragmentId: 'frag_dial_roast_high', weight: 1.0 },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dial_meme_literacy',
    label: 'Low meme literacy ↔ High',
    leftLabel: 'Low meme literacy',
    rightLabel: 'High meme literacy',
    axisDescription:
      'Whether the voice references internet/pop-culture in passing. Low: never; high: assumes the user gets the reference.',
    defaultValue: 0.4,
    fragmentMappings: [
      { atValue: 0.05, fragmentId: 'frag_dial_meme_low', weight: 1.0 },
      { atValue: 0.95, fragmentId: 'frag_dial_meme_high', weight: 1.0 },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dial_emoji_frequency',
    label: 'No emoji ↔ Frequent emoji',
    leftLabel: 'No emoji',
    rightLabel: 'Frequent emoji',
    axisDescription:
      'How often the voice uses emoji as punctuation / tone marker. Defaults low for tooling contexts.',
    defaultValue: 0.05,
    fragmentMappings: [
      { atValue: 0.05, fragmentId: 'frag_dial_emoji_low', weight: 1.0 },
      { atValue: 0.95, fragmentId: 'frag_dial_emoji_high', weight: 1.0 },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'dial_closure_need',
    label: 'Open-ended ↔ Closure-seeking',
    leftLabel: 'Open-ended',
    rightLabel: 'Closure-seeking',
    axisDescription:
      'Open-ended: leaves threads dangling for the user to pick up. Closure-seeking: wraps every turn with "anything else?"-style summary.',
    defaultValue: 0.5,
    fragmentMappings: [
      { atValue: 0.05, fragmentId: 'frag_dial_closure_low', weight: 1.0 },
      { atValue: 0.95, fragmentId: 'frag_dial_closure_high', weight: 1.0 },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
];

export const personalityDialSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'PersonalityDial',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'label',
      'leftLabel',
      'rightLabel',
      'axisDescription',
      'defaultValue',
      'fragmentMappings',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      leftLabel: { type: 'string' },
      rightLabel: { type: 'string' },
      axisDescription: { type: 'string' },
      defaultValue: { type: 'number', minimum: 0, maximum: 1 },
      fragmentMappings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['atValue', 'fragmentId', 'weight'],
          properties: {
            atValue: { type: 'number', minimum: 0, maximum: 1 },
            fragmentId: { type: 'string' },
            weight: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const personalityDialReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Fragments fired by dial value',
    targetSource: 'cart/app/gallery/data/prompt-fragment.ts',
    sourceField: 'fragmentMappings[].fragmentId',
    targetField: 'id',
    summary:
      'Each dial mapping points at a PromptFragment. The resolver picks the entry closest to the current dial value and feeds the fragment into the character\'s "who" slot.',
  },
  {
    kind: 'has-many',
    label: 'Characters consuming this dial',
    targetSource: 'cart/app/gallery/data/character.ts',
    sourceField: 'id',
    targetField: 'dialValues[<id>]',
    summary:
      'Each Character row holds a dialValues map keyed by dial id. The dial registry is the canonical list of valid keys.',
  },
];
