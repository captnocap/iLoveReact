// PromptFragment — atomic, reusable prompt body. The smallest unit of
// prose the composer can slot.
//
// Coexists with `system-message.ts` and `prompt-template.ts` rather
// than replacing them. Both legacy shapes are also slottable into a
// Composition (via their own composition-source-kind rows). Fragments
// are the lightweight option when you don't need the full
// system-message-with-variables-and-references treatment — just a
// chunk of text the composer can drop into a slot.
//
// ── Pre-render script ─────────────────────────────────────────
// A fragment may carry a `preRenderScript` that runs at assembly
// time and can mutate, append, or skip the fragment. This is what
// makes prompts programmable — settings-menu users add scripts to
// fragments to compute values, redact tokens, inject context, etc.
// without touching composer internals.
//
// ── Attachment mode ──────────────────────────────────────────
// `attachmentMode` advises the composer where this fragment most
// naturally slots. Compositions are not bound to it — a composition
// can put any fragment anywhere — but the UI uses it to suggest
// which slots make sense.

import type { GalleryDataReference, JsonObject } from '../../types';

export type PromptFragmentAttachmentMode =
  | 'system' // baseline persona / framing
  | 'user-instruction' // imperative addition
  | 'context-injection' // background facts
  | 'rubric-hint' // success-criteria reminder
  | 'guardrail' // constraint reminder
  | 'closing' // tail instruction (e.g. "respond as JSON")
  | 'wrapper'; // wraps another slot's content

export type PromptFragmentVariableKind = 'string' | 'multiline' | 'enum' | 'number' | 'boolean';

export type PromptFragmentVariable = {
  name: string;
  kind: PromptFragmentVariableKind;
  required: boolean;
  description?: string;
  defaultValue?: string;
  enum?: string[];
};

export type PromptFragmentScript = {
  kind: 'qjs-eval' | 'framework-method';
  body?: string;
  methodNamespace?: string;
  methodName?: string;
  trigger: 'before-render' | 'after-render' | 'before-send';
  /**
   * If the script returns null/undefined, treat as skip — the fragment
   * contributes nothing to the slot. Otherwise the return value
   * replaces the fragment body for this assembly.
   */
  skipOnNull?: boolean;
};

export type PromptFragment = {
  id: string;
  settingsId: string;
  label: string;
  description?: string;
  body: string;
  attachmentMode: PromptFragmentAttachmentMode;
  variables: PromptFragmentVariable[];
  preRenderScript?: PromptFragmentScript;
  /**
   * Tags for ergonomic filtering in the settings menu. Free-form,
   * unlike the gallery's CANONICAL_TAGS.
   */
  tags?: string[];
  authoredBy: 'user' | 'agent' | 'system' | 'extension';
  extensionId?: string;
  createdAt: string;
  updatedAt: string;
};

export const promptFragmentMockData: PromptFragment[] = [
  // ── Default user-baseline fragments ────────────────────────────
  {
    id: 'frag_terse_default',
    settingsId: 'settings_default',
    label: 'Default short — be terse',
    description:
      'User has ADHD; defaults to ~100-word responses. Expand only when explicitly asked.',
    body: 'Default to short responses. Get to the point and stop. The user will ask for more if needed.',
    attachmentMode: 'system',
    variables: [],
    tags: ['user-baseline', 'communication'],
    authoredBy: 'user',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'frag_no_emoji',
    settingsId: 'settings_default',
    label: 'No emojis unless asked',
    body: 'Do not put emojis in code, docs, commit messages, or responses unless explicitly asked.',
    attachmentMode: 'system',
    variables: [],
    tags: ['user-baseline'],
    authoredBy: 'user',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'frag_default_closing',
    settingsId: 'settings_default',
    label: 'Default closing — proceed without ratification',
    body: 'You may take small decisions inline (mark them in the task approachNote). Surface only when the *goal itself* is ambiguous, never when sub-steps are.',
    attachmentMode: 'closing',
    variables: [],
    tags: ['behavior'],
    authoredBy: 'user',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },

  // ── Worker-action fragments ────────────────────────────────────
  {
    id: 'frag_dismantle_critic',
    settingsId: 'settings_default',
    label: 'Adversarial critic — Dismantle button',
    body: [
      'You are an adversarial critic. Your job is to find the load-bearing flaws in the response below.',
      '',
      'Distinguish:',
      '  - LOAD-BEARING: defects that change the conclusion or break the work',
      '  - NITPICK: stylistic / cosmetic issues that do not affect correctness',
      '',
      'Output as a structured objection set. Lead with load-bearing. Be precise — vague critiques are worse than no critique.',
      '',
      'Prior response:',
      '{{prior_response}}',
    ].join('\n'),
    attachmentMode: 'system',
    variables: [
      { name: 'prior_response', kind: 'multiline', required: true, description: 'The response to dismantle.' },
    ],
    tags: ['worker-action', 'critique'],
    authoredBy: 'user',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'frag_steelman',
    settingsId: 'settings_default',
    label: 'Steelman — make the strongest case for correctness',
    body: [
      'Make the strongest possible case that the response below is correct.',
      'Surface the assumptions that have to hold for it to be right; flag any that are load-bearing.',
      'If after honest steelmanning the response still seems wrong, say so plainly.',
      '',
      'Response:',
      '{{prior_response}}',
    ].join('\n'),
    attachmentMode: 'system',
    variables: [
      { name: 'prior_response', kind: 'multiline', required: true },
    ],
    tags: ['worker-action', 'reframe'],
    authoredBy: 'user',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'frag_second_approach',
    settingsId: 'settings_default',
    label: 'Second approach — diverge structurally',
    body: [
      'Solve the problem below, but treat the prior response as the obvious solution that you should AVOID.',
      'Find a structurally different framing — different decomposition, different mechanism, different vocabulary.',
      'If you cannot diverge meaningfully, say so — do not paraphrase.',
      '',
      'Problem: {{problem}}',
      'Prior (avoid): {{prior_response}}',
    ].join('\n'),
    attachmentMode: 'system',
    variables: [
      { name: 'problem', kind: 'multiline', required: true },
      { name: 'prior_response', kind: 'multiline', required: true },
    ],
    tags: ['worker-action', 'reframe'],
    authoredBy: 'user',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },

  // ── Programmable fragment with a pre-render script ─────────────
  {
    id: 'frag_dynamic_cwd',
    settingsId: 'settings_default',
    label: 'Working directory hint (computed)',
    description:
      'Shows the worker the current working directory at assembly time. Pre-render script returns the cwd; if the worker is in a sandbox / no-fs context, returns null and the fragment is skipped.',
    body: 'Working directory: {{cwd}}',
    attachmentMode: 'context-injection',
    variables: [
      { name: 'cwd', kind: 'string', required: true },
    ],
    preRenderScript: {
      kind: 'framework-method',
      methodNamespace: 'system',
      methodName: 'cwdOrNull',
      trigger: 'before-render',
      skipOnNull: true,
    },
    tags: ['dynamic', 'fs'],
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },

  // ── Strict-profile alternate of the terse fragment ─────────────
  {
    id: 'frag_strict_confidentiality',
    settingsId: 'settings_work_strict',
    label: 'Strict — client confidentiality',
    body:
      'You are working on a client codebase. Do not reference internal libraries, prior engagements, or unrelated projects. Treat every file as confidential.',
    attachmentMode: 'system',
    variables: [],
    tags: ['strict-profile', 'compliance'],
    authoredBy: 'user',
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
];

export const promptFragmentSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'PromptFragment',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'settingsId',
      'label',
      'body',
      'attachmentMode',
      'variables',
      'authoredBy',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      label: { type: 'string' },
      description: { type: 'string' },
      body: { type: 'string' },
      attachmentMode: {
        type: 'string',
        enum: [
          'system',
          'user-instruction',
          'context-injection',
          'rubric-hint',
          'guardrail',
          'closing',
          'wrapper',
        ],
      },
      variables: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'kind', 'required'],
          properties: {
            name: { type: 'string' },
            kind: { type: 'string', enum: ['string', 'multiline', 'enum', 'number', 'boolean'] },
            required: { type: 'boolean' },
            description: { type: 'string' },
            defaultValue: { type: 'string' },
            enum: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      preRenderScript: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'trigger'],
        properties: {
          kind: { type: 'string', enum: ['qjs-eval', 'framework-method'] },
          body: { type: 'string' },
          methodNamespace: { type: 'string' },
          methodName: { type: 'string' },
          trigger: { type: 'string', enum: ['before-render', 'after-render', 'before-send'] },
          skipOnNull: { type: 'boolean' },
        },
      },
      tags: { type: 'array', items: { type: 'string' } },
      authoredBy: { type: 'string', enum: ['user', 'agent', 'system', 'extension'] },
      extensionId: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const promptFragmentReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Compositions (slot fragments)',
    targetSource: 'cart/app/gallery/data/composition.ts',
    sourceField: 'id',
    targetField: 'slots[].sources[].ref (when kind=src_prompt-fragment)',
    summary:
      'Fragments are slotted into compositions via the src_prompt-fragment source kind. A single fragment can appear in many compositions.',
  },
  {
    kind: 'references',
    label: 'Source kind registry',
    targetSource: 'cart/app/gallery/data/composition-source-kind.ts',
    sourceField: '(registered as src_prompt-fragment)',
    targetField: 'id',
    summary:
      'PromptFragment is just one of many source kinds the composer understands. Coexists with system-message, prompt-template, glossary-attach, etc.',
  },
];
