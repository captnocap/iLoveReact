// ToolCall — a single tool invocation emitted by a ModelOutput.
//
// Persists the call grain (not just the tool_call event in WorkerEvent)
// so the catalog can answer "every Read on file X this week" or
// "every Bash that triggered a pathology" with one query. Pairs with
// the result back from the dispatcher.

import type { GalleryDataReference, JsonObject } from '../../types';

export type ToolCallStatus =
  | 'pending'
  | 'dispatched'
  | 'succeeded'
  | 'failed'
  | 'denied' // permission-gated and the user said no
  | 'timed-out'
  | 'cancelled';

export type ToolCall = {
  id: string;
  /** FK → model-output.ts. */
  modelOutputId: string;
  /** Pointer at the InferenceRequest for cheap filtering. */
  inferenceRequestId: string;
  /** Pointer at the WorkerSession when the call ran inside one. */
  workerSessionId?: string;
  /** Provider's own tool_call_id for round-trip. */
  providerToolCallId: string;
  /** Tool name as the model emitted it. May be a built-in (Read/Bash/Edit) or a registered cart tool. */
  name: string;
  /** Arguments JSON exactly as the model produced it (un-coerced). */
  argsJson: string;
  status: ToolCallStatus;
  /** Result string returned to the model on the next turn. */
  resultText?: string;
  /** True when the dispatcher reported is_error. */
  isError?: boolean;
  /** When status='denied', the reason the user/permission gate gave. */
  denyReason?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
};

export const toolCallMockData: ToolCall[] = [
  {
    id: 'tcall_ls_001',
    modelOutputId: 'mout_001',
    inferenceRequestId: 'req_001',
    workerSessionId: 'sess_claude_01',
    providerToolCallId: 'toolu_01ABCxyz',
    name: 'Bash',
    argsJson: '{"command":"ls -1"}',
    status: 'succeeded',
    resultText: '7 entries listed',
    isError: false,
    startedAt: '2026-04-24T09:00:01.500Z',
    endedAt: '2026-04-24T09:00:02.000Z',
    durationMs: 500,
  },
];

export const toolCallSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ToolCall',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'modelOutputId', 'inferenceRequestId', 'providerToolCallId', 'name', 'argsJson', 'status', 'startedAt'],
    properties: {
      id: { type: 'string' },
      modelOutputId: { type: 'string' },
      inferenceRequestId: { type: 'string' },
      workerSessionId: { type: 'string' },
      providerToolCallId: { type: 'string' },
      name: { type: 'string' },
      argsJson: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'dispatched', 'succeeded', 'failed', 'denied', 'timed-out', 'cancelled'] },
      resultText: { type: 'string' },
      isError: { type: 'boolean' },
      denyReason: { type: 'string' },
      startedAt: { type: 'string' },
      endedAt: { type: 'string' },
      durationMs: { type: 'number' },
    },
  },
};

export const toolCallReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Model output', targetSource: 'cart/app/gallery/data/core/model-output.ts', sourceField: 'modelOutputId', targetField: 'id' },
  { kind: 'belongs-to', label: 'Inference request', targetSource: 'cart/app/gallery/data/core/inference-request.ts', sourceField: 'inferenceRequestId', targetField: 'id' },
  { kind: 'references', label: 'Worker session', targetSource: 'cart/app/gallery/data/core/worker-session.ts', sourceField: 'workerSessionId', targetField: 'id' },
];
