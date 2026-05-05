// Privacy — the policy side of the config world. Proxy routing, tool
// allowlists, filesystem exposure, telemetry, and redaction rules all
// live here. Owned by a Settings row; snapshot-able by id onto
// InferenceRequest.privacySnapshot so after-the-fact audits can answer
// "what was in effect at 9:02am" with a join instead of archaeology.

import type { GalleryDataReference, JsonObject } from '../../types';

export type ProxyConfig = {
  enabled: boolean;
  url?: string;
  authRef?: string; // env var / keychain pointer for proxy auth
  caCertPath?: string;
};

export type ToolPolicyMode = 'allowlist' | 'denylist';

export type ToolPolicy = {
  mode: ToolPolicyMode;
  allowed: string[];
  denied: string[];
};

export type FilesystemPolicy = {
  exposedPaths: string[]; // absolute paths the agent may read/write
  deniedPaths: string[]; // paths explicitly blocked even if under an exposed root
  readOnlyPaths?: string[];
  maxFileSizeBytes?: number;
};

export type TelemetryPolicy = {
  outboundLogging: boolean; // log every outbound request locally
  secretRedaction: boolean; // scan payloads for secrets before send
  providerTelemetryOptOut: boolean; // disable provider-side telemetry where supported
  localOnly: boolean; // block non-localhost outbound (forces local-runtime)
};

export type Privacy = {
  id: string;
  settingsId: string;
  label: string;
  proxy: ProxyConfig;
  tools: ToolPolicy;
  filesystem: FilesystemPolicy;
  telemetry: TelemetryPolicy;
  createdAt: string;
  updatedAt: string;
  summary?: string;
};

export const privacyMockData: Privacy[] = [
  {
    id: 'privacy_default',
    settingsId: 'settings_default',
    label: 'Default',
    proxy: { enabled: false },
    tools: {
      mode: 'allowlist',
      allowed: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch'],
      denied: [],
    },
    filesystem: {
      exposedPaths: ['/home/siah/creative/reactjit'],
      deniedPaths: ['/home/siah/.ssh', '/home/siah/.aws', '/home/siah/.gnupg'],
      maxFileSizeBytes: 10_000_000,
    },
    telemetry: {
      outboundLogging: true,
      secretRedaction: true,
      providerTelemetryOptOut: true,
      localOnly: false,
    },
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-04-24T00:00:00Z',
    summary: 'Working profile — full repo exposure, secrets blocked, standard tool set.',
  },
  {
    id: 'privacy_strict',
    settingsId: 'settings_work_strict',
    label: 'Strict (client projects)',
    proxy: {
      enabled: true,
      url: 'https://proxy.internal.example:8443',
      authRef: 'env:WORK_PROXY_AUTH',
      caCertPath: '/home/siah/.config/work/proxy-ca.pem',
    },
    tools: {
      mode: 'allowlist',
      allowed: ['Read', 'Grep', 'Glob', 'Edit'],
      denied: ['Bash', 'WebFetch', 'WebSearch', 'Write'],
    },
    filesystem: {
      exposedPaths: ['/home/siah/creative/client-project'],
      deniedPaths: ['/home/siah/.ssh', '/home/siah/.aws', '/home/siah/.gnupg', '/home/siah/creative/reactjit'],
      readOnlyPaths: ['/home/siah/creative/client-project/vendor'],
      maxFileSizeBytes: 2_000_000,
    },
    telemetry: {
      outboundLogging: true,
      secretRedaction: true,
      providerTelemetryOptOut: true,
      localOnly: false,
    },
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
    summary:
      'Client-project profile — outbound via work proxy, read-mostly tool set, single repo scoped, no Bash or web access.',
  },
];

export const privacySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Privacy',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'settingsId', 'label', 'proxy', 'tools', 'filesystem', 'telemetry', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      label: { type: 'string' },
      proxy: {
        type: 'object',
        additionalProperties: false,
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean' },
          url: { type: 'string' },
          authRef: { type: 'string' },
          caCertPath: { type: 'string' },
        },
      },
      tools: {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'allowed', 'denied'],
        properties: {
          mode: { type: 'string', enum: ['allowlist', 'denylist'] },
          allowed: { type: 'array', items: { type: 'string' } },
          denied: { type: 'array', items: { type: 'string' } },
        },
      },
      filesystem: {
        type: 'object',
        additionalProperties: false,
        required: ['exposedPaths', 'deniedPaths'],
        properties: {
          exposedPaths: { type: 'array', items: { type: 'string' } },
          deniedPaths: { type: 'array', items: { type: 'string' } },
          readOnlyPaths: { type: 'array', items: { type: 'string' } },
          maxFileSizeBytes: { type: 'number' },
        },
      },
      telemetry: {
        type: 'object',
        additionalProperties: false,
        required: ['outboundLogging', 'secretRedaction', 'providerTelemetryOptOut', 'localOnly'],
        properties: {
          outboundLogging: { type: 'boolean' },
          secretRedaction: { type: 'boolean' },
          providerTelemetryOptOut: { type: 'boolean' },
          localOnly: { type: 'boolean' },
        },
      },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      summary: { type: 'string' },
    },
  },
};

export const privacyReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary: 'Each Privacy row is owned by one Settings profile.',
  },
  {
    kind: 'has-many',
    label: 'Inference requests (snapshot)',
    targetSource: 'cart/app/gallery/data/inference-request.ts',
    sourceField: 'id',
    targetField: 'privacySnapshot.privacyId',
    summary:
      'Inference requests freeze the active Privacy policy into `privacySnapshot` at send-time so audit questions ("was this proxied?", "what tools were allowed?") resolve against the policy that was actually in effect.',
  },
];
