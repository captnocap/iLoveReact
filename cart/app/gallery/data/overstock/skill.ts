// Skill — a named, reusable unit of "how to do a specific thing."
//
// A Skill composes:
//   - an optional SystemMessage (persona framing)
//   - an optional PromptTemplate (task framing)
//   - a set of required Capabilities (model.thinking, tool.bash, ...)
//   - a set of required tools (by tool name — cross-checked against
//     Privacy.tools.allowed at resolve time)
//   - optional triggers that a higher layer can match against user
//     input, file patterns, or slash commands to auto-activate
//
// Analogous to Claude Code's skills (docs-generator, simplify, review,
// etc.) but first-class in the data model so the cockpit UI can list,
// filter, and invoke them without hard-coding.

import type { GalleryDataReference, JsonObject } from '../../types';

export type SkillTrigger = {
  phrases?: string[]; // substrings / simple patterns matched in user input
  slashCommand?: string; // `/review`, `/refactor`, ...
  filePatterns?: string[]; // glob(s) that activate the skill when touched
};

export type Skill = {
  id: string;
  settingsId: string;
  label: string;
  description: string;
  systemMessageId?: string;
  promptTemplateId?: string;
  /**
   * Opt-in: when set, the assembler builds the skill's prompt via
   * this Composition instead of walking systemMessageId +
   * promptTemplateId directly. Net-additive — falls back to legacy
   * fields when unset.
   */
  compositionId?: string;
  requiredCapabilities: string[]; // capability.id values
  requiredTools: string[]; // tool names — must appear in Privacy.tools.allowed
  triggers?: SkillTrigger;
  createdAt: string;
  updatedAt: string;
};

export const skillMockData: Skill[] = [
  {
    id: 'skill_code_review',
    settingsId: 'settings_default',
    label: 'Code review',
    description:
      'Rigorous diff review with defect / naming / regression callouts. Reads the diff and surrounding context; does not write.',
    systemMessageId: 'sysmsg_reviewer',
    promptTemplateId: 'tmpl_code_review',
    requiredCapabilities: ['model.tools', 'tool.read', 'tool.grep', 'fs.read'],
    requiredTools: ['Read', 'Grep', 'Glob'],
    triggers: {
      phrases: ['review this', 'code review', 'look for issues in'],
      slashCommand: '/review',
    },
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'skill_migration_plan',
    settingsId: 'settings_default',
    label: 'Migration plan',
    description:
      'Produces a numbered, zero-ambiguity migration plan. Reads current shape; does not execute.',
    systemMessageId: 'sysmsg_planner',
    promptTemplateId: 'tmpl_migration_plan',
    requiredCapabilities: ['model.thinking', 'model.long_context', 'tool.read', 'tool.grep'],
    requiredTools: ['Read', 'Grep', 'Glob'],
    triggers: {
      phrases: ['plan a migration', 'migration plan', 'how should we migrate'],
      slashCommand: '/migration-plan',
    },
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'skill_implement',
    settingsId: 'settings_default',
    label: 'Implement change',
    description: 'Applies a planned change. Requires write + bash to run verification.',
    systemMessageId: 'sysmsg_precise_engineer',
    requiredCapabilities: [
      'model.tools',
      'tool.read',
      'tool.write',
      'tool.bash',
      'fs.read',
      'fs.write',
    ],
    requiredTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep'],
    triggers: {
      slashCommand: '/implement',
    },
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'skill_debug_triage',
    settingsId: 'settings_default',
    label: 'Bug triage',
    description: 'Hypothesis-ranked triage. Surfaces smallest diagnostic and trap-before-fix approach.',
    systemMessageId: 'sysmsg_thinking_deep',
    promptTemplateId: 'tmpl_bug_triage',
    requiredCapabilities: ['model.thinking', 'tool.read', 'tool.grep', 'tool.bash', 'fs.read'],
    requiredTools: ['Read', 'Grep', 'Glob', 'Bash'],
    triggers: {
      phrases: ['debug this', 'triage this bug', 'why is this failing'],
      slashCommand: '/triage',
    },
    createdAt: '2026-04-15T00:00:00Z',
    updatedAt: '2026-04-15T00:00:00Z',
  },
  {
    id: 'skill_document_section',
    settingsId: 'settings_default',
    label: 'Document a section',
    description: 'Produces a structured markdown section: summary, when-to / when-not-to, example, limitations.',
    promptTemplateId: 'tmpl_doc_section',
    requiredCapabilities: ['tool.read', 'tool.grep', 'fs.read'],
    requiredTools: ['Read', 'Grep', 'Glob'],
    triggers: {
      slashCommand: '/document',
    },
    createdAt: '2026-04-15T00:00:00Z',
    updatedAt: '2026-04-15T00:00:00Z',
  },
  {
    id: 'skill_review_readonly',
    settingsId: 'settings_work_strict',
    label: 'Strict review (readonly)',
    description:
      'Client-profile review skill. Identical prompting to skill_code_review but no Bash or Write capability required — matches the strict privacy policy\'s tool set.',
    systemMessageId: 'sysmsg_strict_work',
    promptTemplateId: 'tmpl_code_review',
    requiredCapabilities: ['model.tools', 'tool.read', 'tool.grep', 'fs.read'],
    requiredTools: ['Read', 'Grep', 'Glob'],
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
];

export const skillSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Skill',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'settingsId',
      'label',
      'description',
      'requiredCapabilities',
      'requiredTools',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      label: { type: 'string' },
      description: { type: 'string' },
      systemMessageId: { type: 'string' },
      promptTemplateId: { type: 'string' },
      requiredCapabilities: { type: 'array', items: { type: 'string' } },
      requiredTools: { type: 'array', items: { type: 'string' } },
      triggers: {
        type: 'object',
        additionalProperties: false,
        properties: {
          phrases: { type: 'array', items: { type: 'string' } },
          slashCommand: { type: 'string' },
          filePatterns: { type: 'array', items: { type: 'string' } },
        },
      },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const skillReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary: 'Skills are profile-scoped; a strict profile can carry read-only variants of general skills.',
  },
  {
    kind: 'references',
    label: 'System message',
    targetSource: 'cart/app/gallery/data/system-message.ts',
    sourceField: 'systemMessageId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Prompt template',
    targetSource: 'cart/app/gallery/data/prompt-template.ts',
    sourceField: 'promptTemplateId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Required capabilities',
    targetSource: 'cart/app/gallery/data/capability.ts',
    sourceField: 'requiredCapabilities[]',
    targetField: 'id',
    summary:
      'Resolver checks that the active Connection + Model + Privacy combined provides every id in this array.',
  },
  {
    kind: 'references',
    label: 'Required tools (Privacy)',
    targetSource: 'cart/app/gallery/data/privacy.ts',
    sourceField: 'requiredTools[]',
    targetField: 'tools.allowed[]',
    summary:
      'Tool names must appear in the active Privacy.tools.allowed set. If denied, the skill is unusable under that profile — UI surfaces this as "skill blocked by privacy."',
  },
  {
    kind: 'has-many',
    label: 'Roles (composition)',
    targetSource: 'cart/app/gallery/data/role.ts',
    sourceField: 'id',
    targetField: 'skills[]',
    summary: 'Roles are composed of skills. A Reviewer role bundles code-review + document-section, for example.',
  },
];
