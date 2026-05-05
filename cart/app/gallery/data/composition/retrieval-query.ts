// RetrievalQuery — audit-grain log of executed retrievals. One row
// per "the agent looked something up in memory and got these N
// results, which it then fed into the next prompt."
//
// Pairs naturally with InferenceRequest: a request that uses RAG
// produces one (or more) RetrievalQuery rows whose `feedingRequestId`
// points at the request, so audits can replay "exactly which
// memories shaped this answer."
//
// Results are inlined because they are typically small (top-K with
// K usually 3–12), always co-read with the query, and frozen at
// query-time (the source embedding row may later be re-embedded but
// the result row preserves what was actually retrieved).

import type { GalleryDataReference, JsonObject } from '../../types';
import type { EmbeddingEntityKind } from './embedding';

export type RetrievalResult = {
  rank: number;
  embeddingId: string;
  entityKind: EmbeddingEntityKind;
  entityId: string;
  score: number; // primary similarity score
  recencyWeight?: number; // applied if the strategy uses recency decay
  sourceConfidence?: number; // copied from the source row at retrieval time
  excerpt?: string; // short snippet from the source content for display
  includedInContext: boolean; // did this actually make it into the prompt?
};

export type RetrievalQuery = {
  id: string;
  workerId: string;
  strategyId: string;
  embeddingModelId: string;
  /** Raw text of the query before embedding. */
  queryText: string;
  /** Hash of the query — useful for cache hits on repeated queries. */
  queryHash: string;
  /** Optional pre-filters not expressible on the strategy alone. */
  preFilters?: {
    workspaceId?: string;
    projectId?: string;
    tags?: string[];
  };
  results: RetrievalResult[];
  totalCandidates: number; // how many embeddings were scored before topK
  /** The InferenceRequest this retrieval fed, when applicable. */
  feedingRequestId?: string;
  cacheHit: boolean; // did we serve this from a previous identical query?
  durationMs: number;
  executedAt: string;
};

export const retrievalQueryMockData: RetrievalQuery[] = [
  {
    id: 'retq_001',
    workerId: 'w1',
    strategyId: 'retr_default',
    embeddingModelId: 'text-embedding-3-small',
    queryText: 'What is the convention for committing changes in this repo?',
    queryHash: 'sha256:c3a1b2f4d5e60718293a4b5c6d7e8f90',
    preFilters: { workspaceId: 'ws_reactjit' },
    results: [
      {
        rank: 1,
        embeddingId: 'emb_smem_main_only_te3small',
        entityKind: 'semantic-memory',
        entityId: 'smem_main_only',
        score: 0.91,
        recencyWeight: 0.98,
        sourceConfidence: 1.0,
        excerpt: 'Commit and push to main only; do not create or checkout branches in this repo.',
        includedInContext: true,
      },
      {
        rank: 2,
        embeddingId: 'emb_smem_no_explore_te3small',
        entityKind: 'semantic-memory',
        entityId: 'smem_no_explore',
        score: 0.42,
        recencyWeight: 0.96,
        sourceConfidence: 1.0,
        excerpt: 'Do not invoke the Explore agent in this repo; use direct Read/Grep/Glob/Bash.',
        includedInContext: false,
      },
    ],
    totalCandidates: 7,
    feedingRequestId: 'req_002',
    cacheHit: false,
    durationMs: 41,
    executedAt: '2026-04-25T09:05:30Z',
  },
  {
    id: 'retq_002_skill_match',
    workerId: 'worker_sup_01',
    strategyId: 'retr_skill_match',
    embeddingModelId: 'text-embedding-3-small',
    queryText: 'this test fails sometimes — figure out if it is a real bug',
    queryHash: 'sha256:4f5e6d7c8b9a0a1b2c3d4e5f60718293',
    results: [
      {
        rank: 1,
        embeddingId: 'emb_skill_debug_triage_bge',
        entityKind: 'skill',
        entityId: 'skill_debug_triage',
        score: 0.83,
        excerpt: 'Hypothesis-ranked triage. Surfaces smallest diagnostic and trap-before-fix approach.',
        includedInContext: true,
      },
    ],
    totalCandidates: 6,
    cacheHit: false,
    durationMs: 28,
    executedAt: '2026-04-25T08:55:00Z',
  },
  {
    id: 'retq_003_episode_lookup',
    workerId: 'w1',
    strategyId: 'retr_episode_lookup',
    embeddingModelId: 'text-embedding-3-small',
    queryText: 'useHotState slot reset on hot reload — has this come up before?',
    queryHash: 'sha256:8b7a6c5d4e3f201928374650a1b2c3d4',
    preFilters: { projectId: 'proj_reactjit_runtime' },
    results: [
      {
        rank: 1,
        embeddingId: 'emb_episode_hotstate_te3small',
        entityKind: 'episodic-memory',
        entityId: 'ep_hotstate_regression',
        score: 0.94,
        recencyWeight: 0.78,
        excerpt:
          'Reproduced by saving runtime/hooks/useHotState.ts. Slot cache keyed on component identity was invalidated on every remount...',
        includedInContext: true,
      },
    ],
    totalCandidates: 3,
    feedingRequestId: 'req_003',
    cacheHit: false,
    durationMs: 19,
    executedAt: '2026-04-25T09:15:30Z',
  },
];

export const retrievalQuerySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'RetrievalQuery',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'workerId',
      'strategyId',
      'embeddingModelId',
      'queryText',
      'queryHash',
      'results',
      'totalCandidates',
      'cacheHit',
      'durationMs',
      'executedAt',
    ],
    properties: {
      id: { type: 'string' },
      workerId: { type: 'string' },
      strategyId: { type: 'string' },
      embeddingModelId: { type: 'string' },
      queryText: { type: 'string' },
      queryHash: { type: 'string' },
      preFilters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workspaceId: { type: 'string' },
          projectId: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      totalCandidates: { type: 'number' },
      feedingRequestId: { type: 'string' },
      cacheHit: { type: 'boolean' },
      durationMs: { type: 'number' },
      executedAt: { type: 'string' },
      results: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rank', 'embeddingId', 'entityKind', 'entityId', 'score', 'includedInContext'],
          properties: {
            rank: { type: 'number' },
            embeddingId: { type: 'string' },
            entityKind: { type: 'string' },
            entityId: { type: 'string' },
            score: { type: 'number' },
            recencyWeight: { type: 'number' },
            sourceConfidence: { type: 'number' },
            excerpt: { type: 'string' },
            includedInContext: { type: 'boolean' },
          },
        },
      },
    },
  },
};

export const retrievalQueryReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Worker',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'workerId',
    targetField: 'id',
  },
  {
    kind: 'belongs-to',
    label: 'Strategy',
    targetSource: 'cart/app/gallery/data/retrieval-strategy.ts',
    sourceField: 'strategyId',
    targetField: 'id',
  },
  {
    kind: 'belongs-to',
    label: 'Embedding model',
    targetSource: 'cart/app/gallery/data/embedding-model.ts',
    sourceField: 'embeddingModelId',
    targetField: 'id',
    summary: 'Both the query and the candidate vectors must use the same model — RetrievalQuery records which.',
  },
  {
    kind: 'references',
    label: 'Result embeddings',
    targetSource: 'cart/app/gallery/data/embedding.ts',
    sourceField: 'results[].embeddingId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Feeding inference request',
    targetSource: 'cart/app/gallery/data/inference-request.ts',
    sourceField: 'feedingRequestId',
    targetField: 'id',
    summary:
      'When this retrieval fed into a prompt, links to that InferenceRequest so audits can replay "exactly which memories shaped the answer."',
  },
];
