// Role — a named persona with default model / preset + a bundle of
// Skills. Roles are the "who" of a worker — Planner, Implementer,
// Reviewer, Documentarian. A single worker spawn binds a Role; the
// Role determines which skills are available, what the base system
// message is, and what the default model + sampling preset should be.
//
// Assignments of Role to scope (session / workspace / worker) live
// in role-assignment.ts.

import type { GalleryDataReference, JsonObject } from '../../types';

export type Role = {
  id: string;
  settingsId: string;
  label: string;
  description: string;
  defaultModelId?: string;
  defaultPresetId?: string;
  baseSystemMessageId?: string;
  /**
   * Opt-in: when set, the assembler uses this Composition to build
   * the worker's prompt instead of walking baseSystemMessageId +
   * skill.systemMessageId directly. Net-additive — when unset, fall
   * back to legacy behavior.
   */
  compositionId?: string;
  skills: string[]; // skill.id values
  requiredCapabilities: string[]; // union of skill reqs + role baseline
  createdAt: string;
  updatedAt: string;
};

export const roleMockData: Role[] = [
  {
    id: 'role_planner',
    settingsId: 'settings_default',
    label: 'Planner',
    description:
      'Architects migrations, refactors, and feature plans. Read-heavy; does not implement. Pairs with extended-thinking presets for non-trivial plans.',
    defaultModelId: 'claude-opus-4-7',
    defaultPresetId: 'preset_claude_thinking',
    baseSystemMessageId: 'sysmsg_planner',
    skills: ['skill_migration_plan', 'skill_debug_triage'],
    requiredCapabilities: [
      'model.thinking',
      'model.long_context',
      'tool.read',
      'tool.grep',
      'fs.read',
    ],
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'role_implementer',
    settingsId: 'settings_default',
    label: 'Implementer',
    description:
      'Applies planned changes. Requires write + shell for verification. Paired with the Precise preset to keep diffs minimal.',
    defaultModelId: 'claude-opus-4-7',
    defaultPresetId: 'preset_precise',
    baseSystemMessageId: 'sysmsg_precise_engineer',
    skills: ['skill_implement'],
    requiredCapabilities: [
      'model.tools',
      'tool.read',
      'tool.write',
      'tool.bash',
      'fs.read',
      'fs.write',
    ],
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'role_reviewer',
    settingsId: 'settings_default',
    label: 'Reviewer',
    description:
      'Diff reviewer. Read-only — does not modify files. Safe to run on any branch state.',
    defaultModelId: 'claude-sonnet-4-6',
    defaultPresetId: 'preset_precise',
    baseSystemMessageId: 'sysmsg_reviewer',
    skills: ['skill_code_review', 'skill_document_section'],
    requiredCapabilities: ['model.tools', 'tool.read', 'tool.grep', 'fs.read'],
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'role_documentarian',
    settingsId: 'settings_default',
    label: 'Documentarian',
    description:
      'Produces structured docs for components, hooks, and shapes. Read + grep only; never writes to code, only to docs paths.',
    defaultModelId: 'claude-sonnet-4-6',
    defaultPresetId: 'preset_precise',
    skills: ['skill_document_section'],
    requiredCapabilities: ['tool.read', 'tool.grep', 'fs.read'],
    createdAt: '2026-04-15T00:00:00Z',
    updatedAt: '2026-04-15T00:00:00Z',
  },
  {
    id: 'role_reviewer_strict',
    settingsId: 'settings_work_strict',
    label: 'Reviewer (strict)',
    description:
      'Client-profile reviewer. No Bash, no Write. Matches the strict privacy tool allowlist.',
    defaultModelId: 'claude-sonnet-4-6',
    defaultPresetId: 'preset_precise',
    baseSystemMessageId: 'sysmsg_strict_work',
    skills: ['skill_review_readonly'],
    requiredCapabilities: ['model.tools', 'tool.read', 'tool.grep', 'fs.read', 'net.proxy'],
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
];

export const roleSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Role',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'settingsId',
      'label',
      'description',
      'skills',
      'requiredCapabilities',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      label: { type: 'string' },
      description: { type: 'string' },
      defaultModelId: { type: 'string' },
      defaultPresetId: { type: 'string' },
      baseSystemMessageId: { type: 'string' },
      skills: { type: 'array', items: { type: 'string' } },
      requiredCapabilities: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const roleReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Default model',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'defaultModelId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Default preset',
    targetSource: 'cart/app/gallery/data/inference-preset.ts',
    sourceField: 'defaultPresetId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Base system message',
    targetSource: 'cart/app/gallery/data/system-message.ts',
    sourceField: 'baseSystemMessageId',
    targetField: 'id',
    summary:
      'Applied to every turn the role plays. Stacks with any skill-level system message (skill system message prepended).',
  },
  {
    kind: 'references',
    label: 'Skills',
    targetSource: 'cart/app/gallery/data/skill.ts',
    sourceField: 'skills[]',
    targetField: 'id',
    summary:
      'The skill set available to this role. The UI shows only these when a worker is playing this role.',
  },
  {
    kind: 'references',
    label: 'Required capabilities',
    targetSource: 'cart/app/gallery/data/capability.ts',
    sourceField: 'requiredCapabilities[]',
    targetField: 'id',
    summary:
      'Baseline capabilities the role needs regardless of skill. Resolver union-merges with each active skill\'s requirements.',
  },
  {
    kind: 'has-many',
    label: 'Assignments',
    targetSource: 'cart/app/gallery/data/role-assignment.ts',
    sourceField: 'id',
    targetField: 'roleId',
    summary: 'Role assignments bind a role to a scope (session / workspace / worker / default).',
  },
];
