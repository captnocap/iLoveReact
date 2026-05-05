// PromptTemplate — reusable user-message scaffold owned by a Settings
// profile. Unlike SystemMessage (which frames the agent's persona),
// PromptTemplate frames the *task* — a code review checklist, a
// migration planner, a bug-triage walkthrough.
//
// Referenced by InferencePreset.promptTemplateId and Skill.
// promptTemplateId. Variables are typed and validated at render time.

import type { GalleryDataReference, JsonObject } from '../../types';

export type PromptVariableType = 'string' | 'multiline' | 'enum' | 'number' | 'boolean';

export type PromptVariable = {
  name: string;
  type: PromptVariableType;
  required: boolean;
  description?: string;
  enum?: string[];
  default?: string | number | boolean;
};

export type PromptIntent =
  | 'plan'
  | 'review'
  | 'implement'
  | 'analyze'
  | 'refactor'
  | 'debug'
  | 'document';

export type PromptTemplate = {
  id: string;
  settingsId: string;
  label: string;
  intent: PromptIntent;
  body: string;
  variables?: PromptVariable[];
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

export const promptTemplateMockData: PromptTemplate[] = [
  {
    id: 'tmpl_code_review',
    settingsId: 'settings_default',
    label: 'Code review',
    intent: 'review',
    body: [
      'Review the following changes for correctness, safety, and style.',
      '',
      'Base branch: {{base_branch}}',
      'Scope: {{scope}}',
      '',
      'Diff:',
      '```diff',
      '{{diff}}',
      '```',
      '',
      'Call out: load-bearing assumptions, silent failure modes, regressions risk. Approve only if all three are handled.',
    ].join('\n'),
    variables: [
      { name: 'base_branch', type: 'string', required: false, default: 'main' },
      { name: 'scope', type: 'string', required: true, description: 'Area of the codebase under review.' },
      { name: 'diff', type: 'multiline', required: true },
    ],
    summary: 'Paired with the Reviewer role and the code-review skill.',
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'tmpl_migration_plan',
    settingsId: 'settings_default',
    label: 'Migration plan',
    intent: 'plan',
    body: [
      'Produce a numbered migration plan for the following change.',
      '',
      'Current shape: {{current}}',
      'Target shape: {{target}}',
      'Constraints: {{constraints}}',
      '',
      'Requirements: every step a concrete action, zero ambiguity. Call out reversibility, blast radius, and rollback per step.',
    ].join('\n'),
    variables: [
      { name: 'current', type: 'multiline', required: true },
      { name: 'target', type: 'multiline', required: true },
      {
        name: 'constraints',
        type: 'multiline',
        required: false,
        default: 'none',
      },
    ],
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'tmpl_bug_triage',
    settingsId: 'settings_default',
    label: 'Bug triage',
    intent: 'debug',
    body: [
      'Triage the following bug report.',
      '',
      'Symptom: {{symptom}}',
      'Repro: {{repro}}',
      'First-seen: {{first_seen}}',
      '',
      'Produce: hypothesis list ranked by likelihood, the smallest diagnostic to disambiguate the top two, and the trap to set if the bug hides.',
    ].join('\n'),
    variables: [
      { name: 'symptom', type: 'multiline', required: true },
      { name: 'repro', type: 'multiline', required: false },
      { name: 'first_seen', type: 'string', required: false, default: 'unknown' },
    ],
    createdAt: '2026-04-15T00:00:00Z',
    updatedAt: '2026-04-15T00:00:00Z',
  },
  {
    id: 'tmpl_doc_section',
    settingsId: 'settings_default',
    label: 'Document a section',
    intent: 'document',
    body: [
      'Document the following {{subject_kind}}.',
      '',
      'Subject: {{subject}}',
      'Audience: {{audience}}',
      '',
      'Produce a markdown section with: one-sentence summary, when to use, when not to use, at least one minimal example, and known limitations.',
    ].join('\n'),
    variables: [
      {
        name: 'subject_kind',
        type: 'enum',
        required: true,
        enum: ['component', 'hook', 'script', 'shape', 'primitive'],
      },
      { name: 'subject', type: 'string', required: true },
      { name: 'audience', type: 'string', required: false, default: 'new contributor' },
    ],
    createdAt: '2026-04-15T00:00:00Z',
    updatedAt: '2026-04-15T00:00:00Z',
  },
];

export const promptTemplateSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'PromptTemplate',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'settingsId', 'label', 'intent', 'body', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      label: { type: 'string' },
      intent: {
        type: 'string',
        enum: ['plan', 'review', 'implement', 'analyze', 'refactor', 'debug', 'document'],
      },
      body: { type: 'string' },
      variables: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'type', 'required'],
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['string', 'multiline', 'enum', 'number', 'boolean'] },
            required: { type: 'boolean' },
            description: { type: 'string' },
            enum: { type: 'array', items: { type: 'string' } },
            default: {},
          },
        },
      },
      summary: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const promptTemplateReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary: 'Templates are profile-scoped.',
  },
  {
    kind: 'has-many',
    label: 'Presets (linkage)',
    targetSource: 'cart/app/gallery/data/inference-preset.ts',
    sourceField: 'id',
    targetField: 'promptTemplateId',
    summary: 'Presets may bind a template so the preset encapsulates task-shape too, not just sampling.',
  },
  {
    kind: 'has-many',
    label: 'Skills (linkage)',
    targetSource: 'cart/app/gallery/data/skill.ts',
    sourceField: 'id',
    targetField: 'promptTemplateId',
    summary: 'Skills compose a prompt template + system message + tool requirements into a reusable unit.',
  },
];
