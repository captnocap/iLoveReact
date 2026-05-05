// EmbeddingModel — catalog of text-embedding models. Parallel to
// model.ts but specifically for embedders, because the concerns are
// disjoint: embedders don't have temperature / thinking / tools / tool
// calling. They have dimensions, max-input-tokens, and a vector space
// that is *not* interchangeable with other embedders' spaces.
//
// Critical invariant: embeddings produced by different EmbeddingModel
// rows are not comparable. A query embedded with `text-embedding-3-
// small` cannot be searched against vectors stored with `bge-m3`. The
// `embedding.embeddingModelId` FK is what keeps the search space
// honest — the retrieval layer must filter to one model per query.

import type { GalleryDataReference, JsonObject } from '../../types';

export type EmbeddingProvider = 'openai' | 'voyage' | 'cohere' | 'jina' | 'local' | 'anthropic';
export type EmbeddingModelStatus = 'active' | 'experimental' | 'deprecated';

export type EmbeddingModel = {
  id: string;
  providerId: EmbeddingProvider;
  displayName: string;
  dimension: number;
  maxInputTokens: number;
  pricingPerMTokUsd?: number;
  supportsBatchEmbed: boolean;
  supportsLatePreloading?: boolean; // can pre-embed at index time AND adjust at query time (e.g. matryoshka truncation)
  matryoshkaTruncation?: number[]; // dimensions you can truncate to without re-embedding
  status: EmbeddingModelStatus;
  summary?: string;
};

export const embeddingModelMockData: EmbeddingModel[] = [
  {
    id: 'text-embedding-3-small',
    providerId: 'openai',
    displayName: 'OpenAI text-embedding-3-small',
    dimension: 1536,
    maxInputTokens: 8191,
    pricingPerMTokUsd: 0.02,
    supportsBatchEmbed: true,
    supportsLatePreloading: true,
    matryoshkaTruncation: [256, 384, 512, 768, 1024, 1536],
    status: 'active',
    summary: 'Cheap default. Matryoshka truncation lets you store 1536d but query at lower dim for speed.',
  },
  {
    id: 'text-embedding-3-large',
    providerId: 'openai',
    displayName: 'OpenAI text-embedding-3-large',
    dimension: 3072,
    maxInputTokens: 8191,
    pricingPerMTokUsd: 0.13,
    supportsBatchEmbed: true,
    supportsLatePreloading: true,
    matryoshkaTruncation: [256, 1024, 3072],
    status: 'active',
    summary: 'Higher quality at ~7x the cost. Use for cross-encoder seed sets, re-rankers, and small high-value indexes.',
  },
  {
    id: 'voyage-3',
    providerId: 'voyage',
    displayName: 'Voyage 3',
    dimension: 1024,
    maxInputTokens: 32_000,
    pricingPerMTokUsd: 0.06,
    supportsBatchEmbed: true,
    status: 'active',
    summary: 'Long-context embedder. Useful for embedding whole research documents without chunking.',
  },
  {
    id: 'bge-m3',
    providerId: 'local',
    displayName: 'BGE-M3 (local)',
    dimension: 1024,
    maxInputTokens: 8192,
    supportsBatchEmbed: true,
    status: 'active',
    summary:
      'On-device embedder for the local-runtime path and offline / strict-privacy settings. No outbound network required.',
  },
  {
    id: 'jina-embeddings-v3',
    providerId: 'jina',
    displayName: 'Jina Embeddings v3',
    dimension: 1024,
    maxInputTokens: 8192,
    pricingPerMTokUsd: 0.05,
    supportsBatchEmbed: true,
    supportsLatePreloading: true,
    matryoshkaTruncation: [256, 512, 1024],
    status: 'experimental',
  },
  {
    id: 'qwen3-embedding-0_6b',
    providerId: 'local',
    displayName: 'Qwen3-Embedding 0.6B (local, llama.cpp GGUF)',
    dimension: 1024,
    maxInputTokens: 32_768,
    supportsBatchEmbed: true,
    supportsLatePreloading: true,
    matryoshkaTruncation: [128, 256, 512, 768, 1024],
    status: 'active',
    summary:
      'Smallest Qwen3-Embedding. Fast indexing path — ~5-10 ms per chunk on a modern GPU via llama.cpp. Use for the bulk pass on 1M+ chunk corpora.',
  },
  {
    id: 'qwen3-embedding-4b',
    providerId: 'local',
    displayName: 'Qwen3-Embedding 4B (local, llama.cpp GGUF)',
    dimension: 1024,
    maxInputTokens: 32_768,
    supportsBatchEmbed: true,
    supportsLatePreloading: true,
    matryoshkaTruncation: [128, 256, 512, 768, 1024],
    status: 'active',
    summary:
      'Sweet-spot Qwen3-Embedding. ~30-60 ms per chunk on local GPU; close to 8B quality at half the cost. Default embedder for the four-corpus index.',
  },
  {
    id: 'qwen3-embedding-8b',
    providerId: 'local',
    displayName: 'Qwen3-Embedding 8B (local, llama.cpp GGUF)',
    dimension: 1024,
    maxInputTokens: 32_768,
    supportsBatchEmbed: true,
    supportsLatePreloading: true,
    matryoshkaTruncation: [128, 256, 512, 768, 1024],
    status: 'experimental',
    summary:
      'Largest Qwen3-Embedding. Top of MTEB at ~80-150 ms per chunk; cost rarely worth it over 4B + reranker. Carry it as an A/B option, not the default.',
  },
];

export const embeddingModelSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'EmbeddingModel',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'providerId',
      'displayName',
      'dimension',
      'maxInputTokens',
      'supportsBatchEmbed',
      'status',
    ],
    properties: {
      id: { type: 'string' },
      providerId: {
        type: 'string',
        enum: ['openai', 'voyage', 'cohere', 'jina', 'local', 'anthropic'],
      },
      displayName: { type: 'string' },
      dimension: { type: 'number' },
      maxInputTokens: { type: 'number' },
      pricingPerMTokUsd: { type: 'number' },
      supportsBatchEmbed: { type: 'boolean' },
      supportsLatePreloading: { type: 'boolean' },
      matryoshkaTruncation: { type: 'array', items: { type: 'number' } },
      status: { type: 'string', enum: ['active', 'experimental', 'deprecated'] },
      summary: { type: 'string' },
    },
  },
};

export const embeddingModelReferences: GalleryDataReference[] = [
  {
    kind: 'has-many',
    label: 'Embedding rows',
    targetSource: 'cart/app/gallery/data/embedding.ts',
    sourceField: 'id',
    targetField: 'embeddingModelId',
    summary:
      'Every embedding row carries the model that produced it. Vectors from different models are NOT comparable.',
  },
  {
    kind: 'references',
    label: 'Provider (loose)',
    targetSource: 'cart/app/gallery/data/provider.ts',
    sourceField: 'providerId',
    targetField: 'id (loose link — providers may overlap)',
    summary:
      'Some embedding providers map to existing chat providers (openai, anthropic) but the catalog is intentionally separate — embedding-only providers (voyage, cohere) belong here, not in provider.ts.',
  },
];
