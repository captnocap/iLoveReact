// Model — a specific model served by a Provider.
//
// Model.id is what ends up on WorkerSession.model, VariantConfig.model,
// and WorkerState.selectedModel — all currently loose strings. This
// catalog is hand-maintained; new releases are added by hand.
//
// `availableVia` is load-bearing: the same model may be reachable
// through multiple ConnectionKinds, and the capabilities/env-var
// surface differs per connection. Example: claude-opus-4-7 works via
// both the CLI session and the Console API key, but routing env vars
// like ANTHROPIC_DEFAULT_HAIKU_MODEL only apply on the CLI path.

import type { GalleryDataReference, JsonObject } from '../../types';
import type { ConnectionKind } from './connection';

export type ModelFamily =
  | 'claude-4'
  | 'claude-3'
  | 'kimi-k2'
  | 'gpt-5'
  | 'gpt-4o'
  | 'local';

export type Model = {
  id: string;
  providerId: string;
  /** FK → cart/app/gallery/data/core/model-family.ts. Carries the family-level
   *  capability class. The `family` string below is denormalized for filter
   *  cheapness and will be removed once all consumers resolve via familyId. */
  familyId?: string;
  displayName: string;
  family: ModelFamily;
  contextWindow: number;
  availableVia: ConnectionKind[];
  pricingInputPerMTok?: number;
  pricingOutputPerMTok?: number;
  capabilities: {
    streaming: boolean;
    tools: boolean;
    thinking: boolean;
    vision: boolean;
    promptCache: boolean;
  };
  deprecated?: boolean;
  summary?: string;
};

export const modelMockData: Model[] = [
  {
    id: 'claude-opus-4-7',
    providerId: 'anthropic',
    familyId: 'fam_claude_4',
    displayName: 'Claude Opus 4.7',
    family: 'claude-4',
    contextWindow: 1_000_000,
    availableVia: ['claude-code-cli', 'anthropic-api-key'],
    pricingInputPerMTok: 15,
    pricingOutputPerMTok: 75,
    capabilities: {
      streaming: true,
      tools: true,
      thinking: true,
      vision: true,
      promptCache: true,
    },
    summary: 'Flagship reasoning model. Default for the cockpit worker.',
  },
  {
    id: 'claude-sonnet-4-6',
    providerId: 'anthropic',
    familyId: 'fam_claude_4',
    displayName: 'Claude Sonnet 4.6',
    family: 'claude-4',
    contextWindow: 200_000,
    availableVia: ['claude-code-cli', 'anthropic-api-key'],
    pricingInputPerMTok: 3,
    pricingOutputPerMTok: 15,
    capabilities: {
      streaming: true,
      tools: true,
      thinking: true,
      vision: true,
      promptCache: true,
    },
  },
  {
    id: 'claude-haiku-4-5',
    providerId: 'anthropic',
    familyId: 'fam_claude_4',
    displayName: 'Claude Haiku 4.5',
    family: 'claude-4',
    contextWindow: 200_000,
    availableVia: ['claude-code-cli', 'anthropic-api-key'],
    pricingInputPerMTok: 1,
    pricingOutputPerMTok: 5,
    capabilities: {
      streaming: true,
      tools: true,
      thinking: false,
      vision: true,
      promptCache: true,
    },
    summary: 'Routing target for ANTHROPIC_DEFAULT_HAIKU_MODEL on the CLI path.',
  },
  {
    id: 'kimi-k2',
    providerId: 'moonshot',
    familyId: 'fam_kimi_k2',
    displayName: 'Kimi K2',
    family: 'kimi-k2',
    contextWindow: 128_000,
    availableVia: ['kimi-api-key'],
    capabilities: {
      streaming: true,
      tools: true,
      thinking: true,
      vision: false,
      promptCache: false,
    },
  },
  {
    id: 'gpt-5',
    providerId: 'openai',
    familyId: 'fam_gpt_5',
    displayName: 'GPT-5',
    family: 'gpt-5',
    contextWindow: 400_000,
    availableVia: ['openai-api-key'],
    pricingInputPerMTok: 10,
    pricingOutputPerMTok: 40,
    capabilities: {
      streaming: true,
      tools: true,
      thinking: true,
      vision: true,
      promptCache: true,
    },
    summary: 'Codex CLI default.',
  },
  {
    id: 'gpt-5.4-mini',
    providerId: 'local',
    familyId: 'fam_local',
    displayName: 'GPT-5.4 mini (local)',
    family: 'local',
    contextWindow: 32_000,
    availableVia: ['local-runtime'],
    capabilities: {
      streaming: true,
      tools: false,
      thinking: false,
      vision: false,
      promptCache: false,
    },
    summary: 'Placeholder local model id used in worker-event fixtures.',
  },
];

export const modelSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Model',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'providerId',
      'displayName',
      'family',
      'contextWindow',
      'availableVia',
      'capabilities',
    ],
    properties: {
      id: { type: 'string' },
      providerId: { type: 'string' },
      familyId: { type: 'string' },
      displayName: { type: 'string' },
      family: {
        type: 'string',
        enum: ['claude-4', 'claude-3', 'kimi-k2', 'gpt-5', 'gpt-4o', 'local'],
      },
      contextWindow: { type: 'number' },
      availableVia: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'claude-code-cli',
            'anthropic-api-key',
            'kimi-api-key',
            'openai-api-key',
            'local-runtime',
          ],
        },
      },
      pricingInputPerMTok: { type: 'number' },
      pricingOutputPerMTok: { type: 'number' },
      capabilities: {
        type: 'object',
        additionalProperties: false,
        required: ['streaming', 'tools', 'thinking', 'vision', 'promptCache'],
        properties: {
          streaming: { type: 'boolean' },
          tools: { type: 'boolean' },
          thinking: { type: 'boolean' },
          vision: { type: 'boolean' },
          promptCache: { type: 'boolean' },
        },
      },
      deprecated: { type: 'boolean' },
      summary: { type: 'string' },
    },
  },
};

export const modelReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Provider',
    targetSource: 'cart/app/gallery/data/provider.ts',
    sourceField: 'providerId',
    targetField: 'id',
    summary: 'Every model belongs to exactly one Provider.',
  },
  {
    kind: 'references',
    label: 'Connection kinds',
    targetSource: 'cart/app/gallery/data/connection.ts',
    sourceField: 'availableVia[]',
    targetField: 'kind',
    summary:
      'A model may be reachable through more than one ConnectionKind. The routing/env-var surface changes per connection — see env-var.ts.',
  },
  {
    kind: 'has-many',
    label: 'Worker sessions (future FK)',
    targetSource: 'cart/app/gallery/data/worker-session.ts',
    sourceField: 'id',
    targetField: 'model',
    summary:
      'WorkerSession.model is currently a loose string; this catalog is the intended FK target.',
  },
];
