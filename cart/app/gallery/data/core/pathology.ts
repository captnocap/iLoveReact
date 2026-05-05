// Pathology — system-wide behavior floor entries grounded in past
// injury, not policy.
//
// Where a Constraint says "we'd prefer you don't do X" and a
// MechanicalGuardrail says "you literally can't do X", a Pathology sits
// in between: "X has hurt us before, here is the evidence, here is the
// detector." Pathologies are always-on, system-scoped, and cannot be
// opted out of.
//
// The promotion ladder (instruction → constraint → pathology →
// mechanical guardrail) is data: a Constraint that violates often
// enough graduates to a Pathology; a Pathology whose detection becomes
// fully mechanical graduates to a guardrail. Each promotion strengthens
// authority and reduces ongoing defense cost.
//
// `preventionFragmentId` points at a PromptFragment that tries to
// prevent this pathology in the first place — so the behavior floor is
// linked to the upstream guidance that addresses it.

import type { GalleryDataReference, JsonObject } from '../../types';

export type PathologySeverity = 'block' | 'halt' | 'warn';

export type PathologyDetectionSignal = {
  /** How the runtime decides whether this pathology is firing. */
  kind: 'pattern' | 'judgment' | 'script' | 'verb-output' | 'shim-trigger';
  /** Regex source when kind=pattern; framework method name when
   *  kind=script; recipe id when kind=judgment. */
  spec: string;
  /** Where the signal is observed. */
  surface?: 'stdout' | 'stderr' | 'commit-message' | 'tool-call' | 'rule-firing' | 'cross-cutting';
};

export type Pathology = {
  id: string;
  label: string;
  /** Plain-English description of what was observed when this fired in
   *  the past. The injury, not a rule. */
  observedBehavior: string;
  whyHarmful: string;
  /** Concrete evidence — incident date, commit hash, transcript ref. */
  evidence: string[];
  detectionSignals: PathologyDetectionSignal[];
  severity: PathologySeverity;
  /** Optional pointer at the PromptFragment that tries to prevent this
   *  pathology by being baked into the assembly. */
  preventionFragmentId?: string;
  /** Optional pointer at the eventual mechanical guardrail, when one
   *  exists. Closes the promotion ladder. */
  mechanicalGuardrailRef?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export const pathologyMockData: Pathology[] = [
  {
    id: 'pat_session_kill_pattern',
    label: 'Session-killing shell command',
    observedBehavior:
      'Worker ran `pkill -f <pattern>` whose pattern matched the polling shell\'s own command line, cascading into a logout that killed all 14 parallel worker panes.',
    whyHarmful:
      'Lost hours of recovery time. The rule "kill by exact PID, not by pattern" is non-negotiable here.',
    evidence: ['CLAUDE.md:HARD RULE: BANNED SHELL COMMANDS section', '2026-04-22 incident report'],
    detectionSignals: [
      { kind: 'pattern', spec: '\\bpkill\\s+-f\\b|\\bkill\\s+-9\\s+-1\\b|\\bkillall\\s+', surface: 'tool-call' },
    ],
    severity: 'block',
    preventionFragmentId: 'frag_no_session_kill',
    active: true,
    createdAt: '2026-04-22T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  {
    id: 'pat_indiscriminate_stage',
    label: 'Indiscriminate `git add -A`',
    observedBehavior:
      'Worker staged all working-tree changes including other workers\' in-flight edits, producing commits that mixed unrelated work and corrupted the change history.',
    whyHarmful:
      'Parallel sessions step on each other. Mixing unrelated changes makes review impossible and `git revert` cleanup destructive.',
    evidence: ['CLAUDE.md:Stage explicit paths only', 'recurring transcript pattern'],
    detectionSignals: [
      { kind: 'pattern', spec: '\\bgit add (-A|\\.|\\*)\\b', surface: 'tool-call' },
    ],
    severity: 'block',
    preventionFragmentId: 'frag_stage_explicit',
    active: true,
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  {
    id: 'pat_skip_hooks',
    label: 'Skip-hooks bypass',
    observedBehavior:
      'Worker ran `git commit --no-verify` to push past a failing pre-commit, hiding the underlying failure and shipping broken code.',
    whyHarmful:
      'Hooks exist to catch real issues. Bypassing them means the failure surfaces later, in a worse place.',
    evidence: ['CLAUDE.md:Never skip hooks'],
    detectionSignals: [
      { kind: 'pattern', spec: '--no-verify|--no-gpg-sign|-c\\s+commit\\.gpgsign=false', surface: 'tool-call' },
    ],
    severity: 'halt',
    active: true,
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  {
    id: 'pat_explore_in_repo',
    label: 'Spawning Explore agent in this repo',
    observedBehavior:
      'Explore agent invocations produced ~57% false-claim rate on feature audits in this codebase, materially misleading the supervisor.',
    whyHarmful:
      'Direct reads are faster (~1m13s vs ~3m46s) and correct. Explore summaries cannot be trusted here.',
    evidence: ['CLAUDE.md:HARD RULE: DO NOT USE EXPLORE'],
    detectionSignals: [
      { kind: 'pattern', spec: '"subagent_type":\\s*"Explore"|\\bAgent\\s*\\(', surface: 'tool-call' },
    ],
    severity: 'block',
    active: true,
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  {
    id: 'pat_debug_ship',
    label: 'Shipping with -d (debug build)',
    observedBehavior:
      '`scripts/ship <cart> -d` produces a binary that crashes on click. User has corrected this multiple times.',
    whyHarmful:
      'The "fast feedback" of a debug build is a false economy here — the binary literally does not work.',
    evidence: ['memory feedback_no_debug_builds.md'],
    detectionSignals: [
      { kind: 'pattern', spec: '\\bscripts/ship\\b[^|]*\\s+-d\\b', surface: 'tool-call' },
    ],
    severity: 'block',
    active: true,
    createdAt: '2026-05-04T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
];

export const pathologySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Pathology',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label', 'observedBehavior', 'whyHarmful', 'evidence', 'detectionSignals', 'severity', 'active', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      observedBehavior: { type: 'string' },
      whyHarmful: { type: 'string' },
      evidence: { type: 'array', items: { type: 'string' } },
      detectionSignals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'spec'],
          properties: {
            kind: { type: 'string', enum: ['pattern', 'judgment', 'script', 'verb-output', 'shim-trigger'] },
            spec: { type: 'string' },
            surface: { type: 'string', enum: ['stdout', 'stderr', 'commit-message', 'tool-call', 'rule-firing', 'cross-cutting'] },
          },
        },
      },
      severity: { type: 'string', enum: ['block', 'halt', 'warn'] },
      preventionFragmentId: { type: 'string' },
      mechanicalGuardrailRef: { type: 'string' },
      active: { type: 'boolean' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const pathologyReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Prevention fragment',
    targetSource: 'cart/app/gallery/data/composition/prompt-fragment.ts',
    sourceField: 'preventionFragmentId',
    targetField: 'id',
    summary:
      'Closes the promotion ladder upstream — the PromptFragment baked into worker assemblies that tries to prevent this pathology before it ever fires.',
  },
  {
    kind: 'has-many',
    label: 'Detections',
    targetSource: 'cart/app/gallery/data/core/pathology-detection.ts',
    sourceField: 'id',
    targetField: 'pathologyId',
  },
];
