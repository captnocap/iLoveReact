// Worker — a runtime actor owned by Supervisor.
//
// Workers are not Assistant and not Supervisor. They are disposable or
// fixed-slot executors that receive narrow assignments from Supervisor.
// The fixed crew fields support the experiment where a Supervisor keeps
// a stable roster of worker slots, while preserving the boundary that a
// worker never becomes the Supervisor.
//
// Pared down from the datashapes.md `Agent`
// shape: we deliberately skip trust scores, self-modification policy,
// and the autonomous delegation chain — those are enterprise-scale
// governance features that don't apply to a single-user tool yet.
//
// Today's WorkerState (cart/cockpit) carries most of this inline. This
// shape promotes worker identity to first class so that:
//   - WorkerEvent.requestId → InferenceRequest → Worker becomes a real
//     chain, not an implicit "everything belongs to a session."
//   - RoleAssignment.scope='worker' has a stable target.
//   - Supervisor.fixedCrew[].workerId has a stable target.

import type { GalleryDataReference, JsonObject } from '../../types';

export type WorkerLifecycle =
  | 'spawning'
  | 'active'
  | 'idle'
  | 'streaming'
  | 'suspended'
  | 'terminating'
  | 'terminated'
  | 'crashed';

export type WorkerKind = 'primary' | 'subagent' | 'background';
export type WorkerCrewMode = 'fixed' | 'spawned';

export type Worker = {
  id: string;
  supervisorId: string;
  crewSlotId?: string;
  crewMode: WorkerCrewMode;
  userId: string;
  workspaceId: string;
  projectId?: string;
  environmentId?: string;
  settingsId: string;
  sessionId?: string; // current WorkerSession, if running
  label: string;
  kind: WorkerKind;
  lifecycle: WorkerLifecycle;
  roleId?: string;
  connectionId: string;
  modelId: string;
  parentWorkerId?: string; // worker-to-worker delegation, not Supervisor identity
  childWorkerIds?: string[];
  maxConcurrentRequests: number;
  spawnedAt: string;
  lastActivityAt?: string;
  terminatedAt?: string;
};

export const workerMockData: Worker[] = [
  {
    id: 'w1',
    supervisorId: 'supervisor_default',
    crewSlotId: 'crew_doc',
    crewMode: 'fixed',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_carts',
    environmentId: 'env_reactjit_local',
    settingsId: 'settings_default',
    sessionId: 'sess_claude_01',
    label: 'Worker 1 — documentarian',
    kind: 'primary',
    lifecycle: 'streaming',
    roleId: 'role_documentarian',
    connectionId: 'conn_claude_cli',
    modelId: 'claude-sonnet-4-6',
    maxConcurrentRequests: 1,
    spawnedAt: '2026-04-24T09:10:00Z',
    lastActivityAt: '2026-04-24T09:10:42Z',
  },
  {
    id: 'worker_sub_02',
    supervisorId: 'supervisor_default',
    crewSlotId: 'crew_review',
    crewMode: 'fixed',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_framework',
    environmentId: 'env_reactjit_local',
    settingsId: 'settings_default',
    sessionId: 'sess_kimi_01',
    label: 'Worker 2 — triage',
    kind: 'subagent',
    lifecycle: 'idle',
    roleId: 'role_reviewer',
    connectionId: 'conn_kimi',
    modelId: 'kimi-k2',
    maxConcurrentRequests: 1,
    spawnedAt: '2026-04-24T09:05:00Z',
    lastActivityAt: '2026-04-24T09:06:03Z',
  },
  {
    id: 'worker_strict_reviewer',
    supervisorId: 'supervisor_default',
    crewSlotId: 'crew_strict',
    crewMode: 'fixed',
    userId: 'user_local',
    workspaceId: 'ws_client_project',
    projectId: 'proj_client_engagement',
    environmentId: 'env_client_staging',
    settingsId: 'settings_work_strict',
    label: 'Client reviewer',
    kind: 'primary',
    lifecycle: 'idle',
    roleId: 'role_reviewer_strict',
    connectionId: 'conn_anthropic_api',
    modelId: 'claude-sonnet-4-6',
    maxConcurrentRequests: 1,
    spawnedAt: '2026-04-12T14:00:00Z',
    lastActivityAt: '2026-04-12T14:22:00Z',
  },
  {
    id: 'worker_spawned_scratch',
    supervisorId: 'supervisor_default',
    crewMode: 'spawned',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_carts',
    environmentId: 'env_reactjit_local',
    settingsId: 'settings_default',
    label: 'Scratch worker',
    kind: 'background',
    lifecycle: 'idle',
    roleId: 'role_implementer',
    connectionId: 'conn_claude_cli',
    modelId: 'claude-sonnet-4-6',
    maxConcurrentRequests: 1,
    spawnedAt: '2026-05-05T00:00:00Z',
    lastActivityAt: '2026-05-05T00:00:00Z',
  },
];

export const workerSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Worker',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'supervisorId',
      'crewMode',
      'userId',
      'workspaceId',
      'settingsId',
      'label',
      'kind',
      'lifecycle',
      'connectionId',
      'modelId',
      'maxConcurrentRequests',
      'spawnedAt',
    ],
    properties: {
      id: { type: 'string' },
      supervisorId: { type: 'string' },
      crewSlotId: { type: 'string' },
      crewMode: { type: 'string', enum: ['fixed', 'spawned'] },
      userId: { type: 'string' },
      workspaceId: { type: 'string' },
      projectId: { type: 'string' },
      environmentId: { type: 'string' },
      settingsId: { type: 'string' },
      sessionId: { type: 'string' },
      label: { type: 'string' },
      kind: { type: 'string', enum: ['primary', 'subagent', 'background'] },
      lifecycle: {
        type: 'string',
        enum: [
          'spawning',
          'active',
          'idle',
          'streaming',
          'suspended',
          'terminating',
          'terminated',
          'crashed',
        ],
      },
      roleId: { type: 'string' },
      connectionId: { type: 'string' },
      modelId: { type: 'string' },
      parentWorkerId: { type: 'string' },
      childWorkerIds: { type: 'array', items: { type: 'string' } },
      maxConcurrentRequests: { type: 'number' },
      spawnedAt: { type: 'string' },
      lastActivityAt: { type: 'string' },
      terminatedAt: { type: 'string' },
    },
  },
};

export const workerReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Supervisor',
    targetSource: 'cart/app/gallery/data/supervisor.ts',
    sourceField: 'supervisorId',
    targetField: 'id',
    summary:
      'Workers belong to Supervisor for orchestration. This reference does not imply identity inheritance or transformation.',
  },
  { kind: 'belongs-to', label: 'User', targetSource: 'cart/app/gallery/data/user.ts', sourceField: 'userId', targetField: 'id' },
  {
    kind: 'belongs-to',
    label: 'Workspace',
    targetSource: 'cart/app/gallery/data/workspace.ts',
    sourceField: 'workspaceId',
    targetField: 'id',
  },
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Project',
    targetSource: 'cart/app/gallery/data/project.ts',
    sourceField: 'projectId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Environment',
    targetSource: 'cart/app/gallery/data/environment.ts',
    sourceField: 'environmentId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Role',
    targetSource: 'cart/app/gallery/data/role.ts',
    sourceField: 'roleId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Connection',
    targetSource: 'cart/app/gallery/data/connection.ts',
    sourceField: 'connectionId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Model',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'modelId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Current session',
    targetSource: 'cart/app/gallery/data/worker-session.ts',
    sourceField: 'sessionId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Parent worker',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'parentWorkerId',
    targetField: 'id',
    summary: 'Worker-to-worker delegation only. Supervisor is a separate shape and is referenced via supervisorId.',
  },
  {
    kind: 'has-many',
    label: 'Inference requests',
    targetSource: 'cart/app/gallery/data/inference-request.ts',
    sourceField: 'id',
    targetField: 'workerId (to wire)',
    summary:
      'Inference requests should carry a workerId so "what has this worker been up to" is a direct query, not a session-join.',
  },
];
