// TaskDependency — a typed edge in a TaskGraph DAG. Explicitly stored
// (not derived) so dep-semantics can vary per edge and so the
// scheduler doesn't re-infer on every ready-check.
//
// Kind semantics:
//   'blocking'     — downstream cannot start until upstream completes.
//   'sequential'   — preferred order but not strict; scheduler may
//                    allow overlap when safe.
//   'soft-order'   — advisory only; scheduler is free to reorder.
//   'data-flow'    — downstream consumes an artifact the upstream
//                    produces; implies blocking + artifact handoff.
//
// The scheduler walks only 'blocking' and 'data-flow' edges when
// deciding readiness.

import type { GalleryDataReference, JsonObject } from '../../types';

export type TaskDependencyKind = 'blocking' | 'sequential' | 'soft-order' | 'data-flow';

export type TaskDependency = {
  id: string;
  taskGraphId: string;
  upstreamTaskId: string;
  downstreamTaskId: string;
  kind: TaskDependencyKind;
  artifactRef?: string; // for kind='data-flow' — what gets handed off
  note?: string;
  createdAt: string;
};

export const taskDependencyMockData: TaskDependency[] = [
  {
    id: 'dep_plan_phase',
    taskGraphId: 'tg_phase_planning',
    upstreamTaskId: 'task_plan_ts',
    downstreamTaskId: 'task_phase_ts',
    kind: 'sequential',
    note: 'PlanningPhase.planId FKs into plan.ts — write plan.ts first so refs resolve in editors.',
    createdAt: '2026-04-24T09:25:00Z',
  },
  {
    id: 'dep_phase_graph',
    taskGraphId: 'tg_phase_planning',
    upstreamTaskId: 'task_phase_ts',
    downstreamTaskId: 'task_graph_ts',
    kind: 'sequential',
    createdAt: '2026-04-24T09:25:00Z',
  },
  {
    id: 'dep_graph_task',
    taskGraphId: 'tg_phase_planning',
    upstreamTaskId: 'task_graph_ts',
    downstreamTaskId: 'task_task_ts',
    kind: 'sequential',
    createdAt: '2026-04-24T09:25:00Z',
  },
  {
    id: 'dep_task_dep',
    taskGraphId: 'tg_phase_planning',
    upstreamTaskId: 'task_task_ts',
    downstreamTaskId: 'task_dep_ts',
    kind: 'sequential',
    createdAt: '2026-04-24T09:25:00Z',
  },
  {
    id: 'dep_dep_research',
    taskGraphId: 'tg_phase_planning',
    upstreamTaskId: 'task_dep_ts',
    downstreamTaskId: 'task_research_ts',
    kind: 'sequential',
    createdAt: '2026-04-24T09:25:00Z',
  },
  {
    id: 'dep_hot_repro_to_trace',
    taskGraphId: 'tg_hot_repro',
    upstreamTaskId: 'task_hot_min_repro',
    downstreamTaskId: 'task_hot_trace',
    kind: 'data-flow',
    artifactRef: 'repro-cart: /tmp/hotstate-repro.tsx',
    note: 'Trace task consumes the minimal-repro cart produced by the preceding task.',
    createdAt: '2026-04-22T14:00:00Z',
  },
];

export const taskDependencySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'TaskDependency',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'taskGraphId', 'upstreamTaskId', 'downstreamTaskId', 'kind', 'createdAt'],
    properties: {
      id: { type: 'string' },
      taskGraphId: { type: 'string' },
      upstreamTaskId: { type: 'string' },
      downstreamTaskId: { type: 'string' },
      kind: { type: 'string', enum: ['blocking', 'sequential', 'soft-order', 'data-flow'] },
      artifactRef: { type: 'string' },
      note: { type: 'string' },
      createdAt: { type: 'string' },
    },
  },
};

export const taskDependencyReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Task graph', targetSource: 'cart/app/gallery/data/task-graph.ts', sourceField: 'taskGraphId', targetField: 'id' },
  {
    kind: 'references',
    label: 'Upstream task',
    targetSource: 'cart/app/gallery/data/task.ts',
    sourceField: 'upstreamTaskId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Downstream task',
    targetSource: 'cart/app/gallery/data/task.ts',
    sourceField: 'downstreamTaskId',
    targetField: 'id',
  },
];
