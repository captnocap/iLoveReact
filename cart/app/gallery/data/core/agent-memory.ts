// AgentMemory + MemoryEntry — typed view of the file-based memory
// system at `~/.claude-overflow/projects/<slug>/memory/`.
//
// Each project directory has one AgentMemory header and N MemoryEntry
// rows, one per `.md` file inside. MEMORY.md is the index, not an
// entry — it is a directory pointer and is excluded from the entry set.
//
// Storage is atomic-file-to-db: each entry lives as its own file with
// frontmatter on disk, but is projected into a row-shaped view here so
// the cockpit and gallery can query across entries uniformly.

import type { GalleryDataReference, JsonObject } from '../../types';

export type MemoryEntryType = 'user' | 'feedback' | 'project' | 'reference';

export type MemoryEntry = {
  id: string;
  memoryId: string; // FK → AgentMemory.id
  filename: string; // e.g. "past.md"
  name: string;
  description: string;
  type: MemoryEntryType;
  body: string;
  updatedAt: string;
};

export type AgentMemory = {
  id: string;
  userId: string;
  projectSlug: string; // e.g. "-home-siah-creative-reactjit"
  rootPath: string; // absolute path to the memory/ dir
  indexPath: string; // path to MEMORY.md
  entryCount: number;
  updatedAt: string;
};

// ── Mock — the active memory for this repo ─────────────────────────────

const memoryId = 'mem_reactjit';

export const agentMemoryMockData: {
  memory: AgentMemory;
  entries: MemoryEntry[];
} = {
  memory: {
    id: memoryId,
    userId: 'user_local',
    projectSlug: '-home-siah-creative-reactjit',
    rootPath:
      '/home/siah/.claude-overflow/projects/-home-siah-creative-reactjit/memory',
    indexPath:
      '/home/siah/.claude-overflow/projects/-home-siah-creative-reactjit/memory/MEMORY.md',
    entryCount: 5,
    updatedAt: '2026-04-24T00:00:00Z',
  },
  entries: [
    {
      id: 'mem_reactjit.past',
      memoryId,
      filename: 'past.md',
      name: 'Past',
      description:
        'The 50-day Smith detour, why it\'s frozen, anti-patterns to resist.',
      type: 'project',
      body:
        'Fact: Smith/.tsz is frozen as of 2026-04-18. Why: the 50-day detour produced a reconciler that drifted from the love2d reference. How to apply: do not restart Smith, do not run d-suite, do not port .tsz mechanically.',
      updatedAt: '2026-04-18T00:00:00Z',
    },
    {
      id: 'mem_reactjit.present',
      memoryId,
      filename: 'present.md',
      name: 'Present',
      description:
        'Root stack shape, ship path, primitives, tailwind/HTML support, runtime shims, known gaps.',
      type: 'project',
      body:
        'The repo ships carts via `./scripts/ship <cart>`, uses V8 by default, and has a hot-reload dev host. Known gap: useHotState does not preserve across reloads yet.',
      updatedAt: '2026-04-18T00:00:00Z',
    },
    {
      id: 'mem_reactjit.behavior',
      memoryId,
      filename: 'behavior.md',
      name: 'Behavior',
      description:
        'Cross-cutting rules: no Explore agent, Zig 0.16.0, git main-only, regenerate don\'t port.',
      type: 'feedback',
      body:
        'Rule: never invoke Explore in this repo. Why: it produced materially false feature reports; direct reads are faster and correct. How to apply: use Read/Grep/Glob/Bash directly.',
      updatedAt: '2026-04-18T00:00:00Z',
    },
    {
      id: 'mem_reactjit.jsrt_plan',
      memoryId,
      filename: 'jsrt_plan.md',
      name: 'JSRT plan',
      description:
        'Decided VM direction: JS inside Lua, NOT JS translated to Lua.',
      type: 'project',
      body:
        'JSRT is a JS evaluator running inside LuaJIT. Scope boundary: evaluator implements ECMAScript semantics; it does not know about React/hooks/JSX. esbuild lowers JSX before the evaluator sees the bundle.',
      updatedAt: '2026-04-21T00:00:00Z',
    },
    {
      id: 'mem_reactjit.ship_wait',
      memoryId,
      filename: 'feedback_ship_wait.md',
      name: 'Ship wait',
      description:
        'Don\'t pgrep-busy-wait for zig build before shipping; ship holds flock.',
      type: 'feedback',
      body:
        'Rule: do not write `until ! pgrep -f "zig build"` loops. Why: pgrep -f matches the polling shell itself — self-matching deadlock. How to apply: call scripts/ship directly; it serializes with flock.',
      updatedAt: '2026-04-21T00:00:00Z',
    },
  ],
};

// ── Schema ─────────────────────────────────────────────────────────────

const memoryEntryRowSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'memoryId', 'filename', 'name', 'description', 'type', 'body', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    memoryId: { type: 'string' },
    filename: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
    body: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

const agentMemoryRowSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'userId', 'projectSlug', 'rootPath', 'indexPath', 'entryCount', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    projectSlug: { type: 'string' },
    rootPath: { type: 'string' },
    indexPath: { type: 'string' },
    entryCount: { type: 'number' },
    updatedAt: { type: 'string' },
  },
};

export const agentMemorySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'AgentMemory',
  type: 'object',
  additionalProperties: false,
  required: ['memory', 'entries'],
  properties: {
    memory: agentMemoryRowSchema,
    entries: { type: 'array', items: memoryEntryRowSchema },
  },
};

// ── References ─────────────────────────────────────────────────────────

export const agentMemoryReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'User',
    targetSource: 'cart/app/gallery/data/user.ts',
    sourceField: 'memory.userId',
    targetField: 'id',
    summary: 'Each AgentMemory belongs to exactly one user.',
  },
  {
    kind: 'has-many',
    label: 'Memory entries',
    targetSource: 'cart/app/gallery/data/agent-memory.ts',
    sourceField: 'memory.id',
    targetField: 'entries[].memoryId',
    summary:
      'The AgentMemory header owns N MemoryEntry rows (one per .md file in the memory/ directory, excluding MEMORY.md).',
  },
  {
    kind: 'references',
    label: 'Project (implicit)',
    targetSource: 'cart/app/gallery/data/agent-memory.ts',
    sourceField: 'memory.projectSlug',
    targetField: '(external filesystem anchor)',
    summary:
      'projectSlug is derived from the absolute repo path (\"/\" → \"-\"). It is the handshake key between the memory system and the running project directory.',
  },
];
