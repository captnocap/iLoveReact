// Workstream — an isolated branch of parallel work. Owns its own
// fork/merge lineage, its own context scope, and (optionally) its own
// task subgraph. Workers execute *within* a workstream; the
// workstream is the boundary that keeps parallel branches from
// stepping on each other's state.
//
// Orthogonal to Worker:
//   - Worker is the runtime actor (one per process / agent instance).
//   - Workstream is the unit of parallelism (one per branch of work).
// A workstream typically owns N workers; a worker may move between
// workstreams over its lifetime.
//
// Pared down from datashapes.md §8.1.1: dropped per-stream working-
// memory linkage (we point at WorkingMemory by workerId, not
// workstreamId — workers carry attention, streams carry intent),
// dropped resourceUsage block (BudgetLedger rolls that up by
// workstreamId).

import type { GalleryDataReference, JsonObject } from '../../types';

export type WorkstreamStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'stalled'
  | 'merging'
  | 'merged'
  | 'abandoned';

export type ForkPattern =
  | 'speculation' // try N approaches in parallel; keep best
  | 'partition' // split work, each branch handles a slice
  | 'review-fork' // one branch implements, one reviews
  | 'experiment'; // one branch tries something; main continues

export type Workstream = {
  id: string;
  projectId: string;
  workspaceId: string;
  parentWorkstreamId?: string;
  childWorkstreamIds?: string[];
  forkPattern?: ForkPattern;
  forkRationale?: string;
  label: string;
  goal: string;
  status: WorkstreamStatus;
  priority: number; // higher wins resource contention
  workerIds: string[];
  taskGraphId?: string;
  contextScopeId?: string; // future hook to a ContextScope shape
  forkedAt?: string;
  mergedAt?: string;
  abandonedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export const workstreamMockData: Workstream[] = [
  {
    id: 'ws_phase4_parallelism',
    projectId: 'proj_reactjit_carts',
    workspaceId: 'ws_reactjit',
    label: 'Phase 4 — parallelism layer',
    goal: 'Stamp out task-claim, budget-ledger, workstream, barrier, merge-proposal, merge-conflict.',
    status: 'active',
    priority: 8,
    workerIds: ['w1'],
    taskGraphId: 'tg_phase_planning',
    forkedAt: '2026-04-25T09:25:00Z',
    createdAt: '2026-04-25T09:25:00Z',
    updatedAt: '2026-04-25T09:30:00Z',
  },
  {
    id: 'ws_speculate_kimi_adapter_a',
    projectId: 'proj_reactjit_carts',
    workspaceId: 'ws_reactjit',
    parentWorkstreamId: 'ws_phase4_parallelism',
    forkPattern: 'speculation',
    forkRationale:
      'Two valid shapes for the Kimi adapter — try both in parallel and keep whichever produces fewer special-case rules.',
    label: 'Kimi adapter — approach A (separate raw-event file)',
    goal: 'Mirror codex-raw-event.ts pattern; fold differences into rule predicates.',
    status: 'pending',
    priority: 4,
    workerIds: [],
    forkedAt: '2026-04-25T09:35:00Z',
    createdAt: '2026-04-25T09:35:00Z',
    updatedAt: '2026-04-25T09:35:00Z',
  },
  {
    id: 'ws_speculate_kimi_adapter_b',
    projectId: 'proj_reactjit_carts',
    workspaceId: 'ws_reactjit',
    parentWorkstreamId: 'ws_phase4_parallelism',
    forkPattern: 'speculation',
    forkRationale:
      'Alternative — extend codex-raw-event with provider-tagged variant blocks. Less duplication, more conditionals at adapter time.',
    label: 'Kimi adapter — approach B (shared raw-event file)',
    goal: 'Single raw-event file with provider-tagged frame variants.',
    status: 'pending',
    priority: 4,
    workerIds: [],
    forkedAt: '2026-04-25T09:35:00Z',
    createdAt: '2026-04-25T09:35:00Z',
    updatedAt: '2026-04-25T09:35:00Z',
  },
  {
    id: 'ws_review_fork_phase4',
    projectId: 'proj_reactjit_carts',
    workspaceId: 'ws_reactjit',
    parentWorkstreamId: 'ws_phase4_parallelism',
    forkPattern: 'review-fork',
    forkRationale:
      'Reviewer worker tracks main as it lands files; surfaces issues async without blocking the implementer.',
    label: 'Phase 4 review',
    goal: 'Continuous review of phase-4 shapes as each lands; surface concerns to supervisor.',
    status: 'paused',
    priority: 5,
    workerIds: ['worker_strict_reviewer'],
    forkedAt: '2026-04-25T09:25:00Z',
    createdAt: '2026-04-25T09:25:00Z',
    updatedAt: '2026-04-25T09:30:00Z',
  },
];

export const workstreamSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Workstream',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'projectId',
      'workspaceId',
      'label',
      'goal',
      'status',
      'priority',
      'workerIds',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      projectId: { type: 'string' },
      workspaceId: { type: 'string' },
      parentWorkstreamId: { type: 'string' },
      childWorkstreamIds: { type: 'array', items: { type: 'string' } },
      forkPattern: {
        type: 'string',
        enum: ['speculation', 'partition', 'review-fork', 'experiment'],
      },
      forkRationale: { type: 'string' },
      label: { type: 'string' },
      goal: { type: 'string' },
      status: {
        type: 'string',
        enum: ['pending', 'active', 'paused', 'stalled', 'merging', 'merged', 'abandoned'],
      },
      priority: { type: 'number' },
      workerIds: { type: 'array', items: { type: 'string' } },
      taskGraphId: { type: 'string' },
      contextScopeId: { type: 'string' },
      forkedAt: { type: 'string' },
      mergedAt: { type: 'string' },
      abandonedAt: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const workstreamReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Project',
    targetSource: 'cart/app/gallery/data/project.ts',
    sourceField: 'projectId',
    targetField: 'id',
  },
  {
    kind: 'belongs-to',
    label: 'Workspace',
    targetSource: 'cart/app/gallery/data/workspace.ts',
    sourceField: 'workspaceId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Parent workstream',
    targetSource: 'cart/app/gallery/data/workstream.ts',
    sourceField: 'parentWorkstreamId',
    targetField: 'id',
    summary: 'Fork lineage. A speculation pattern produces sibling forks under one parent.',
  },
  {
    kind: 'has-many',
    label: 'Workers',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'workerIds[]',
    targetField: 'id',
    summary: 'Workers execute tasks within a workstream\'s isolation boundary.',
  },
  {
    kind: 'references',
    label: 'Task graph',
    targetSource: 'cart/app/gallery/data/task-graph.ts',
    sourceField: 'taskGraphId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Task claims',
    targetSource: 'cart/app/gallery/data/task-claim.ts',
    sourceField: 'id',
    targetField: 'workstreamId',
    summary: 'Workers in a workstream claim tasks scoped to that workstream\'s priority.',
  },
  {
    kind: 'has-many',
    label: 'Barriers (waiting on this)',
    targetSource: 'cart/app/gallery/data/barrier.ts',
    sourceField: 'id',
    targetField: 'requiredWorkstreamIds[]',
    summary: 'A barrier waiting for this workstream to finish includes its id in its required set.',
  },
  {
    kind: 'has-many',
    label: 'Merge proposals',
    targetSource: 'cart/app/gallery/data/merge-proposal.ts',
    sourceField: 'id',
    targetField: 'sourceWorkstreamId',
    summary: 'When a workstream finishes, its outputs surface as a MergeProposal pending integration.',
  },
];
