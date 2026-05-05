// BinaryShim — intercepts binaries the agent reaches for inside the VM.
//
// `npm`, `node`, `docker`, `curl` etc. are routed through shim wrappers
// at known paths inside the rootfs. The shim consults its policy row
// here and either silently completes, redirects to the verb the agent
// should have used, raises a graceful error, audits, or blocks outright.
//
// The "decoy artifacts" pattern (`NO_NPM_JACKASS`) is structured here:
// a redirect_to_verb shim drops a forensic file under
// `decoyArtifactPath` so the run's diff captures the attempt, even if
// the actual stdout looked successful.

import type { GalleryDataReference, JsonObject } from '../../types';

export type ShimPolicy =
  | 'silent-success' // exit 0, no stdout, no diff — the binary was a no-op
  | 'redirect-to-verb' // print the canonical verb to use, exit nonzero
  | 'graceful-error' // structured error message, exit nonzero
  | 'audit-only' // pass through to the real binary; just log
  | 'block'; // refuse outright, exit nonzero, no real call

export type BinaryShim = {
  id: string;
  vmImageId: string;
  /** The binary name the agent typed (`npm`, `docker`, etc.). */
  binary: string;
  policy: ShimPolicy;
  /** When policy=redirect-to-verb, which verb the agent should have used. */
  redirectVerbId?: string;
  /** Forensic decoy file path written into the worktree on intercept. */
  decoyArtifactPath?: string;
  /** Single-line message printed to stderr on intercept. */
  message: string;
  /** When policy=audit-only, real binary path. */
  realBinaryPath?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export const binaryShimMockData: BinaryShim[] = [
  {
    id: 'shim_npm',
    vmImageId: 'vmimg_dev',
    binary: 'npm',
    policy: 'redirect-to-verb',
    redirectVerbId: 'verb_build_dev',
    decoyArtifactPath: '/work/.NO_NPM_JACKASS',
    message: 'npm is not available in this image. Use the build verb (tools/v8cli for scripts).',
    enabled: true,
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  {
    id: 'shim_node',
    vmImageId: 'vmimg_dev',
    binary: 'node',
    policy: 'redirect-to-verb',
    decoyArtifactPath: '/work/.NO_NODE',
    message: 'node is not in this image; use tools/v8cli to run JS scripts.',
    enabled: true,
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  {
    id: 'shim_docker',
    vmImageId: 'vmimg_dev',
    binary: 'docker',
    policy: 'block',
    message: 'docker is not permitted inside the worker VM (nested virtualization).',
    enabled: true,
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  {
    id: 'shim_curl_audit',
    vmImageId: 'vmimg_dev',
    binary: 'curl',
    policy: 'audit-only',
    realBinaryPath: '/usr/bin/curl',
    message: 'curl invocation logged for audit.',
    enabled: true,
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
];

export const binaryShimSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'BinaryShim',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'vmImageId', 'binary', 'policy', 'message', 'enabled', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      vmImageId: { type: 'string' },
      binary: { type: 'string' },
      policy: {
        type: 'string',
        enum: ['silent-success', 'redirect-to-verb', 'graceful-error', 'audit-only', 'block'],
      },
      redirectVerbId: { type: 'string' },
      decoyArtifactPath: { type: 'string' },
      message: { type: 'string' },
      realBinaryPath: { type: 'string' },
      enabled: { type: 'boolean' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const binaryShimReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'VM image',
    targetSource: 'cart/app/gallery/data/core/vm-image.ts',
    sourceField: 'vmImageId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Redirect verb',
    targetSource: 'cart/app/gallery/data/core/worker-verb.ts',
    sourceField: 'redirectVerbId',
    targetField: 'id',
  },
];
