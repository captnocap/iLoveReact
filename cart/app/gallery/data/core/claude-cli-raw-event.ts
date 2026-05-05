// ClaudeCliRawEvent — NDJSON frames emitted by the `claude` binary on stdout
// when run with --output-format stream-json. This is Layer 2 of the event
// model: the *honest* on-the-wire shape from the Claude Code CLI SDK
// connection. It is reduced into the normalized WorkerEvent contract
// (worker-event.ts, Layer 1) by the claude-cli row in event-adapter.ts
// (Layer 3).
//
// Nothing here is claude-code-specific beyond the wire format — nested
// `message.content[]` blocks are Anthropic SDK primitives (text / thinking
// / tool_use / tool_result). Other providers emit very different shapes;
// do not fold this into a shared raw-event union.

import type { GalleryDataReference, JsonObject } from '../../types';

// ── TS types ────────────────────────────────────────────────────────────

export type ClaudeCliTextBlock = { type: 'text'; text: string };
export type ClaudeCliThinkingBlock = { type: 'thinking'; thinking: string };
export type ClaudeCliToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ClaudeCliToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: 'text'; text: string }>;
  is_error?: boolean;
};
export type ClaudeCliAssistantBlock =
  | ClaudeCliTextBlock
  | ClaudeCliThinkingBlock
  | ClaudeCliToolUseBlock;

export type ClaudeCliSystemInit = {
  type: 'system';
  subtype: 'init';
  session_id: string;
  model: string;
  cwd?: string;
  tools?: string[];
  permissionMode?: string;
  apiKeySource?: string;
};

export type ClaudeCliAssistantMessage = {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    model: string;
    content: ClaudeCliAssistantBlock[];
    stop_reason?: string | null;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  session_id: string;
};

export type ClaudeCliUserMessage = {
  type: 'user';
  message: {
    role: 'user';
    content: ClaudeCliToolResultBlock[];
  };
  session_id: string;
};

export type ClaudeCliResult = {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution';
  result?: string;
  is_error: boolean;
  session_id: string;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
};

export type ClaudeCliRawEvent =
  | ClaudeCliSystemInit
  | ClaudeCliAssistantMessage
  | ClaudeCliUserMessage
  | ClaudeCliResult;

// ── JSON Schema ─────────────────────────────────────────────────────────

const assistantBlockSchema: JsonObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: true,
      required: ['type', 'text'],
      properties: {
        type: { const: 'text' },
        text: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: true,
      required: ['type', 'thinking'],
      properties: {
        type: { const: 'thinking' },
        thinking: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: true,
      required: ['type', 'id', 'name', 'input'],
      properties: {
        type: { const: 'tool_use' },
        id: { type: 'string' },
        name: { type: 'string' },
        input: { type: 'object', additionalProperties: true },
      },
    },
  ],
};

const toolResultBlockSchema: JsonObject = {
  type: 'object',
  additionalProperties: true,
  required: ['type', 'tool_use_id', 'content'],
  properties: {
    type: { const: 'tool_result' },
    tool_use_id: { type: 'string' },
    is_error: { type: 'boolean' },
    content: {
      oneOf: [
        { type: 'string' },
        {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'text'],
            properties: {
              type: { const: 'text' },
              text: { type: 'string' },
            },
          },
        },
      ],
    },
  },
};

export const claudeCliRawEventSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ClaudeCliRawEvent',
  description:
    'NDJSON frame emitted on stdout by the `claude` CLI binary with --output-format stream-json.',
  oneOf: [
    {
      title: 'ClaudeCliSystemInit',
      type: 'object',
      additionalProperties: true,
      required: ['type', 'subtype', 'session_id', 'model'],
      properties: {
        type: { const: 'system' },
        subtype: { const: 'init' },
        session_id: { type: 'string' },
        model: { type: 'string' },
        cwd: { type: 'string' },
        tools: { type: 'array', items: { type: 'string' } },
        permissionMode: { type: 'string' },
        apiKeySource: { type: 'string' },
      },
    },
    {
      title: 'ClaudeCliAssistantMessage',
      type: 'object',
      additionalProperties: true,
      required: ['type', 'message', 'session_id'],
      properties: {
        type: { const: 'assistant' },
        session_id: { type: 'string' },
        message: {
          type: 'object',
          additionalProperties: true,
          required: ['id', 'role', 'content'],
          properties: {
            id: { type: 'string' },
            role: { const: 'assistant' },
            model: { type: 'string' },
            stop_reason: { type: ['string', 'null'] },
            content: { type: 'array', items: assistantBlockSchema },
            usage: {
              type: 'object',
              additionalProperties: true,
              properties: {
                input_tokens: { type: 'number' },
                output_tokens: { type: 'number' },
                cache_read_input_tokens: { type: 'number' },
                cache_creation_input_tokens: { type: 'number' },
              },
            },
          },
        },
      },
    },
    {
      title: 'ClaudeCliUserMessage',
      type: 'object',
      additionalProperties: true,
      required: ['type', 'message', 'session_id'],
      properties: {
        type: { const: 'user' },
        session_id: { type: 'string' },
        message: {
          type: 'object',
          additionalProperties: true,
          required: ['role', 'content'],
          properties: {
            role: { const: 'user' },
            content: { type: 'array', items: toolResultBlockSchema },
          },
        },
      },
    },
    {
      title: 'ClaudeCliResult',
      type: 'object',
      additionalProperties: true,
      required: ['type', 'subtype', 'is_error', 'session_id'],
      properties: {
        type: { const: 'result' },
        subtype: {
          type: 'string',
          enum: ['success', 'error_max_turns', 'error_during_execution'],
        },
        result: { type: 'string' },
        is_error: { type: 'boolean' },
        session_id: { type: 'string' },
        total_cost_usd: { type: 'number' },
        duration_ms: { type: 'number' },
        duration_api_ms: { type: 'number' },
        num_turns: { type: 'number' },
        usage: {
          type: 'object',
          additionalProperties: true,
          properties: {
            input_tokens: { type: 'number' },
            output_tokens: { type: 'number' },
          },
        },
      },
    },
  ],
};

// ── Mock — one full turn off the wire ──────────────────────────────────

export const claudeCliRawEventMockData: ClaudeCliRawEvent[] = [
  {
    type: 'system',
    subtype: 'init',
    session_id: 'sess_claude_cli_01',
    model: 'claude-opus-4-7',
    cwd: '/home/user/project',
    tools: ['Bash', 'Read', 'Edit', 'Write'],
    permissionMode: 'default',
    apiKeySource: 'subscription',
  },
  {
    type: 'assistant',
    session_id: 'sess_claude_cli_01',
    message: {
      id: 'msg_01ABC',
      role: 'assistant',
      model: 'claude-opus-4-7',
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: 'The user wants a directory listing.' },
        {
          type: 'tool_use',
          id: 'toolu_01XYZ',
          name: 'Bash',
          input: { command: 'ls -1' },
        },
      ],
      usage: {
        input_tokens: 842,
        output_tokens: 64,
        cache_read_input_tokens: 12_400,
      },
    },
  },
  {
    type: 'user',
    session_id: 'sess_claude_cli_01',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_01XYZ',
          content: 'cart\nframework\nruntime\nscripts\n',
          is_error: false,
        },
      ],
    },
  },
  {
    type: 'assistant',
    session_id: 'sess_claude_cli_01',
    message: {
      id: 'msg_01DEF',
      role: 'assistant',
      model: 'claude-opus-4-7',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Listed 4 entries.' }],
      usage: { input_tokens: 912, output_tokens: 18 },
    },
  },
  {
    type: 'result',
    subtype: 'success',
    result: 'Listed 4 entries.',
    is_error: false,
    session_id: 'sess_claude_cli_01',
    total_cost_usd: 0.0123,
    duration_ms: 2140,
    duration_api_ms: 1890,
    num_turns: 1,
    usage: { input_tokens: 1754, output_tokens: 82 },
  },
];

export const claudeCliRawEventReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Normalized contract',
    targetSource: 'cart/app/gallery/data/worker-event.ts',
    sourceField: 'type / message.content[].type',
    targetField: 'type',
    summary:
      'The raw CLI frame is reduced into the normalized WorkerEvent contract. `system` → system, `assistant.message.content[]` is fanned out into assistant / tool_call events, `user.message.content[]` tool_result blocks become tool_result events, `result` → result. The rule table lives in event-adapter.ts.',
  },
  {
    kind: 'belongs-to',
    label: 'Connection kind',
    targetSource: 'cart/app/gallery/data/event-adapter.ts',
    sourceField: 'type',
    targetField: 'connectionKind',
    summary:
      'This raw shape is emitted only by connections with kind `claude-code-cli`. The Anthropic HTTP SDK (kind `anthropic-api-key`) emits a different stream shape — message_start / content_block_delta / message_stop — and will live in its own raw-event file.',
  },
];
