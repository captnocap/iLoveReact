// WorkerVerb — curated, intent-shaped action vocabulary per VmImage.
//
// "Verbs" are the action surface the agent reaches for inside the VM:
// build, test, format, commit, lint, etc. Intent-shaped, not
// implementation-shaped — the verb says what to do; the script behind
// it says how. This separation lets us swap the implementation (npm →
// bun → tools/v8cli) without re-prompting the model.
//
// Each verb belongs to a VmImage (the verb's surface depends on the
// tools that image provides) and declares an args schema + the
// pathology-detection regex(es) that should run on its output.

import type { GalleryDataReference, JsonObject } from '../../types';

export type VerbArgKind = 'string' | 'integer' | 'boolean' | 'enum' | 'multiline' | 'path';

export type VerbArg = {
  name: string;
  kind: VerbArgKind;
  required: boolean;
  description?: string;
  enum?: string[];
};

export type VerbPathologyCheck = {
  /** Pattern (regex source) that, if matched in stdout/stderr, fires a
   *  PathologyDetection. Pointer at the Pathology row provides the
   *  actual severity / why-harmful description. */
  patternSource: string;
  pathologyId: string;
  /** Where the pattern is evaluated. */
  surface: 'stdout' | 'stderr' | 'both' | 'exit-code-nonzero';
};

export type WorkerVerb = {
  id: string;
  vmImageId: string;
  /** The verb name as the agent invokes it: 'build', 'test', 'commit', … */
  name: string;
  intent: string;
  /** Absolute path inside the VM image to the script the verb runs. */
  scriptPath: string;
  args: VerbArg[];
  pathologyChecks: VerbPathologyCheck[];
  /** Hard cap on wall time (ms). Verb runner kills past this. */
  timeoutMs: number;
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

export const workerVerbMockData: WorkerVerb[] = [
  {
    id: 'verb_build_dev',
    vmImageId: 'vmimg_dev',
    name: 'build',
    intent: 'Compile the cart and package the binary.',
    scriptPath: '/usr/local/bin/verb-build',
    args: [
      { name: 'cart', kind: 'string', required: true, description: 'Cart name (e.g. "app", "openai-chat").' },
    ],
    pathologyChecks: [
      { patternSource: 'pkill -f|kill -9 -1|killall ', pathologyId: 'pat_session_kill_pattern', surface: 'both' },
    ],
    timeoutMs: 600_000,
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  {
    id: 'verb_test_dev',
    vmImageId: 'vmimg_dev',
    name: 'test',
    intent: 'Run the cart\'s self-tests.',
    scriptPath: '/usr/local/bin/verb-test',
    args: [{ name: 'scope', kind: 'string', required: false }],
    pathologyChecks: [],
    timeoutMs: 180_000,
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  {
    id: 'verb_commit_dev',
    vmImageId: 'vmimg_dev',
    name: 'commit',
    intent: 'Stage explicit paths + create a single conventional-style commit.',
    scriptPath: '/usr/local/bin/verb-commit',
    args: [
      { name: 'message', kind: 'multiline', required: true },
      { name: 'paths', kind: 'multiline', required: true, description: 'Newline-separated paths to stage. Never -A.' },
    ],
    pathologyChecks: [
      { patternSource: 'git add (-A|\\.|\\*)', pathologyId: 'pat_indiscriminate_stage', surface: 'stdout' },
      { patternSource: '--no-verify|--no-gpg-sign', pathologyId: 'pat_skip_hooks', surface: 'stdout' },
    ],
    timeoutMs: 30_000,
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
  {
    id: 'verb_review_minimal',
    vmImageId: 'vmimg_minimal',
    name: 'review',
    intent: 'Read-only review of a diff or path.',
    scriptPath: '/usr/local/bin/verb-review',
    args: [{ name: 'target', kind: 'path', required: true }],
    pathologyChecks: [],
    timeoutMs: 60_000,
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
];

export const workerVerbSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'WorkerVerb',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'vmImageId', 'name', 'intent', 'scriptPath', 'args', 'pathologyChecks', 'timeoutMs', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      vmImageId: { type: 'string' },
      name: { type: 'string' },
      intent: { type: 'string' },
      scriptPath: { type: 'string' },
      args: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'kind', 'required'],
          properties: {
            name: { type: 'string' },
            kind: { type: 'string', enum: ['string', 'integer', 'boolean', 'enum', 'multiline', 'path'] },
            required: { type: 'boolean' },
            description: { type: 'string' },
            enum: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      pathologyChecks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['patternSource', 'pathologyId', 'surface'],
          properties: {
            patternSource: { type: 'string' },
            pathologyId: { type: 'string' },
            surface: { type: 'string', enum: ['stdout', 'stderr', 'both', 'exit-code-nonzero'] },
          },
        },
      },
      timeoutMs: { type: 'number' },
      summary: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const workerVerbReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'VM image',
    targetSource: 'cart/app/gallery/data/core/vm-image.ts',
    sourceField: 'vmImageId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Pathology checks',
    targetSource: 'cart/app/gallery/data/core/pathology.ts',
    sourceField: 'pathologyChecks[].pathologyId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Invocations',
    targetSource: 'cart/app/gallery/data/core/verb-invocation.ts',
    sourceField: 'id',
    targetField: 'verbId',
  },
];
