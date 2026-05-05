// EnvVar — known environment variables that shape a connection's
// behavior. Keyed by ConnectionKind, not Provider — the Claude Code CLI
// and the Anthropic API key connection share a Provider but have
// materially different env-var rosters. Keeping the FK on kind prevents
// routing vars (`ANTHROPIC_DEFAULT_HAIKU_MODEL`) from bleeding into
// paths that don't honor them.
//
// This is a curated catalog, not a dump of every variable in process
// env. Add rows only for variables we actively support or document.

import type { GalleryDataReference, JsonObject } from '../../types';
import { CONNECTION_KINDS, type ConnectionKind } from './connection';

export type EnvVarRole =
  | 'auth'
  | 'routing'
  | 'model-override'
  | 'behavior'
  | 'telemetry'
  | 'transport';

export type EnvVar = {
  name: string;
  connectionKind: ConnectionKind;
  role: EnvVarRole;
  required: boolean;
  default?: string;
  sensitive: boolean;
  summary: string;
};

export const envVarMockData: EnvVar[] = [
  // ── claude-code-cli ────────────────────────────────────────────────
  {
    name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    connectionKind: 'claude-code-cli',
    role: 'model-override',
    required: false,
    default: 'claude-haiku-4-5',
    sensitive: false,
    summary:
      'Swaps the model used for background/subagent calls. CLI-only — the raw SDK ignores this.',
  },
  {
    name: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    connectionKind: 'claude-code-cli',
    role: 'model-override',
    required: false,
    sensitive: false,
    summary: 'Override the Sonnet-tier routing target on the CLI.',
  },
  {
    name: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    connectionKind: 'claude-code-cli',
    role: 'model-override',
    required: false,
    sensitive: false,
    summary: 'Override the Opus-tier routing target on the CLI.',
  },
  {
    name: 'CLAUDE_CODE_USE_BEDROCK',
    connectionKind: 'claude-code-cli',
    role: 'transport',
    required: false,
    default: '0',
    sensitive: false,
    summary:
      'Route CLI traffic through Amazon Bedrock instead of Anthropic direct. Requires AWS credentials in the env.',
  },
  {
    name: 'CLAUDE_CODE_USE_VERTEX',
    connectionKind: 'claude-code-cli',
    role: 'transport',
    required: false,
    default: '0',
    sensitive: false,
    summary:
      'Route CLI traffic through Google Vertex AI instead of Anthropic direct. Requires GCP credentials in the env.',
  },
  {
    name: 'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
    connectionKind: 'claude-code-cli',
    role: 'behavior',
    required: false,
    sensitive: false,
    summary:
      'Hard ceiling on per-turn output tokens. Overrides the default ceiling baked into the CLI.',
  },
  {
    name: 'DISABLE_TELEMETRY',
    connectionKind: 'claude-code-cli',
    role: 'telemetry',
    required: false,
    default: '0',
    sensitive: false,
    summary: 'Opt out of CLI telemetry.',
  },
  {
    name: 'DISABLE_AUTOUPDATER',
    connectionKind: 'claude-code-cli',
    role: 'behavior',
    required: false,
    default: '0',
    sensitive: false,
    summary: 'Disable the CLI self-update check.',
  },

  // ── anthropic-api-key (raw SDK / Messages API) ─────────────────────
  {
    name: 'ANTHROPIC_API_KEY',
    connectionKind: 'anthropic-api-key',
    role: 'auth',
    required: true,
    sensitive: true,
    summary:
      'Console API key. Required for the raw SDK path. The CLI connection does NOT honor this when a subscription session is present.',
  },
  {
    name: 'ANTHROPIC_BASE_URL',
    connectionKind: 'anthropic-api-key',
    role: 'transport',
    required: false,
    default: 'https://api.anthropic.com',
    sensitive: false,
    summary: 'Override the HTTP endpoint — used for proxies, staging, or Bedrock/Vertex gateways.',
  },
  {
    name: 'ANTHROPIC_MODEL',
    connectionKind: 'anthropic-api-key',
    role: 'routing',
    required: false,
    sensitive: false,
    summary:
      'Default model id for SDK requests that do not pass `model:` explicitly. Rarely used — most call sites pin the model.',
  },

  // ── kimi-api-key ────────────────────────────────────────────────────
  {
    name: 'KIMI_API_KEY',
    connectionKind: 'kimi-api-key',
    role: 'auth',
    required: true,
    sensitive: true,
    summary: 'Moonshot Kimi API key.',
  },
  {
    name: 'KIMI_BASE_URL',
    connectionKind: 'kimi-api-key',
    role: 'transport',
    required: false,
    default: 'https://api.moonshot.cn/v1',
    sensitive: false,
    summary: 'Override the Kimi HTTP endpoint.',
  },

  // ── openai-api-key (Codex) ─────────────────────────────────────────
  {
    name: 'OPENAI_API_KEY',
    connectionKind: 'openai-api-key',
    role: 'auth',
    required: true,
    sensitive: true,
    summary: 'OpenAI API key. Codex CLI reads this on startup.',
  },
  {
    name: 'OPENAI_BASE_URL',
    connectionKind: 'openai-api-key',
    role: 'transport',
    required: false,
    default: 'https://api.openai.com/v1',
    sensitive: false,
    summary: 'Override the OpenAI-compatible HTTP endpoint. Used for Azure OpenAI, LiteLLM proxies, etc.',
  },

  // ── local-runtime ───────────────────────────────────────────────────
  {
    name: 'LOCAL_MODEL_PATH',
    connectionKind: 'local-runtime',
    role: 'transport',
    required: true,
    sensitive: false,
    summary: 'Filesystem path to the local model weights or runtime socket.',
  },
];

export const envVarSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'EnvVar',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'connectionKind', 'role', 'required', 'sensitive', 'summary'],
    properties: {
      name: { type: 'string' },
      connectionKind: { type: 'string', enum: CONNECTION_KINDS },
      role: {
        type: 'string',
        enum: ['auth', 'routing', 'model-override', 'behavior', 'telemetry', 'transport'],
      },
      required: { type: 'boolean' },
      default: { type: 'string' },
      sensitive: { type: 'boolean' },
      summary: { type: 'string' },
    },
  },
};

export const envVarReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Connection kind',
    targetSource: 'cart/app/gallery/data/connection.ts',
    sourceField: 'connectionKind',
    targetField: 'kind',
    summary:
      'Env vars are scoped to ConnectionKind so routing overrides only apply to the paths that honor them.',
  },
  {
    kind: 'references',
    label: 'Models',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'default (for model-override role)',
    targetField: 'id',
    summary:
      'Env vars with role `model-override` carry a Model.id in their default field — the routing target when unset.',
  },
];
