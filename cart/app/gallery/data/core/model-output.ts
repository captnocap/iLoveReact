// ModelOutput — what came back from a single InferenceRequest.
//
// Splits the response payload off the request so cost / timing data on
// InferenceRequest stays narrow, and downstream rows (ToolCall,
// SupervisorJudgment) hang off the *output* of a turn, not the
// *request* that produced it.
//
// One InferenceRequest produces zero (errored) or one ModelOutput.

import type { GalleryDataReference, JsonObject } from '../../types';

export type ModelOutputFinishReason =
  | 'stop' // model emitted a natural stop
  | 'length' // hit max_tokens
  | 'tool-calls' // yielded for tool execution
  | 'content-filter' // refused / safety
  | 'error' // upstream error
  | 'cancelled'; // client disconnect

export type ModelOutput = {
  id: string;
  inferenceRequestId: string;
  /** The visible response text. May be empty when the only output was tool calls. */
  responseContent?: string;
  /** Model's reasoning channel (Anthropic 'thinking', GPT-5 reasoning summary). */
  reasoningContent?: string;
  /** FK list — actual ToolCall rows. Order is the order the model emitted them. */
  toolCallIds: string[];
  finishReason: ModelOutputFinishReason;
  /** Refusal message when finishReason='content-filter'. */
  refusalMessage?: string;
  /** Token counts as the provider reported them. May differ from
   *  InferenceRequest.tokensOut if the provider computes them differently. */
  outputTokens?: number;
  reasoningTokens?: number;
  /** Hash of (responseContent + reasoningContent + toolCallIds). Lets the
   *  verifier check whether a CompositionRun's snapshot is reading the
   *  same output it was originally judged against. */
  contentHash?: string;
  emittedAt: string;
};

export const modelOutputMockData: ModelOutput[] = [
  {
    id: 'mout_001',
    inferenceRequestId: 'req_001',
    responseContent: 'Listed 7 entries.',
    toolCallIds: ['tcall_ls_001'],
    finishReason: 'stop',
    outputTokens: 82,
    contentHash: 'sha256:abcd...',
    emittedAt: '2026-04-24T09:00:02.140Z',
  },
];

export const modelOutputSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ModelOutput',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'inferenceRequestId', 'toolCallIds', 'finishReason', 'emittedAt'],
    properties: {
      id: { type: 'string' },
      inferenceRequestId: { type: 'string' },
      responseContent: { type: 'string' },
      reasoningContent: { type: 'string' },
      toolCallIds: { type: 'array', items: { type: 'string' } },
      finishReason: { type: 'string', enum: ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'cancelled'] },
      refusalMessage: { type: 'string' },
      outputTokens: { type: 'number' },
      reasoningTokens: { type: 'number' },
      contentHash: { type: 'string' },
      emittedAt: { type: 'string' },
    },
  },
};

export const modelOutputReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Inference request', targetSource: 'cart/app/gallery/data/core/inference-request.ts', sourceField: 'inferenceRequestId', targetField: 'id' },
  { kind: 'has-many', label: 'Tool calls', targetSource: 'cart/app/gallery/data/core/tool-call.ts', sourceField: 'toolCallIds[]', targetField: 'id' },
];
