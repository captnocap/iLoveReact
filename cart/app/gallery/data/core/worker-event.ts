// WorkerEvent — normalized event contract emitted by the three cockpit
// backends (claude-code CLI, kimi, local-AI). Shapes mirror the reducers
// in cart/cockpit/index.tsx (reduceClaudeEvent / reduceKimiEvent /
// reduceLocalEvent) and the FFI producers in framework/qjs_runtime.zig
// (claudeMessageToJs / kimiMessageToJs / localAiEventToJs).
//
// Per-backend coverage:
//   claude: system, assistant, result
//   kimi:   turn_begin, assistant_part, tool_call, tool_result, status, result
//   local:  system, assistant_part, status, result

import type { GalleryDataReference, JsonObject } from '../../types';

// ── TS types ────────────────────────────────────────────────────────────

export type SystemEvent = {
  type: 'system';
  model?: string;
  session_id?: string;
};

export type AssistantTextBlock = { type: 'text'; text: string };
export type AssistantThinkingBlock = { type: 'thinking'; thinking: string };
export type AssistantToolUseBlock = {
  type: 'tool_use';
  name: string;
  input_json?: string;
};
export type AssistantBlock =
  | AssistantTextBlock
  | AssistantThinkingBlock
  | AssistantToolUseBlock;

export type AssistantEvent = {
  type: 'assistant';
  content: AssistantBlock[];
  text?: string;
};

export type AssistantPartEvent = {
  type: 'assistant_part';
  part_type: 'text' | 'thinking';
  text?: string;
};

export type TurnBeginEvent = { type: 'turn_begin' };

export type ToolCallEvent = {
  type: 'tool_call';
  name: string;
  input_json?: string;
};

export type ToolResultEvent = {
  type: 'tool_result';
  text?: string;
  is_error?: boolean;
};

export type StatusEvent = {
  type: 'status';
  text?: string;
  is_error?: boolean;
};

export type ResultEvent = {
  type: 'result';
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  session_id?: string;
};

export type WorkerEvent =
  | SystemEvent
  | AssistantEvent
  | AssistantPartEvent
  | TurnBeginEvent
  | ToolCallEvent
  | ToolResultEvent
  | StatusEvent
  | ResultEvent;

// ── JSON Schema ─────────────────────────────────────────────────────────

const assistantBlockSchema: JsonObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'text'],
      properties: {
        type: { const: 'text' },
        text: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'thinking'],
      properties: {
        type: { const: 'thinking' },
        thinking: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'name'],
      properties: {
        type: { const: 'tool_use' },
        name: { type: 'string' },
        input_json: { type: 'string' },
      },
    },
  ],
};

export const workerEventSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'WorkerEvent',
  description:
    'Normalized event emitted by the cockpit backends (claude-code CLI, kimi, local). Discriminated by `type`.',
  oneOf: [
    {
      title: 'SystemEvent',
      type: 'object',
      additionalProperties: true,
      required: ['type'],
      properties: {
        type: { const: 'system' },
        model: { type: 'string' },
        session_id: { type: 'string' },
      },
    },
    {
      title: 'AssistantEvent',
      type: 'object',
      additionalProperties: true,
      required: ['type', 'content'],
      properties: {
        type: { const: 'assistant' },
        text: { type: 'string' },
        content: { type: 'array', items: assistantBlockSchema },
      },
    },
    {
      title: 'AssistantPartEvent',
      type: 'object',
      additionalProperties: true,
      required: ['type', 'part_type'],
      properties: {
        type: { const: 'assistant_part' },
        part_type: { type: 'string', enum: ['text', 'thinking'] },
        text: { type: 'string' },
      },
    },
    {
      title: 'TurnBeginEvent',
      type: 'object',
      additionalProperties: true,
      required: ['type'],
      properties: {
        type: { const: 'turn_begin' },
      },
    },
    {
      title: 'ToolCallEvent',
      type: 'object',
      additionalProperties: true,
      required: ['type', 'name'],
      properties: {
        type: { const: 'tool_call' },
        name: { type: 'string' },
        input_json: { type: 'string' },
      },
    },
    {
      title: 'ToolResultEvent',
      type: 'object',
      additionalProperties: true,
      required: ['type'],
      properties: {
        type: { const: 'tool_result' },
        text: { type: 'string' },
        is_error: { type: 'boolean' },
      },
    },
    {
      title: 'StatusEvent',
      type: 'object',
      additionalProperties: true,
      required: ['type'],
      properties: {
        type: { const: 'status' },
        text: { type: 'string' },
        is_error: { type: 'boolean' },
      },
    },
    {
      title: 'ResultEvent',
      type: 'object',
      additionalProperties: true,
      required: ['type'],
      properties: {
        type: { const: 'result' },
        result: { type: 'string' },
        is_error: { type: 'boolean' },
        total_cost_usd: { type: 'number' },
        session_id: { type: 'string' },
      },
    },
  ],
};

// ── Mock — one full turn per backend ───────────────────────────────────

export const workerEventMockData: WorkerEvent[] = [
  // claude turn
  { type: 'system', model: 'claude-opus-4-7', session_id: 'sess_claude_01' },
  {
    type: 'assistant',
    content: [
      { type: 'thinking', thinking: 'The user wants a directory listing.' },
      { type: 'tool_use', name: 'Bash', input_json: '{"command":"ls -1"}' },
    ],
  },
  {
    type: 'assistant',
    content: [{ type: 'text', text: 'Listed 7 entries.' }],
  },
  {
    type: 'result',
    result: 'Listed 7 entries.',
    is_error: false,
    total_cost_usd: 0.0123,
    session_id: 'sess_claude_01',
  },

  // kimi turn
  { type: 'turn_begin' },
  { type: 'assistant_part', part_type: 'thinking', text: 'Planning the fix…' },
  { type: 'tool_call', name: 'Edit', input_json: '{"file_path":"/tmp/x.ts"}' },
  { type: 'tool_result', text: 'patched 1 hunk', is_error: false },
  { type: 'assistant_part', part_type: 'text', text: 'Applied the patch.' },
  { type: 'status', text: 'idle', is_error: false },
  { type: 'result', result: 'done', is_error: false },

  // local turn
  { type: 'system', model: 'gpt-5.4-mini', session_id: 'sess_local_01' },
  { type: 'assistant_part', part_type: 'text', text: 'Working locally — ' },
  { type: 'assistant_part', part_type: 'text', text: 'no external calls.' },
  { type: 'status', text: 'connected', is_error: false },
  {
    type: 'result',
    result: 'ok',
    is_error: false,
    total_cost_usd: 0,
    session_id: 'sess_local_01',
  },
];

export const workerEventReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Worker Session',
    targetSource: 'cart/app/gallery/data/worker-session.ts',
    sourceField: 'session_id',
    targetField: 'id',
    summary:
      'Event rows should attach back to a session header so provider identity, timing, and transcript grouping can normalize into related tables.',
  },
];
