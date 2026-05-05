// Environment — a named runtime context within a Project (dev / staging
// / prod / local / preview). Holds the knobs that differ across
// deployments: process env vars, deployment target, connection strings.
//
// Separate from Settings.Privacy (which is agent-policy-grain) — this
// is about *what the running program talks to*, not *what the agent is
// allowed to do*. Example: `prod` environment has DATABASE_URL pointing
// at the live DB; `dev` points at localhost. Both are legal to read
// under the same privacy policy, but running "migrate" against the
// wrong one is a disaster.

import type { GalleryDataReference, JsonObject } from '../../types';

export type EnvironmentKind = 'dev' | 'staging' | 'prod' | 'preview' | 'local' | 'test';

export type EnvironmentSafetyLevel =
  | 'sandboxed' // read + write, no side effects beyond the dir
  | 'dev-writable' // local writes ok, may hit local services
  | 'read-only' // agent cannot write or trigger side effects
  | 'protected' // production — writes require explicit human approval
;

export type Environment = {
  id: string;
  projectId: string;
  kind: EnvironmentKind;
  label: string;
  envVars: Record<string, string>; // non-secret vars; secrets go through credentialRef
  deploymentTarget?: string; // e.g. "fly.io/reactjit", "localhost:3000"
  safetyLevel: EnvironmentSafetyLevel;
  createdAt: string;
  updatedAt: string;
  summary?: string;
};

export const environmentMockData: Environment[] = [
  {
    id: 'env_reactjit_local',
    projectId: 'proj_reactjit_framework',
    kind: 'local',
    label: 'Local dev',
    envVars: {
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000',
      DISABLE_TELEMETRY: '1',
    },
    safetyLevel: 'dev-writable',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-04-24T00:00:00Z',
    summary: 'The dev host on this machine.',
  },
  {
    id: 'env_reactjit_test',
    projectId: 'proj_reactjit_framework',
    kind: 'test',
    label: 'Test',
    envVars: {
      DISABLE_TELEMETRY: '1',
      NODE_ENV: 'test',
    },
    safetyLevel: 'sandboxed',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'env_client_staging',
    projectId: 'proj_client_engagement',
    kind: 'staging',
    label: 'Client staging',
    envVars: {
      NODE_ENV: 'staging',
    },
    deploymentTarget: 'staging.client.example',
    safetyLevel: 'dev-writable',
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'env_client_prod',
    projectId: 'proj_client_engagement',
    kind: 'prod',
    label: 'Client production',
    envVars: {
      NODE_ENV: 'production',
    },
    deploymentTarget: 'prod.client.example',
    safetyLevel: 'protected',
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
    summary: 'Human approval required before any mutation — enforced by the worker spawn menu.',
  },
];

export const environmentSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Environment',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'projectId', 'kind', 'label', 'envVars', 'safetyLevel', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      projectId: { type: 'string' },
      kind: { type: 'string', enum: ['dev', 'staging', 'prod', 'preview', 'local', 'test'] },
      label: { type: 'string' },
      envVars: { type: 'object', additionalProperties: { type: 'string' } },
      deploymentTarget: { type: 'string' },
      safetyLevel: {
        type: 'string',
        enum: ['sandboxed', 'dev-writable', 'read-only', 'protected'],
      },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      summary: { type: 'string' },
    },
  },
};

export const environmentReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Project',
    targetSource: 'cart/app/gallery/data/project.ts',
    sourceField: 'projectId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Worker sessions (future)',
    targetSource: 'cart/app/gallery/data/worker-session.ts',
    sourceField: 'id',
    targetField: 'environmentId (to wire)',
    summary: 'Sessions should pin an environment so "which env am I hitting" is explicit.',
  },
];
