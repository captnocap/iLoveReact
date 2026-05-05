// ModelFamily — abstract model identity, independent of provider.
//
// "Opus 4 four times over" = one ModelFamily, four Models, each pointing
// at a different Connection. Family carries the things that travel with
// the architecture (training generation, base capabilities, context
// window class) regardless of who serves it.
//
// `Model.familyId` is the FK target. `Model.family` (string enum) is
// retained for one cycle as a denormalized convenience for filtering;
// new code should resolve via familyId.

import type { GalleryDataReference, JsonObject } from '../../types';

export type ModelGeneration = 'gpt-4' | 'gpt-5' | 'claude-3' | 'claude-4' | 'kimi-k2' | 'local';

export type ModelFamilyCapabilityClass = {
  /** Whether the family natively supports tool calls. */
  tools: boolean;
  /** Has a thinking / extended-reasoning mode. */
  thinking: boolean;
  /** Vision-capable as a class. Specific Models may opt out. */
  vision: boolean;
  /** Has a server-side prompt cache. */
  promptCache: boolean;
};

export type ModelFamily = {
  id: string;
  label: string;
  generation: ModelGeneration;
  /** Token-class. Specific Models may set their own contextWindow. */
  defaultContextWindow: number;
  capabilities: ModelFamilyCapabilityClass;
  /** Origin organization — Anthropic, OpenAI, Moonshot, etc. */
  origin: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

export const modelFamilyMockData: ModelFamily[] = [
  {
    id: 'fam_claude_4',
    label: 'Claude 4 family',
    generation: 'claude-4',
    defaultContextWindow: 200_000,
    capabilities: { tools: true, thinking: true, vision: true, promptCache: true },
    origin: 'Anthropic',
    summary: 'Opus / Sonnet / Haiku. Opus pushes the long-context end (1M).',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  },
  {
    id: 'fam_kimi_k2',
    label: 'Kimi K2 family',
    generation: 'kimi-k2',
    defaultContextWindow: 128_000,
    capabilities: { tools: true, thinking: true, vision: false, promptCache: false },
    origin: 'Moonshot',
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'fam_gpt_5',
    label: 'GPT-5 family',
    generation: 'gpt-5',
    defaultContextWindow: 400_000,
    capabilities: { tools: true, thinking: true, vision: true, promptCache: true },
    origin: 'OpenAI',
    summary: 'Codex CLI defaults here. Reasoning_effort knob is family-level.',
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'fam_local',
    label: 'Local runtime family',
    generation: 'local',
    defaultContextWindow: 32_000,
    capabilities: { tools: false, thinking: false, vision: false, promptCache: false },
    origin: '(varies)',
    summary: 'On-device GGUF / safetensors. Capabilities depend on the specific model file.',
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-20T00:00:00Z',
  },
];

export const modelFamilySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ModelFamily',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label', 'generation', 'defaultContextWindow', 'capabilities', 'origin', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      generation: {
        type: 'string',
        enum: ['gpt-4', 'gpt-5', 'claude-3', 'claude-4', 'kimi-k2', 'local'],
      },
      defaultContextWindow: { type: 'number' },
      capabilities: {
        type: 'object',
        additionalProperties: false,
        required: ['tools', 'thinking', 'vision', 'promptCache'],
        properties: {
          tools: { type: 'boolean' },
          thinking: { type: 'boolean' },
          vision: { type: 'boolean' },
          promptCache: { type: 'boolean' },
        },
      },
      origin: { type: 'string' },
      summary: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const modelFamilyReferences: GalleryDataReference[] = [
  {
    kind: 'has-many',
    label: 'Models',
    targetSource: 'cart/app/gallery/data/core/model.ts',
    sourceField: 'id',
    targetField: 'familyId',
    summary:
      'A family fans out into N Models — each (family, provider, connection) tuple is a distinct Model row. "Opus 4 four times over" = 4 Model rows under fam_claude_4.',
  },
];
