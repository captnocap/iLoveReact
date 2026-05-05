// Connection — the concrete credential + wire-format binding between
// the user and a Provider. Replaces the notion of a simple "API key" row,
// because Anthropic has two distinct auth shapes that both target the
// same Provider.
//
// `kind` is load-bearing — every wire-format difference (raw event
// shape, env-var surface, capability set) keys off it.
//
// This file is the authoritative source for `ConnectionKind`. Both
// model.ts and event-adapter.ts import the type from here.

import type { GalleryDataReference, JsonObject } from '../../types';

// ── Connection kind ────────────────────────────────────────────────────

export type ConnectionKind =
  | 'claude-code-cli' // Anthropic — `claude` binary, subscription-backed session
  | 'anthropic-api-key' // Anthropic — Console API key, Messages HTTP API
  | 'kimi-api-key' // Moonshot — single API key
  | 'openai-api-key' // OpenAI — single API key (Codex CLI uses this)
  | 'local-runtime'; // Local — no network credential

export const CONNECTION_KINDS: ConnectionKind[] = [
  'claude-code-cli',
  'anthropic-api-key',
  'kimi-api-key',
  'openai-api-key',
  'local-runtime',
];

// ── Connection row ─────────────────────────────────────────────────────

export type CredentialSource = 'env' | 'keychain' | 'cli-session' | 'file' | 'none';

export type CredentialRef = {
  source: CredentialSource;
  // For `env`: the env var name. For `keychain`: the keychain item id.
  // For `cli-session`: the path to the CLI's auth dir. For `file`: the
  // path to a config/key file. For `none`: unused.
  locator?: string;
};

export type ConnectionCapabilities = {
  streaming: boolean;
  tools: boolean;
  thinking: boolean;
  vision: boolean;
  promptCache: boolean;
  batch: boolean;
};

export type ConnectionStatus = 'active' | 'unauthorized' | 'unreachable' | 'disabled';

/** Kind→transport split as data. `kind` carries the auth shape; `connectionType`
 *  carries the wire shape. Adding a new kind doesn't have to imply a new
 *  transport — a kimi-cli-wire variant could be `kind: 'kimi-api-key'` +
 *  `connectionType: 'cli'`. */
export type ConnectionTransport = 'cli' | 'http';

/** Where workers backed by this Connection actually run. `host` = local
 *  process, no isolation. `firecracker` = per-invocation Firecracker VM
 *  picked from a VmImage. Other substrates may land later. */
export type ConnectionExecutionSubstrate = 'host' | 'firecracker' | 'docker' | 'remote-ssh';

export type ConnectionVmConfig = {
  defaultVmImageId?: string;
  /** Fall back to this image when the active recipe doesn't pin one. */
  forceImageId?: string;
  /** Hard cap on per-VM CPU. */
  vcpuMax?: number;
  /** Hard cap on per-VM memory. */
  memMaxBytes?: number;
  /** Worker branch retention policy after VM destruction. */
  branchRetention?: 'preserve' | 'merge-or-delete' | 'delete-after-success';
};

/** CLI runtimes auto-load specific files at session start (claude-code reads
 *  CLAUDE.md, codex reads AGENTS.md, etc.). Workers backed by this Connection
 *  must render their composition assembly to one of these targets. */
export type ConnectionAutoLoadedFile = {
  path: string;
  /** Composition target slot the assembler writes here. Mirrors the
   *  spec's `target: "CLAUDE.md" | "system_prompt" | …`. */
  assemblyTarget: string;
  description?: string;
};

export type Connection = {
  id: string;
  settingsId: string;
  providerId: string;
  kind: ConnectionKind;
  label: string;
  /** Wire shape — derived from `kind` for built-in kinds, but stored
   *  explicitly so connection-type filters in rules / model-routes can
   *  match without knowing the kind enum. */
  connectionType?: ConnectionTransport;
  /** Where the worker process runs. Defaults to 'host' for back-compat;
   *  Firecracker substrate requires vmConfig to be set. */
  executionSubstrate?: ConnectionExecutionSubstrate;
  vmConfig?: ConnectionVmConfig;
  /** Files the runtime auto-loads at session start. The assembler renders
   *  the active prompt-composition into these. CLI kinds populate this; HTTP
   *  kinds typically leave it empty (the prompt rides in the request body). */
  autoLoadedFiles?: ConnectionAutoLoadedFile[];
  credentialRef: CredentialRef;
  capabilities: ConnectionCapabilities;
  status: ConnectionStatus;
  createdAt: string;
  lastUsedAt?: string;
  summary?: string;
};

// ── Mock — one row per kind, plus a second anthropic to show the
// two-auth-paths asymmetry ─────────────────────────────────────────────

export const connectionMockData: Connection[] = [
  {
    id: 'conn_claude_cli',
    settingsId: 'settings_default',
    providerId: 'anthropic',
    kind: 'claude-code-cli',
    label: 'Claude Code (subscription)',
    connectionType: 'cli',
    executionSubstrate: 'host',
    autoLoadedFiles: [
      { path: 'CLAUDE.md', assemblyTarget: 'cli-runtime-instructions', description: 'Auto-loaded by claude on session start.' },
    ],
    credentialRef: { source: 'cli-session', locator: '~/.claude/' },
    capabilities: {
      streaming: true,
      tools: true,
      thinking: true,
      vision: true,
      promptCache: true,
      batch: false,
    },
    status: 'active',
    createdAt: '2026-04-01T00:00:00Z',
    lastUsedAt: '2026-04-24T09:02:14Z',
    summary: 'Subscription-backed CLI session. Billing goes through the Anthropic account, not a Console org.',
  },
  {
    id: 'conn_anthropic_api',
    settingsId: 'settings_default',
    providerId: 'anthropic',
    kind: 'anthropic-api-key',
    label: 'Anthropic Console (project key)',
    connectionType: 'http',
    executionSubstrate: 'host',
    credentialRef: { source: 'env', locator: 'ANTHROPIC_API_KEY' },
    capabilities: {
      streaming: true,
      tools: true,
      thinking: true,
      vision: true,
      promptCache: true,
      batch: true,
    },
    status: 'active',
    createdAt: '2026-03-15T00:00:00Z',
    summary: 'Same provider as the CLI connection, but Console-org billing and a different wire format (SDK streaming events, not NDJSON).',
  },
  {
    id: 'conn_kimi',
    settingsId: 'settings_default',
    providerId: 'moonshot',
    kind: 'kimi-api-key',
    label: 'Kimi (K2)',
    connectionType: 'cli',
    executionSubstrate: 'host',
    autoLoadedFiles: [
      { path: 'KIMI.md', assemblyTarget: 'cli-runtime-instructions', description: 'Auto-loaded by kimi --wire.' },
    ],
    credentialRef: { source: 'env', locator: 'KIMI_API_KEY' },
    capabilities: {
      streaming: true,
      tools: true,
      thinking: true,
      vision: false,
      promptCache: false,
      batch: false,
    },
    status: 'active',
    createdAt: '2026-04-10T00:00:00Z',
    lastUsedAt: '2026-04-24T09:06:03Z',
  },
  {
    id: 'conn_openai',
    settingsId: 'settings_default',
    providerId: 'openai',
    kind: 'openai-api-key',
    label: 'OpenAI (Codex)',
    connectionType: 'http',
    executionSubstrate: 'host',
    autoLoadedFiles: [
      { path: 'AGENTS.md', assemblyTarget: 'cli-runtime-instructions', description: 'Auto-loaded by codex CLI on session start.' },
    ],
    credentialRef: { source: 'env', locator: 'OPENAI_API_KEY' },
    capabilities: {
      streaming: true,
      tools: true,
      thinking: true,
      vision: true,
      promptCache: true,
      batch: true,
    },
    status: 'active',
    createdAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'conn_local',
    settingsId: 'settings_default',
    providerId: 'local',
    kind: 'local-runtime',
    label: 'Local runtime',
    connectionType: 'http',
    executionSubstrate: 'host',
    credentialRef: { source: 'none' },
    capabilities: {
      streaming: true,
      tools: false,
      thinking: false,
      vision: false,
      promptCache: false,
      batch: false,
    },
    status: 'active',
    createdAt: '2026-04-20T00:00:00Z',
    lastUsedAt: '2026-04-24T09:10:00Z',
  },
];

// ── Schema ─────────────────────────────────────────────────────────────

export const connectionSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Connection',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'settingsId',
      'providerId',
      'kind',
      'label',
      'credentialRef',
      'capabilities',
      'status',
      'createdAt',
    ],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      providerId: { type: 'string' },
      kind: { type: 'string', enum: CONNECTION_KINDS },
      label: { type: 'string' },
      connectionType: { type: 'string', enum: ['cli', 'http'] },
      executionSubstrate: { type: 'string', enum: ['host', 'firecracker', 'docker', 'remote-ssh'] },
      vmConfig: {
        type: 'object',
        additionalProperties: false,
        properties: {
          defaultVmImageId: { type: 'string' },
          forceImageId: { type: 'string' },
          vcpuMax: { type: 'number' },
          memMaxBytes: { type: 'number' },
          branchRetention: { type: 'string', enum: ['preserve', 'merge-or-delete', 'delete-after-success'] },
        },
      },
      autoLoadedFiles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'assemblyTarget'],
          properties: {
            path: { type: 'string' },
            assemblyTarget: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
      credentialRef: {
        type: 'object',
        additionalProperties: false,
        required: ['source'],
        properties: {
          source: {
            type: 'string',
            enum: ['env', 'keychain', 'cli-session', 'file', 'none'],
          },
          locator: { type: 'string' },
        },
      },
      capabilities: {
        type: 'object',
        additionalProperties: false,
        required: ['streaming', 'tools', 'thinking', 'vision', 'promptCache', 'batch'],
        properties: {
          streaming: { type: 'boolean' },
          tools: { type: 'boolean' },
          thinking: { type: 'boolean' },
          vision: { type: 'boolean' },
          promptCache: { type: 'boolean' },
          batch: { type: 'boolean' },
        },
      },
      status: {
        type: 'string',
        enum: ['active', 'unauthorized', 'unreachable', 'disabled'],
      },
      createdAt: { type: 'string' },
      lastUsedAt: { type: 'string' },
      summary: { type: 'string' },
    },
  },
};

// ── References ─────────────────────────────────────────────────────────

export const connectionReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Provider',
    targetSource: 'cart/app/gallery/data/provider.ts',
    sourceField: 'providerId',
    targetField: 'id',
    summary:
      'Every connection belongs to exactly one Provider. Anthropic owns two rows here (CLI + API key); other providers own one.',
  },
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary:
      'Connections belong to a Settings profile, not the user directly. Swapping profiles swaps the credential set — no per-row edit required.',
  },
  {
    kind: 'has-many',
    label: 'Env vars',
    targetSource: 'cart/app/gallery/data/env-var.ts',
    sourceField: 'kind',
    targetField: 'connectionKind',
    summary:
      'The env-var surface is keyed by ConnectionKind, not Provider. Anthropic-API-key and Claude-Code-CLI have materially different env-var rosters even though they share a Provider.',
  },
  {
    kind: 'has-many',
    label: 'Event adapter',
    targetSource: 'cart/app/gallery/data/event-adapter.ts',
    sourceField: 'kind',
    targetField: 'connectionKind',
    summary:
      'Each ConnectionKind has exactly one event adapter — the rules that fold its raw wire events into the normalized WorkerEvent contract.',
  },
];
