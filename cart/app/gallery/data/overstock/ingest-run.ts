// IngestRun — one row per embedding-pipeline invocation. Captures the
// {source, model, range, status, timing, error} for a single ingest pass
// across one of the seven corpora (claude / claude-overflow / codex / kimi
// chat logs, agent memory, repo code, generic documents).
//
// Lifecycle:
//   - row inserted at run start with status='running', filesDone=0
//   - filesDone + chunksEmbedded incremented as each file completes
//   - status flipped to 'completed' | 'failed' | 'cancelled' at end,
//     wallMs + embedMs filled in
//
// The detailed per-file events live in ingest-event.ts. The row here is
// the rollup; the event log is the audit trail. Live UIs can render
// progress bars from this row alone (no event scan required); the event
// log is for post-mortems and throughput analysis.
//
// Cart UI rendering pattern:
//   - "Embedding Index" panel queries WHERE status='running' to render
//     active progress bars (one per row, parallel ingests supported)
//   - "Recent Ingests" history queries the last N rows ordered by
//     startedAt for retrospective stats

import type { GalleryDataReference, JsonObject } from '../../types';

export type IngestSourceType =
  | 'chat-log-claude'
  | 'chat-log-claude-overflow'
  | 'chat-log-codex'
  | 'chat-log-kimi'
  | 'memory'
  | 'code'
  | 'document';

export type IngestStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type IngestRunArgs = {
  /** Cap files to process (0 = no limit). */
  limit?: number;
  /** Skip the first N alphabetically-sorted files. */
  offset?: number;
  /** Repo root for the code source. Ignored for chat sources. */
  root?: string;
  /** Optional reranker path used by query-time runs that record stats here. */
  rerank?: string;
};

export type IngestRun = {
  id: string;
  sourceType: IngestSourceType;
  /** FK → embedding-model.id. The vector space the chunks were embedded into. */
  modelId: string;
  /** Absolute path to the per-model DuckDB file written by this run. */
  dbPath: string;
  /** FK → worker.id (loose). Null for manual CLI invocations. */
  workerId?: string;
  /** Reproducibility: the args passed to the run. */
  args: IngestRunArgs;
  startedAt: string;
  endedAt?: string;
  /** Files discovered by the source-specific walker. */
  filesTotal: number;
  /** Files successfully processed. Increments live during the run. */
  filesDone: number;
  /** Files that errored out (parse failures, oversize, missing). */
  filesFailed: number;
  /** Chunks upserted into the chunks table by this run. */
  chunksEmbedded: number;
  status: IngestStatus;
  /** First fatal error message, if any. Per-file errors live on IngestEvent. */
  errorText?: string;
  /** Wall time in ms — set when status flips terminal. While running, UI
   *  computes elapsed from startedAt + now. */
  wallMs?: number;
  /** Sum of per-chunk embed time. wallMs - embedMs ≈ I/O + DB time. */
  embedMs?: number;
};

export const ingestRunMockData: IngestRun[] = [
  {
    id: 'run_2026_04_30_claude_qwen06_initial',
    sourceType: 'chat-log-claude',
    modelId: 'qwen3-embedding-0_6b',
    dbPath: '/home/siah/.cache/reactjit-embed/bench-qwen3-embedding-0-6b-q8_0.db',
    args: { limit: 20 },
    startedAt: '2026-04-29T23:11:00Z',
    endedAt: '2026-04-29T23:15:36Z',
    filesTotal: 289,
    filesDone: 20,
    filesFailed: 0,
    chunksEmbedded: 5716,
    status: 'completed',
    wallMs: 276_313,
    embedMs: 222_095,
  },
  {
    id: 'run_2026_04_30_claude_qwen06_extend',
    sourceType: 'chat-log-claude',
    modelId: 'qwen3-embedding-0_6b',
    dbPath: '/home/siah/.cache/reactjit-embed/bench-qwen3-embedding-0-6b-q8_0.db',
    args: { limit: 150, offset: 20 },
    startedAt: '2026-04-30T01:30:00Z',
    endedAt: '2026-04-30T02:00:00Z',
    filesTotal: 289,
    filesDone: 150,
    filesFailed: 0,
    chunksEmbedded: 28_781,
    status: 'completed',
    wallMs: 1_748_409,
    embedMs: 1_408_071,
  },
  {
    id: 'run_2026_04_30_overflow_qwen06',
    sourceType: 'chat-log-claude-overflow',
    modelId: 'qwen3-embedding-0_6b',
    dbPath: '/home/siah/.cache/reactjit-embed/bench-qwen3-embedding-0-6b-q8_0.db',
    args: { limit: 999 },
    startedAt: '2026-04-30T03:11:00Z',
    filesTotal: 221,
    filesDone: 87,
    filesFailed: 0,
    chunksEmbedded: 14_238,
    status: 'running',
  },
  {
    id: 'run_2026_04_30_memory_qwen06_smoke',
    sourceType: 'memory',
    modelId: 'qwen3-embedding-0_6b',
    dbPath: '/home/siah/.cache/reactjit-embed/bench-qwen3-embedding-0-6b-q8_0.db',
    args: { limit: 10 },
    startedAt: '2026-04-30T02:55:00Z',
    endedAt: '2026-04-30T02:55:01Z',
    filesTotal: 234,
    filesDone: 10,
    filesFailed: 0,
    chunksEmbedded: 10,
    status: 'completed',
    wallMs: 1_080,
    embedMs: 876,
  },
  {
    id: 'run_2026_04_30_code_voyage_smoke',
    sourceType: 'code',
    modelId: 'voyage-4-nano',
    dbPath: '/tmp/voy-codetest.db',
    args: { limit: 5, root: '/home/siah/creative/reactjit/runtime/hooks' },
    startedAt: '2026-04-30T02:50:11Z',
    endedAt: '2026-04-30T02:50:11.665Z',
    filesTotal: 33,
    filesDone: 5,
    filesFailed: 0,
    chunksEmbedded: 5,
    status: 'completed',
    wallMs: 665,
    embedMs: 603,
  },
  {
    id: 'run_2026_04_30_codex_qwen06_partial',
    sourceType: 'chat-log-codex',
    modelId: 'qwen3-embedding-0_6b',
    dbPath: '/home/siah/.cache/reactjit-embed/bench-qwen3-embedding-0-6b-q8_0.db',
    args: { limit: 3 },
    startedAt: '2026-04-30T02:30:00Z',
    endedAt: '2026-04-30T02:30:18Z',
    filesTotal: 416,
    filesDone: 3,
    filesFailed: 0,
    chunksEmbedded: 276,
    status: 'completed',
    wallMs: 18_124,
    embedMs: 15_198,
  },
];

export const ingestRunSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'IngestRun',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'sourceType',
      'modelId',
      'dbPath',
      'args',
      'startedAt',
      'filesTotal',
      'filesDone',
      'filesFailed',
      'chunksEmbedded',
      'status',
    ],
    properties: {
      id: { type: 'string' },
      sourceType: {
        type: 'string',
        enum: [
          'chat-log-claude',
          'chat-log-claude-overflow',
          'chat-log-codex',
          'chat-log-kimi',
          'memory',
          'code',
          'document',
        ],
      },
      modelId: { type: 'string' },
      dbPath: { type: 'string' },
      workerId: { type: 'string' },
      args: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'number' },
          offset: { type: 'number' },
          root: { type: 'string' },
          rerank: { type: 'string' },
        },
      },
      startedAt: { type: 'string' },
      endedAt: { type: 'string' },
      filesTotal: { type: 'number' },
      filesDone: { type: 'number' },
      filesFailed: { type: 'number' },
      chunksEmbedded: { type: 'number' },
      status: { type: 'string', enum: ['running', 'completed', 'failed', 'cancelled'] },
      errorText: { type: 'string' },
      wallMs: { type: 'number' },
      embedMs: { type: 'number' },
    },
  },
};

export const ingestRunReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Embedding model',
    targetSource: 'cart/app/gallery/data/embedding-model.ts',
    sourceField: 'modelId',
    targetField: 'id',
    summary:
      'The vector space the chunks landed in. All Embedding rows produced by this run share this modelId.',
  },
  {
    kind: 'references',
    label: 'Worker (optional)',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'workerId',
    targetField: 'id',
    summary:
      'Null for manual CLI invocations. Set when an agent/worker (e.g. supervisor) kicked off the ingest as part of its goal.',
  },
  {
    kind: 'has-many',
    label: 'Ingest events',
    targetSource: 'cart/app/gallery/data/ingest-event.ts',
    sourceField: 'id',
    targetField: 'runId',
    summary:
      'Per-file lifecycle events. Optional — the rollup on this row is enough for live progress UIs; events are for audit + post-mortem.',
  },
  {
    kind: 'references',
    label: 'Produces chunks (loose)',
    targetSource: 'cart/app/gallery/data/embedding.ts',
    sourceField: 'id',
    targetField: '(no row-level FK; rows produced during [startedAt, endedAt] for this modelId)',
    summary:
      'Embedding rows do not currently carry a runId column. The link is implicit by time + model. Add a runId column on Embedding if cross-run analytics become important.',
  },
  {
    kind: 'references',
    label: 'Source corpus (varies by sourceType)',
    targetSource: 'cart/app/gallery/data/(chat-log-chunk|code-chunk|document-chunk|agent-memory).ts',
    sourceField: 'sourceType',
    targetField: '(implicit — sourceType selects which chunk shape was produced)',
    summary:
      'sourceType discriminates which downstream chunk shape this run produced. chat-log-* sources produce chat-log-chunk rows; code produces code-chunk; memory produces document-chunk with format=memory; document produces document-chunk.',
  },
];
