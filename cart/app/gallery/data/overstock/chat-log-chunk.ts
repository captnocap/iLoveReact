// ChatLogChunk — N-event window from a worker-session, materialized as a
// retrievable row. The embeddable unit of conversational history.
//
// Sits between worker-event.ts (the raw normalized stream, one row per
// frame) and episodic-memory.ts (a curated narrative produced by a
// consolidation pass). The chunking pipeline reads worker-event rows
// for a session, groups them into 4–8 event windows with 2-event
// overlap, constructs a serialized `displayText` (the exact string fed
// to the embedder), and stores one ChatLogChunk row per window.
//
// Why a window, not per-event: per-event is too granular — a one-line
// tool call and a long assistant turn produce vectors with wildly
// different signal density. Per-conversation is too coarse — the
// average session is 50k+ tokens. A 4–8 event window captures one
// logical exchange, which is the unit retrieval should surface.
//
// Why a chunkingStrategy field: we expect to A/B different windowing
// approaches (sliding-window vs turn-boundary vs LLM-chunked). Recording
// the strategy on the row lets re-indexing target one strategy at a
// time without disturbing the others.
//
// What gets embedded vs displayed: `displayText` is THE string that was
// fed to the embedder — including the constructed dialog prefix
// ('[ts user] …\n[ts assistant] …\n[tool: Bash {…}]'). Tool outputs
// that exceed a size threshold are *replaced* in displayText with
// '[tool result: 2400 lines, sha abc123]' before embedding — the actual
// content remains retrievable via the worker-event rows in the time
// range, but does not bloat vectors. textPreview is a short clip used
// in result lists.

import type { GalleryDataReference, JsonObject } from '../../types';

export type ChatLogChunkRoleSequence = Array<
  'user' | 'assistant' | 'thinking' | 'tool_call' | 'tool_result' | 'system'
>;

export type ChatLogChunkChunkingStrategy =
  | 'window-4-overlap-2' // default — 4-event sliding window, 2-event overlap
  | 'window-8-overlap-2' // wider window for sparse-turn sessions
  | 'turn-boundary' // chunk per user→assistant→tools→assistant cycle
  | 'llm-chunked'; // boundaries decided by a small LLM pass

export type ChatLogChunk = {
  id: string;
  workspaceId?: string;
  projectId?: string;
  sessionId: string; // FK → worker-session.id
  /** Which model produced the assistant turns in this chunk. */
  modelId?: string;
  /** Position of this chunk within the session, 0-indexed. */
  chunkIndex: number;
  chunkingStrategy: ChatLogChunkChunkingStrategy;
  /**
   * The exact serialized string fed to the embedder. Includes the
   * constructed dialog prefix and tool-call shape. Re-embed when the
   * underlying messages mutate (rare — chat history is append-only —
   * but redactions and tool-output truncation thresholds change).
   */
  displayText: string;
  /** Short clip surfaced in result lists, derived from displayText. */
  textPreview: string;
  rawEventCount: number;
  /** Sequence of event roles in the window — used for filter queries
   *  ("only chunks containing tool_call", etc.). */
  roleSequence: ChatLogChunkRoleSequence;
  /** Tool names called within this window (for filtering by tool). */
  toolCallNames: string[];
  firstEventOccurredAt: string;
  lastEventOccurredAt: string;
  /** sha256 of displayText. Drift detection for re-embed decisions. */
  contentHash: string;
  tokenCount: number;
  createdAt: string;
};

export const chatLogChunkMockData: ChatLogChunk[] = [
  {
    id: 'clc_sess_claude_01_0007',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_carts',
    sessionId: 'sess_claude_01',
    modelId: 'claude-opus-4-7',
    chunkIndex: 7,
    chunkingStrategy: 'window-4-overlap-2',
    displayText:
      '[2026-04-24T08:14:00Z user] Can you list the data shape files in the gallery?\n' +
      '[2026-04-24T08:14:02Z assistant thinking] User wants a directory listing.\n' +
      '[2026-04-24T08:14:02Z tool: Bash] {"command":"ls -1 cart/app/gallery/data"}\n' +
      '[2026-04-24T08:14:02Z tool result: 71 lines, sha:a3f2…b1]\n' +
      '[2026-04-24T08:14:03Z assistant] Listed 71 entries. The relevant ones for embedding are: …',
    textPreview:
      'user: list data shape files → assistant scans cart/app/gallery/data, surfaces embedding-relevant ones',
    rawEventCount: 5,
    roleSequence: ['user', 'thinking', 'tool_call', 'tool_result', 'assistant'],
    toolCallNames: ['Bash'],
    firstEventOccurredAt: '2026-04-24T08:14:00Z',
    lastEventOccurredAt: '2026-04-24T08:14:03Z',
    contentHash: 'sha256:b3a4c5d6e7f80910a1b2c3d4e5f60718',
    tokenCount: 168,
    createdAt: '2026-04-24T08:14:05Z',
  },
  {
    id: 'clc_sess_claude_01_0019',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_runtime',
    sessionId: 'sess_claude_01',
    modelId: 'claude-opus-4-7',
    chunkIndex: 19,
    chunkingStrategy: 'window-4-overlap-2',
    displayText:
      '[2026-04-22T14:42:00Z user] useHotState resets every reload — expected?\n' +
      '[2026-04-22T14:42:01Z assistant thinking] Slot ids likely invalidated on remount; trap before patching.\n' +
      '[2026-04-22T14:42:02Z tool: Read] {"file_path":"runtime/hooks/useHotState.ts"}\n' +
      '[2026-04-22T14:42:02Z tool result: 64 lines, sha:9f8e…a0]\n' +
      '[2026-04-22T14:42:05Z assistant] Slot cache is keyed on component identity — that is the reset.',
    textPreview:
      'user reports useHotState reset on reload; assistant traces it to slot-cache identity in runtime/hooks/useHotState.ts',
    rawEventCount: 5,
    roleSequence: ['user', 'thinking', 'tool_call', 'tool_result', 'assistant'],
    toolCallNames: ['Read'],
    firstEventOccurredAt: '2026-04-22T14:42:00Z',
    lastEventOccurredAt: '2026-04-22T14:42:05Z',
    contentHash: 'sha256:1a2b3c4d5e6f70819a0b1c2d3e4f5061',
    tokenCount: 142,
    createdAt: '2026-04-22T14:42:08Z',
  },
];

export const chatLogChunkSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ChatLogChunk',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'sessionId',
      'chunkIndex',
      'chunkingStrategy',
      'displayText',
      'textPreview',
      'rawEventCount',
      'roleSequence',
      'toolCallNames',
      'firstEventOccurredAt',
      'lastEventOccurredAt',
      'contentHash',
      'tokenCount',
      'createdAt',
    ],
    properties: {
      id: { type: 'string' },
      workspaceId: { type: 'string' },
      projectId: { type: 'string' },
      sessionId: { type: 'string' },
      modelId: { type: 'string' },
      chunkIndex: { type: 'number' },
      chunkingStrategy: {
        type: 'string',
        enum: ['window-4-overlap-2', 'window-8-overlap-2', 'turn-boundary', 'llm-chunked'],
      },
      displayText: { type: 'string' },
      textPreview: { type: 'string' },
      rawEventCount: { type: 'number' },
      roleSequence: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['user', 'assistant', 'thinking', 'tool_call', 'tool_result', 'system'],
        },
      },
      toolCallNames: { type: 'array', items: { type: 'string' } },
      firstEventOccurredAt: { type: 'string' },
      lastEventOccurredAt: { type: 'string' },
      contentHash: { type: 'string' },
      tokenCount: { type: 'number' },
      createdAt: { type: 'string' },
    },
  },
};

export const chatLogChunkReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Worker session',
    targetSource: 'cart/app/gallery/data/worker-session.ts',
    sourceField: 'sessionId',
    targetField: 'id',
    summary:
      'Each chunk is a window over the worker-event stream of one session. The session is the conversation; chunks slice it.',
  },
  {
    kind: 'references',
    label: 'Workspace / project',
    targetSource: 'cart/app/gallery/data/workspace.ts',
    sourceField: 'workspaceId / projectId',
    targetField: 'id',
    summary:
      'Denormalized from the parent session for retrieval-time filtering — cheaper than joining through session for every search.',
  },
  {
    kind: 'references',
    label: 'Source events (range, not row)',
    targetSource: 'cart/app/gallery/data/worker-event.ts',
    sourceField: '(sessionId, [firstEventOccurredAt, lastEventOccurredAt])',
    targetField: '(sessionId, occurredAt)',
    summary:
      'Not a strict row-level FK — the chunk references a time range of events. This lets the chunk survive worker-event re-normalization or backfill.',
  },
  {
    kind: 'has-many',
    label: 'Embeddings',
    targetSource: 'cart/app/gallery/data/embedding.ts',
    sourceField: 'id',
    targetField: '(entityKind="chat-log-chunk", entityId=id)',
    summary:
      'One Embedding row per (chunk, embeddingModelId). Multiple rows when running an A/B between two embedders.',
  },
  {
    kind: 'references',
    label: 'Consolidates into episodic memory',
    targetSource: 'cart/app/gallery/data/episodic-memory.ts',
    sourceField: '(consolidation)',
    targetField: 'narrative',
    summary:
      'A background consolidation pass selects high-signal chunks and synthesizes them into episodic memory narratives. Not a row-level FK — the relationship is "this chunk contributed to this episode."',
  },
];
