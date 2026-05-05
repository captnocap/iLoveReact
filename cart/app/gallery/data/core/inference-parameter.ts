// InferenceParameter — catalog of per-request knobs supported by the
// various connection paths. Analogous to env-var.ts: each row is scoped
// by `applicableKinds`, because the same provider may expose different
// knobs depending on whether you reach it through the CLI or the raw
// API (the Claude Code CLI, in particular, hides almost all sampling
// knobs — only max_output_tokens is user-controllable).
//
// Rows may further scope by model family (thinking budget only on
// claude-4) or specific model id (reasoning_effort only on gpt-5).
//
// Preset rows (inference-preset.ts) reference parameters by `name`
// from this catalog.

import type { GalleryDataReference, JsonObject } from '../../types';
import { CONNECTION_KINDS, type ConnectionKind } from './connection';
import type { ModelFamily } from './model';

export type InferenceParameterRole =
  | 'sampling' // temperature, top_p, top_k, min_p
  | 'budget' // max_tokens, thinking budget
  | 'control' // stop, response_format, tool_choice
  | 'reasoning' // reasoning_effort, thinking.type
  | 'local-sampler' // mirostat, repeat_penalty, seed
  | 'metadata'; // user_id, request metadata

export type InferenceParameterType =
  | 'number'
  | 'integer'
  | 'string'
  | 'boolean'
  | 'enum'
  | 'array'
  | 'object';

export type InferenceParameter = {
  name: string;
  role: InferenceParameterRole;
  type: InferenceParameterType;
  range?: { min?: number; max?: number };
  enum?: string[];
  default?: string | number | boolean;
  applicableKinds: ConnectionKind[];
  applicableFamilies?: ModelFamily[];
  applicableModelIds?: string[];
  excludedModelIds?: string[];
  summary: string;
};

export const inferenceParameterMockData: InferenceParameter[] = [
  // ── Sampling ────────────────────────────────────────────────────────
  {
    name: 'temperature',
    role: 'sampling',
    type: 'number',
    range: { min: 0.0, max: 2.0 },
    default: 1.0,
    applicableKinds: ['anthropic-api-key', 'kimi-api-key', 'openai-api-key', 'local-runtime'],
    summary:
      'Sampling randomness. Not exposed on the Claude Code CLI path — the CLI fixes this internally.',
  },
  {
    name: 'top_p',
    role: 'sampling',
    type: 'number',
    range: { min: 0.0, max: 1.0 },
    default: 1.0,
    applicableKinds: ['anthropic-api-key', 'kimi-api-key', 'openai-api-key', 'local-runtime'],
    summary: 'Nucleus sampling cutoff. Paired with temperature; most guides recommend tuning one, not both.',
  },
  {
    name: 'top_k',
    role: 'sampling',
    type: 'integer',
    range: { min: 1, max: 500 },
    applicableKinds: ['anthropic-api-key', 'local-runtime'],
    summary:
      'Top-K sampling cap. Anthropic Messages API and local runtimes expose this; OpenAI and Kimi do not.',
  },
  {
    name: 'min_p',
    role: 'sampling',
    type: 'number',
    range: { min: 0.0, max: 1.0 },
    applicableKinds: ['local-runtime'],
    summary: 'Minimum-P sampling floor. Local runtimes only (llama.cpp / ollama family).',
  },

  // ── Budget ──────────────────────────────────────────────────────────
  {
    name: 'max_tokens',
    role: 'budget',
    type: 'integer',
    range: { min: 1, max: 200_000 },
    applicableKinds: ['anthropic-api-key', 'kimi-api-key', 'openai-api-key', 'local-runtime'],
    summary:
      'Hard ceiling on output tokens. Required on the Anthropic Messages API; optional on others. The Claude Code CLI honors this indirectly via the CLAUDE_CODE_MAX_OUTPUT_TOKENS env var, not a per-request field.',
  },
  {
    name: 'max_output_tokens',
    role: 'budget',
    type: 'integer',
    range: { min: 1, max: 100_000 },
    applicableKinds: ['openai-api-key'],
    applicableModelIds: ['gpt-5'],
    summary: 'GPT-5 output ceiling. OpenAI renamed the field for the reasoning-model path.',
  },
  {
    name: 'thinking.budget_tokens',
    role: 'budget',
    type: 'integer',
    range: { min: 1024, max: 64_000 },
    // claude-code-cli reaches the same Anthropic API via OAuth, so the
    // thinking surface applies identically. Earlier revisions of this
    // catalog entry omitted claude-code-cli, which made the Settings
    // probe-driven UI hide reasoning controls for that kind despite
    // them working at the API level.
    applicableKinds: ['anthropic-api-key', 'claude-code-cli'],
    applicableFamilies: ['claude-4'],
    excludedModelIds: ['claude-haiku-4-5'],
    summary:
      'Extended-thinking budget. Claude-4 family only, and not Haiku. Enables an internal reasoning pass before the visible response.',
  },

  // ── Control ─────────────────────────────────────────────────────────
  {
    name: 'stop_sequences',
    role: 'control',
    type: 'array',
    applicableKinds: ['anthropic-api-key', 'kimi-api-key', 'openai-api-key', 'local-runtime'],
    summary: 'Early-termination strings. Field is called `stop` on OpenAI; `stop_sequences` on Anthropic.',
  },
  {
    name: 'response_format',
    role: 'control',
    type: 'object',
    applicableKinds: ['openai-api-key', 'kimi-api-key'],
    summary:
      'Structured-output spec (json_schema / json_object). Anthropic uses tool_use for this shape; local depends on the runtime.',
  },
  {
    name: 'tool_choice',
    role: 'control',
    type: 'object',
    applicableKinds: ['anthropic-api-key', 'kimi-api-key', 'openai-api-key'],
    summary: 'Forces / disables / specifies tool use. All hosted providers expose this; local runtimes generally do not.',
  },

  // ── Reasoning ───────────────────────────────────────────────────────
  {
    name: 'reasoning_effort',
    role: 'reasoning',
    type: 'enum',
    enum: ['low', 'medium', 'high'],
    default: 'medium',
    applicableKinds: ['openai-api-key'],
    applicableModelIds: ['gpt-5'],
    summary: 'GPT-5 reasoning-depth knob. No analog on Anthropic — Claude uses `thinking.budget_tokens` instead.',
  },
  {
    name: 'thinking.type',
    role: 'reasoning',
    type: 'enum',
    enum: ['enabled', 'disabled'],
    default: 'disabled',
    // Same applicability as thinking.budget_tokens — Anthropic API
    // surface, reachable via either an API key or the claude-code CLI's
    // OAuth path.
    applicableKinds: ['anthropic-api-key', 'claude-code-cli'],
    applicableFamilies: ['claude-4'],
    summary: 'Extended-thinking toggle. Paired with thinking.budget_tokens.',
  },

  // ── Local sampler ───────────────────────────────────────────────────
  {
    name: 'mirostat_tau',
    role: 'local-sampler',
    type: 'number',
    range: { min: 0.1, max: 10.0 },
    default: 5.0,
    applicableKinds: ['local-runtime'],
    summary: 'Mirostat target entropy. llama.cpp family.',
  },
  {
    name: 'repeat_penalty',
    role: 'local-sampler',
    type: 'number',
    range: { min: 0.5, max: 2.0 },
    default: 1.1,
    applicableKinds: ['local-runtime'],
    summary: 'Repetition penalty. Local runtimes only; hosted providers apply this internally.',
  },
  {
    name: 'seed',
    role: 'local-sampler',
    type: 'integer',
    applicableKinds: ['openai-api-key', 'local-runtime'],
    summary:
      'Deterministic sampling seed. OpenAI exposes it on a best-effort basis (not guaranteed reproducible). Local runtimes honor it exactly.',
  },

  // ── Metadata ────────────────────────────────────────────────────────
  {
    name: 'metadata.user_id',
    role: 'metadata',
    type: 'string',
    applicableKinds: ['anthropic-api-key'],
    summary: 'End-user identifier for Anthropic abuse tracking. Opaque per-user hash, never the real email.',
  },
  {
    name: 'user',
    role: 'metadata',
    type: 'string',
    applicableKinds: ['openai-api-key'],
    summary: 'OpenAI end-user identifier. Same purpose as Anthropic metadata.user_id, different field name.',
  },
];

// ── Schema ─────────────────────────────────────────────────────────────

const parameterRoleEnum = [
  'sampling',
  'budget',
  'control',
  'reasoning',
  'local-sampler',
  'metadata',
];

const parameterTypeEnum = [
  'number',
  'integer',
  'string',
  'boolean',
  'enum',
  'array',
  'object',
];

const modelFamilyEnum = ['claude-4', 'claude-3', 'kimi-k2', 'gpt-5', 'gpt-4o', 'local'];

export const inferenceParameterSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'InferenceParameter',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'role', 'type', 'applicableKinds', 'summary'],
    properties: {
      name: { type: 'string' },
      role: { type: 'string', enum: parameterRoleEnum },
      type: { type: 'string', enum: parameterTypeEnum },
      range: {
        type: 'object',
        additionalProperties: false,
        properties: {
          min: { type: 'number' },
          max: { type: 'number' },
        },
      },
      enum: { type: 'array', items: { type: 'string' } },
      default: {},
      applicableKinds: {
        type: 'array',
        items: { type: 'string', enum: CONNECTION_KINDS },
      },
      applicableFamilies: {
        type: 'array',
        items: { type: 'string', enum: modelFamilyEnum },
      },
      applicableModelIds: { type: 'array', items: { type: 'string' } },
      excludedModelIds: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
  },
};

export const inferenceParameterReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Connection kinds',
    targetSource: 'cart/app/gallery/data/connection.ts',
    sourceField: 'applicableKinds[]',
    targetField: 'kind',
    summary:
      'Scopes a parameter to a subset of connection kinds. Key asymmetry: `claude-code-cli` exposes almost no sampling knobs; `anthropic-api-key` and `local-runtime` expose the widest surfaces.',
  },
  {
    kind: 'references',
    label: 'Models',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'applicableModelIds[] / excludedModelIds[] / applicableFamilies[]',
    targetField: 'id / family',
    summary:
      'Fine-grained scoping for params that only apply to specific families or models (e.g. reasoning_effort → gpt-5 only, thinking.budget_tokens → claude-4 but not Haiku).',
  },
  {
    kind: 'has-many',
    label: 'Preset values',
    targetSource: 'cart/app/gallery/data/inference-preset.ts',
    sourceField: 'name',
    targetField: 'values[].parameter',
    summary:
      'Presets reference parameters by name. The applicability fields here let the preset editor filter valid params for the current worker connection + model.',
  },
];
