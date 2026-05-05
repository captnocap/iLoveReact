// Project — a logical unit of work inside a Workspace. For a monorepo,
// multiple projects map to one workspace (framework + runtime +
// cart-host all living under /home/siah/creative/reactjit). For a
// single-package repo, there is typically one Project per Workspace.
//
// Projects are the narrative scope — what the agent is working on and
// why. Goals, task graphs, and conversation threads belong to a
// Project so "which effort does this belong to" is a first-class
// query, not a comment in a commit message.
//
// Simplified from the datashapes.md spec: no workspace-level billing,
// no project-to-project dependency graph. Add those when we need them.

import type { GalleryDataReference, JsonObject } from '../../types';

export type ProjectStatus = 'active' | 'paused' | 'archived';

export type Project = {
  id: string;
  workspaceId: string;
  slug: string;
  label: string;
  description?: string;
  subPath?: string; // path relative to workspace.rootPath; '.' for whole-workspace
  status: ProjectStatus;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
};

export const projectMockData: Project[] = [
  {
    id: 'proj_reactjit_framework',
    workspaceId: 'ws_reactjit',
    slug: 'framework',
    label: 'Framework (Zig runtime)',
    description: 'Layout, engine, GPU, events, input, state, effects, text, windows.',
    subPath: 'framework',
    status: 'active',
    tags: ['zig', 'runtime'],
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-04-24T00:00:00Z',
  },
  {
    id: 'proj_reactjit_runtime',
    workspaceId: 'ws_reactjit',
    slug: 'runtime',
    label: 'Runtime (JS entry)',
    description: 'JS entry point, JSX shim, primitives, host globals, hooks.',
    subPath: 'runtime',
    status: 'active',
    tags: ['typescript', 'react'],
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-04-24T00:00:00Z',
  },
  {
    id: 'proj_reactjit_carts',
    workspaceId: 'ws_reactjit',
    slug: 'carts',
    label: 'Carts (.tsx apps)',
    description: 'Individual cart apps — cockpit, sweatshop, component-gallery, etc.',
    subPath: 'cart',
    status: 'active',
    tags: ['typescript', 'react', 'apps'],
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-04-24T00:00:00Z',
  },
  {
    id: 'proj_client_engagement',
    workspaceId: 'ws_client_project',
    slug: 'engagement',
    label: 'Client engagement',
    subPath: '.',
    status: 'active',
    tags: ['client', 'confidential'],
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
];

export const projectSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Project',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'workspaceId', 'slug', 'label', 'status', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      workspaceId: { type: 'string' },
      slug: { type: 'string' },
      label: { type: 'string' },
      description: { type: 'string' },
      subPath: { type: 'string' },
      status: { type: 'string', enum: ['active', 'paused', 'archived'] },
      tags: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const projectReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Workspace',
    targetSource: 'cart/app/gallery/data/workspace.ts',
    sourceField: 'workspaceId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Environments',
    targetSource: 'cart/app/gallery/data/environment.ts',
    sourceField: 'id',
    targetField: 'projectId',
    summary: 'Per-project dev / staging / prod separation.',
  },
  {
    kind: 'has-many',
    label: 'Worker sessions (future)',
    targetSource: 'cart/app/gallery/data/worker-session.ts',
    sourceField: 'id',
    targetField: 'projectId (to wire)',
    summary:
      'Worker sessions could key off projectId so session lists filter naturally by "which effort am I on."',
  },
  {
    kind: 'has-many',
    label: 'Task graphs (future)',
    targetSource: 'cart/app/gallery/data/task-graph.ts',
    sourceField: 'id',
    targetField: 'projectId',
    summary: 'Task graphs belong to a project; Phase 3 shape.',
  },
];
