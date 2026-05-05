// TaskGraph — a DAG of Tasks + TaskDependency edges. Owned by a
// PlanningPhase when one exists, or directly by a Project for
// lightweight "bunch of related tasks" without the full plan
// ceremony.
//
// The graph row itself carries only metadata and denormalized id
// arrays. Tasks and TaskDependency rows live in their own shapes so
// single-task status updates don't have to rewrite the whole graph.

import type { GalleryDataReference, JsonObject } from '../../types';

export type TaskGraphStatus = 'pending' | 'active' | 'completed' | 'abandoned';

export type TaskGraph = {
  id: string;
  projectId: string;
  planPhaseId?: string; // optional — not every graph belongs to a phase
  label: string;
  summary?: string;
  status: TaskGraphStatus;
  taskIds: string[];
  dependencyIds: string[];
  assignedWorkerIds?: string[]; // which workers have taken tasks from this graph
  createdAt: string;
  updatedAt: string;
};

export const taskGraphMockData: TaskGraph[] = [
  {
    id: 'tg_phase_planning',
    projectId: 'proj_reactjit_carts',
    planPhaseId: 'phase_planning_and_tasks',
    label: 'Plan / Task / Research shapes',
    summary:
      'Build the plan / phase / task-graph / task / task-dependency / research files. Each has stable FKs to the layers below.',
    status: 'active',
    taskIds: [
      'task_plan_ts',
      'task_phase_ts',
      'task_graph_ts',
      'task_task_ts',
      'task_dep_ts',
      'task_research_ts',
    ],
    dependencyIds: [
      'dep_plan_phase',
      'dep_phase_graph',
      'dep_graph_task',
      'dep_task_dep',
      'dep_dep_research',
    ],
    assignedWorkerIds: ['w1'],
    createdAt: '2026-04-24T09:25:00Z',
    updatedAt: '2026-04-24T09:30:00Z',
  },
  {
    id: 'tg_hot_repro',
    projectId: 'proj_reactjit_runtime',
    planPhaseId: 'phase_hot_reproduce',
    label: 'useHotState reproduction',
    status: 'completed',
    taskIds: ['task_hot_min_repro', 'task_hot_trace'],
    dependencyIds: ['dep_hot_repro_to_trace'],
    createdAt: '2026-04-22T14:00:00Z',
    updatedAt: '2026-04-22T14:30:00Z',
  },
  {
    id: 'tg_adhoc_cleanup',
    projectId: 'proj_reactjit_framework',
    label: 'Ad-hoc: tidy stale dev-host warnings',
    summary: 'Not worth a full Plan — five small cleanups.',
    status: 'pending',
    taskIds: ['task_tidy_warn_1', 'task_tidy_warn_2'],
    dependencyIds: [],
    createdAt: '2026-04-24T09:00:00Z',
    updatedAt: '2026-04-24T09:00:00Z',
  },
];

export const taskGraphSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'TaskGraph',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'projectId', 'label', 'status', 'taskIds', 'dependencyIds', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      projectId: { type: 'string' },
      planPhaseId: { type: 'string' },
      label: { type: 'string' },
      summary: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'active', 'completed', 'abandoned'] },
      taskIds: { type: 'array', items: { type: 'string' } },
      dependencyIds: { type: 'array', items: { type: 'string' } },
      assignedWorkerIds: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const taskGraphReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Project', targetSource: 'cart/app/gallery/data/project.ts', sourceField: 'projectId', targetField: 'id' },
  {
    kind: 'references',
    label: 'Planning phase',
    targetSource: 'cart/app/gallery/data/planning-phase.ts',
    sourceField: 'planPhaseId',
    targetField: 'id',
    summary: 'Optional — lightweight ad-hoc graphs skip phases entirely.',
  },
  {
    kind: 'has-many',
    label: 'Tasks',
    targetSource: 'cart/app/gallery/data/task.ts',
    sourceField: 'taskIds[]',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Dependencies',
    targetSource: 'cart/app/gallery/data/task-dependency.ts',
    sourceField: 'dependencyIds[]',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Assigned workers',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'assignedWorkerIds[]',
    targetField: 'id',
    summary: 'Denormalized for fast lookup: which workers have claimed tasks from this graph.',
  },
];
