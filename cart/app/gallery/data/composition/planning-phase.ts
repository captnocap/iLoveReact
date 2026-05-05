// PlanningPhase — an ordered phase of a Plan. Phases have a canonical
// shape — discovery → design → implement → verify → ship / review —
// but plans can mix, repeat, or skip them. Each phase produces one
// TaskGraph that drives concrete worker activity.
//
// The `gate` field captures "what has to be true before this phase
// can start" — a minimal prerequisite, not a full contract. A phase
// may still begin with an open gate, but the cockpit UI will flag it.

import type { GalleryDataReference, JsonObject } from '../../types';

export type PhaseKind =
  | 'discovery' // understand the problem
  | 'design' // sketch the shape
  | 'implement' // build
  | 'verify' // test / observe / measure
  | 'review' // check someone else's work
  | 'ship' // deploy / release
  | 'cleanup' // tidy afterward
  | 'research'; // inquiry as a phase of a plan

export type PhaseStatus =
  | 'pending'
  | 'active'
  | 'blocked'
  | 'completed'
  | 'skipped'
  | 'abandoned';

export type PhaseGate = {
  description: string;
  met: boolean;
  blockingReason?: string;
};

export type PlanningPhase = {
  id: string;
  planId: string;
  order: number;
  kind: PhaseKind;
  label: string;
  goal: string;
  status: PhaseStatus;
  gate?: PhaseGate;
  taskGraphId?: string;
  relatedResearchIds?: string[];
  outputArtifactRefs?: string[];
  estimatedDurationMs?: number;
  actualDurationMs?: number;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export const planningPhaseMockData: PlanningPhase[] = [
  {
    id: 'phase_foundations',
    planId: 'plan_gallery_data_shapes',
    order: 1,
    kind: 'implement',
    label: 'Foundations',
    goal: 'Stand up provider / model / connection / user / settings / privacy / budget / inference-request.',
    status: 'completed',
    gate: { description: 'Gallery script exists and story registry works.', met: true },
    taskGraphId: 'tg_phase_foundations',
    outputArtifactRefs: ['cart/app/gallery/data/{provider,model,connection,user,settings,privacy,budget,inference-request}.ts'],
    startedAt: '2026-04-24T08:00:00Z',
    endedAt: '2026-04-24T08:45:00Z',
    actualDurationMs: 2_700_000,
    createdAt: '2026-04-24T08:00:00Z',
    updatedAt: '2026-04-24T08:45:00Z',
  },
  {
    id: 'phase_role_skill_layer',
    planId: 'plan_gallery_data_shapes',
    order: 2,
    kind: 'implement',
    label: 'Role / skill / capability layer',
    goal: 'Close forward dangles on InferencePreset; add capability catalog, skills, roles, role-assignment.',
    status: 'completed',
    gate: { description: 'Foundations phase complete.', met: true },
    taskGraphId: 'tg_phase_role_skill',
    outputArtifactRefs: [
      'cart/app/gallery/data/{capability,system-message,prompt-template,skill,role,role-assignment}.ts',
    ],
    startedAt: '2026-04-24T08:45:00Z',
    endedAt: '2026-04-24T09:00:00Z',
    actualDurationMs: 900_000,
    createdAt: '2026-04-24T08:45:00Z',
    updatedAt: '2026-04-24T09:00:00Z',
  },
  {
    id: 'phase_structural_scope',
    planId: 'plan_gallery_data_shapes',
    order: 3,
    kind: 'implement',
    label: 'Structural scope (workspace / project / environment / worker)',
    goal: 'Replace string-path scoping with first-class Workspace + Project + Environment; promote Worker to own shape.',
    status: 'completed',
    taskGraphId: 'tg_phase_structural',
    startedAt: '2026-04-24T09:00:00Z',
    endedAt: '2026-04-24T09:10:00Z',
    actualDurationMs: 600_000,
    createdAt: '2026-04-24T09:00:00Z',
    updatedAt: '2026-04-24T09:10:00Z',
  },
  {
    id: 'phase_memory_tiers',
    planId: 'plan_gallery_data_shapes',
    order: 4,
    kind: 'implement',
    label: 'Memory tiers',
    goal: 'Coexisting richer alternative to agent-memory: working / episodic / semantic / procedural.',
    status: 'completed',
    taskGraphId: 'tg_phase_memory',
    startedAt: '2026-04-24T09:10:00Z',
    endedAt: '2026-04-24T09:25:00Z',
    actualDurationMs: 900_000,
    createdAt: '2026-04-24T09:10:00Z',
    updatedAt: '2026-04-24T09:25:00Z',
  },
  {
    id: 'phase_planning_and_tasks',
    planId: 'plan_gallery_data_shapes',
    order: 5,
    kind: 'implement',
    label: 'Planning + tasks + research',
    goal: 'Plan / PlanningPhase / TaskGraph / Task / TaskDependency / Research.',
    status: 'active',
    taskGraphId: 'tg_phase_planning',
    startedAt: '2026-04-24T09:25:00Z',
    createdAt: '2026-04-24T09:25:00Z',
    updatedAt: '2026-04-24T09:25:00Z',
  },
  {
    id: 'phase_events_and_hooks',
    planId: 'plan_gallery_data_shapes',
    order: 6,
    kind: 'implement',
    label: 'Event system + hooks',
    goal: 'Generic typed Event + EventHook registrations, distinct from provider-normalized WorkerEvent.',
    status: 'pending',
    gate: {
      description: 'Planning / tasks phase complete.',
      met: false,
      blockingReason: 'phase_planning_and_tasks still active.',
    },
    createdAt: '2026-04-24T09:25:00Z',
    updatedAt: '2026-04-24T09:25:00Z',
  },
  {
    id: 'phase_hot_reproduce',
    planId: 'plan_hotstate_fix',
    order: 1,
    kind: 'discovery',
    label: 'Reproduce reliably',
    goal: 'Minimum repro case where useHotState resets on save.',
    status: 'completed',
    taskGraphId: 'tg_hot_repro',
    startedAt: '2026-04-22T14:00:00Z',
    endedAt: '2026-04-22T14:30:00Z',
    createdAt: '2026-04-22T14:00:00Z',
    updatedAt: '2026-04-22T14:30:00Z',
  },
  {
    id: 'phase_hot_fix',
    planId: 'plan_hotstate_fix',
    order: 2,
    kind: 'implement',
    label: 'Fix + verify',
    goal: 'Patch slot rebuild to honor stable ids across remount.',
    status: 'blocked',
    gate: {
      description: 'Zig-side identity key design agreed.',
      met: false,
      blockingReason: 'Waiting on a review of two proposed approaches.',
    },
    createdAt: '2026-04-22T14:30:00Z',
    updatedAt: '2026-04-22T15:10:00Z',
  },
];

export const planningPhaseSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'PlanningPhase',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'planId', 'order', 'kind', 'label', 'goal', 'status', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      planId: { type: 'string' },
      order: { type: 'number' },
      kind: {
        type: 'string',
        enum: ['discovery', 'design', 'implement', 'verify', 'review', 'ship', 'cleanup', 'research'],
      },
      label: { type: 'string' },
      goal: { type: 'string' },
      status: {
        type: 'string',
        enum: ['pending', 'active', 'blocked', 'completed', 'skipped', 'abandoned'],
      },
      gate: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'met'],
        properties: {
          description: { type: 'string' },
          met: { type: 'boolean' },
          blockingReason: { type: 'string' },
        },
      },
      taskGraphId: { type: 'string' },
      relatedResearchIds: { type: 'array', items: { type: 'string' } },
      outputArtifactRefs: { type: 'array', items: { type: 'string' } },
      estimatedDurationMs: { type: 'number' },
      actualDurationMs: { type: 'number' },
      startedAt: { type: 'string' },
      endedAt: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const planningPhaseReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Plan', targetSource: 'cart/app/gallery/data/plan.ts', sourceField: 'planId', targetField: 'id' },
  {
    kind: 'references',
    label: 'Task graph (execution)',
    targetSource: 'cart/app/gallery/data/task-graph.ts',
    sourceField: 'taskGraphId',
    targetField: 'id',
    summary: 'Each phase produces at most one TaskGraph. Graph is the "how" of the phase.',
  },
  {
    kind: 'references',
    label: 'Research sessions',
    targetSource: 'cart/app/gallery/data/research.ts',
    sourceField: 'relatedResearchIds[]',
    targetField: 'id',
    summary: 'Discovery phases often have a Research row attached; implementation phases may cite one for rationale.',
  },
];
