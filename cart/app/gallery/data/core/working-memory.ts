// WorkingMemory — the bounded-attention tier. One row per active
// Worker, holding ranked context slots that compete for a fixed token
// budget. Lowest-rank slots evict when capacity is exceeded.
//
// This is the ephemeral tier: it dies with the worker. Long-lived
// knowledge is promoted up-tier (to episodic / semantic / procedural)
// by a separate consolidation pass — not modeled here.
//
// Coexists with agent-memory.ts (the "simple / single-tier" approach).
// Pick one or the other per experiment; they are not meant to compose.

import type { GalleryDataReference, JsonObject } from '../../types';

export type WorkingMemorySlotKind =
  | 'goal' // what the worker is trying to do
  | 'recent_event' // last N worker events
  | 'file_excerpt' // fragment of an open file
  | 'tool_result' // output from a recent tool call
  | 'plan_step' // current task-graph position
  | 'scratchpad' // free-form note the worker wrote to itself
  | 'user_message' // recent user turn
  | 'anchor'; // pinned item — never evicts

export type WorkingMemorySlot = {
  id: string;
  kind: WorkingMemorySlotKind;
  content: string;
  tokens: number;
  relevanceScore: number; // 0–1; rank order for eviction
  pinned: boolean; // pinned slots ignore eviction
  insertedAt: string;
  touchedAt: string;
  sourceRef?: string; // e.g. "worker-event:evt_123", "file:/abs/path:L10-L40"
};

export type WorkingMemory = {
  id: string;
  workerId: string;
  capacityTokens: number;
  currentTokenUsage: number;
  slots: WorkingMemorySlot[];
  evictionPolicy: 'lru' | 'lowest-relevance' | 'hybrid';
  lastConsolidatedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export const workingMemoryMockData: WorkingMemory[] = [
  {
    id: 'wm_w1',
    workerId: 'w1',
    capacityTokens: 120_000,
    currentTokenUsage: 41_820,
    evictionPolicy: 'hybrid',
    slots: [
      {
        id: 'slot_01',
        kind: 'goal',
        content: 'Document the component-gallery data shapes family — 2 pages + index.',
        tokens: 42,
        relevanceScore: 1.0,
        pinned: true,
        insertedAt: '2026-04-24T09:10:00Z',
        touchedAt: '2026-04-24T09:10:00Z',
      },
      {
        id: 'slot_02',
        kind: 'anchor',
        content: 'Workspace: ws_reactjit, rootPath /home/siah/creative/reactjit',
        tokens: 28,
        relevanceScore: 1.0,
        pinned: true,
        insertedAt: '2026-04-24T09:10:00Z',
        touchedAt: '2026-04-24T09:10:00Z',
      },
      {
        id: 'slot_03',
        kind: 'file_excerpt',
        content:
          "// working-memory.ts module header and type definitions... (excerpt, tokens abbreviated)",
        tokens: 2_800,
        relevanceScore: 0.82,
        pinned: false,
        insertedAt: '2026-04-24T09:10:20Z',
        touchedAt: '2026-04-24T09:10:40Z',
        sourceRef: 'file:cart/app/gallery/data/working-memory.ts',
      },
      {
        id: 'slot_04',
        kind: 'tool_result',
        content: 'ls -1 cart/app/gallery/data/ | wc -l → 29',
        tokens: 14,
        relevanceScore: 0.41,
        pinned: false,
        insertedAt: '2026-04-24T09:10:30Z',
        touchedAt: '2026-04-24T09:10:30Z',
        sourceRef: 'inference-request:req_002:tool_result',
      },
      {
        id: 'slot_05',
        kind: 'recent_event',
        content:
          'Supervisor delegated Phase 2 (memory tiers) to this worker at 09:10:00.',
        tokens: 22,
        relevanceScore: 0.6,
        pinned: false,
        insertedAt: '2026-04-24T09:10:00Z',
        touchedAt: '2026-04-24T09:10:00Z',
        sourceRef: 'worker-event:evt_sup_delegate_01',
      },
      {
        id: 'slot_06',
        kind: 'plan_step',
        content: 'Currently on: write working-memory.ts (step 1 of 4 in Phase 2).',
        tokens: 18,
        relevanceScore: 0.7,
        pinned: false,
        insertedAt: '2026-04-24T09:10:40Z',
        touchedAt: '2026-04-24T09:10:40Z',
      },
    ],
    lastConsolidatedAt: '2026-04-24T09:00:00Z',
    createdAt: '2026-04-24T09:10:00Z',
    updatedAt: '2026-04-24T09:10:40Z',
  },
];

export const workingMemorySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'WorkingMemory',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'workerId',
      'capacityTokens',
      'currentTokenUsage',
      'slots',
      'evictionPolicy',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      workerId: { type: 'string' },
      capacityTokens: { type: 'number' },
      currentTokenUsage: { type: 'number' },
      evictionPolicy: { type: 'string', enum: ['lru', 'lowest-relevance', 'hybrid'] },
      lastConsolidatedAt: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      slots: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind', 'content', 'tokens', 'relevanceScore', 'pinned', 'insertedAt', 'touchedAt'],
          properties: {
            id: { type: 'string' },
            kind: {
              type: 'string',
              enum: [
                'goal',
                'recent_event',
                'file_excerpt',
                'tool_result',
                'plan_step',
                'scratchpad',
                'user_message',
                'anchor',
              ],
            },
            content: { type: 'string' },
            tokens: { type: 'number' },
            relevanceScore: { type: 'number' },
            pinned: { type: 'boolean' },
            insertedAt: { type: 'string' },
            touchedAt: { type: 'string' },
            sourceRef: { type: 'string' },
          },
        },
      },
    },
  },
};

export const workingMemoryReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Worker',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'workerId',
    targetField: 'id',
    summary: 'One working-memory row per active worker. Dies with the worker.',
  },
  {
    kind: 'references',
    label: 'Source events / files (slot.sourceRef)',
    targetSource: 'cart/app/gallery/data/worker-event.ts',
    sourceField: 'slots[].sourceRef',
    targetField: '(polymorphic — worker-event / file / inference-request)',
    summary:
      'Each slot may trace back to its source (event, file excerpt, tool result, etc.) via a stringly-typed ref. Not a strict FK — the slot can outlive its source.',
  },
  {
    kind: 'references',
    label: 'Consolidation target — episodic',
    targetSource: 'cart/app/gallery/data/episodic-memory.ts',
    sourceField: '(consolidation)',
    targetField: 'id',
    summary:
      'A consolidation pass promotes relevant working-memory state into episodic records before eviction. Not modeled as a row-level FK — consolidation is a job, not a link.',
  },
];
