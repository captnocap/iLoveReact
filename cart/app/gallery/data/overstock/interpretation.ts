// Interpretation — the model's reasoning pass that turns unstructured
// human input into structured shape values. The seam where the model
// (interpreter) hands off to the deterministic machine (executor).
//
// ── Why this is its own row ────────────────────────────────────
// You cannot mechanically extract intent from "build this — but the
// X part should be Y" plus a screenshot. A model has to reason about
// it and emit structured outputs. Without a row to record that
// reasoning, the resulting Goal/Rubric/Constraint values look like
// they came from nowhere — there is no audit trail back to the
// model's interpretation moment.
//
// ── What it captures ────────────────────────────────────────────
//   - the source (which user message / artifact was being read)
//   - the model that did the reading
//   - every shape value the interpretation produced, with confidence
//     and short reasoning
//   - whether the user reviewed and approved/revised the
//     interpretation
//   - supersession when the user says "you read me wrong" — a fresh
//     Interpretation is created and supersedes the old one; downstream
//     rows (Rubric, Constraints) are re-derived
//
// This is what makes "the model became my flag-setter" auditable
// instead of opaque.

import type { GalleryDataReference, JsonObject } from '../../types';

export type InterpretationOutputTargetKind =
  | 'goal'
  | 'plan'
  | 'task'
  | 'constraint'
  | 'outcome-rubric'
  | 'rubric-dimension'
  | 'reference-artifact'
  | 'system-message'
  | 'inference-preset';

export type InterpretationStatus =
  | 'draft' // model produced it; awaiting user review
  | 'approved' // user reviewed; values are canon
  | 'revised' // user pushed back; revisions in flight
  | 'superseded' // a later Interpretation took over
  | 'auto-applied'; // confidence high enough that no review was required

export type InterpretationOutput = {
  id: string;
  targetEntityKind: InterpretationOutputTargetKind;
  /**
   * Either 'create' (this output is a brand-new row of targetEntityKind)
   * or the id of the row being updated.
   */
  targetEntityId: string;
  fieldPath?: string; // e.g. 'gestaltInvariant.description'; omit for full create
  value: unknown;
  confidence: number; // 0–1
  reasoning: string; // short — one or two sentences
};

export type Interpretation = {
  id: string;
  /** The user input that was interpreted. Polymorphic ref. */
  sourceRefKind: 'user-message' | 'reference-artifact' | 'episodic-memory' | 'event';
  sourceRef: string;
  interpretedByModelId: string;
  /** Optional pointer at the prior interpretation if this is a revision. */
  supersedesInterpretationId?: string;
  outputs: InterpretationOutput[];
  status: InterpretationStatus;
  reviewedAt?: string;
  reviseRequestedAt?: string;
  reviseRequestNote?: string;
  supersededByInterpretationId?: string;
  createdAt: string;
};

export const interpretationMockData: Interpretation[] = [
  // Reading the user's spaghetti prompt → produced Goal + Rubric
  {
    id: 'interp_dinner_prompt_001',
    sourceRefKind: 'user-message',
    sourceRef: 'event:evt_user_input_dinner_001',
    interpretedByModelId: 'claude-opus-4-7',
    outputs: [
      {
        id: 'out_001',
        targetEntityKind: 'goal',
        targetEntityId: 'create',
        value: {
          statement: 'Make spaghetti for dinner; recognizable, hot, balanced.',
          successDescription: 'Plated spaghetti, eaten with satisfaction.',
        },
        confidence: 0.95,
        reasoning:
          'User said "spaghetti for dinner" — clear declarative goal. Recognition as spaghetti is the gestalt; balance/hotness inferred from past episodes.',
      },
      {
        id: 'out_002',
        targetEntityKind: 'outcome-rubric',
        targetEntityId: 'create',
        value: { ref: 'rubric_spaghetti_dinner' },
        confidence: 0.85,
        reasoning:
          'Built rubric from declarative + past episode lessons. Pepper-level dimension explicitly promoted from ep_spaghetti_too_pepper episode.',
      },
      {
        id: 'out_003',
        targetEntityKind: 'rubric-dimension',
        targetEntityId: 'rubric_spaghetti_dinner',
        fieldPath: 'dimensions[dim_pan_choice].posture',
        value: 'delegated',
        confidence: 0.78,
        reasoning:
          'User has not specified pan; user-knowledge-level = none; safe to delegate.',
      },
    ],
    status: 'auto-applied',
    createdAt: '2026-04-25T17:55:00Z',
  },

  // Reading the screenshot prompt → produced Goal + Rubric with inferred dimensions
  {
    id: 'interp_screenshot_001',
    sourceRefKind: 'user-message',
    sourceRef: 'event:evt_user_input_ui_screenshot_001',
    interpretedByModelId: 'claude-opus-4-7',
    outputs: [
      {
        id: 'out_010',
        targetEntityKind: 'goal',
        targetEntityId: 'create',
        value: {
          statement: 'Build a UI component matching the screenshot, with the X behavior fixed.',
        },
        confidence: 0.9,
        reasoning: 'User attached image + said "build this — but X part should be Y."',
      },
      {
        id: 'out_011',
        targetEntityKind: 'reference-artifact',
        targetEntityId: 'create',
        value: { kind: 'image', ref: '/uploads/shot.png' },
        confidence: 1.0,
        reasoning: 'Direct attachment; no interpretation needed.',
      },
      {
        id: 'out_012',
        targetEntityKind: 'rubric-dimension',
        targetEntityId: 'rubric_ui_from_screenshot',
        fieldPath: 'dimensions[dim_screenshot_layout]',
        value: { posture: 'invariant', source: 'inferred-from-reference' },
        confidence: 0.7,
        reasoning:
          'Ran vision pass over the screenshot; layout grid is the most stable visual property → posture=invariant.',
      },
      {
        id: 'out_013',
        targetEntityKind: 'rubric-dimension',
        targetEntityId: 'rubric_ui_from_screenshot',
        fieldPath: 'dimensions[dim_user_called_out_X]',
        value: { posture: 'strict', source: 'user-stated', kind: 'anti-pattern' },
        confidence: 0.95,
        reasoning:
          'User explicitly named the X behavior they did not want; encoded as strict-posture anti-pattern dimension.',
      },
      {
        id: 'out_014',
        targetEntityKind: 'rubric-dimension',
        targetEntityId: 'rubric_ui_from_screenshot',
        fieldPath: 'dimensions[dim_pixel_exact]',
        value: { posture: 'delegated' },
        confidence: 0.6,
        reasoning:
          'User-knowledge-level inferred as none on pixel-precision; safe to delegate, low confidence on the assumption itself.',
      },
    ],
    status: 'approved',
    reviewedAt: '2026-04-25T10:32:00Z',
    createdAt: '2026-04-25T10:30:00Z',
  },

  // A revision example — user said "you read me wrong"
  {
    id: 'interp_screenshot_001_revision',
    sourceRefKind: 'user-message',
    sourceRef: 'event:evt_user_revise_layout_002',
    interpretedByModelId: 'claude-opus-4-7',
    supersedesInterpretationId: 'interp_screenshot_001',
    outputs: [
      {
        id: 'out_020',
        targetEntityKind: 'rubric-dimension',
        targetEntityId: 'rubric_ui_from_screenshot',
        fieldPath: 'dimensions[dim_screenshot_layout].expected',
        value:
          'Same column structure (4-col), header position bottom-left, stack hierarchy reversed from screenshot (icons above title).',
        confidence: 0.92,
        reasoning:
          "User clarified that the screenshot's header position is what they want, but icons should sit above titles, not below. Updating dimension expected text.",
      },
    ],
    status: 'approved',
    reviewedAt: '2026-04-25T11:20:00Z',
    createdAt: '2026-04-25T11:18:00Z',
  },
];

export const interpretationSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Interpretation',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'sourceRefKind', 'sourceRef', 'interpretedByModelId', 'outputs', 'status', 'createdAt'],
    properties: {
      id: { type: 'string' },
      sourceRefKind: {
        type: 'string',
        enum: ['user-message', 'reference-artifact', 'episodic-memory', 'event'],
      },
      sourceRef: { type: 'string' },
      interpretedByModelId: { type: 'string' },
      supersedesInterpretationId: { type: 'string' },
      status: {
        type: 'string',
        enum: ['draft', 'approved', 'revised', 'superseded', 'auto-applied'],
      },
      reviewedAt: { type: 'string' },
      reviseRequestedAt: { type: 'string' },
      reviseRequestNote: { type: 'string' },
      supersededByInterpretationId: { type: 'string' },
      createdAt: { type: 'string' },
      outputs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'targetEntityKind', 'targetEntityId', 'value', 'confidence', 'reasoning'],
          properties: {
            id: { type: 'string' },
            targetEntityKind: {
              type: 'string',
              enum: [
                'goal',
                'plan',
                'task',
                'constraint',
                'outcome-rubric',
                'rubric-dimension',
                'reference-artifact',
                'system-message',
                'inference-preset',
              ],
            },
            targetEntityId: { type: 'string' },
            fieldPath: { type: 'string' },
            value: {},
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
          },
        },
      },
    },
  },
};

export const interpretationReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Source (polymorphic)',
    targetSource: 'cart/app/gallery/data/(varies by sourceRefKind)',
    sourceField: '(sourceRefKind, sourceRef)',
    targetField: 'id',
    summary: 'The user input being interpreted. Polymorphic across user-message, reference-artifact, etc.',
  },
  {
    kind: 'references',
    label: 'Interpreting model',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'interpretedByModelId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Superseded interpretation',
    targetSource: 'cart/app/gallery/data/interpretation.ts',
    sourceField: 'supersedesInterpretationId',
    targetField: 'id',
    summary:
      'Forms a revision chain — when the user pushes back, a new Interpretation supersedes the old one and downstream shape values are re-derived.',
  },
  {
    kind: 'has-many',
    label: 'Output rows (polymorphic)',
    targetSource: 'cart/app/gallery/data/(varies by output.targetEntityKind)',
    sourceField: 'outputs[].targetEntityId',
    targetField: 'id',
    summary:
      'Each output row created or modified by the interpretation traces back here via its own provenance field (e.g. outcome-rubric.derivedFromInterpretationId).',
  },
];
