// SystemMessage — reusable system-message body owned by a Settings
// profile. Referenced by InferencePreset.systemMessageId, Skill.
// systemMessageId, and Role.baseSystemMessageId so the same prose can
// be shared across presets / skills / roles without duplication.
//
// Bodies support simple `{{variable}}` placeholders. The Skill or
// Preset that references a system message is responsible for the
// variable bindings; the SystemMessage row itself stays template-level.

import type { GalleryDataReference, JsonObject } from '../../types';

export type SystemMessageVariable = {
  name: string;
  required: boolean;
  description?: string;
  default?: string;
};

export type SystemMessage = {
  id: string;
  settingsId: string;
  label: string;
  body: string;
  variables?: SystemMessageVariable[];
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

export const systemMessageMockData: SystemMessage[] = [
  {
    id: 'sysmsg_precise_engineer',
    settingsId: 'settings_default',
    label: 'Precise engineer',
    body:
      'You are a precise engineer. Prefer minimal diffs. Do not speculate; when you do not know, say so. Your working directory is {{cwd}}.',
    variables: [
      {
        name: 'cwd',
        required: false,
        description: 'Absolute path of the current working directory.',
        default: '/',
      },
    ],
    summary: 'Default working system message for the Precise preset and the Implementer role.',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'sysmsg_reviewer',
    settingsId: 'settings_default',
    label: 'Code reviewer',
    body:
      'You are a rigorous code reviewer. Flag defects, unclear naming, and risky refactors. Do not approve changes that lack tests unless the change is trivial. Base branch: {{base_branch}}.',
    variables: [
      { name: 'base_branch', required: false, default: 'main' },
    ],
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'sysmsg_planner',
    settingsId: 'settings_default',
    label: 'Planner',
    body:
      'You are a software architect. Produce numbered execution plans. Every step must be a concrete action with zero ambiguity. Surface assumptions and non-obvious dependencies before listing steps.',
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'sysmsg_thinking_deep',
    settingsId: 'settings_default',
    label: 'Think step-by-step',
    body:
      'Think step by step. Surface load-bearing assumptions before concluding. Prefer structured reasoning over intuition when the problem is non-trivial.',
    summary: 'Paired with the Claude Extended Thinking preset.',
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'sysmsg_strict_work',
    settingsId: 'settings_work_strict',
    label: 'Work profile — strict',
    body:
      'You are working on {{client_name}}\'s codebase. Do not reference internal libraries, prior engagements, or unrelated projects. Treat every file as confidential.',
    variables: [
      { name: 'client_name', required: true, description: 'Client project label.' },
    ],
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
];

export const systemMessageSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SystemMessage',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'settingsId', 'label', 'body', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      label: { type: 'string' },
      body: { type: 'string' },
      variables: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'required'],
          properties: {
            name: { type: 'string' },
            required: { type: 'boolean' },
            description: { type: 'string' },
            default: { type: 'string' },
          },
        },
      },
      summary: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const systemMessageReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary: 'System messages are profile-scoped — a work profile can carry confidentiality clauses that the personal profile does not.',
  },
  {
    kind: 'has-many',
    label: 'Presets (linkage)',
    targetSource: 'cart/app/gallery/data/inference-preset.ts',
    sourceField: 'id',
    targetField: 'systemMessageId',
    summary: 'Presets may reference a SystemMessage instead of carrying an inline body.',
  },
  {
    kind: 'has-many',
    label: 'Skills (linkage)',
    targetSource: 'cart/app/gallery/data/skill.ts',
    sourceField: 'id',
    targetField: 'systemMessageId',
    summary: 'Skills attach a system message that frames their operation.',
  },
  {
    kind: 'has-many',
    label: 'Roles (linkage)',
    targetSource: 'cart/app/gallery/data/role.ts',
    sourceField: 'id',
    targetField: 'baseSystemMessageId',
    summary: 'Roles attach a base system message applied to every turn in that persona.',
  },
];
