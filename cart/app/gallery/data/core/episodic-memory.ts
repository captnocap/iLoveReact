// EpisodicMemory — the experiential tier. One row per significant
// episode: a completed task, a debugging session, an aborted attempt,
// a handoff. Answers "what happened when, and what did I learn from
// it" across sessions.
//
// Differs from worker-event.ts (the raw event stream): episodic
// memories are *curated summaries* with a narrative, outcome, and
// reusable lessons. Consolidation from working-memory to episodic is
// what promotes ephemeral state into persistent experience.
//
// Per-worker for strongly-scoped experiences; can also be workspace-
// scoped for cross-session recall ("the last time anyone worked on
// the gallery, we hit this issue").

import type { GalleryDataReference, JsonObject } from '../../types';

export type EpisodeOutcome =
  | 'completed'
  | 'completed_with_caveats'
  | 'abandoned'
  | 'failed'
  | 'handed_off'
  | 'interrupted';

export type EpisodeKind =
  | 'task' // accomplished a concrete task
  | 'debug' // tracked down a specific bug
  | 'research' // explored / investigated
  | 'refactor' // structural change
  | 'spike' // exploratory prototype
  | 'handoff' // relay to another worker / human
  | 'review'; // reviewed someone else's work

export type EpisodicMemory = {
  id: string;
  workerId: string;
  workspaceId: string;
  projectId?: string;
  sessionId?: string; // which WorkerSession produced this, if any
  kind: EpisodeKind;
  title: string;
  narrative: string; // short prose summary — what I did, in order
  outcome: EpisodeOutcome;
  lessons?: string[]; // reusable learnings, 1–3 bullets
  relatedRequestIds?: string[]; // InferenceRequest ids that made up the episode
  artifactRefs?: string[]; // files / PRs / branches produced
  durationMs?: number;
  costUsd?: number;
  startedAt: string;
  endedAt?: string;
  tags?: string[];
};

export const episodicMemoryMockData: EpisodicMemory[] = [
  {
    id: 'ep_gallery_scaffold',
    workerId: 'w1',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_carts',
    sessionId: 'sess_claude_01',
    kind: 'task',
    title: 'Data-shape catalog — foundations (user / settings / connection / model / event contract)',
    narrative:
      'Scaffolded 12 data-shape files across the foundations and event-contract layers. Reshaped user → settings → privacy per the diagram, split Connection from ApiKey to absorb the Claude-CLI vs Console-key asymmetry, stamped a pressure-test codex-raw-event adapter to prove the normalized WorkerEvent contract holds across providers with wildly different wire formats.',
    outcome: 'completed',
    lessons: [
      'Keeping Settings as its own entity was load-bearing for profile switching + snapshot-able Privacy — do not collapse it into User.',
      'Connection replaces ApiKey cleanly because Anthropic\'s two auth paths are the *only* reason the old shape felt forced.',
      'Forward references (system-message.ts, prompt-template.ts, connection.ts, worker.ts) are fine — call them out as "to wire" and close them when the target lands.',
    ],
    relatedRequestIds: ['req_001', 'req_002'],
    artifactRefs: ['cart/app/gallery/data/'],
    durationMs: 5_700_000,
    costUsd: 2.41,
    startedAt: '2026-04-24T08:00:00Z',
    endedAt: '2026-04-24T09:35:00Z',
    tags: ['catalog', 'foundations', 'contract-first'],
  },
  {
    id: 'ep_kimi_raw_shape_gap',
    workerId: 'worker_sub_02',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_carts',
    sessionId: 'sess_kimi_01',
    kind: 'research',
    title: 'Kimi wire format has enough drift from Codex to need its own raw-event file',
    narrative:
      'Surveyed the Kimi stream shape against our Codex raw-event. Content deltas are the same, but Kimi carries a per-chunk `status` frame that OpenAI does not, and tool-call argument streaming uses a different schema for partial JSON. Folding Kimi into codex-raw-event would require an `if provider` branch in every rule — not worth it.',
    outcome: 'handed_off',
    lessons: [
      'Do not collapse raw-event shapes even when they look 80% similar — the 20% drift is always load-bearing at adapter time.',
      'Status frames are a real capability difference worth exposing on the normalized contract.',
    ],
    artifactRefs: [],
    durationMs: 900_000,
    costUsd: 0.41,
    startedAt: '2026-04-24T09:05:00Z',
    endedAt: '2026-04-24T09:20:00Z',
    tags: ['adapters', 'kimi', 'deferred'],
  },
  {
    id: 'ep_hotstate_regression',
    workerId: 'worker_strict_reviewer',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_runtime',
    kind: 'debug',
    title: 'useHotState not preserving across hot-reload — root cause: stale slot ids after remount',
    narrative:
      'Reproduced by saving runtime/hooks/useHotState.ts. The slot cache keyed on component identity was invalidated on every remount. Traced to hotstate.zig\'s slot rebuild logic not honoring stable ids. Trap-before-fix: added an instrumentation log that printed slot ids on rebuild, confirmed hypothesis.',
    outcome: 'completed_with_caveats',
    lessons: [
      'Stable-identity props must survive Zig-side rebuilds; do not key on JS-side component identity for persistence.',
      'Instrument before patching — the fix was one line, finding it took an hour without the log.',
    ],
    artifactRefs: ['framework/hotstate.zig', 'runtime/hooks/useHotState.ts'],
    durationMs: 4_200_000,
    costUsd: 1.87,
    startedAt: '2026-04-22T14:00:00Z',
    endedAt: '2026-04-22T15:10:00Z',
    tags: ['zig', 'hooks', 'hot-reload'],
  },
];

export const episodicMemorySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'EpisodicMemory',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'workerId', 'workspaceId', 'kind', 'title', 'narrative', 'outcome', 'startedAt'],
    properties: {
      id: { type: 'string' },
      workerId: { type: 'string' },
      workspaceId: { type: 'string' },
      projectId: { type: 'string' },
      sessionId: { type: 'string' },
      kind: {
        type: 'string',
        enum: ['task', 'debug', 'research', 'refactor', 'spike', 'handoff', 'review'],
      },
      title: { type: 'string' },
      narrative: { type: 'string' },
      outcome: {
        type: 'string',
        enum: ['completed', 'completed_with_caveats', 'abandoned', 'failed', 'handed_off', 'interrupted'],
      },
      lessons: { type: 'array', items: { type: 'string' } },
      relatedRequestIds: { type: 'array', items: { type: 'string' } },
      artifactRefs: { type: 'array', items: { type: 'string' } },
      durationMs: { type: 'number' },
      costUsd: { type: 'number' },
      startedAt: { type: 'string' },
      endedAt: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
};

export const episodicMemoryReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Worker',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'workerId',
    targetField: 'id',
  },
  {
    kind: 'belongs-to',
    label: 'Workspace',
    targetSource: 'cart/app/gallery/data/workspace.ts',
    sourceField: 'workspaceId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Project',
    targetSource: 'cart/app/gallery/data/project.ts',
    sourceField: 'projectId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Session',
    targetSource: 'cart/app/gallery/data/worker-session.ts',
    sourceField: 'sessionId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Inference requests',
    targetSource: 'cart/app/gallery/data/inference-request.ts',
    sourceField: 'relatedRequestIds[]',
    targetField: 'id',
    summary: 'The requests that made up the episode — useful for cost / replay.',
  },
  {
    kind: 'references',
    label: 'Consolidation feed (from working-memory)',
    targetSource: 'cart/app/gallery/data/working-memory.ts',
    sourceField: '(consolidation)',
    targetField: 'id',
    summary:
      'Episodic records are typically produced by consolidating working-memory state at worker end-of-episode. Not a row-level FK.',
  },
  {
    kind: 'references',
    label: 'Feeds semantic memory',
    targetSource: 'cart/app/gallery/data/semantic-memory.ts',
    sourceField: 'lessons[]',
    targetField: 'body (via consolidation)',
    summary:
      'Reusable lessons surface as semantic-memory entries after repeated episodes reinforce them. Not a direct link.',
  },
];
