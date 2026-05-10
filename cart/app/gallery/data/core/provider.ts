// Provider — the brand / origin of a model + connection family.
//
// Providers are the root entity of the catalog. A Provider owns a set of
// Models and is reachable through one or more ConnectionKinds (see
// connection.ts). `WorkerSession.provider` today is a loose string; once
// this catalog is in use, that field becomes a FK to `provider.id`.
//
// The catalog is intentionally small and hand-curated — this is not a
// public model registry, just the set we talk to.

import type { GalleryDataReference, JsonObject } from '../../types';

export type ProviderKind = 'cli-wrapped' | 'http-api' | 'local-runtime';
export type ProviderStatus = 'active' | 'experimental' | 'deprecated';

export type Provider = {
  id: string;
  label: string;
  kind: ProviderKind;
  status: ProviderStatus;
  docsUrl?: string;
  summary: string;
};

export const providerMockData: Provider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'http-api',
    status: 'active',
    docsUrl: 'https://docs.anthropic.com',
    summary:
      'Anthropic is reachable two ways: the `claude` CLI binary (subscription-backed session) and the Messages HTTP API (Console API key). Both resolve to the same Provider row; the auth asymmetry lives on Connection.',
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    kind: 'http-api',
    status: 'active',
    docsUrl: 'https://platform.moonshot.cn',
    summary:
      'Single-auth-path provider — one API key, one HTTP stream format. Serves as the clean baseline the other providers are compared against.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'http-api',
    status: 'active',
    docsUrl: 'https://platform.openai.com/docs',
    summary:
      'Two reachable transports for the same provider: `openai-api-key` connections speak Chat Completions HTTP, while `codex-cli` connections drive the local `codex` app-server over stdio. Delta-chunk wire format is materially different from Anthropic — see codex-raw-event.ts.',
  },
  {
    id: 'local',
    label: 'Local Runtime',
    kind: 'local-runtime',
    status: 'experimental',
    summary:
      'On-device model execution. No network credential; the connection resolves against a filesystem path and local process.',
  },
];

export const providerSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Provider',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label', 'kind', 'status', 'summary'],
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      kind: { type: 'string', enum: ['cli-wrapped', 'http-api', 'local-runtime'] },
      status: { type: 'string', enum: ['active', 'experimental', 'deprecated'] },
      docsUrl: { type: 'string' },
      summary: { type: 'string' },
    },
  },
};

export const providerReferences: GalleryDataReference[] = [
  {
    kind: 'has-many',
    label: 'Models',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'id',
    targetField: 'providerId',
    summary: 'Each provider owns a curated set of Model rows. Model.providerId is a FK here.',
  },
  {
    kind: 'has-many',
    label: 'Connections',
    targetSource: 'cart/app/gallery/data/connection.ts',
    sourceField: 'id',
    targetField: 'providerId',
    summary:
      'A provider is reachable through one or more Connections. Anthropic has two (`claude-code-cli` + `anthropic-api-key`); others have one.',
  },
];
