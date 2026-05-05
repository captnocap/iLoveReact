// Capability — the shared vocabulary used by skills, roles, connections,
// models, and privacy policies to describe "what can be done."
//
// A capability is a stable id (e.g. `model.thinking`, `tool.bash`,
// `fs.write`) plus a category and a summary. Three kinds of entities
// interact with this catalog:
//
//   Providers of capabilities:
//     - Connection.capabilities (streaming, tools, thinking, ...)
//     - Model.capabilities (streaming, tools, thinking, vision, ...)
//   Restrictors of capabilities:
//     - Privacy.tools (allowed/denied tool set)
//     - Privacy.filesystem (path exposure + read-only overrides)
//     - Privacy.telemetry.localOnly (blocks net.direct)
//   Requirers of capabilities:
//     - Skill.requiredCapabilities
//     - Role.requiredCapabilities
//
// The request resolver checks: does the merge of the active
// Connection + Model *provide* every capability the selected Role/Skill
// *requires*, and does the active Privacy not *restrict* any of them?

import type { GalleryDataReference, JsonObject } from '../../types';

export type CapabilityCategory = 'model' | 'tool' | 'fs' | 'net' | 'provider';
export type CapabilityProvider = 'connection' | 'model' | 'privacy';

export type Capability = {
  id: string;
  category: CapabilityCategory;
  label: string;
  summary: string;
  providedBy: CapabilityProvider[]; // where this capability can be resolved from
};

export const capabilityMockData: Capability[] = [
  // ── model ────────────────────────────────────────────────────────────
  {
    id: 'model.streaming',
    category: 'model',
    label: 'Streaming output',
    summary: 'Model supports incremental token / block streaming.',
    providedBy: ['connection', 'model'],
  },
  {
    id: 'model.tools',
    category: 'model',
    label: 'Tool calling',
    summary: 'Model supports structured tool use / function calling.',
    providedBy: ['connection', 'model'],
  },
  {
    id: 'model.thinking',
    category: 'model',
    label: 'Extended thinking',
    summary:
      'Model supports an internal reasoning pass (Claude-4 thinking, GPT-5 reasoning).',
    providedBy: ['model'],
  },
  {
    id: 'model.vision',
    category: 'model',
    label: 'Vision input',
    summary: 'Model accepts image input.',
    providedBy: ['model'],
  },
  {
    id: 'model.long_context',
    category: 'model',
    label: 'Long context (≥200k tokens)',
    summary: 'Context window ≥ 200k tokens.',
    providedBy: ['model'],
  },
  {
    id: 'model.prompt_cache',
    category: 'model',
    label: 'Prompt caching',
    summary: 'Provider supports prompt cache reads / writes.',
    providedBy: ['connection', 'model'],
  },

  // ── tool ─────────────────────────────────────────────────────────────
  {
    id: 'tool.read',
    category: 'tool',
    label: 'Read files',
    summary: 'Tool: read file contents from disk.',
    providedBy: ['privacy'],
  },
  {
    id: 'tool.write',
    category: 'tool',
    label: 'Write / edit files',
    summary: 'Tool: create or modify files on disk.',
    providedBy: ['privacy'],
  },
  {
    id: 'tool.bash',
    category: 'tool',
    label: 'Run shell commands',
    summary: 'Tool: execute arbitrary bash commands in the host shell.',
    providedBy: ['privacy'],
  },
  {
    id: 'tool.grep',
    category: 'tool',
    label: 'Search repo',
    summary: 'Tool: grep / glob across exposed paths.',
    providedBy: ['privacy'],
  },
  {
    id: 'tool.web_fetch',
    category: 'tool',
    label: 'Fetch URLs',
    summary: 'Tool: HTTP fetch of arbitrary URLs.',
    providedBy: ['privacy'],
  },
  {
    id: 'tool.web_search',
    category: 'tool',
    label: 'Web search',
    summary: 'Tool: query a search provider.',
    providedBy: ['privacy'],
  },

  // ── fs ───────────────────────────────────────────────────────────────
  {
    id: 'fs.read',
    category: 'fs',
    label: 'Filesystem read',
    summary: 'At least one exposed path is readable.',
    providedBy: ['privacy'],
  },
  {
    id: 'fs.write',
    category: 'fs',
    label: 'Filesystem write',
    summary: 'At least one exposed path is writable (not in readOnlyPaths).',
    providedBy: ['privacy'],
  },

  // ── net ──────────────────────────────────────────────────────────────
  {
    id: 'net.direct',
    category: 'net',
    label: 'Direct outbound network',
    summary:
      'Unproxied outbound traffic is permitted. Blocked by Privacy.proxy.enabled=true or Privacy.telemetry.localOnly=true.',
    providedBy: ['privacy'],
  },
  {
    id: 'net.proxy',
    category: 'net',
    label: 'Proxied outbound network',
    summary: 'Outbound traffic flows through the configured proxy.',
    providedBy: ['privacy'],
  },
  {
    id: 'net.local_only',
    category: 'net',
    label: 'Local-only (offline)',
    summary: 'No outbound traffic; only local-runtime connections are usable.',
    providedBy: ['privacy'],
  },

  // ── provider ────────────────────────────────────────────────────────
  {
    id: 'provider.anthropic',
    category: 'provider',
    label: 'Anthropic',
    summary: 'At least one anthropic Connection is active.',
    providedBy: ['connection'],
  },
  {
    id: 'provider.openai',
    category: 'provider',
    label: 'OpenAI',
    summary: 'At least one openai Connection is active.',
    providedBy: ['connection'],
  },
  {
    id: 'provider.local',
    category: 'provider',
    label: 'Local runtime',
    summary: 'A local-runtime Connection is active.',
    providedBy: ['connection'],
  },
];

export const capabilitySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Capability',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'category', 'label', 'summary', 'providedBy'],
    properties: {
      id: { type: 'string' },
      category: { type: 'string', enum: ['model', 'tool', 'fs', 'net', 'provider'] },
      label: { type: 'string' },
      summary: { type: 'string' },
      providedBy: {
        type: 'array',
        items: { type: 'string', enum: ['connection', 'model', 'privacy'] },
      },
    },
  },
};

export const capabilityReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Connection capabilities (provider)',
    targetSource: 'cart/app/gallery/data/connection.ts',
    sourceField: 'id (when providedBy includes connection)',
    targetField: 'capabilities.*',
    summary:
      'Connection.capabilities booleans map to capability ids. Example: connection.capabilities.thinking=true → provides `model.thinking`.',
  },
  {
    kind: 'references',
    label: 'Model capabilities (provider)',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'id (when providedBy includes model)',
    targetField: 'capabilities.*',
    summary: 'Same pattern — Model.capabilities booleans map to these ids.',
  },
  {
    kind: 'references',
    label: 'Privacy (restrictor)',
    targetSource: 'cart/app/gallery/data/privacy.ts',
    sourceField: 'id (when providedBy includes privacy)',
    targetField: 'tools / filesystem / telemetry',
    summary:
      'Privacy policy either grants or denies tool / fs / net capabilities based on its allowlist + filesystem + telemetry blocks.',
  },
  {
    kind: 'has-many',
    label: 'Skill requirements',
    targetSource: 'cart/app/gallery/data/skill.ts',
    sourceField: 'id',
    targetField: 'requiredCapabilities[]',
    summary: 'Skills declare the capability ids they need to operate.',
  },
  {
    kind: 'has-many',
    label: 'Role requirements',
    targetSource: 'cart/app/gallery/data/role.ts',
    sourceField: 'id',
    targetField: 'requiredCapabilities[]',
    summary: 'Roles aggregate skill requirements + their own baseline.',
  },
];
