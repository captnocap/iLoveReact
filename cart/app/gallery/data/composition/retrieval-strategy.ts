// RetrievalStrategy — saved retrieval configuration. The user picks
// (or the worker selects automatically) one of these when looking
// things up from the embedding store. Strategy answers "given a
// query, what counts as a relevant result?" — top-k, threshold,
// diversity, recency weighting, entity filters.
//
// Strategies are profile-scoped (settingsId) so the strict work
// profile can pin lower top-k and stricter entity filters than the
// personal profile.
//
// The strategy itself does NOT bind to an EmbeddingModel — that
// lives on the RetrievalQuery so the worker can switch models at
// query time (e.g. drop to bge-m3 for offline runs while keeping the
// strategy's other knobs).

import type { GalleryDataReference, JsonObject } from '../../types';
import type { EmbeddingEntityKind } from './embedding';

export type RetrievalScoringMode =
  | 'cosine'
  | 'dot-product'
  | 'l2-distance'
  | 'mmr' // maximum marginal relevance — diversity-aware
  | 'hybrid'; // similarity blended with keyword / BM25 score

export type RetrievalStrategy = {
  id: string;
  settingsId: string;
  label: string;
  description?: string;
  scoringMode: RetrievalScoringMode;
  topK: number;
  /** Minimum score to include — filter applied AFTER ranking. */
  minScore?: number;
  /** For mmr scoring — tradeoff between similarity and diversity. */
  mmrLambda?: number;
  /** Recency decay half-life in seconds — null = no recency weighting. */
  recencyHalfLifeSec?: number;
  /** If set, restrict to these entity kinds. Empty = no filter. */
  entityKindFilter?: EmbeddingEntityKind[];
  /** If set, drop results below this confidence on the source row. */
  minSourceConfidence?: number;
  /** Whether to deduplicate near-identical results. */
  deduplicate: boolean;
  /** Threshold above which two results are considered duplicates (cosine). */
  deduplicateThreshold?: number;
  createdAt: string;
  updatedAt: string;
};

export const retrievalStrategyMockData: RetrievalStrategy[] = [
  {
    id: 'retr_default',
    settingsId: 'settings_default',
    label: 'Default (top-5 cosine, gentle recency)',
    description: 'Standard retrieval for general agent operation.',
    scoringMode: 'cosine',
    topK: 5,
    minScore: 0.3,
    recencyHalfLifeSec: 30 * 24 * 3600,
    deduplicate: true,
    deduplicateThreshold: 0.95,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  },
  {
    id: 'retr_skill_match',
    settingsId: 'settings_default',
    label: 'Skill discovery',
    description: 'Restrict to skills + procedural memory; high top-k for fuzzy matching.',
    scoringMode: 'cosine',
    topK: 12,
    minScore: 0.25,
    entityKindFilter: ['skill', 'procedural-memory'],
    deduplicate: false,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  },
  {
    id: 'retr_episode_lookup',
    settingsId: 'settings_default',
    label: 'Have I done this before?',
    description: 'MMR over episodic memories — diversity-aware so similar episodes do not all return.',
    scoringMode: 'mmr',
    mmrLambda: 0.6,
    topK: 8,
    minScore: 0.4,
    recencyHalfLifeSec: 90 * 24 * 3600,
    entityKindFilter: ['episodic-memory'],
    deduplicate: true,
    deduplicateThreshold: 0.92,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  },
  {
    id: 'retr_strict_high_confidence',
    settingsId: 'settings_work_strict',
    label: 'Strict — high-confidence only',
    description:
      'Work profile retrieval. Tight threshold + minimum source confidence ensures the agent does not pull half-baked semantic memories from personal-profile work.',
    scoringMode: 'cosine',
    topK: 3,
    minScore: 0.55,
    minSourceConfidence: 0.85,
    entityKindFilter: ['semantic-memory', 'prompt-template'],
    deduplicate: true,
    deduplicateThreshold: 0.9,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  },
  {
    id: 'retr_hybrid_research',
    settingsId: 'settings_default',
    label: 'Hybrid (research)',
    description: 'BM25 + cosine for research finding lookup. Catches both exact-term and semantic matches.',
    scoringMode: 'hybrid',
    topK: 10,
    minScore: 0.2,
    entityKindFilter: ['research-finding', 'semantic-memory'],
    deduplicate: true,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  },
];

export const retrievalStrategySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'RetrievalStrategy',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'settingsId', 'label', 'scoringMode', 'topK', 'deduplicate', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      label: { type: 'string' },
      description: { type: 'string' },
      scoringMode: {
        type: 'string',
        enum: ['cosine', 'dot-product', 'l2-distance', 'mmr', 'hybrid'],
      },
      topK: { type: 'number' },
      minScore: { type: 'number' },
      mmrLambda: { type: 'number' },
      recencyHalfLifeSec: { type: 'number' },
      entityKindFilter: { type: 'array', items: { type: 'string' } },
      minSourceConfidence: { type: 'number' },
      deduplicate: { type: 'boolean' },
      deduplicateThreshold: { type: 'number' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const retrievalStrategyReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Retrieval queries',
    targetSource: 'cart/app/gallery/data/retrieval-query.ts',
    sourceField: 'id',
    targetField: 'strategyId',
    summary: 'Each executed query records which strategy it used.',
  },
];
