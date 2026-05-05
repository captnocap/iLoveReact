// IngestEvent — fine-grained event log inside a single IngestRun.
// Append-only audit trail of what happened, when, to which file.
//
// Optional but useful for:
//   - live progress UI subscribed to the JSON-line stream from --progress-fd
//   - post-mortem on failed runs (which file errored, with what reason)
//   - throughput analysis (distribution of per-file embed times)
//   - debugging "why did chunk count drop after re-ingest" (file_error events)
//
// Wire format note:
//   When streamed via embed-bench's --progress-fd flag, each event is a
//   single JSON line matching one of the discriminated-union arms below
//   (minus the `id` and `runId` fields, which are implicit in the
//   connection). The persistent table form below carries those fields
//   for cross-run queries.

import type { GalleryDataReference, JsonObject } from '../../types';

export type IngestEventPhase =
  | 'discovering_files'
  | 'embedding'
  | 'building_hnsw';

export type IngestEvent =
  | {
      id: string;
      runId: string;
      ts: string;
      kind: 'run_start';
      total_files: number;
    }
  | {
      id: string;
      runId: string;
      ts: string;
      kind: 'file_start';
      i: number; // 1-based file index within the run
      path: string;
    }
  | {
      id: string;
      runId: string;
      ts: string;
      kind: 'file_done';
      i: number;
      path: string;
      events: number; // FlatEvent count parsed
      chunks: number; // chunks emitted + embedded for this file
      embed_ms: number;
    }
  | {
      id: string;
      runId: string;
      ts: string;
      kind: 'file_error';
      i: number;
      path: string;
      reason: string;
    }
  | {
      id: string;
      runId: string;
      ts: string;
      kind: 'phase_change';
      phase: IngestEventPhase;
    }
  | {
      id: string;
      runId: string;
      ts: string;
      kind: 'run_done';
      files: number;
      chunks: number;
      wall_ms: number;
      embed_ms: number;
    }
  | {
      id: string;
      runId: string;
      ts: string;
      kind: 'run_error';
      reason: string;
    };

export const ingestEventMockData: IngestEvent[] = [
  {
    id: 'evt_overflow_001',
    runId: 'run_2026_04_30_overflow_qwen06',
    ts: '2026-04-30T03:11:00.024Z',
    kind: 'run_start',
    total_files: 221,
  },
  {
    id: 'evt_overflow_002',
    runId: 'run_2026_04_30_overflow_qwen06',
    ts: '2026-04-30T03:11:00.110Z',
    kind: 'phase_change',
    phase: 'embedding',
  },
  {
    id: 'evt_overflow_003',
    runId: 'run_2026_04_30_overflow_qwen06',
    ts: '2026-04-30T03:11:00.180Z',
    kind: 'file_start',
    i: 1,
    path: '/home/siah/.claude-overflow/projects/-home-siah-creative-reactjit/0023bf24-4f1e-4321-9bca-d6e7e4b7e5a2.jsonl',
  },
  {
    id: 'evt_overflow_004',
    runId: 'run_2026_04_30_overflow_qwen06',
    ts: '2026-04-30T03:11:09.804Z',
    kind: 'file_done',
    i: 1,
    path: '/home/siah/.claude-overflow/projects/-home-siah-creative-reactjit/0023bf24-4f1e-4321-9bca-d6e7e4b7e5a2.jsonl',
    events: 612,
    chunks: 184,
    embed_ms: 8_932,
  },
  {
    id: 'evt_overflow_005',
    runId: 'run_2026_04_30_overflow_qwen06',
    ts: '2026-04-30T03:14:42.100Z',
    kind: 'file_error',
    i: 17,
    path: '/home/siah/.claude-overflow/projects/-home-siah-creative-reactjit/c0fe1234-deadbeef.jsonl',
    reason: 'parse_failed: invalid JSON at line 4209',
  },
  {
    id: 'evt_codex_run_done',
    runId: 'run_2026_04_30_codex_qwen06_partial',
    ts: '2026-04-30T02:30:18.124Z',
    kind: 'run_done',
    files: 3,
    chunks: 276,
    wall_ms: 18_124,
    embed_ms: 15_198,
  },
  {
    id: 'evt_old_run_error',
    runId: 'run_old_failed_example',
    ts: '2026-04-29T22:18:11.000Z',
    kind: 'run_error',
    reason: 'duckdb says: Conversion Error: Cannot cast list with length 2560 to array with length 1024',
  },
];

export const ingestEventSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'IngestEvent',
  description:
    'Discriminated union over kind. Each arm has its own required payload fields; common fields (id, runId, ts, kind) appear on all arms.',
  oneOf: [
    {
      title: 'run_start',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'runId', 'ts', 'kind', 'total_files'],
      properties: {
        id: { type: 'string' },
        runId: { type: 'string' },
        ts: { type: 'string' },
        kind: { const: 'run_start' },
        total_files: { type: 'number' },
      },
    },
    {
      title: 'file_start',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'runId', 'ts', 'kind', 'i', 'path'],
      properties: {
        id: { type: 'string' },
        runId: { type: 'string' },
        ts: { type: 'string' },
        kind: { const: 'file_start' },
        i: { type: 'number' },
        path: { type: 'string' },
      },
    },
    {
      title: 'file_done',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'runId', 'ts', 'kind', 'i', 'path', 'events', 'chunks', 'embed_ms'],
      properties: {
        id: { type: 'string' },
        runId: { type: 'string' },
        ts: { type: 'string' },
        kind: { const: 'file_done' },
        i: { type: 'number' },
        path: { type: 'string' },
        events: { type: 'number' },
        chunks: { type: 'number' },
        embed_ms: { type: 'number' },
      },
    },
    {
      title: 'file_error',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'runId', 'ts', 'kind', 'i', 'path', 'reason'],
      properties: {
        id: { type: 'string' },
        runId: { type: 'string' },
        ts: { type: 'string' },
        kind: { const: 'file_error' },
        i: { type: 'number' },
        path: { type: 'string' },
        reason: { type: 'string' },
      },
    },
    {
      title: 'phase_change',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'runId', 'ts', 'kind', 'phase'],
      properties: {
        id: { type: 'string' },
        runId: { type: 'string' },
        ts: { type: 'string' },
        kind: { const: 'phase_change' },
        phase: { type: 'string', enum: ['discovering_files', 'embedding', 'building_hnsw'] },
      },
    },
    {
      title: 'run_done',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'runId', 'ts', 'kind', 'files', 'chunks', 'wall_ms', 'embed_ms'],
      properties: {
        id: { type: 'string' },
        runId: { type: 'string' },
        ts: { type: 'string' },
        kind: { const: 'run_done' },
        files: { type: 'number' },
        chunks: { type: 'number' },
        wall_ms: { type: 'number' },
        embed_ms: { type: 'number' },
      },
    },
    {
      title: 'run_error',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'runId', 'ts', 'kind', 'reason'],
      properties: {
        id: { type: 'string' },
        runId: { type: 'string' },
        ts: { type: 'string' },
        kind: { const: 'run_error' },
        reason: { type: 'string' },
      },
    },
  ],
};

export const ingestEventReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Ingest run',
    targetSource: 'cart/app/gallery/data/ingest-run.ts',
    sourceField: 'runId',
    targetField: 'id',
    summary:
      'Every event belongs to exactly one run. The run row is the rollup; events are the per-file audit trail.',
  },
  {
    kind: 'references',
    label: 'Wire format (live stream)',
    targetSource: '(embed-bench --progress-fd)',
    sourceField: '(JSON-line stream)',
    targetField: '(this shape minus id/runId, which are implicit in the connection)',
    summary:
      'When embed-bench is run with --progress-fd N, each event lands as one JSON line on that fd. Subscribers (cart UI, log tailers) decode one event per line. The persistent table form below carries id/runId so events can be queried after the connection closes.',
  },
];
