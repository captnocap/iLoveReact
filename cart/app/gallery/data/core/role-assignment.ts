// RoleAssignment — binds a Role to a scope. Lets "every worker in this
// session is a Reviewer" be one row, not N, and lets "the default role
// when nothing is specified is Implementer" live as data instead of
// hardcoded behavior.
//
// Scope precedence at resolve time (highest wins):
//   worker → session → workspace → default
// The resolver walks from most-specific to least and takes the first
// matching assignment.

import type { GalleryDataReference, JsonObject } from '../../types';

export type RoleAssignmentScope = 'worker' | 'session' | 'workspace' | 'default';

export type RoleAssignment = {
  id: string;
  settingsId: string;
  scope: RoleAssignmentScope;
  scopeTargetId?: string; // worker.id / session.id / workspace slug — null when scope='default'
  roleId: string;
  overrideModelId?: string;
  overridePresetId?: string;
  note?: string;
  createdAt: string;
};

export const roleAssignmentMockData: RoleAssignment[] = [
  {
    id: 'assn_default_implementer',
    settingsId: 'settings_default',
    scope: 'default',
    roleId: 'role_implementer',
    createdAt: '2026-03-01T00:00:00Z',
    note: 'Fallback role when no more-specific assignment applies.',
  },
  {
    id: 'assn_workspace_reactjit_planner',
    settingsId: 'settings_default',
    scope: 'workspace',
    scopeTargetId: '/home/siah/creative/reactjit',
    roleId: 'role_planner',
    overrideModelId: 'claude-opus-4-7',
    createdAt: '2026-04-10T00:00:00Z',
    note:
      'Workspace-level default — in the reactjit tree, new workers play Planner until told otherwise. Opus pinned for plan quality.',
  },
  {
    id: 'assn_session_review',
    settingsId: 'settings_default',
    scope: 'session',
    scopeTargetId: 'sess_claude_01',
    roleId: 'role_reviewer',
    overridePresetId: 'preset_precise',
    createdAt: '2026-04-24T09:00:00Z',
    note: 'Review-only session — this session cannot implement even if the workspace default is Implementer.',
  },
  {
    id: 'assn_worker_documentarian',
    settingsId: 'settings_default',
    scope: 'worker',
    scopeTargetId: 'w1',
    roleId: 'role_documentarian',
    createdAt: '2026-04-24T09:10:00Z',
    note: 'Per-worker override — this specific worker only documents; adjacent workers in the same session keep their defaults.',
  },
  {
    id: 'assn_strict_default',
    settingsId: 'settings_work_strict',
    scope: 'default',
    roleId: 'role_reviewer_strict',
    createdAt: '2026-04-12T00:00:00Z',
    note:
      'Strict profile defaults to review-only — under the work profile nothing can implement unless a more-specific assignment upgrades the role.',
  },
];

export const roleAssignmentSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'RoleAssignment',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'settingsId', 'scope', 'roleId', 'createdAt'],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      scope: { type: 'string', enum: ['worker', 'session', 'workspace', 'default'] },
      scopeTargetId: { type: 'string' },
      roleId: { type: 'string' },
      overrideModelId: { type: 'string' },
      overridePresetId: { type: 'string' },
      note: { type: 'string' },
      createdAt: { type: 'string' },
    },
  },
};

export const roleAssignmentReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
  },
  {
    kind: 'belongs-to',
    label: 'Role',
    targetSource: 'cart/app/gallery/data/role.ts',
    sourceField: 'roleId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Scope target — session',
    targetSource: 'cart/app/gallery/data/worker-session.ts',
    sourceField: 'scopeTargetId (when scope=session)',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Scope target — worker',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'scopeTargetId (when scope=worker)',
    targetField: 'id',
    summary:
      'Worker-level assignments target an individual Worker row.',
  },
  {
    kind: 'references',
    label: 'Override model',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'overrideModelId',
    targetField: 'id',
    summary: 'Optional per-assignment override of the role\'s default model.',
  },
  {
    kind: 'references',
    label: 'Override preset',
    targetSource: 'cart/app/gallery/data/inference-preset.ts',
    sourceField: 'overridePresetId',
    targetField: 'id',
    summary: 'Optional per-assignment override of the role\'s default preset.',
  },
];
