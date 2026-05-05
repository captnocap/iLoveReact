// CodexRawEvent — SSE-delta frames emitted by the OpenAI-compatible
// HTTP streaming endpoint that the Codex CLI talks to. Layer 2 for the
// `openai-api-key` connection.
//
// The wire format is materially different from Claude Code:
//   • Token-level deltas (`choices[0].delta.content`) — text streams
//     in small chunks, not as completed blocks.
//   • Tool-call arguments arrive as *partial JSON string fragments*
//     across multiple frames — they must be accumulated by tool-call
//     index before the result can be parsed. The normalized contract's
//     `input_json` field is a string specifically to accommodate this.
//   • A terminal `[DONE]` sentinel instead of a structured result
//     frame. Usage/timing is delivered on the last-before-DONE frame
//     when `stream_options.include_usage: true` is requested.
//
// This is why the event-adapter layer is load-bearing — the same
// normalized event (`tool_call`) is produced from one structured
// Anthropic block vs. N streamed Codex deltas.

import type { GalleryDataReference, JsonObject } from '../../types';

// ── TS types ────────────────────────────────────────────────────────────

export type CodexToolCallDelta = {
  index: number;
  id?: string; // present on first delta of a call
  type?: 'function';
  function?: {
    name?: string; // present on first delta of a call
    arguments?: string; // partial JSON — accumulate across deltas
  };
};

export type CodexDelta = {
  role?: 'assistant';
  content?: string; // incremental text
  tool_calls?: CodexToolCallDelta[];
  refusal?: string | null;
};

export type CodexFinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | null;

export type CodexChoice = {
  index: number;
  delta: CodexDelta;
  finish_reason: CodexFinishReason;
};

export type CodexUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
};

export type CodexChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: CodexChoice[];
  usage?: CodexUsage; // only on the final chunk (stream_options.include_usage)
};

export type CodexDoneSentinel = { done: true };

export type CodexRawEvent = CodexChunk | CodexDoneSentinel;

// ── JSON Schema ─────────────────────────────────────────────────────────

const toolCallDeltaSchema: JsonObject = {
  type: 'object',
  additionalProperties: true,
  required: ['index'],
  properties: {
    index: { type: 'number' },
    id: { type: 'string' },
    type: { const: 'function' },
    function: {
      type: 'object',
      additionalProperties: true,
      properties: {
        name: { type: 'string' },
        arguments: { type: 'string' },
      },
    },
  },
};

const choiceSchema: JsonObject = {
  type: 'object',
  additionalProperties: true,
  required: ['index', 'delta'],
  properties: {
    index: { type: 'number' },
    delta: {
      type: 'object',
      additionalProperties: true,
      properties: {
        role: { const: 'assistant' },
        content: { type: 'string' },
        tool_calls: { type: 'array', items: toolCallDeltaSchema },
        refusal: { type: ['string', 'null'] },
      },
    },
    finish_reason: {
      oneOf: [
        { type: 'null' },
        { type: 'string', enum: ['stop', 'length', 'tool_calls', 'content_filter'] },
      ],
    },
  },
};

export const codexRawEventSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CodexRawEvent',
  description:
    'OpenAI-compatible SSE streaming chunk, or the `[DONE]` sentinel.',
  oneOf: [
    {
      title: 'CodexChunk',
      type: 'object',
      additionalProperties: true,
      required: ['id', 'object', 'created', 'model', 'choices'],
      properties: {
        id: { type: 'string' },
        object: { const: 'chat.completion.chunk' },
        created: { type: 'number' },
        model: { type: 'string' },
        choices: { type: 'array', items: choiceSchema },
        usage: {
          type: 'object',
          additionalProperties: true,
          properties: {
            prompt_tokens: { type: 'number' },
            completion_tokens: { type: 'number' },
            total_tokens: { type: 'number' },
            prompt_tokens_details: {
              type: 'object',
              additionalProperties: true,
              properties: {
                cached_tokens: { type: 'number' },
              },
            },
          },
        },
      },
    },
    {
      title: 'CodexDoneSentinel',
      type: 'object',
      additionalProperties: false,
      required: ['done'],
      properties: {
        done: { const: true },
      },
    },
  ],
};

// ── Mock — one full turn: text + partial tool_call across deltas ───────

const CHAT_ID = 'chatcmpl_codex_01';
const MODEL = 'gpt-5';
const CREATED = 1_745_500_000;

export const codexRawEventMockData: CodexRawEvent[] = [
  // role prelude
  {
    id: CHAT_ID,
    object: 'chat.completion.chunk',
    created: CREATED,
    model: MODEL,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  },
  // text tokens — streamed in small fragments
  {
    id: CHAT_ID,
    object: 'chat.completion.chunk',
    created: CREATED,
    model: MODEL,
    choices: [{ index: 0, delta: { content: "I'll list" }, finish_reason: null }],
  },
  {
    id: CHAT_ID,
    object: 'chat.completion.chunk',
    created: CREATED,
    model: MODEL,
    choices: [{ index: 0, delta: { content: ' the directory.' }, finish_reason: null }],
  },
  // tool_call — name arrives on first delta, arguments streamed across 3
  {
    id: CHAT_ID,
    object: 'chat.completion.chunk',
    created: CREATED,
    model: MODEL,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_codex_01',
              type: 'function',
              function: { name: 'bash', arguments: '' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  },
  {
    id: CHAT_ID,
    object: 'chat.completion.chunk',
    created: CREATED,
    model: MODEL,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, function: { arguments: '{"comma' } },
          ],
        },
        finish_reason: null,
      },
    ],
  },
  {
    id: CHAT_ID,
    object: 'chat.completion.chunk',
    created: CREATED,
    model: MODEL,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, function: { arguments: 'nd":"ls -1"}' } },
          ],
        },
        finish_reason: null,
      },
    ],
  },
  // terminal chunk — finish_reason + optional usage
  {
    id: CHAT_ID,
    object: 'chat.completion.chunk',
    created: CREATED,
    model: MODEL,
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    usage: {
      prompt_tokens: 412,
      completion_tokens: 38,
      total_tokens: 450,
      prompt_tokens_details: { cached_tokens: 320 },
    },
  },
  // SSE [DONE] sentinel
  { done: true },
];

export const codexRawEventReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Normalized contract',
    targetSource: 'cart/app/gallery/data/worker-event.ts',
    sourceField: 'choices[].delta.content / .tool_calls[] / finish_reason',
    targetField: 'type',
    summary:
      'Content deltas fold into `assistant_part` events (text streaming); accumulated tool_calls become a single `tool_call` event once arguments parse; `finish_reason` drives the terminal `result` event. See event-adapter.ts for the full rule set.',
  },
  {
    kind: 'belongs-to',
    label: 'Connection kind',
    targetSource: 'cart/app/gallery/data/event-adapter.ts',
    sourceField: 'type',
    targetField: 'connectionKind',
    summary:
      'Emitted only by connections with kind `openai-api-key`. Kimi uses a near-identical wire format but with enough per-field drift that it gets its own raw-event file and adapter.',
  },
];
