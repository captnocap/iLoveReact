// Workspace — the outermost scope. An on-disk directory root that the
// agent operates within. All paths, projects, sessions, and role
// assignments ultimately anchor to a Workspace. In a single-user tool
// you will typically have one row per local repo.
//
// This replaces the "path-as-id" pattern used elsewhere in the shape
// catalog (role-assignment.scopeTargetId, etc.). When a referenced
// location needs a stable identifier, point at workspace.id instead of
// the raw path.

import type { GalleryDataReference, JsonObject } from '../../types';

export type WorkspaceKind = 'repo' | 'worktree' | 'sandbox' | 'vault';
export type WorkspaceStatus = 'active' | 'archived';

export type Workspace = {
  id: string;
  userId: string;
  label: string;
  kind: WorkspaceKind;
  rootPath: string;
  status: WorkspaceStatus;
  vcs?: {
    kind: 'git' | 'jj' | 'none';
    defaultBranch?: string;
  };
  createdAt: string;
  updatedAt: string;
  summary?: string;
};

export const workspaceMockData: Workspace[] = [
  {
    id: 'ws_reactjit',
    userId: 'user_local',
    label: 'ReactJIT',
    kind: 'repo',
    rootPath: '/home/siah/creative/reactjit',
    status: 'active',
    vcs: { kind: 'git', defaultBranch: 'main' },
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-04-24T00:00:00Z',
    summary: 'Primary repo — React-reconciler-on-Zig framework.',
  },
  {
    id: 'ws_client_project',
    userId: 'user_local',
    label: 'Client project',
    kind: 'repo',
    rootPath: '/home/siah/creative/client-project',
    status: 'active',
    vcs: { kind: 'git', defaultBranch: 'main' },
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
    summary: 'Client engagement — uses the strict settings profile.',
  },
  {
    id: 'ws_sandbox',
    userId: 'user_local',
    label: 'Sandbox',
    kind: 'sandbox',
    rootPath: '/home/siah/tmp/agent-sandbox',
    status: 'active',
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-20T00:00:00Z',
    summary: 'Throwaway workspace for experiments. No VCS.',
  },
];

export const workspaceSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Workspace',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'userId', 'label', 'kind', 'rootPath', 'status', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      label: { type: 'string' },
      kind: { type: 'string', enum: ['repo', 'worktree', 'sandbox', 'vault'] },
      rootPath: { type: 'string' },
      status: { type: 'string', enum: ['active', 'archived'] },
      vcs: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: ['git', 'jj', 'none'] },
          defaultBranch: { type: 'string' },
        },
      },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      summary: { type: 'string' },
    },
  },
};

export const workspaceReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'User',
    targetSource: 'cart/app/gallery/data/user.ts',
    sourceField: 'userId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Projects',
    targetSource: 'cart/app/gallery/data/project.ts',
    sourceField: 'id',
    targetField: 'workspaceId',
    summary:
      'A workspace may hold one or many projects (e.g. monorepo). Single-package repos have one project per workspace.',
  },
  {
    kind: 'has-many',
    label: 'Role assignments (workspace scope)',
    targetSource: 'cart/app/gallery/data/role-assignment.ts',
    sourceField: 'id',
    targetField: 'scopeTargetId (when scope=workspace)',
    summary:
      'Workspace-scoped role assignments now use workspace.id instead of the raw path. Replaces the string-path hack.',
  },
  {
    kind: 'has-many',
    label: 'Worker sessions',
    targetSource: 'cart/app/gallery/data/worker-session.ts',
    sourceField: 'id',
    targetField: 'workspaceId (to wire)',
    summary:
      'Worker sessions should carry a workspaceId so cost, audit, and memory can be grouped by workspace.',
  },
];
