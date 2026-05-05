// InferenceRequest — one outbound inference call. The merge point
// between Connection (how to auth/transport) and Privacy (what to
// allow). This is the audit-grain entity: every request carries a
// frozen snapshot of the config that was in effect when it fired.
//
// A WorkerSession has-many InferenceRequests. WorkerEvents hang off
// the Request they belong to (via worker-event.requestId, once wired
// through — currently they only key off session_id).

import type { GalleryDataReference, JsonObject } from '../../types';

export type InferenceRequestStatus =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'error'
  | 'cancelled';

export type PrivacySnapshot = {
  privacyId: string; // the row this snapshot was frozen from
  proxyUsed: boolean;
  proxyUrl?: string;
  allowedTools: string[];
  exposedPaths: string[];
  outboundLogging: boolean;
  secretRedaction: boolean;
};

export type InferenceRequest = {
  id: string;
  workerSessionId: string;
  connectionId: string;
  modelId: string;
  presetId?: string;
  turnIndex: number;
  status: InferenceRequestStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  tokensCacheRead?: number;
  costUsd?: number;
  parametersResolved: Record<string, unknown>; // what actually went on the wire
  privacySnapshot: PrivacySnapshot; // frozen at send-time
  errorMessage?: string;
};

export const inferenceRequestMockData: InferenceRequest[] = [
  {
    id: 'req_001',
    workerSessionId: 'sess_claude_01',
    connectionId: 'conn_claude_cli',
    modelId: 'claude-opus-4-7',
    presetId: 'preset_precise',
    turnIndex: 0,
    status: 'complete',
    startedAt: '2026-04-24T09:00:00Z',
    endedAt: '2026-04-24T09:00:02.140Z',
    durationMs: 2140,
    tokensIn: 1754,
    tokensOut: 82,
    tokensCacheRead: 12_400,
    costUsd: 0.0123,
    parametersResolved: {
      max_tokens: 8192,
    },
    privacySnapshot: {
      privacyId: 'privacy_default',
      proxyUsed: false,
      allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch'],
      exposedPaths: ['/home/siah/creative/reactjit'],
      outboundLogging: true,
      secretRedaction: true,
    },
  },
  {
    id: 'req_002',
    workerSessionId: 'sess_kimi_01',
    connectionId: 'conn_kimi',
    modelId: 'kimi-k2',
    presetId: 'preset_creative',
    turnIndex: 0,
    status: 'complete',
    startedAt: '2026-04-24T09:05:00Z',
    endedAt: '2026-04-24T09:06:03Z',
    durationMs: 63_000,
    tokensIn: 2210,
    tokensOut: 412,
    costUsd: 0.0087,
    parametersResolved: {
      temperature: 1.1,
      top_p: 0.98,
      max_tokens: 16_000,
    },
    privacySnapshot: {
      privacyId: 'privacy_default',
      proxyUsed: false,
      allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch'],
      exposedPaths: ['/home/siah/creative/reactjit'],
      outboundLogging: true,
      secretRedaction: true,
    },
  },
  {
    id: 'req_003',
    workerSessionId: 'sess_openai_01',
    connectionId: 'conn_openai',
    modelId: 'gpt-5',
    presetId: 'preset_codex_reasoning_high',
    turnIndex: 2,
    status: 'streaming',
    startedAt: '2026-04-24T09:15:00Z',
    parametersResolved: {
      reasoning_effort: 'high',
      max_output_tokens: 16_000,
    },
    privacySnapshot: {
      privacyId: 'privacy_strict',
      proxyUsed: true,
      proxyUrl: 'https://proxy.internal.example:8443',
      allowedTools: ['Read', 'Grep', 'Glob', 'Edit'],
      exposedPaths: ['/home/siah/creative/client-project'],
      outboundLogging: true,
      secretRedaction: true,
    },
  },
];

export const inferenceRequestSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'InferenceRequest',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'workerSessionId',
      'connectionId',
      'modelId',
      'turnIndex',
      'status',
      'startedAt',
      'parametersResolved',
      'privacySnapshot',
    ],
    properties: {
      id: { type: 'string' },
      workerSessionId: { type: 'string' },
      connectionId: { type: 'string' },
      modelId: { type: 'string' },
      presetId: { type: 'string' },
      turnIndex: { type: 'number' },
      status: {
        type: 'string',
        enum: ['pending', 'streaming', 'complete', 'error', 'cancelled'],
      },
      startedAt: { type: 'string' },
      endedAt: { type: 'string' },
      durationMs: { type: 'number' },
      tokensIn: { type: 'number' },
      tokensOut: { type: 'number' },
      tokensCacheRead: { type: 'number' },
      costUsd: { type: 'number' },
      parametersResolved: { type: 'object', additionalProperties: true },
      privacySnapshot: {
        type: 'object',
        additionalProperties: false,
        required: [
          'privacyId',
          'proxyUsed',
          'allowedTools',
          'exposedPaths',
          'outboundLogging',
          'secretRedaction',
        ],
        properties: {
          privacyId: { type: 'string' },
          proxyUsed: { type: 'boolean' },
          proxyUrl: { type: 'string' },
          allowedTools: { type: 'array', items: { type: 'string' } },
          exposedPaths: { type: 'array', items: { type: 'string' } },
          outboundLogging: { type: 'boolean' },
          secretRedaction: { type: 'boolean' },
        },
      },
      errorMessage: { type: 'string' },
    },
  },
};

export const inferenceRequestReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Worker session',
    targetSource: 'cart/app/gallery/data/worker-session.ts',
    sourceField: 'workerSessionId',
    targetField: 'id',
    summary: 'Each request belongs to a session. A session has many requests, one per turn.',
  },
  {
    kind: 'belongs-to',
    label: 'Connection',
    targetSource: 'cart/app/gallery/data/connection.ts',
    sourceField: 'connectionId',
    targetField: 'id',
    summary: 'Which Connection fired this request — carries the auth path and wire format used.',
  },
  {
    kind: 'belongs-to',
    label: 'Model',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'modelId',
    targetField: 'id',
    summary: 'The model that actually served the request (may differ from default if onExceed=degrade-model kicked in).',
  },
  {
    kind: 'references',
    label: 'Preset',
    targetSource: 'cart/app/gallery/data/inference-preset.ts',
    sourceField: 'presetId',
    targetField: 'id',
    summary: 'The preset the parameters were resolved from (if any).',
  },
  {
    kind: 'references',
    label: 'Privacy (snapshot source)',
    targetSource: 'cart/app/gallery/data/privacy.ts',
    sourceField: 'privacySnapshot.privacyId',
    targetField: 'id',
    summary:
      'Points at the Privacy row this snapshot was frozen from. The snapshot itself is inlined so audits resolve even if the source Privacy row is later edited or deleted.',
  },
  {
    kind: 'has-many',
    label: 'Worker events',
    targetSource: 'cart/app/gallery/data/worker-event.ts',
    sourceField: 'id',
    targetField: 'requestId (to wire)',
    summary:
      'Events should ultimately hang off requests, not sessions — a session has N requests, each with its own event stream. WorkerEvent.requestId is the forward hook.',
  },
];
