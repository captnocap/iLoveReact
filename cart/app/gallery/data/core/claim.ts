// Claim — append-only ledger of agent assertions that need verification.
//
// When the rule engine detects an agent emitting a forward-looking
// assertion ("fixed", "shipped", "works", "the cause is X", "the work
// was destroyed"), it inserts a Claim row with status='unverified' and
// the evidence kinds that would resolve it. A verify-gate then watches
// for either:
//
//   - matching evidence events arriving on the bus → mark verified
//   - the agent taking another forward action with no intervening
//     evidence → fire `supervisor:inject-message` with a prompt-back
//     template, looping the agent back through its own claim
//
// This is the load-bearing entity behind the verify-loop family. Every
// scenario in the catalog (manifest-as-truth, build-success-as-truth,
// causal fabrication, loss-narrative-without-recovery, etc.) reduces
// to a Claim row plus an evidence requirement.
//
// Subagent claims chain via parentClaimId — a parent Claim only
// resolves when all of its descendants resolve.

import type { GalleryDataReference, JsonObject } from '../../types';

function objectSchema(properties: Record<string, JsonObject>, required: string[] = Object.keys(properties)): JsonObject {
  return { type: 'object', additionalProperties: false, required, properties };
}

function arraySchema(items: JsonObject): JsonObject {
  return { type: 'array', items };
}

const stringSchema: JsonObject = { type: 'string' };
const numberSchema: JsonObject = { type: 'number' };
const booleanSchema: JsonObject = { type: 'boolean' };

export type ClaimKind =
  | 'fix'             // "fixed", "the bug is gone"
  | 'ship'            // "shipped", "the work is in"
  | 'works'           // "works now", "try it"
  | 'cause'           // "the cause is X", "happens because"
  | 'recovery'        // "the work was destroyed / recovered"
  | 'completion'      // "all done", "complete"
  | 'pre-existing'    // "that's pre-existing"
  | 'subagent';       // delegated assertion from a child worker

export type ClaimEvidenceKind =
  | 'build-success'   // build process exit 0 (necessary, not sufficient)
  | 'test-pass'       // test suite exit 0
  | 'run-success'     // binary/script ran with exit 0
  | 'reflog-read'     // git reflog inspected
  | 'log-grep'        // git log --follow / blame for pre-existing claims
  | 'stack-trace'     // stack trace was read for causal claims
  | 'repro-run'       // reproduction was attempted
  | 'subagent-pass';  // child worker's claim resolved

export type ClaimStatus =
  | 'unverified'      // claim made, waiting on evidence
  | 'verified'        // matching evidence arrived
  | 'rejected'        // evidence contradicts the claim
  | 'expired';        // session ended / window elapsed without evidence

export type ClaimResolution =
  | 'auto-verified'        // evidence event arrived and matched
  | 'supervisor-overrode'  // supervisor explicitly resolved without evidence
  | 'user-overrode'        // user explicitly green-lit
  | 'session-ended'        // session terminated before evidence
  | 'rule-rejected';       // a rule fired with `claim:reject:<id>`

export type ClaimEvidenceRecord = {
  kind: ClaimEvidenceKind;
  bus: string;
  payload: JsonObject;
  at: string;
};

export type Claim = {
  id: string;
  /** WorkerSession that made the claim. */
  sessionId: string;
  workerId?: string;
  /** Parent Claim when this is a subagent assertion. */
  parentClaimId?: string;
  /** VM where the claim was emitted, if any. */
  vmid?: string;

  /** What the claim says, captured from the bus payload. */
  claimText: string;
  /** Bus channel and event id that surfaced the claim. */
  detectedFrom: string;
  detectedEventId?: string;

  /** Categorization — drives which evidence kinds satisfy. */
  kind: ClaimKind;
  /** Optional scope (file path, function id, feature label). When set,
   *  evidence is only counted if its payload references this scope. */
  scope?: string;

  /** Evidence kinds that resolve this claim. ANY single one suffices
   *  unless requireAll is true. */
  requiredEvidence: ClaimEvidenceKind[];
  requireAll: boolean;

  /** Evidence observed so far. Append-only. */
  evidence: ClaimEvidenceRecord[];

  status: ClaimStatus;
  resolution?: ClaimResolution;
  resolvedAt?: string;
  resolutionNote?: string;

  /** Free-form prompt template for inject-message when the gate fires.
   *  Variables: {claim}, {scope}, {requiredEvidence}. */
  injectTemplate?: string;

  detectedAt: string;
  updatedAt: string;
};

const claimEvidenceSchema: JsonObject = objectSchema({
  kind: { type: 'string', enum: [
    'build-success', 'test-pass', 'run-success',
    'reflog-read', 'log-grep', 'stack-trace', 'repro-run', 'subagent-pass',
  ] },
  bus: stringSchema,
  payload: { type: 'object', additionalProperties: true },
  at: stringSchema,
});

const claimRowSchema = objectSchema({
  id: stringSchema,
  sessionId: stringSchema,
  workerId: stringSchema,
  parentClaimId: stringSchema,
  vmid: stringSchema,
  claimText: stringSchema,
  detectedFrom: stringSchema,
  detectedEventId: stringSchema,
  kind: { type: 'string', enum: [
    'fix', 'ship', 'works', 'cause', 'recovery', 'completion', 'pre-existing', 'subagent',
  ] },
  scope: stringSchema,
  requiredEvidence: arraySchema({ type: 'string' }),
  requireAll: booleanSchema,
  evidence: arraySchema(claimEvidenceSchema),
  status: { type: 'string', enum: ['unverified', 'verified', 'rejected', 'expired'] },
  resolution: { type: 'string', enum: [
    'auto-verified', 'supervisor-overrode', 'user-overrode', 'session-ended', 'rule-rejected',
  ] },
  resolvedAt: stringSchema,
  resolutionNote: stringSchema,
  injectTemplate: stringSchema,
  detectedAt: stringSchema,
  updatedAt: stringSchema,
}, [
  'id', 'sessionId', 'claimText', 'detectedFrom', 'kind',
  'requiredEvidence', 'requireAll', 'evidence',
  'status', 'detectedAt', 'updatedAt',
]);

export const claimSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Claim',
  type: 'array',
  items: claimRowSchema,
};

export const claimMockData: Claim[] = [
  {
    id: 'claim_001',
    sessionId: 'sess_claude_01',
    workerId: 'w1',
    vmid: 'vmrun_001',
    claimText: 'fixed — the segfault is gone, try it now',
    detectedFrom: 'vm:vmrun_001:event:append',
    detectedEventId: 'evt_2026_05_07_001',
    kind: 'fix',
    scope: 'framework/parser.zig',
    requiredEvidence: ['build-success', 'run-success'],
    requireAll: true,
    evidence: [
      { kind: 'build-success', bus: 'vm:vmrun_001:event:append', payload: { exitCode: 0 }, at: '2026-05-07T10:01:30Z' },
      { kind: 'run-success', bus: 'vm:vmrun_001:event:append', payload: { exitCode: 0 }, at: '2026-05-07T10:01:42Z' },
    ],
    status: 'verified',
    resolution: 'auto-verified',
    resolvedAt: '2026-05-07T10:01:42Z',
    detectedAt: '2026-05-07T10:01:12Z',
    updatedAt: '2026-05-07T10:01:42Z',
  },
  {
    id: 'claim_002',
    sessionId: 'sess_local_01',
    claimText: 'should be silenced',
    detectedFrom: 'event:append',
    kind: 'fix',
    requiredEvidence: ['run-success'],
    requireAll: false,
    evidence: [],
    status: 'unverified',
    injectTemplate:
      'You said: "{claim}". I have no evidence ({requiredEvidence}) since that claim. ' +
      'Run the verification before reasserting.',
    detectedAt: '2026-05-07T11:14:00Z',
    updatedAt: '2026-05-07T11:14:00Z',
  },
];

export const claimReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Worker session',
    targetSource: 'cart/app/gallery/data/core/worker-session.ts',
    sourceField: 'sessionId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Worker',
    targetSource: 'cart/app/gallery/data/core/worker.ts',
    sourceField: 'workerId',
    targetField: 'id',
  },
  {
    kind: 'self',
    label: 'Parent claim (subagent chain)',
    targetSource: 'cart/app/gallery/data/core/claim.ts',
    sourceField: 'parentClaimId',
    targetField: 'id',
    summary: 'Subagent claims chain to the parent. A parent claim only resolves when every descendant resolves.',
  },
];
