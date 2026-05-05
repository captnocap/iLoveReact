// VerbInvocation — append-only log of every WorkerVerb call.
//
// Records both the agent's claimed args AND the actual script invocation
// the runner executed. The two often differ — args get coerced, paths
// resolved, defaults filled — and the audit trail wants both.
//
// Pathology checks declared on the WorkerVerb run on this row's
// stdout/stderr. Any matched check appends a PathologyDetection that
// references this invocation via verbInvocationId.

import type { GalleryDataReference, JsonObject } from '../../types';

export type VerbInvocationStatus = 'started' | 'succeeded' | 'failed' | 'timed-out' | 'killed';

export type VerbInvocation = {
  id: string;
  runId: string; // FK → vm-run.ts
  workerId: string;
  verbId: string;
  /** Args as the agent supplied them (parsed from the model output). */
  agentArgsJson: string;
  /** Actual script path + args the runner exec'd. */
  resolvedScriptPath: string;
  resolvedArgv: string[];
  exitCode?: number;
  status: VerbInvocationStatus;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  /** Pathology detections triggered by this invocation. Denorm count for fast filtering. */
  detectedPathologyCount: number;
  startedAt: string;
  endedAt?: string;
};

export const verbInvocationMockData: VerbInvocation[] = [
  {
    id: 'vinv_001',
    runId: 'vmrun_001',
    workerId: 'worker_spawned_scratch',
    verbId: 'verb_build_dev',
    agentArgsJson: '{"cart":"app"}',
    resolvedScriptPath: '/usr/local/bin/verb-build',
    resolvedArgv: ['--cart', 'app'],
    exitCode: 0,
    status: 'succeeded',
    stdout: 'compiled cart/app → zig-out/bin/app (3.8s)',
    durationMs: 3_812,
    detectedPathologyCount: 0,
    startedAt: '2026-05-05T10:00:02Z',
    endedAt: '2026-05-05T10:00:06Z',
  },
];

export const verbInvocationSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'VerbInvocation',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'runId', 'workerId', 'verbId', 'agentArgsJson', 'resolvedScriptPath', 'resolvedArgv', 'status', 'detectedPathologyCount', 'startedAt'],
    properties: {
      id: { type: 'string' },
      runId: { type: 'string' },
      workerId: { type: 'string' },
      verbId: { type: 'string' },
      agentArgsJson: { type: 'string' },
      resolvedScriptPath: { type: 'string' },
      resolvedArgv: { type: 'array', items: { type: 'string' } },
      exitCode: { type: 'number' },
      status: { type: 'string', enum: ['started', 'succeeded', 'failed', 'timed-out', 'killed'] },
      stdout: { type: 'string' },
      stderr: { type: 'string' },
      durationMs: { type: 'number' },
      detectedPathologyCount: { type: 'number' },
      startedAt: { type: 'string' },
      endedAt: { type: 'string' },
    },
  },
};

export const verbInvocationReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'VM run', targetSource: 'cart/app/gallery/data/core/vm-run.ts', sourceField: 'runId', targetField: 'id' },
  { kind: 'belongs-to', label: 'Verb', targetSource: 'cart/app/gallery/data/core/worker-verb.ts', sourceField: 'verbId', targetField: 'id' },
  { kind: 'belongs-to', label: 'Worker', targetSource: 'cart/app/gallery/data/core/worker.ts', sourceField: 'workerId', targetField: 'id' },
  {
    kind: 'has-many',
    label: 'Pathology detections',
    targetSource: 'cart/app/gallery/data/core/pathology-detection.ts',
    sourceField: 'id',
    targetField: 'verbInvocationId',
  },
];
