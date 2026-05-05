// VmRun — per-invocation log of one Firecracker boot.
//
// The lifecycle the spec describes:
//   1. Spawn Firecracker VM with selected VmImage
//   2. Cut a fresh git branch off main
//   3. Mount worktree (readonly / worktree / snapshot)
//   4. Render assembly to CLAUDE.md (or AGENTS.md, etc.)
//   5. Worker operates with verbs + shims as the action surface
//   6. Branch captures the diff, VM is destroyed at completion
//   7. Branch is preserved per retention policy for forensics
//
// VmRun is the row that records ONE pass through that lifecycle.
// VerbInvocation rows hang off this run via runId.

import type { GalleryDataReference, JsonObject } from '../../types';

export type VmRunStatus = 'spawning' | 'running' | 'completed' | 'failed' | 'aborted' | 'destroyed';
export type VmMountPolicy = 'readonly' | 'worktree' | 'snapshot';

export type VmResourceUsage = {
  cpuSeconds?: number;
  peakRssBytes?: number;
  diskWriteBytes?: number;
  netOutBytes?: number;
};

export type VmRun = {
  id: string;
  vmImageId: string;
  workerId: string;
  /** Fresh branch name cut off main for this run. Persisted for forensics. */
  branchName: string;
  baseCommit: string;
  /** What was actually mounted. May differ from VmImage.defaultMountPolicy. */
  mountPolicy: VmMountPolicy;
  /** What got rendered to CLAUDE.md (or equivalent) at boot. */
  renderedAssemblyHash?: string;
  status: VmRunStatus;
  /** Hash of the producing host (commit, image, kernel, tooling). Lets the
   *  verifier confirm it's reading a known-good build. */
  hostFingerprint?: string;
  /** Unified diff captured from the run's branch. Read-only after run end. */
  capturedDiffRef?: string;
  resourceUsage?: VmResourceUsage;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  errorMessage?: string;
};

export const vmRunMockData: VmRun[] = [
  {
    id: 'vmrun_001',
    vmImageId: 'vmimg_dev',
    workerId: 'worker_spawned_scratch',
    branchName: 'vmrun/2026-05-05/scratch-001',
    baseCommit: '49eb83726',
    mountPolicy: 'worktree',
    renderedAssemblyHash: 'sha256:abc...',
    status: 'completed',
    hostFingerprint: 'sha256:host-49eb-vmimg_dev-vmlinux-6.1',
    capturedDiffRef: 'git:vmrun/2026-05-05/scratch-001..main',
    resourceUsage: { cpuSeconds: 14.2, peakRssBytes: 412_000_000, diskWriteBytes: 18_400 },
    startedAt: '2026-05-05T10:00:00Z',
    endedAt: '2026-05-05T10:00:14Z',
    durationMs: 14_000,
  },
];

export const vmRunSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'VmRun',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'vmImageId', 'workerId', 'branchName', 'baseCommit', 'mountPolicy', 'status', 'startedAt'],
    properties: {
      id: { type: 'string' },
      vmImageId: { type: 'string' },
      workerId: { type: 'string' },
      branchName: { type: 'string' },
      baseCommit: { type: 'string' },
      mountPolicy: { type: 'string', enum: ['readonly', 'worktree', 'snapshot'] },
      renderedAssemblyHash: { type: 'string' },
      status: { type: 'string', enum: ['spawning', 'running', 'completed', 'failed', 'aborted', 'destroyed'] },
      hostFingerprint: { type: 'string' },
      capturedDiffRef: { type: 'string' },
      resourceUsage: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cpuSeconds: { type: 'number' },
          peakRssBytes: { type: 'number' },
          diskWriteBytes: { type: 'number' },
          netOutBytes: { type: 'number' },
        },
      },
      startedAt: { type: 'string' },
      endedAt: { type: 'string' },
      durationMs: { type: 'number' },
      errorMessage: { type: 'string' },
    },
  },
};

export const vmRunReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'VM image',
    targetSource: 'cart/app/gallery/data/core/vm-image.ts',
    sourceField: 'vmImageId',
    targetField: 'id',
  },
  {
    kind: 'belongs-to',
    label: 'Worker',
    targetSource: 'cart/app/gallery/data/core/worker.ts',
    sourceField: 'workerId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Verb invocations during this run',
    targetSource: 'cart/app/gallery/data/core/verb-invocation.ts',
    sourceField: 'id',
    targetField: 'runId',
  },
];
