// QuizSession — one quiz the assistant authored and rendered.
//
// Each session is a 3-state object: `pending` (intent tree authored,
// not yet rendered) → `rendered` (mounted on screen) → `answered` (user
// hit Submit) → `inferred` (the infer turn produced ManifestDelta[]
// and updated the user manifest) → `archived`.
//
// The body of the quiz is `intentTreeJson`, a verbatim chat-loom
// `Node[]` tree (parser at `runtime/intent/parser.parseIntent`,
// renderer at `runtime/intent/render.RenderIntent`). Saving the tree
// rather than re-asking the model on every render keeps quizzes
// reproducible and dirt-cheap to display.
//
// ── Anti-repetition ─────────────────────────────────────────────
// `repetitionEmbedding` is a hash/vector of the rendered question
// text. Before authoring a new quiz the engine cosine-checks against
// recent sessions' embeddings; matches above threshold force a
// reframe pass. `metaphorScaffold` records the metaphor family used
// (gas-station snack / island item / obsolete file format / …) so
// the reframer can pick a different family.

import type { GalleryDataReference, JsonObject } from '../../types';

export type QuizQuestionKind = 'pick-one' | 'pick-many' | 'short-answer' | 'spectrum';

export type QuizQuestion = {
  id: string;
  /** Targeted dimension id (manifest-dimension.ts). */
  dimensionId: string;
  kind: QuizQuestionKind;
  prompt: string;
  optionLabels?: string[];
  /** Path inside intentTreeJson — UI uses it to highlight the matching node. */
  intentNodePath?: string;
};

export type QuizAnswer = {
  questionId: string;
  /** Raw answer string as the chat-loom Submit reply rendered it. */
  valueRaw: string;
  /** Optional normalization (categorical option id, scalar value, …). */
  valueNormalized?: string | number;
  answeredAt: string;
};

export type ManifestDelta = {
  dimensionId: string;
  previousValue?: string | number;
  nextValue: string | number;
  /** Signed change to confidence; total confidence is clamped to [0, 1]. */
  confidenceDelta: number;
  reason: string;
};

export type QuizSessionStatus =
  | 'pending'
  | 'rendered'
  | 'answered'
  | 'inferred'
  | 'archived';

export type QuizSession = {
  id: string;
  userManifestId: string;
  characterId: string;
  /** URL-friendly stem; mirrors recipe slug pattern. */
  slug: string;
  title: string;
  kickerText?: string;
  dimensionsTargeted: string[];
  /**
   * Verbatim chat-loom Node[] tree the LLM produced (after parseIntent).
   * Stored as JsonValue; runtime hands it to RenderIntent.
   */
  intentTreeJson: JsonObject;
  questions: QuizQuestion[];
  answers: QuizAnswer[];
  inferences: ManifestDelta[];
  /**
   * Vector / hash for cosine-style anti-repetition. v1 may be a
   * coarse fingerprint; the resolver only cares about presence.
   */
  repetitionEmbedding?: number[];
  metaphorScaffold?: string;
  status: QuizSessionStatus;
  createdAt: string;
  answeredAt?: string;
  inferredAt?: string;
};

const ts = '2026-05-01T22:00:00Z';

export const quizSessionMockData: QuizSession[] = [
  {
    id: 'quiz_gas_station_snack',
    userManifestId: 'manifest_local',
    characterId: 'char_default',
    slug: 'gas-station-snack-conflict-style',
    title: 'Pick a gas station snack to reveal your conflict style.',
    kickerText: 'Tell me how you handle pressure without telling me how you handle pressure.',
    dimensionsTargeted: ['dim_value_hierarchy', 'dim_metaphor_affinity', 'dim_communication_style'],
    intentTreeJson: {
      root: {
        kind: 'col',
        children: [
          { kind: 'title', text: 'Pick a gas station snack' },
          { kind: 'text', text: 'No wrong answer. (There are wrong answers.)' },
          {
            kind: 'row',
            children: [
              { kind: 'btn', label: 'Beef jerky', reply: 'I picked: beef jerky' },
              { kind: 'btn', label: 'Sour gummy worms', reply: 'I picked: sour gummy worms' },
              { kind: 'btn', label: 'Plain peanuts', reply: 'I picked: plain peanuts' },
              { kind: 'btn', label: 'Off-brand iced tea', reply: 'I picked: off-brand iced tea' },
            ],
          },
        ],
      },
    },
    questions: [
      {
        id: 'q1',
        dimensionId: 'dim_value_hierarchy',
        kind: 'pick-one',
        prompt: 'Pick a gas station snack',
        optionLabels: ['Beef jerky', 'Sour gummy worms', 'Plain peanuts', 'Off-brand iced tea'],
        intentNodePath: 'root.children[2]',
      },
    ],
    answers: [
      {
        questionId: 'q1',
        valueRaw: 'I picked: plain peanuts',
        valueNormalized: 'plain-peanuts',
        answeredAt: '2026-05-01T22:01:30Z',
      },
    ],
    inferences: [
      {
        dimensionId: 'dim_value_hierarchy',
        previousValue: 'achievement',
        nextValue: 'craft',
        confidenceDelta: 0.15,
        reason:
          'Plain peanuts read as no-frills / craft over flash. Cross-checks with prior craft signal in island-item quiz.',
      },
      {
        dimensionId: 'dim_metaphor_affinity',
        nextValue: 'cooking',
        confidenceDelta: 0.1,
        reason: 'User engaged readily with the food metaphor; reinforces cooking-family affinity.',
      },
    ],
    repetitionEmbedding: [0.12, -0.04, 0.31, 0.08, -0.22, 0.4, 0.05, -0.11],
    metaphorScaffold: 'cooking',
    status: 'inferred',
    createdAt: '2026-05-01T22:00:00Z',
    answeredAt: '2026-05-01T22:01:30Z',
    inferredAt: '2026-05-01T22:02:10Z',
  },
  {
    id: 'quiz_obsolete_file_format',
    userManifestId: 'manifest_local',
    characterId: 'char_default',
    slug: 'which-obsolete-file-format-are-you',
    title: 'Which obsolete file format are you?',
    kickerText: 'A short read on how you carry information.',
    dimensionsTargeted: ['dim_communication_style', 'dim_curiosity_patterns'],
    intentTreeJson: {
      root: {
        kind: 'col',
        children: [
          { kind: 'title', text: 'Which obsolete file format are you?' },
          {
            kind: 'form',
            fields: [
              { name: 'q1', label: 'Pick one without thinking', placeholder: '.tar.gz / .rtf / .ppm / .qif' },
            ],
            submit: { label: 'Send', reply: 'Format: {q1}' },
          },
        ],
      },
    },
    questions: [
      {
        id: 'q1',
        dimensionId: 'dim_communication_style',
        kind: 'short-answer',
        prompt: 'Pick one without thinking',
        intentNodePath: 'root.children[1]',
      },
    ],
    answers: [
      {
        questionId: 'q1',
        valueRaw: 'Format: .tar.gz',
        valueNormalized: '.tar.gz',
        answeredAt: '2026-04-28T08:15:30Z',
      },
    ],
    inferences: [
      {
        dimensionId: 'dim_communication_style',
        nextValue: 'terse',
        confidenceDelta: 0.2,
        reason: '.tar.gz reads as compressed-by-default; reinforces terse communication style.',
      },
      {
        dimensionId: 'dim_curiosity_patterns',
        nextValue: 'depth-safe',
        confidenceDelta: 0.1,
        reason: 'Picked a familiar format over a fringe one (.qif); modest depth-safe signal.',
      },
    ],
    repetitionEmbedding: [-0.05, 0.18, 0.27, -0.02, 0.14, 0.31, -0.07, 0.11],
    metaphorScaffold: 'machinery',
    status: 'inferred',
    createdAt: '2026-04-28T08:14:00Z',
    answeredAt: '2026-04-28T08:15:30Z',
    inferredAt: '2026-04-28T08:16:00Z',
  },
  {
    id: 'quiz_pressure_metaphor',
    userManifestId: 'manifest_local',
    characterId: 'char_default',
    slug: 'desert-island-item',
    title: 'Pick one item for the desert island.',
    dimensionsTargeted: ['dim_stress_responses', 'dim_humor_alignment'],
    intentTreeJson: {
      root: {
        kind: 'col',
        children: [
          { kind: 'title', text: 'Desert island, one item.' },
          { kind: 'text', text: 'Don\'t overthink it. (Or do — also a signal.)' },
          {
            kind: 'row',
            children: [
              { kind: 'btn', label: 'A pen', reply: 'pen' },
              { kind: 'btn', label: 'A pocket knife', reply: 'knife' },
              { kind: 'btn', label: 'A solar lantern', reply: 'lantern' },
              { kind: 'btn', label: 'A book of matches', reply: 'matches' },
            ],
          },
        ],
      },
    },
    questions: [
      {
        id: 'q1',
        dimensionId: 'dim_stress_responses',
        kind: 'pick-one',
        prompt: 'Pick one',
        optionLabels: ['A pen', 'A pocket knife', 'A solar lantern', 'A book of matches'],
        intentNodePath: 'root.children[2]',
      },
    ],
    answers: [],
    inferences: [],
    repetitionEmbedding: [0.21, 0.05, -0.18, 0.09, 0.32, -0.04, 0.16, 0.02],
    metaphorScaffold: 'narrative',
    status: 'rendered',
    createdAt: ts,
  },
];

export const quizSessionSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'QuizSession',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'userManifestId',
      'characterId',
      'slug',
      'title',
      'dimensionsTargeted',
      'intentTreeJson',
      'questions',
      'answers',
      'inferences',
      'status',
      'createdAt',
    ],
    properties: {
      id: { type: 'string' },
      userManifestId: { type: 'string' },
      characterId: { type: 'string' },
      slug: { type: 'string' },
      title: { type: 'string' },
      kickerText: { type: 'string' },
      dimensionsTargeted: { type: 'array', items: { type: 'string' } },
      intentTreeJson: { type: 'object' },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'dimensionId', 'kind', 'prompt'],
          properties: {
            id: { type: 'string' },
            dimensionId: { type: 'string' },
            kind: {
              type: 'string',
              enum: ['pick-one', 'pick-many', 'short-answer', 'spectrum'],
            },
            prompt: { type: 'string' },
            optionLabels: { type: 'array', items: { type: 'string' } },
            intentNodePath: { type: 'string' },
          },
        },
      },
      answers: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['questionId', 'valueRaw', 'answeredAt'],
          properties: {
            questionId: { type: 'string' },
            valueRaw: { type: 'string' },
            valueNormalized: { type: ['string', 'number'] },
            answeredAt: { type: 'string' },
          },
        },
      },
      inferences: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['dimensionId', 'nextValue', 'confidenceDelta', 'reason'],
          properties: {
            dimensionId: { type: 'string' },
            previousValue: { type: ['string', 'number'] },
            nextValue: { type: ['string', 'number'] },
            confidenceDelta: { type: 'number' },
            reason: { type: 'string' },
          },
        },
      },
      repetitionEmbedding: {
        type: 'array',
        items: { type: 'number' },
      },
      metaphorScaffold: { type: 'string' },
      status: {
        type: 'string',
        enum: ['pending', 'rendered', 'answered', 'inferred', 'archived'],
      },
      createdAt: { type: 'string' },
      answeredAt: { type: 'string' },
      inferredAt: { type: 'string' },
    },
  },
};

export const quizSessionReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'User manifest',
    targetSource: 'cart/app/gallery/data/user-manifest.ts',
    sourceField: 'userManifestId',
    targetField: 'id',
  },
  {
    kind: 'belongs-to',
    label: 'Authoring character',
    targetSource: 'cart/app/gallery/data/character.ts',
    sourceField: 'characterId',
    targetField: 'id',
    summary:
      'The character that authored this quiz. The manifest reads "the assistant is curating this for me" because the chip + theme on the rendered quiz come from the character.',
  },
  {
    kind: 'references',
    label: 'Dimensions targeted',
    targetSource: 'cart/app/gallery/data/manifest-dimension.ts',
    sourceField: 'dimensionsTargeted[]',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Inferred deltas → manifest',
    targetSource: 'cart/app/gallery/data/user-manifest.ts',
    sourceField: 'inferences[].dimensionId',
    targetField: 'dimensions[].dimensionId',
    summary:
      'Each ManifestDelta lands on the user-manifest as a confidence change + sourceQuizId addition (or contradictoryQuizId on disagreement).',
  },
];
