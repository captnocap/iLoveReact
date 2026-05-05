// Embedding — sidecar vector row. Polymorphic on (entityKind,
// entityId): the vector belongs to "the statement field of
// semantic-memory id smem_xyz" or "the body of prompt-template id
// tmpl_xyz".
//
// Lifecycle is driven by `contentHash`. The indexer hashes the
// source text; if a row already exists with the same (entityKind,
// entityId, embeddingModelId, contentHash), the embedding is reused.
// If the hash differs, the old row is replaced — embeddings are
// derived state, not authored state.
//
// Storage: column-store table with a FLOAT[<dimension>] column and an
// HNSW index on the vector column. The embedded-local path is DuckDB
// with the VSS extension; service-backed deployments use Postgres with
// pgvector. For small N (<10k), brute-force cosine over the column is
// fine; HNSW pays off above that. The vector field on this row is the
// portable JSON projection (base64-packed float32). Storage layers may
// keep the on-disk vector as a native typed column; the row shape here
// is the wire shape, not the storage shape.

import type { GalleryDataReference, JsonObject } from '../../types';

export type EmbeddingEntityKind =
  // curated tiers
  | 'semantic-memory'
  | 'episodic-memory'
  | 'procedural-memory'
  | 'working-memory-slot'
  | 'prompt-template'
  | 'system-message'
  | 'skill'
  | 'research-finding'
  | 'plan'
  | 'task'
  // raw-chunk tier (the four corpora that get indexed wholesale)
  | 'chat-log-chunk'
  | 'code-chunk'
  | 'document-chunk';

export type Embedding = {
  id: string;
  entityKind: EmbeddingEntityKind;
  entityId: string;
  /**
   * Optional sub-field path. When the entity is multi-field (e.g.
   * working-memory has slots[]), this disambiguates which field was
   * embedded — e.g. 'slots[3].content'. Null for "embed the whole
   * default content of this entity."
   */
  fieldPath?: string;
  embeddingModelId: string;
  dimension: number;
  /**
   * The vector itself. Stored as a base64 string in JSON contexts;
   * BLOB in SQLite. Length = dimension * 4 bytes (float32).
   */
  vector: string;
  /**
   * Hash of the source text at embed time. Re-embedding triggers when
   * this no longer matches the current source content.
   */
  contentHash: string;
  /** Token count of the source text — useful for batching + cost. */
  tokenCount: number;
  createdAt: string;
};

// Mock vectors are stubbed as base64 placeholder strings — real rows
// would carry serialized float32 arrays.
const STUB_VECTOR_1536 = 'b64:<1536-dim-float32-array>';
const STUB_VECTOR_1024 = 'b64:<1024-dim-float32-array>';

export const embeddingMockData: Embedding[] = [
  {
    id: 'emb_smem_main_only_te3small',
    entityKind: 'semantic-memory',
    entityId: 'smem_main_only',
    embeddingModelId: 'text-embedding-3-small',
    dimension: 1536,
    vector: STUB_VECTOR_1536,
    contentHash: 'sha256:e3b0c44298fc1c149afbf4c8996fb924',
    tokenCount: 22,
    createdAt: '2026-04-24T09:00:00Z',
  },
  {
    id: 'emb_smem_no_explore_te3small',
    entityKind: 'semantic-memory',
    entityId: 'smem_no_explore',
    embeddingModelId: 'text-embedding-3-small',
    dimension: 1536,
    vector: STUB_VECTOR_1536,
    contentHash: 'sha256:6e340b9cffb37a989ca544e6bb780a2c',
    tokenCount: 41,
    createdAt: '2026-04-24T09:00:00Z',
  },
  {
    id: 'emb_tmpl_code_review_te3small',
    entityKind: 'prompt-template',
    entityId: 'tmpl_code_review',
    embeddingModelId: 'text-embedding-3-small',
    dimension: 1536,
    vector: STUB_VECTOR_1536,
    contentHash: 'sha256:b2a4af7c1d8e3f0d6c5e7a3b2a1c4d5e',
    tokenCount: 86,
    createdAt: '2026-04-24T09:00:00Z',
  },
  {
    id: 'emb_skill_debug_triage_bge',
    entityKind: 'skill',
    entityId: 'skill_debug_triage',
    fieldPath: 'description + triggers.phrases',
    embeddingModelId: 'bge-m3',
    dimension: 1024,
    vector: STUB_VECTOR_1024,
    contentHash: 'sha256:f1e2d3c4b5a69788a7b6c5d4e3f2a1b0',
    tokenCount: 38,
    createdAt: '2026-04-24T09:00:00Z',
  },
  {
    id: 'emb_episode_hotstate_te3small',
    entityKind: 'episodic-memory',
    entityId: 'ep_hotstate_regression',
    fieldPath: 'narrative',
    embeddingModelId: 'text-embedding-3-small',
    dimension: 1536,
    vector: STUB_VECTOR_1536,
    contentHash: 'sha256:9f8e7d6c5b4a39281706f5e4d3c2b1a0',
    tokenCount: 92,
    createdAt: '2026-04-22T15:11:00Z',
  },
  {
    id: 'emb_episode_hotstate_bge',
    entityKind: 'episodic-memory',
    entityId: 'ep_hotstate_regression',
    fieldPath: 'narrative',
    embeddingModelId: 'bge-m3',
    dimension: 1024,
    vector: STUB_VECTOR_1024,
    contentHash: 'sha256:9f8e7d6c5b4a39281706f5e4d3c2b1a0',
    tokenCount: 92,
    createdAt: '2026-04-22T15:11:00Z',
  },
  {
    id: 'emb_clc_sess_claude_01_0019_qwen3_4b',
    entityKind: 'chat-log-chunk',
    entityId: 'clc_sess_claude_01_0019',
    fieldPath: 'displayText',
    embeddingModelId: 'qwen3-embedding-4b',
    dimension: 1024,
    vector: STUB_VECTOR_1024,
    contentHash: 'sha256:1a2b3c4d5e6f70819a0b1c2d3e4f5061',
    tokenCount: 142,
    createdAt: '2026-04-22T14:42:10Z',
  },
  {
    id: 'emb_cc_runtime_useHotState_0_qwen3_4b',
    entityKind: 'code-chunk',
    entityId: 'cc_runtime_useHotState_0_200',
    fieldPath: 'displayText',
    embeddingModelId: 'qwen3-embedding-4b',
    dimension: 1024,
    vector: STUB_VECTOR_1024,
    contentHash: 'sha256:c3d4e5f60718293a4b5c6d7e8f9001122',
    tokenCount: 1480,
    createdAt: '2026-04-24T08:00:30Z',
  },
  {
    id: 'emb_doc_claude_md_0_qwen3_4b',
    entityKind: 'document-chunk',
    entityId: 'doc_claude_md_root_0',
    fieldPath: 'displayText',
    embeddingModelId: 'qwen3-embedding-4b',
    dimension: 1024,
    vector: STUB_VECTOR_1024,
    contentHash: 'sha256:0a1b2c3d4e5f60718293a4b5c6d7e8f9',
    tokenCount: 132,
    createdAt: '2026-04-25T09:00:30Z',
  },
];

export const embeddingSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Embedding',
  description:
    'Polymorphic sidecar; vectors from different embeddingModelIds are NOT comparable. Storage layer expected to enforce UNIQUE on (entityKind, entityId, fieldPath, embeddingModelId).',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'entityKind',
      'entityId',
      'embeddingModelId',
      'dimension',
      'vector',
      'contentHash',
      'tokenCount',
      'createdAt',
    ],
    properties: {
      id: { type: 'string' },
      entityKind: {
        type: 'string',
        enum: [
          'semantic-memory',
          'episodic-memory',
          'procedural-memory',
          'working-memory-slot',
          'prompt-template',
          'system-message',
          'skill',
          'research-finding',
          'plan',
          'task',
          'chat-log-chunk',
          'code-chunk',
          'document-chunk',
        ],
      },
      entityId: { type: 'string' },
      fieldPath: { type: 'string' },
      embeddingModelId: { type: 'string' },
      dimension: { type: 'number' },
      vector: { type: 'string' },
      contentHash: { type: 'string' },
      tokenCount: { type: 'number' },
      createdAt: { type: 'string' },
    },
  },
};

export const embeddingReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Embedding model',
    targetSource: 'cart/app/gallery/data/embedding-model.ts',
    sourceField: 'embeddingModelId',
    targetField: 'id',
    summary:
      'The model that produced this vector. Search must filter to one model per query — vectors from different models live in different spaces.',
  },
  {
    kind: 'references',
    label: 'Source entity (polymorphic)',
    targetSource: 'cart/app/gallery/data/(varies by entityKind)',
    sourceField: '(entityKind, entityId)',
    targetField: 'id',
    summary:
      'Polymorphic FK. entityKind names the target table; entityId is the row in that table. The source content lives there; this row is derived state.',
  },
  {
    kind: 'has-many',
    label: 'Retrieval queries (matched against)',
    targetSource: 'cart/app/gallery/data/retrieval-query.ts',
    sourceField: 'id',
    targetField: 'results[].embeddingId',
    summary: 'Retrieval results record which embedding row scored against the query.',
  },
];
