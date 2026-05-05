// PathologyDetection — append-only log of every Pathology firing.
//
// One row per detection event, with: what triggered it, where the
// signal was observed, who detected it (rule engine / verifier model /
// supervisor), severity actually applied, and how it was resolved
// (halted / warned / overridden).
//
// Every detection emits a `pathology.detected` Event that the rule
// engine can match. The user-facing surface (cockpit notification,
// halt-run dialog) is wired via Rule consequences, not directly here.

import type { GalleryDataReference, JsonObject } from '../../types';
import type { PathologySeverity } from './pathology';

export type PathologyDetectionResolution =
  | 'pending'
  | 'halted-run' // run was halted as the consequence
  | 'blocked-action' // the offending action was blocked outright
  | 'warned' // surfaced to user, run continued
  | 'user-overrode' // user explicitly green-lit despite the detection
  | 'auto-resolved'; // suppressed by a higher-priority rule

export type PathologyDetectorKind =
  | 'rule-engine' // pattern match in a rule's match.payloadEquals
  | 'verb-runner' // verb output matched a verb-level pathology check
  | 'shim' // binary-shim intercept
  | 'verifier-model' // stage-3 verifier flagged it cold
  | 'supervisor' // supervisor judgment;
  | 'manual'; // human user marked it

export type PathologyDetection = {
  id: string;
  pathologyId: string;
  /** Who/what detected it. */
  detector: PathologyDetectorKind;
  /** Severity applied at this firing — defaults to Pathology.severity but
   *  the resolver may downgrade for warn-only runs. */
  appliedSeverity: PathologySeverity;
  /** Pointer at the row that triggered detection. Polymorphic — see
   *  triggerKind. */
  triggerKind: 'verb-invocation' | 'tool-call' | 'rule-firing' | 'commit' | 'composition-run' | 'manual';
  triggerId?: string;
  /** Optional pointer at the verb invocation when triggered by verb output. */
  verbInvocationId?: string;
  /** Optional pointer at the composition run when relevant. */
  compositionRunId?: string;
  /** What was actually observed — the matched line, the offending command, etc. */
  evidence: string;
  /** Free-form notes from the detector. */
  reasoning?: string;
  /** Model id when detector=verifier-model or supervisor. */
  judgedByModelId?: string;
  resolution: PathologyDetectionResolution;
  resolvedAt?: string;
  resolutionNote?: string;
  detectedAt: string;
};

export const pathologyDetectionMockData: PathologyDetection[] = [
  {
    id: 'patdet_001',
    pathologyId: 'pat_session_kill_pattern',
    detector: 'verb-runner',
    appliedSeverity: 'block',
    triggerKind: 'verb-invocation',
    verbInvocationId: 'vinv_blocked_pkill',
    evidence: 'pkill -f "zig build"',
    reasoning: 'Self-matching pgrep pattern. Killed before exec.',
    resolution: 'blocked-action',
    resolvedAt: '2026-04-22T16:32:11Z',
    resolutionNote: 'Verb runner refused to exec; agent re-prompted with kill <PID>.',
    detectedAt: '2026-04-22T16:32:11Z',
  },
];

export const pathologyDetectionSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'PathologyDetection',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'pathologyId', 'detector', 'appliedSeverity', 'triggerKind', 'evidence', 'resolution', 'detectedAt'],
    properties: {
      id: { type: 'string' },
      pathologyId: { type: 'string' },
      detector: { type: 'string', enum: ['rule-engine', 'verb-runner', 'shim', 'verifier-model', 'supervisor', 'manual'] },
      appliedSeverity: { type: 'string', enum: ['block', 'halt', 'warn'] },
      triggerKind: { type: 'string', enum: ['verb-invocation', 'tool-call', 'rule-firing', 'commit', 'composition-run', 'manual'] },
      triggerId: { type: 'string' },
      verbInvocationId: { type: 'string' },
      compositionRunId: { type: 'string' },
      evidence: { type: 'string' },
      reasoning: { type: 'string' },
      judgedByModelId: { type: 'string' },
      resolution: {
        type: 'string',
        enum: ['pending', 'halted-run', 'blocked-action', 'warned', 'user-overrode', 'auto-resolved'],
      },
      resolvedAt: { type: 'string' },
      resolutionNote: { type: 'string' },
      detectedAt: { type: 'string' },
    },
  },
};

export const pathologyDetectionReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Pathology', targetSource: 'cart/app/gallery/data/core/pathology.ts', sourceField: 'pathologyId', targetField: 'id' },
  { kind: 'references', label: 'Verb invocation', targetSource: 'cart/app/gallery/data/core/verb-invocation.ts', sourceField: 'verbInvocationId', targetField: 'id' },
  { kind: 'references', label: 'Composition run', targetSource: 'cart/app/gallery/data/core/composition-run.ts', sourceField: 'compositionRunId', targetField: 'id' },
];
