// ProceduralMemory — the how-to tier. Learned execution knowledge:
// playbooks, recipes, and skill mastery. Answers "when I need to do X,
// what are the steps that have actually worked?"
//
// Distinct from skill.ts (which is a declarative capability spec — the
// *what* and *required capabilities*). ProceduralMemory is the
// *how* — concrete ordered steps, learned from experience, improved
// over invocations.
//
// Relationship with skill.ts:
//   - A Skill *can* reference one or more Playbooks as its preferred
//     execution strategies.
//   - A Playbook belongs to a user (cross-project know-how) and may
//     optionally reference a Skill it implements.

import type { GalleryDataReference, JsonObject } from '../../types';

export type PlaybookStepKind =
  | 'observe' // read / inspect state
  | 'reason' // think before acting
  | 'act' // take action (tool call / edit / command)
  | 'verify' // check result
  | 'recover'; // fallback if previous step failed

export type PlaybookStep = {
  id: string;
  order: number;
  kind: PlaybookStepKind;
  instruction: string;
  toolHint?: string; // preferred tool for this step ("Bash", "Read", ...)
  successCriteria?: string;
  recoverIfFailed?: string; // id of a fallback step
};

export type PlaybookMaturity =
  | 'candidate' // first attempt, not yet proven
  | 'refined' // iterated a couple of times
  | 'mastered' // high success rate across many invocations
  | 'deprecated'; // known to fail now

export type Playbook = {
  id: string;
  userId: string;
  implementsSkillId?: string; // optional FK to skill.ts
  label: string;
  summary: string;
  trigger: string; // natural-language description of when to use this playbook
  steps: PlaybookStep[];
  maturity: PlaybookMaturity;
  invocationCount: number;
  successCount: number;
  lastInvokedAt?: string;
  derivedFromEpisodeIds?: string[]; // episodes that taught us this approach
  revisionOf?: string; // previous version of this playbook
  createdAt: string;
  updatedAt: string;
  tags?: string[];
};

export const proceduralMemoryMockData: Playbook[] = [
  {
    id: 'play_triage_flaky_test',
    userId: 'user_local',
    implementsSkillId: 'skill_debug_triage',
    label: 'Triage flaky test',
    summary: 'Determine whether a failing test is flake or a real regression before fixing it.',
    trigger: 'A test that previously passed now fails intermittently.',
    steps: [
      {
        id: 'step_1',
        order: 1,
        kind: 'observe',
        instruction: 'Run the test 10 times in a row; record pass/fail pattern.',
        toolHint: 'Bash',
        successCriteria: 'Clear flake-rate measurement.',
      },
      {
        id: 'step_2',
        order: 2,
        kind: 'reason',
        instruction:
          'If fail-rate < 10%, suspect flake (timing / ordering / IO). If ≥ 50%, suspect real regression.',
      },
      {
        id: 'step_3',
        order: 3,
        kind: 'observe',
        instruction: 'Check git log for recent changes in the test file and its direct deps.',
        toolHint: 'Bash',
      },
      {
        id: 'step_4',
        order: 4,
        kind: 'act',
        instruction:
          'Add deterministic seed / ordering / timeout adjustment if flake; bisect if regression.',
      },
      {
        id: 'step_5',
        order: 5,
        kind: 'verify',
        instruction: 'Re-run 10 times; require 10/10 pass before claiming fix.',
        toolHint: 'Bash',
      },
    ],
    maturity: 'refined',
    invocationCount: 11,
    successCount: 9,
    lastInvokedAt: '2026-04-20T12:00:00Z',
    derivedFromEpisodeIds: [],
    createdAt: '2026-03-20T00:00:00Z',
    updatedAt: '2026-04-20T12:00:00Z',
    tags: ['test', 'debug'],
  },
  {
    id: 'play_add_data_shape',
    userId: 'user_local',
    label: 'Add a new data-shape file',
    summary: 'Scaffold + populate a new shape in cart/app/gallery/data/, with all references wired.',
    trigger: 'User asks for a new entity, type, or shape to be added to the gallery.',
    steps: [
      {
        id: 'step_1',
        order: 1,
        kind: 'act',
        instruction:
          'Run ./scripts/gallery-component <PascalName> --format data --storage <kind> --tags "<tags>" to scaffold the file + story + index registration.',
        toolHint: 'Bash',
      },
      {
        id: 'step_2',
        order: 2,
        kind: 'observe',
        instruction: 'Read the scaffolded file to confirm boilerplate.',
        toolHint: 'Read',
      },
      {
        id: 'step_3',
        order: 3,
        kind: 'act',
        instruction:
          'Overwrite with real TS types, mock data, JSON schema, and GalleryDataReference[]. Reference by string path, not import, for cross-shape refs.',
        toolHint: 'Write',
      },
      {
        id: 'step_4',
        order: 4,
        kind: 'verify',
        instruction:
          'Grep stories/index.ts for the generated section import; confirm registration landed.',
        toolHint: 'Bash',
      },
      {
        id: 'step_5',
        order: 5,
        kind: 'recover',
        instruction:
          'If the shape references a not-yet-written file, mark references with "(future)" / "(to wire)" summaries and close the loop when the target lands.',
      },
    ],
    maturity: 'mastered',
    invocationCount: 29,
    successCount: 29,
    lastInvokedAt: '2026-04-24T09:10:40Z',
    derivedFromEpisodeIds: ['ep_gallery_scaffold'],
    createdAt: '2026-04-24T08:00:00Z',
    updatedAt: '2026-04-24T09:10:40Z',
    tags: ['gallery', 'scaffold'],
  },
  {
    id: 'play_commit_early',
    userId: 'user_local',
    label: 'Commit early and often',
    summary: 'Stage specific files by path and commit after each logical unit of work on main.',
    trigger: 'Completed a logical unit of work, or touched 3+ files, or about to start a risky step.',
    steps: [
      {
        id: 'step_1',
        order: 1,
        kind: 'observe',
        instruction: 'Run git status and git diff to understand what changed.',
        toolHint: 'Bash',
      },
      {
        id: 'step_2',
        order: 2,
        kind: 'reason',
        instruction:
          'Decide commit boundary: one logical change per commit. If there are unrelated changes from other workers, stage only my paths.',
      },
      {
        id: 'step_3',
        order: 3,
        kind: 'act',
        instruction:
          'git add <explicit paths> (never -A or .). Commit with a conventional-commits prefix.',
        toolHint: 'Bash',
      },
      {
        id: 'step_4',
        order: 4,
        kind: 'verify',
        instruction: 'git status; confirm working tree reflects the intended state.',
        toolHint: 'Bash',
      },
    ],
    maturity: 'mastered',
    invocationCount: 180,
    successCount: 180,
    lastInvokedAt: '2026-04-24T09:00:00Z',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-04-24T09:00:00Z',
    tags: ['git', 'workflow'],
  },
  {
    id: 'play_ship_cart_v1',
    userId: 'user_local',
    label: '(deprecated) Ship cart via npx tsc',
    summary: 'Old approach — invoked npx tsc synchronously in the reconciler path.',
    trigger: 'User wants to ship a cart.',
    steps: [
      {
        id: 'step_1',
        order: 1,
        kind: 'act',
        instruction: 'Run ./scripts/ship <cart>; wait for tsc.',
      },
    ],
    maturity: 'deprecated',
    invocationCount: 40,
    successCount: 40,
    derivedFromEpisodeIds: [],
    revisionOf: undefined,
    createdAt: '2026-02-15T00:00:00Z',
    updatedAt: '2026-03-15T00:00:00Z',
    tags: ['ship', 'deprecated'],
  },
];

export const proceduralMemorySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ProceduralMemory',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'userId',
      'label',
      'summary',
      'trigger',
      'steps',
      'maturity',
      'invocationCount',
      'successCount',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      implementsSkillId: { type: 'string' },
      label: { type: 'string' },
      summary: { type: 'string' },
      trigger: { type: 'string' },
      maturity: { type: 'string', enum: ['candidate', 'refined', 'mastered', 'deprecated'] },
      invocationCount: { type: 'number' },
      successCount: { type: 'number' },
      lastInvokedAt: { type: 'string' },
      derivedFromEpisodeIds: { type: 'array', items: { type: 'string' } },
      revisionOf: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'order', 'kind', 'instruction'],
          properties: {
            id: { type: 'string' },
            order: { type: 'number' },
            kind: {
              type: 'string',
              enum: ['observe', 'reason', 'act', 'verify', 'recover'],
            },
            instruction: { type: 'string' },
            toolHint: { type: 'string' },
            successCriteria: { type: 'string' },
            recoverIfFailed: { type: 'string' },
          },
        },
      },
    },
  },
};

export const proceduralMemoryReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'User',
    targetSource: 'cart/app/gallery/data/user.ts',
    sourceField: 'userId',
    targetField: 'id',
    summary: 'Playbooks travel with the user across projects (how-to is portable).',
  },
  {
    kind: 'references',
    label: 'Implements skill',
    targetSource: 'cart/app/gallery/data/skill.ts',
    sourceField: 'implementsSkillId',
    targetField: 'id',
    summary:
      'Optional link — a playbook may be the preferred execution strategy for a declarative Skill. A Skill can have multiple candidate playbooks; the resolver picks by maturity + successCount.',
  },
  {
    kind: 'references',
    label: 'Source episodes',
    targetSource: 'cart/app/gallery/data/episodic-memory.ts',
    sourceField: 'derivedFromEpisodeIds[]',
    targetField: 'id',
    summary: 'Episodes that contributed to this playbook\'s shape — useful for tracing why a step exists.',
  },
  {
    kind: 'references',
    label: 'Revision-of',
    targetSource: 'cart/app/gallery/data/procedural-memory.ts',
    sourceField: 'revisionOf',
    targetField: 'id',
    summary: 'Supersession chain — the V2 playbook points at the V1 it replaced.',
  },
];
