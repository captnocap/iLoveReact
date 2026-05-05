// Plan — the top-level shape of intent. Answers "what are we doing,
// why, and how will we know we're done?" A Plan decomposes into
// ordered PlanningPhases; each phase produces a TaskGraph that the
// worker pool executes.
//
// Plans live at the Project level — they are the narrative substrate
// for a sustained effort. A short one-off task skips Plan entirely
// and just goes into WorkerQuest or directly to a Task row.

import type { GalleryDataReference, JsonObject } from '../../types';

export type PlanStatus = 'draft' | 'active' | 'paused' | 'completed' | 'abandoned';
export type PlanKind =
  | 'feature' // ship a new capability
  | 'refactor' // structural change
  | 'migration' // versioned move from A to B
  | 'debug' // sustained investigation
  | 'research' // explore a question
  | 'cleanup' // tech debt / polish
  | 'experiment'; // try something, decide later

export type PlanSuccessCriterion = {
  id: string;
  statement: string;
  kind: 'observable' | 'measurable' | 'qualitative';
  met: boolean;
};

export type Plan = {
  id: string;
  projectId: string;
  goalId: string;
  label: string;
  kind: PlanKind;
  summary: string;
  rationale: string;
  status: PlanStatus;
  phaseIds: string[]; // ordered
  successCriteria: PlanSuccessCriterion[];
  owningWorkerId?: string;
  relatedResearchIds?: string[]; // research that informed or motivated this plan
  supersedes?: string; // previous plan id, if this is a revision
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  tags?: string[];
};

export const planMockData: Plan[] = [
  {
    id: 'plan_gallery_data_shapes',
    projectId: 'proj_reactjit_carts',
    goalId: 'goal_data_shape_catalog',
    label: 'Component-gallery data-shape catalog',
    kind: 'feature',
    summary:
      'Build a first-class, linked catalog of the data shapes used across the cockpit, worker, and inference layers — starting from provider/model/connection and reaching up to Plan/Task/Research.',
    rationale:
      'Without a catalog, every new worker feature hardcodes its own copy of "what a session is" or "what a worker knows." A shared shape layer turns those from ambient code into audit-able data.',
    status: 'active',
    phaseIds: [
      'phase_foundations',
      'phase_role_skill_layer',
      'phase_structural_scope',
      'phase_memory_tiers',
      'phase_planning_and_tasks',
      'phase_events_and_hooks',
    ],
    successCriteria: [
      {
        id: 'crit_all_dangles_closed',
        statement: 'No "forward / future / to wire" references remain in any shape file.',
        kind: 'observable',
        met: false,
      },
      {
        id: 'crit_coverage_matrix',
        statement: 'At least two adapter rows per ConnectionKind prove the normalized contract holds.',
        kind: 'measurable',
        met: false,
      },
      {
        id: 'crit_coexistence',
        statement: 'Simple and enterprise variants coexist for memory (agent-memory vs tiers) and session (worker-session vs workstream).',
        kind: 'qualitative',
        met: true,
      },
    ],
    owningWorkerId: 'worker_sup_01',
    relatedResearchIds: ['research_datashapes_doc_survey'],
    createdAt: '2026-04-24T08:00:00Z',
    updatedAt: '2026-04-24T09:35:00Z',
    startedAt: '2026-04-24T08:00:00Z',
    tags: ['catalog', 'contract-first', 'active'],
  },
  {
    id: 'plan_hotstate_fix',
    projectId: 'proj_reactjit_runtime',
    goalId: 'goal_hot_reload_state',
    label: 'Restore useHotState persistence across reload',
    kind: 'debug',
    summary:
      'Slot cache rebuild does not honor stable ids after remount. Fix the Zig-side identity key so state survives hot reload.',
    rationale: 'Dev loop is broken — every edit clobbers in-memory state. Re-entering state manually each iteration is slowing cart development.',
    status: 'paused',
    phaseIds: ['phase_hot_reproduce', 'phase_hot_fix'],
    successCriteria: [
      {
        id: 'crit_survives_reload',
        statement: 'Editing a cart tsx file preserves all useHotState slots across the rebundle.',
        kind: 'observable',
        met: false,
      },
    ],
    relatedResearchIds: [],
    createdAt: '2026-04-22T14:00:00Z',
    updatedAt: '2026-04-22T15:10:00Z',
    startedAt: '2026-04-22T14:00:00Z',
    tags: ['hooks', 'hot-reload', 'known-gap'],
  },
];

export const planSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Plan',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'projectId',
      'goalId',
      'label',
      'kind',
      'summary',
      'rationale',
      'status',
      'phaseIds',
      'successCriteria',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      projectId: { type: 'string' },
      goalId: { type: 'string' },
      label: { type: 'string' },
      kind: {
        type: 'string',
        enum: ['feature', 'refactor', 'migration', 'debug', 'research', 'cleanup', 'experiment'],
      },
      summary: { type: 'string' },
      rationale: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'active', 'paused', 'completed', 'abandoned'] },
      phaseIds: { type: 'array', items: { type: 'string' } },
      successCriteria: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'statement', 'kind', 'met'],
          properties: {
            id: { type: 'string' },
            statement: { type: 'string' },
            kind: { type: 'string', enum: ['observable', 'measurable', 'qualitative'] },
            met: { type: 'boolean' },
          },
        },
      },
      owningWorkerId: { type: 'string' },
      relatedResearchIds: { type: 'array', items: { type: 'string' } },
      supersedes: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      startedAt: { type: 'string' },
      endedAt: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
};

export const planReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Project', targetSource: 'cart/app/gallery/data/project.ts', sourceField: 'projectId', targetField: 'id' },
  {
    kind: 'belongs-to',
    label: 'Goal (required)',
    targetSource: 'cart/app/gallery/data/goal.ts',
    sourceField: 'goalId',
    targetField: 'id',
    summary:
      'Every Plan exists in service of a Goal. The Plan is HOW; the Goal is WHAT. A Plan without a Goal is the type-mismatch trap — the agent has decomposed without knowing what it is decomposing toward.',
  },
  {
    kind: 'has-many',
    label: 'Planning phases',
    targetSource: 'cart/app/gallery/data/planning-phase.ts',
    sourceField: 'phaseIds[]',
    targetField: 'id',
    summary: 'Phases are ordered; phaseIds preserves order. A new phase is appended by writing to the end of phaseIds + a new PlanningPhase row.',
  },
  {
    kind: 'references',
    label: 'Owning worker',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'owningWorkerId',
    targetField: 'id',
    summary: 'The worker driving the plan. Typically a supervisor / planner persona.',
  },
  {
    kind: 'references',
    label: 'Related research',
    targetSource: 'cart/app/gallery/data/research.ts',
    sourceField: 'relatedResearchIds[]',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Supersedes',
    targetSource: 'cart/app/gallery/data/plan.ts',
    sourceField: 'supersedes',
    targetField: 'id',
  },
];
