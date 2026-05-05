// Barrier — a sync point. Pauses one or more waiting workers /
// workstreams until a required set of workstreams reaches a target
// status (typically `merged` or `completed`).
//
// "Wait for all 3 children, then merge their work" is one row. The
// supervisor pauses on the barrier; resumes when satisfied set ⊇
// required set; then runs the configured `onSatisfied` action.
//
// Barriers are first-class data so the cockpit UI can render the
// "I am waiting on these to finish" state, and so a crashed
// supervisor can pick up exactly where the previous one left off.

import type { GalleryDataReference, JsonObject } from '../../types';

export type BarrierStatus = 'waiting' | 'satisfied' | 'cancelled' | 'timed-out';

export type BarrierTargetStatus =
  | 'completed'
  | 'merged'
  | 'abandoned'
  | 'either-completed-or-abandoned';

export type BarrierOnSatisfied =
  | 'merge' // run a merge-proposal across the satisfied workstreams
  | 'continue' // resume the waiting actor without merging
  | 'pick-best' // for speculation forks — keep one, abandon the rest
  | 'cancel-others'; // first-to-finish wins; rest are cancelled

export type Barrier = {
  id: string;
  workstreamId: string; // the workstream that owns / is waiting on this barrier
  label: string;
  requiredWorkstreamIds: string[];
  satisfiedWorkstreamIds: string[];
  targetStatus: BarrierTargetStatus;
  onSatisfied: BarrierOnSatisfied;
  status: BarrierStatus;
  pickBestCriteria?: string; // for onSatisfied='pick-best'
  timeoutMs?: number;
  startedAt: string;
  satisfiedAt?: string;
  timedOutAt?: string;
  cancelledAt?: string;
  resultMergeProposalId?: string; // if onSatisfied='merge', the produced proposal
};

export const barrierMockData: Barrier[] = [
  {
    id: 'barrier_kimi_speculation',
    workstreamId: 'ws_phase4_parallelism',
    label: 'Pick the better Kimi adapter shape',
    requiredWorkstreamIds: ['ws_speculate_kimi_adapter_a', 'ws_speculate_kimi_adapter_b'],
    satisfiedWorkstreamIds: [],
    targetStatus: 'completed',
    onSatisfied: 'pick-best',
    pickBestCriteria:
      'Fewer special-case rules in adapter; equal or smaller LOC; matches the codex-pattern style.',
    status: 'waiting',
    startedAt: '2026-04-25T09:35:00Z',
  },
  {
    id: 'barrier_phase4_review_join',
    workstreamId: 'ws_phase4_parallelism',
    label: 'Wait for review fork before phase4 close',
    requiredWorkstreamIds: ['ws_review_fork_phase4'],
    satisfiedWorkstreamIds: [],
    targetStatus: 'completed',
    onSatisfied: 'continue',
    timeoutMs: 1_800_000,
    startedAt: '2026-04-25T09:30:00Z',
  },
  {
    id: 'barrier_legacy_satisfied_example',
    workstreamId: 'ws_phase4_parallelism',
    label: 'Wait for memory tier consolidation pass',
    requiredWorkstreamIds: ['ws_consolidate_memory'],
    satisfiedWorkstreamIds: ['ws_consolidate_memory'],
    targetStatus: 'merged',
    onSatisfied: 'merge',
    status: 'satisfied',
    startedAt: '2026-04-24T09:20:00Z',
    satisfiedAt: '2026-04-24T09:25:00Z',
    resultMergeProposalId: 'merge_phase2_memory_tiers',
  },
];

export const barrierSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Barrier',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'workstreamId',
      'label',
      'requiredWorkstreamIds',
      'satisfiedWorkstreamIds',
      'targetStatus',
      'onSatisfied',
      'status',
      'startedAt',
    ],
    properties: {
      id: { type: 'string' },
      workstreamId: { type: 'string' },
      label: { type: 'string' },
      requiredWorkstreamIds: { type: 'array', items: { type: 'string' } },
      satisfiedWorkstreamIds: { type: 'array', items: { type: 'string' } },
      targetStatus: {
        type: 'string',
        enum: ['completed', 'merged', 'abandoned', 'either-completed-or-abandoned'],
      },
      onSatisfied: {
        type: 'string',
        enum: ['merge', 'continue', 'pick-best', 'cancel-others'],
      },
      status: { type: 'string', enum: ['waiting', 'satisfied', 'cancelled', 'timed-out'] },
      pickBestCriteria: { type: 'string' },
      timeoutMs: { type: 'number' },
      startedAt: { type: 'string' },
      satisfiedAt: { type: 'string' },
      timedOutAt: { type: 'string' },
      cancelledAt: { type: 'string' },
      resultMergeProposalId: { type: 'string' },
    },
  },
};

export const barrierReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Owning workstream',
    targetSource: 'cart/app/gallery/data/workstream.ts',
    sourceField: 'workstreamId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Required workstreams',
    targetSource: 'cart/app/gallery/data/workstream.ts',
    sourceField: 'requiredWorkstreamIds[]',
    targetField: 'id',
    summary: 'The set of workstreams that must reach targetStatus before the barrier resolves.',
  },
  {
    kind: 'references',
    label: 'Resulting merge proposal',
    targetSource: 'cart/app/gallery/data/merge-proposal.ts',
    sourceField: 'resultMergeProposalId',
    targetField: 'id',
    summary: 'When onSatisfied=merge resolves, the produced MergeProposal is linked here for traceability.',
  },
];
