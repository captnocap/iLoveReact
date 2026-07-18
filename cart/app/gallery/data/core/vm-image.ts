// VmImage — the worker's "body". A rootfs + kernel + curated tool set
// that one or more WorkerVerbs operate against. Every Firecracker
// invocation picks a VmImage and the worker is constrained to whatever
// that image provides.
//
// Why curated images: an unbounded image (full distro + npm + docker +
// curl) lets workers reach for anything; a curated image makes the
// action surface enumerable and auditable. Spec calls these
// "minimal / dev / research / verifier" — the row carries the
// classification so the rule engine can route by image kind.

import type { GalleryDataReference, JsonObject } from '../../types';

export type VmImageKind = 'minimal' | 'dev' | 'research' | 'verifier' | 'custom';
export type VmImageMountPolicy = 'readonly' | 'worktree' | 'snapshot';

export type VmImage = {
  id: string;
  label: string;
  kind: VmImageKind;
  /** Path or registry locator for the rootfs. Resolution is platform-specific. */
  rootfsLocator: string;
  /** Kernel binary path/locator. */
  kernelLocator: string;
  /** Tools the image is *expected* to provide. Verbs depend on these. */
  providedTools: string[];
  /** Default mount mode workers get on the host worktree. */
  defaultMountPolicy: VmImageMountPolicy;
  /** Soft cap on workers that can boot this image concurrently. */
  maxConcurrent?: number;
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

export const vmImageMockData: VmImage[] = [
  {
    id: 'vmimg_minimal',
    label: 'Minimal',
    kind: 'minimal',
    rootfsLocator: 'oci://reactjit/vm-minimal:latest',
    kernelLocator: '/var/lib/firecracker/vmlinux-6.1',
    providedTools: ['sh', 'cat', 'grep', 'sed', 'find'],
    defaultMountPolicy: 'readonly',
    summary: 'Read-only audits. Cannot write to the worktree.',
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  {
    id: 'vmimg_dev',
    label: 'Dev',
    kind: 'dev',
    rootfsLocator: 'oci://reactjit/vm-dev:latest',
    kernelLocator: '/var/lib/firecracker/vmlinux-6.1',
    providedTools: ['sh', 'git', 'zig-0.16.0', 'tools/v8cli', 'esbuild', 'rg', 'fd', 'jq'],
    defaultMountPolicy: 'worktree',
    maxConcurrent: 4,
    summary: 'Full build/iterate stack. Worktree mount is writable on a per-VM branch.',
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  {
    id: 'vmimg_verifier',
    label: 'Verifier',
    kind: 'verifier',
    rootfsLocator: 'oci://reactjit/vm-verifier:latest',
    kernelLocator: '/var/lib/firecracker/vmlinux-6.1',
    providedTools: ['sh', 'git', 'zig-0.16.0', 'tools/v8cli', 'jq', 'diff'],
    defaultMountPolicy: 'snapshot',
    summary: 'Stage-3 cross-family verification. Snapshot mount means the verifier sees the produced diff but cannot mutate it.',
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
];

export const vmImageSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'VmImage',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label', 'kind', 'rootfsLocator', 'kernelLocator', 'providedTools', 'defaultMountPolicy', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      kind: { type: 'string', enum: ['minimal', 'dev', 'research', 'verifier', 'custom'] },
      rootfsLocator: { type: 'string' },
      kernelLocator: { type: 'string' },
      providedTools: { type: 'array', items: { type: 'string' } },
      defaultMountPolicy: { type: 'string', enum: ['readonly', 'worktree', 'snapshot'] },
      maxConcurrent: { type: 'number' },
      summary: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const vmImageReferences: GalleryDataReference[] = [
  {
    kind: 'has-many',
    label: 'VM runs',
    targetSource: 'cart/app/gallery/data/core/vm-run.ts',
    sourceField: 'id',
    targetField: 'vmImageId',
  },
  {
    kind: 'has-many',
    label: 'Worker verbs (curated against this image)',
    targetSource: 'cart/app/gallery/data/core/worker-verb.ts',
    sourceField: 'id',
    targetField: 'vmImageId',
  },
];
