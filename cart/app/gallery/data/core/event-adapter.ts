// EventAdapter — Layer 3 of the event model.
//
// Describes, as data, how a given ConnectionKind's raw wire events
// (Layer 2 — e.g. claude-cli-raw-event.ts) fold into the normalized
// WorkerEvent contract (Layer 1 — worker-event.ts).
//
// This is intentionally the *shape of the rules*, not the reducer code.
// Making it data lets the gallery render a coverage matrix — "which
// normalized events does each provider produce, which raw fields feed
// each normalized field, what gets dropped, what gets synthesized."
//
// When a new provider is added, the steps are:
//   1. Add a row to ConnectionKind
//   2. Create data/<provider>-raw-event.ts with the honest wire shape
//   3. Add one EventAdapter row here
// The normalized contract itself never changes.

import type { GalleryDataReference, JsonObject } from '../../types';
import { CONNECTION_KINDS, type ConnectionKind } from './connection';

// ── Normalized event types (mirrors worker-event.ts WorkerEvent.type) ──

export type NormalizedEventType =
  | 'system'
  | 'assistant'
  | 'assistant_part'
  | 'turn_begin'
  | 'tool_call'
  | 'tool_result'
  | 'status'
  | 'result';

// ── Adapter rule shape ──────────────────────────────────────────────────

export type EventAdapterRule = {
  // A dotted / bracketed path into the raw frame that identifies which
  // raw shape this rule matches. Examples:
  //   "type=system&subtype=init"
  //   "type=assistant message.content[].type=text"
  //   "type=result"
  rawSelector: string;

  // What the rule produces on the normalized side.
  normalizedType: NormalizedEventType;

  // Raw-field → normalized-field mapping. Keys are normalized field
  // names on the WorkerEvent variant; values are paths into the raw
  // frame, or literal strings prefixed with `=`.
  fieldMap: Record<string, string>;

  // Optional notes for the gallery — edge cases, ordering constraints,
  // streaming behavior, anything that would otherwise rot as a code
  // comment.
  notes?: string;
};

export type EventAdapter = {
  connectionKind: ConnectionKind;
  rawSourcePath: string; // points at the raw-event data file for this kind
  rules: EventAdapterRule[];
  synthesized: NormalizedEventType[]; // events fabricated without a raw source
  dropped: string[]; // raw shapes/selectors intentionally ignored
  summary: string;
};

// ── Claude Code CLI adapter ────────────────────────────────────────────

const claudeCliAdapter: EventAdapter = {
  connectionKind: 'claude-code-cli',
  rawSourcePath: 'cart/app/gallery/data/claude-cli-raw-event.ts',
  summary:
    'Reduces `claude --output-format stream-json` NDJSON frames into the normalized WorkerEvent contract. Assistant frames are fanned out — one raw frame may produce multiple normalized events because `message.content[]` is an array of mixed blocks (text / thinking / tool_use).',
  rules: [
    {
      rawSelector: 'type=system subtype=init',
      normalizedType: 'system',
      fieldMap: {
        type: '=system',
        model: 'model',
        session_id: 'session_id',
      },
      notes:
        'The CLI emits exactly one init frame per session, before any assistant output. Carries the session_id that every downstream frame echoes.',
    },
    {
      rawSelector: 'type=assistant message.content[].type=text',
      normalizedType: 'assistant',
      fieldMap: {
        type: '=assistant',
        'content[]': 'message.content[]',
        text: 'message.content[text].text',
      },
      notes:
        'Text blocks are coalesced into a single normalized assistant event per raw frame. The CLI does not stream token-level deltas — the assistant frame contains the completed block.',
    },
    {
      rawSelector: 'type=assistant message.content[].type=thinking',
      normalizedType: 'assistant',
      fieldMap: {
        type: '=assistant',
        'content[]': 'message.content[]',
      },
      notes:
        'Thinking blocks are passed through as `content[].type=thinking`. Same frame may carry text + thinking + tool_use simultaneously.',
    },
    {
      rawSelector: 'type=assistant message.content[].type=tool_use',
      normalizedType: 'tool_call',
      fieldMap: {
        type: '=tool_call',
        name: 'message.content[tool_use].name',
        input_json: 'JSON.stringify(message.content[tool_use].input)',
      },
      notes:
        '`input` is a parsed object in the raw frame, but the normalized contract carries `input_json` as a string so kimi/codex tool calls (which arrive as partial string deltas) can share the same field shape.',
    },
    {
      rawSelector: 'type=user message.content[].type=tool_result',
      normalizedType: 'tool_result',
      fieldMap: {
        type: '=tool_result',
        text: 'message.content[tool_result].content',
        is_error: 'message.content[tool_result].is_error',
      },
      notes:
        'CLI emits tool results back as a synthetic `user` frame. When `content` is an array of text blocks, they are joined into one string for the normalized `text` field.',
    },
    {
      rawSelector: 'type=result',
      normalizedType: 'result',
      fieldMap: {
        type: '=result',
        result: 'result',
        is_error: 'is_error',
        total_cost_usd: 'total_cost_usd',
        session_id: 'session_id',
      },
      notes:
        'Terminal frame — always the last NDJSON line of a session. Carries cost/timing; the absence of this frame after stdout close means the session errored at the process boundary.',
    },
  ],
  synthesized: [
    'turn_begin',
    'status',
  ],
  dropped: [
    'type=assistant message.usage',
    'type=system subtype=init cwd',
    'type=system subtype=init tools',
    'type=system subtype=init permissionMode',
    'type=system subtype=init apiKeySource',
  ],
};

// ── Codex (OpenAI-compatible) adapter ──────────────────────────────────

const codexAdapter: EventAdapter = {
  connectionKind: 'openai-api-key',
  rawSourcePath: 'cart/app/gallery/data/codex-raw-event.ts',
  summary:
    'Reduces OpenAI-compatible SSE `chat.completion.chunk` frames into the normalized WorkerEvent contract. Text streams as token deltas, tool-call arguments stream as partial JSON strings that must be accumulated by call index before parse. Maximally different from the Anthropic CLI shape — this is what the contract was designed to absorb.',
  rules: [
    {
      rawSelector: 'choices[0].delta.role=assistant',
      normalizedType: 'turn_begin',
      fieldMap: {
        type: '=turn_begin',
      },
      notes:
        'The first chunk of a response carries `delta.role` without content. Treated as the turn-begin marker — no synthesis needed on this path.',
    },
    {
      rawSelector: 'choices[0].delta.content',
      normalizedType: 'assistant_part',
      fieldMap: {
        type: '=assistant_part',
        part_type: '=text',
        text: 'choices[0].delta.content',
      },
      notes:
        'Each text delta becomes one assistant_part event. Consumers concatenate by turn. Unlike the CLI path, a full `assistant` event is never produced from Codex — downstream code must treat streamed `assistant_part` as the canonical text channel.',
    },
    {
      rawSelector: 'choices[0].delta.tool_calls[].id',
      normalizedType: 'tool_call',
      fieldMap: {
        type: '=tool_call',
        name: 'choices[0].delta.tool_calls[i].function.name',
        input_json: 'accumulate(choices[0].delta.tool_calls[i].function.arguments)',
      },
      notes:
        'Tool call is emitted once per `index` — when the accumulated `function.arguments` string becomes parseable JSON, or when `finish_reason=tool_calls` fires. `input_json` is the accumulated raw string, not a re-serialization. Arguments may span 3–20+ chunks for a large tool input.',
    },
    {
      rawSelector: 'choices[0].finish_reason=stop',
      normalizedType: 'result',
      fieldMap: {
        type: '=result',
        result: '=',
        is_error: '=false',
        total_cost_usd: 'computeFromUsage(usage, model)',
      },
      notes:
        'Cost is derived from `usage.prompt_tokens` + `usage.completion_tokens` against the model pricing row — not provided by the wire format. When `stream_options.include_usage` is false, cost is null.',
    },
    {
      rawSelector: 'choices[0].finish_reason=tool_calls',
      normalizedType: 'result',
      fieldMap: {
        type: '=result',
        result: '=',
        is_error: '=false',
      },
      notes:
        'Turn ended to yield for tool execution. Downstream orchestrator is expected to dispatch the tool_call events that preceded this frame and produce tool_result events on the next turn.',
    },
    {
      rawSelector: 'choices[0].finish_reason=length',
      normalizedType: 'result',
      fieldMap: {
        type: '=result',
        is_error: '=true',
        result: '=length limit reached',
      },
      notes:
        'Truncation is surfaced as an error result — matches the CLI path behavior for `error_max_turns`.',
    },
  ],
  synthesized: [
    // Codex has no `system` frame — we synthesize one at connection
    // open, carrying `model` from the first chunk.
    'system',
    // No `status` frames on the wire — inferred from HTTP/SSE pipe
    // state and surfaced as synthesized status events.
    'status',
    // tool_result is produced by the orchestrator after executing a
    // tool_call; Codex's wire format never carries one.
    'tool_result',
  ],
  dropped: [
    // Codex echoes chat completion id and created timestamp on every
    // chunk; neither is surfaced on the normalized event.
    'choices[0].delta.refusal',
    'id',
    'created',
    'object',
    // `[DONE]` sentinel is consumed to close the stream but produces
    // no normalized event — the preceding terminal chunk already did.
    'done=true',
  ],
};

// ── Exports ─────────────────────────────────────────────────────────────

export const eventAdapterMockData: EventAdapter[] = [claudeCliAdapter, codexAdapter];

const normalizedTypeEnum = [
  'system',
  'assistant',
  'assistant_part',
  'turn_begin',
  'tool_call',
  'tool_result',
  'status',
  'result',
];

export const eventAdapterSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'EventAdapter',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['connectionKind', 'rawSourcePath', 'rules', 'synthesized', 'dropped', 'summary'],
    properties: {
      connectionKind: { type: 'string', enum: CONNECTION_KINDS },
      rawSourcePath: { type: 'string' },
      summary: { type: 'string' },
      rules: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rawSelector', 'normalizedType', 'fieldMap'],
          properties: {
            rawSelector: { type: 'string' },
            normalizedType: { type: 'string', enum: normalizedTypeEnum },
            fieldMap: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            notes: { type: 'string' },
          },
        },
      },
      synthesized: {
        type: 'array',
        items: { type: 'string', enum: normalizedTypeEnum },
      },
      dropped: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  },
};

export const eventAdapterReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Normalized contract',
    targetSource: 'cart/app/gallery/data/worker-event.ts',
    sourceField: 'rules[].normalizedType / synthesized[]',
    targetField: 'type',
    summary:
      'Every rule produces a value in the WorkerEvent.type union. The contract is closed — new providers fold *into* these types, they do not extend them.',
  },
  {
    kind: 'references',
    label: 'Raw event (claude-cli)',
    targetSource: 'cart/app/gallery/data/claude-cli-raw-event.ts',
    sourceField: 'rules[].rawSelector / rules[].fieldMap',
    targetField: 'type / message.content[]',
    summary:
      'Rules for the `claude-code-cli` connection read fields out of this raw shape. One raw assistant frame fans out into N normalized events because `message.content[]` is an array of mixed blocks.',
  },
  {
    kind: 'belongs-to',
    label: 'Connection kind',
    targetSource: 'cart/app/gallery/data/connection.ts',
    sourceField: 'connectionKind',
    targetField: 'kind',
    summary:
      'One adapter row per ConnectionKind. Adding a provider means adding one row here and one raw-event file — the normalized contract stays frozen.',
  },
];
