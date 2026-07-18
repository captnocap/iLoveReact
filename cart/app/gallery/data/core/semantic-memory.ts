// SemanticMemory — the knowledge tier. Facts, conventions, and
// invariants that are true about a user / workspace / domain across
// sessions. Answers "what do I *know* about this?"
//
// This is the tier that agent-memory.ts currently occupies in the
// single-tier approach (it mirrors the `~/.claude-overflow/projects/
// <slug>/memory/` file system). The two shapes coexist:
//   - agent-memory.ts: pragmatic, file-backed, matches the live
//     on-disk layout. Use this when the source of truth is the
//     directory itself.
//   - semantic-memory.ts: tier-aware, supports confidence scores,
//     sourcing from episodes, and query-time retrieval ranking. Use
//     this when promoting episodic lessons into persistent knowledge.
//
// Pick one; do not mix. They are alternative models of the same
// concept.

import type { GalleryDataReference, JsonObject } from '../../types';

export type SemanticFactKind =
  | 'invariant' // always true ("useHotState does not persist across remount")
  | 'convention' // what the project does ("Zig 0.16.0, LF line endings")
  | 'domain_term' // terminology ("cart = .tsx app")
  | 'relation' // X is related to Y ("Smith compiler is frozen under tsz/")
  | 'policy' // rule with a reason ("commit and push to main only")
  | 'heuristic' // rule of thumb ("prefer direct reads over Explore")
  | 'constraint'; // hard boundary ("never chmod frozen dirs")

export type SemanticMemoryEntry = {
  id: string;
  userId: string;
  workspaceId?: string; // null = cross-workspace (user-wide fact)
  kind: SemanticFactKind;
  subject: string; // what the fact is about (e.g. "useHotState", "cart/", "Zig version")
  statement: string; // the fact itself
  rationale?: string; // why it's true / why we care
  confidence: number; // 0–1
  sourceEpisodeIds?: string[]; // episodes that reinforced it
  supersedes?: string; // id of an older entry this replaces
  firstLearnedAt: string;
  lastReinforcedAt: string;
  reinforcementCount: number;
  tags?: string[];
};

export const semanticMemoryMockData: SemanticMemoryEntry[] = [
  {
    id: 'smem_zig_version',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    kind: 'convention',
    subject: 'Zig toolchain',
    statement: 'Repo compiles with pinned Zig 0.16.0; use tools/zig/zig and its bundled standard library as the API authority.',
    confidence: 0.98,
    firstLearnedAt: '2026-03-01T00:00:00Z',
    lastReinforcedAt: '2026-04-18T00:00:00Z',
    reinforcementCount: 5,
    tags: ['zig', 'toolchain'],
  },
  {
    id: 'smem_main_only',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    kind: 'policy',
    subject: 'Git branching',
    statement: 'Commit and push to main only; do not create or checkout branches in this repo.',
    rationale:
      'Parallel sessions step on each other if branches diverge; a linear main keeps supervisor + workers coherent.',
    confidence: 1.0,
    firstLearnedAt: '2026-03-15T00:00:00Z',
    lastReinforcedAt: '2026-04-24T00:00:00Z',
    reinforcementCount: 12,
    tags: ['git', 'workflow'],
  },
  {
    id: 'smem_no_explore',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    kind: 'heuristic',
    subject: 'Agent tool use',
    statement: 'Do not invoke the Explore agent in this repo; use direct Read/Grep/Glob/Bash.',
    rationale:
      'Explore produced materially false feature reports here (~57% false-claim rate on audits). Direct reads are faster and correct.',
    confidence: 1.0,
    sourceEpisodeIds: ['ep_explore_audit_false_positive'],
    firstLearnedAt: '2026-04-01T00:00:00Z',
    lastReinforcedAt: '2026-04-22T00:00:00Z',
    reinforcementCount: 4,
    tags: ['agent', 'explore', 'anti-pattern'],
  },
  {
    id: 'smem_useHotState_not_persisting',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    kind: 'invariant',
    subject: 'useHotState',
    statement: 'useHotState state is reset on every hot-reload as of 2026-04-24.',
    rationale: 'Slot cache keyed on component identity; remount invalidates. Known, not fixed.',
    confidence: 0.95,
    sourceEpisodeIds: ['ep_hotstate_regression'],
    firstLearnedAt: '2026-04-22T15:10:00Z',
    lastReinforcedAt: '2026-04-24T00:00:00Z',
    reinforcementCount: 2,
    tags: ['hooks', 'hot-reload', 'known-gap'],
  },
  {
    id: 'smem_cart_def',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    kind: 'domain_term',
    subject: 'cart',
    statement: 'A cart is a single .tsx application that ships via ./scripts/ship as a self-extracting binary.',
    confidence: 1.0,
    firstLearnedAt: '2026-03-01T00:00:00Z',
    lastReinforcedAt: '2026-04-24T00:00:00Z',
    reinforcementCount: 8,
    tags: ['vocabulary'],
  },
  {
    id: 'smem_terse_pref',
    userId: 'user_local',
    kind: 'convention',
    subject: 'Response style',
    statement: 'User prefers terse responses; no trailing summaries, no emojis unless asked.',
    confidence: 1.0,
    firstLearnedAt: '2026-03-01T00:00:00Z',
    lastReinforcedAt: '2026-04-24T00:00:00Z',
    reinforcementCount: 20,
    tags: ['user-pref'],
  },
  {
    id: 'smem_frozen_dirs',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    kind: 'constraint',
    subject: 'Frozen directories',
    statement: 'archive/, love2d/, tsz/ are read-only. Do not chmod, edit, or restart Smith work.',
    confidence: 1.0,
    firstLearnedAt: '2026-04-18T00:00:00Z',
    lastReinforcedAt: '2026-04-18T00:00:00Z',
    reinforcementCount: 1,
    tags: ['boundary', 'anti-pattern'],
  },
];

export const semanticMemorySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SemanticMemory',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'userId',
      'kind',
      'subject',
      'statement',
      'confidence',
      'firstLearnedAt',
      'lastReinforcedAt',
      'reinforcementCount',
    ],
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      workspaceId: { type: 'string' },
      kind: {
        type: 'string',
        enum: ['invariant', 'convention', 'domain_term', 'relation', 'policy', 'heuristic', 'constraint'],
      },
      subject: { type: 'string' },
      statement: { type: 'string' },
      rationale: { type: 'string' },
      confidence: { type: 'number' },
      sourceEpisodeIds: { type: 'array', items: { type: 'string' } },
      supersedes: { type: 'string' },
      firstLearnedAt: { type: 'string' },
      lastReinforcedAt: { type: 'string' },
      reinforcementCount: { type: 'number' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
};

export const semanticMemoryReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'User',
    targetSource: 'cart/app/gallery/data/user.ts',
    sourceField: 'userId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Workspace (scope)',
    targetSource: 'cart/app/gallery/data/workspace.ts',
    sourceField: 'workspaceId',
    targetField: 'id',
    summary: 'Null = user-wide fact (e.g. response-style preference). Set = workspace-scoped fact.',
  },
  {
    kind: 'references',
    label: 'Source episodes',
    targetSource: 'cart/app/gallery/data/episodic-memory.ts',
    sourceField: 'sourceEpisodeIds[]',
    targetField: 'id',
    summary: 'Episodes that reinforced this fact. Confidence grows with reinforcementCount.',
  },
  {
    kind: 'references',
    label: 'Supersedes',
    targetSource: 'cart/app/gallery/data/semantic-memory.ts',
    sourceField: 'supersedes',
    targetField: 'id',
    summary: 'Points at a replaced entry — lets stale facts be traced, not just overwritten.',
  },
  {
    kind: 'references',
    label: 'Alternative shape — agent-memory',
    targetSource: 'cart/app/gallery/data/agent-memory.ts',
    sourceField: '(same concept, simpler model)',
    targetField: 'entries[].body',
    summary:
      'The simple / file-backed alternative to this tier. Coexist — pick one per experiment; do not mix.',
  },
];
