// MergeProposal — the outputs of one or more finishing workstreams,
// staged for integration into a target workstream. The proposal
// captures the artifacts each source produced and the proposed
// resolution if multiple sources touched the same artifact.
//
// Lifecycle:
//   pending  — produced; awaiting review / decision
//   approved — auto-merge or human-approved; ready to apply
//   merged   — applied; sources transitioned to status='merged'
//   rejected — denied; sources transitioned to 'abandoned' or
//              re-queued for further work
//
// Conflicts are split out into MergeConflict rows when present so a
// proposal can carry "approved with N unresolved conflicts" without
// inlining the conflict bodies.

import type { GalleryDataReference, JsonObject } from '../../types';

export type MergeProposalStatus = 'pending' | 'approved' | 'merged' | 'rejected';
export type MergeArtifactKind = 'file' | 'patch' | 'commit' | 'document' | 'data-row';

export type ProposalArtifact = {
  id: string;
  sourceWorkstreamId: string;
  kind: MergeArtifactKind;
  ref: string; // path / commit sha / document id
  summary?: string;
  acceptInProposal: boolean; // a single proposal may include or skip individual artifacts
};

export type MergeProposal = {
  id: string;
  targetWorkstreamId: string;
  sourceWorkstreamIds: string[];
  triggeredByBarrierId?: string;
  status: MergeProposalStatus;
  strategy: 'auto' | 'human-review' | 'pick-best' | 'sequential-apply';
  artifacts: ProposalArtifact[];
  conflictIds: string[]; // FK to merge-conflict rows
  createdAt: string;
  decidedAt?: string;
  decidedByActor?: 'supervisor' | 'human' | 'auto';
  note?: string;
};

export const mergeProposalMockData: MergeProposal[] = [
  {
    id: 'merge_phase2_memory_tiers',
    targetWorkstreamId: 'ws_phase4_parallelism',
    sourceWorkstreamIds: ['ws_consolidate_memory'],
    triggeredByBarrierId: 'barrier_legacy_satisfied_example',
    status: 'merged',
    strategy: 'auto',
    artifacts: [
      {
        id: 'art_working_memory_ts',
        sourceWorkstreamId: 'ws_consolidate_memory',
        kind: 'file',
        ref: 'cart/app/gallery/data/working-memory.ts',
        acceptInProposal: true,
      },
      {
        id: 'art_episodic_memory_ts',
        sourceWorkstreamId: 'ws_consolidate_memory',
        kind: 'file',
        ref: 'cart/app/gallery/data/episodic-memory.ts',
        acceptInProposal: true,
      },
      {
        id: 'art_semantic_memory_ts',
        sourceWorkstreamId: 'ws_consolidate_memory',
        kind: 'file',
        ref: 'cart/app/gallery/data/semantic-memory.ts',
        acceptInProposal: true,
      },
      {
        id: 'art_procedural_memory_ts',
        sourceWorkstreamId: 'ws_consolidate_memory',
        kind: 'file',
        ref: 'cart/app/gallery/data/procedural-memory.ts',
        acceptInProposal: true,
      },
    ],
    conflictIds: [],
    createdAt: '2026-04-24T09:25:00Z',
    decidedAt: '2026-04-24T09:25:30Z',
    decidedByActor: 'auto',
    note: 'No file overlap with main; auto-merged.',
  },
  {
    id: 'merge_kimi_speculation_pending',
    targetWorkstreamId: 'ws_phase4_parallelism',
    sourceWorkstreamIds: ['ws_speculate_kimi_adapter_a', 'ws_speculate_kimi_adapter_b'],
    triggeredByBarrierId: 'barrier_kimi_speculation',
    status: 'pending',
    strategy: 'pick-best',
    artifacts: [
      {
        id: 'art_kimi_a_raw',
        sourceWorkstreamId: 'ws_speculate_kimi_adapter_a',
        kind: 'file',
        ref: 'cart/app/gallery/data/kimi-raw-event.ts',
        summary: 'Standalone raw-event file mirroring codex-raw-event.',
        acceptInProposal: false,
      },
      {
        id: 'art_kimi_b_extension',
        sourceWorkstreamId: 'ws_speculate_kimi_adapter_b',
        kind: 'patch',
        ref: 'cart/app/gallery/data/codex-raw-event.ts',
        summary: 'Patch: extend codex-raw-event with provider-tagged variant blocks.',
        acceptInProposal: false,
      },
    ],
    conflictIds: ['conflict_kimi_adapter_choice'],
    createdAt: '2026-04-25T09:35:00Z',
    note: 'Both branches finished; human/supervisor must pick before either is accepted.',
  },
];

export const mergeProposalSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'MergeProposal',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'targetWorkstreamId',
      'sourceWorkstreamIds',
      'status',
      'strategy',
      'artifacts',
      'conflictIds',
      'createdAt',
    ],
    properties: {
      id: { type: 'string' },
      targetWorkstreamId: { type: 'string' },
      sourceWorkstreamIds: { type: 'array', items: { type: 'string' } },
      triggeredByBarrierId: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'approved', 'merged', 'rejected'] },
      strategy: {
        type: 'string',
        enum: ['auto', 'human-review', 'pick-best', 'sequential-apply'],
      },
      conflictIds: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'string' },
      decidedAt: { type: 'string' },
      decidedByActor: { type: 'string', enum: ['supervisor', 'human', 'auto'] },
      note: { type: 'string' },
      artifacts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'sourceWorkstreamId', 'kind', 'ref', 'acceptInProposal'],
          properties: {
            id: { type: 'string' },
            sourceWorkstreamId: { type: 'string' },
            kind: { type: 'string', enum: ['file', 'patch', 'commit', 'document', 'data-row'] },
            ref: { type: 'string' },
            summary: { type: 'string' },
            acceptInProposal: { type: 'boolean' },
          },
        },
      },
    },
  },
};

export const mergeProposalReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Target workstream',
    targetSource: 'cart/app/gallery/data/workstream.ts',
    sourceField: 'targetWorkstreamId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Source workstreams',
    targetSource: 'cart/app/gallery/data/workstream.ts',
    sourceField: 'sourceWorkstreamIds[]',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Triggered by barrier',
    targetSource: 'cart/app/gallery/data/barrier.ts',
    sourceField: 'triggeredByBarrierId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Conflicts',
    targetSource: 'cart/app/gallery/data/merge-conflict.ts',
    sourceField: 'conflictIds[]',
    targetField: 'id',
    summary: 'Conflicts are separate rows so a proposal can be approved-with-conflicts.',
  },
];
