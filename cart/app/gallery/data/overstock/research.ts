// Research — a scoped inquiry. Answers "what did we look up, where
// did we look, and what did we learn?" Pragmatic variant of the
// datashapes.md ResearchSession + SearchStrategy + ResearchQuery +
// Source + Evidence + Finding chain — collapsed into one entity with
// nested Source and Finding arrays because they are always co-read
// and usually small.
//
// Research rows can:
//   - attach to a PlanningPhase (discovery work that informs a phase)
//   - attach to a Task (kind='research')
//   - produce SemanticMemory entries when findings persist
//   - stand alone (ad-hoc inquiry that may or may not turn into a plan)

import type { GalleryDataReference, JsonObject } from '../../types';

export type ResearchStatus = 'active' | 'complete' | 'abandoned' | 'archived';

export type ResearchStrategy =
  | 'web-search'
  | 'web-fetch'
  | 'code-grep'
  | 'doc-read'
  | 'ask-user'
  | 'memory-lookup'
  | 'experiment'
  | 'hybrid';

export type ResearchSourceKind =
  | 'url'
  | 'file'
  | 'docs'
  | 'user-message'
  | 'semantic-memory'
  | 'episodic-memory'
  | 'experiment-output';

export type ResearchSource = {
  id: string;
  kind: ResearchSourceKind;
  ref: string; // URL / file path / memory id / etc.
  excerpt?: string; // short quote, if worth caching
  accessedAt: string;
  relevance: number; // 0–1
};

export type ResearchFinding = {
  id: string;
  statement: string;
  confidence: number; // 0–1
  supportingSourceIds: string[];
  contradictingSourceIds?: string[];
  promotedToSemanticMemoryId?: string; // if this finding became a persistent fact
};

export type ResearchGap = {
  id: string;
  question: string;
  reason: string; // why we could not answer it
  deferredUntil?: string; // ISO-date or phase/plan id pointer
};

export type Research = {
  id: string;
  workerId?: string;
  projectId?: string;
  planPhaseId?: string;
  taskId?: string;
  question: string; // the inquiry itself
  strategy: ResearchStrategy;
  status: ResearchStatus;
  sources: ResearchSource[];
  findings: ResearchFinding[];
  gaps?: ResearchGap[];
  summary?: string; // one-paragraph takeaway
  startedAt: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
};

export const researchMockData: Research[] = [
  {
    id: 'research_datashapes_doc_survey',
    workerId: 'worker_sup_01',
    projectId: 'proj_reactjit_carts',
    planPhaseId: 'phase_planning_and_tasks',
    question:
      'What does datashapes.md cover, and which parts are worth pulling into the gallery vs. skipping as enterprise cruft?',
    strategy: 'doc-read',
    status: 'complete',
    sources: [
      {
        id: 'src_ds_toc',
        kind: 'file',
        ref: '/home/siah/creative/reactjit/datashapes.md#table-of-contents',
        excerpt:
          '14 chapters: identity, memory, workspace, conversation, planning, research, design, parallelism, artifacts, temporal, inter-agent, events, governance, cross-cutting.',
        accessedAt: '2026-04-24T09:15:00Z',
        relevance: 1.0,
      },
      {
        id: 'src_ds_chapter_1',
        kind: 'file',
        ref: '/home/siah/creative/reactjit/datashapes.md#chapter-1',
        excerpt: 'Actor / Agent / User / Persona / Skill / CapabilityFingerprint / RoleAssignment',
        accessedAt: '2026-04-24T09:16:00Z',
        relevance: 0.9,
      },
      {
        id: 'src_ds_chapter_8',
        kind: 'file',
        ref: '/home/siah/creative/reactjit/datashapes.md#chapter-8',
        excerpt:
          'Workstream / ExecutionSession / SessionFork / ForkSpec / MergeConflict / Barrier / ConcurrencyPolicy',
        accessedAt: '2026-04-24T09:17:00Z',
        relevance: 0.75,
      },
    ],
    findings: [
      {
        id: 'find_memory_tier_split',
        statement:
          'Splitting memory into working / episodic / semantic / procedural tiers is a genuine upgrade over a single agent-memory.ts — worth pulling in, coexisting with the simple version.',
        confidence: 0.9,
        supportingSourceIds: ['src_ds_toc', 'src_ds_chapter_1'],
      },
      {
        id: 'find_skip_design_chapter',
        statement:
          'Chapter 7 (DesignDoc / Wireframe / VisualSpec / DesignReview / ApprovalStatus) is a full PM tool and out of scope for a single-user agentic workspace.',
        confidence: 0.95,
        supportingSourceIds: ['src_ds_toc'],
      },
      {
        id: 'find_workspace_first_class',
        statement:
          'Making Workspace / Project first-class instead of using raw paths as scope-target-ids fixes several dangling references cleanly.',
        confidence: 1.0,
        supportingSourceIds: ['src_ds_chapter_8'],
        promotedToSemanticMemoryId: undefined,
      },
      {
        id: 'find_skip_trust_scores',
        statement:
          'Trust scores at every level (Actor, Agent, DelegationGraph, Skill proficiency) are enterprise-marketplace features; noise for a single-user tool.',
        confidence: 0.85,
        supportingSourceIds: ['src_ds_chapter_1'],
      },
    ],
    gaps: [
      {
        id: 'gap_event_system_integration',
        question:
          'How should a generic Event shape (chapter 12) relate to our existing worker-event.ts (provider-event-normalized)?',
        reason: 'Deferred to Phase 4 — need to decide whether to keep both or fold worker-event into the generic Event with a provider-event subtype.',
        deferredUntil: 'phase_events_and_hooks',
      },
    ],
    summary:
      'Keep most of Chapters 1, 2, 3, 5, 8, 12. Skip Chapters 6 (research-as-subsystem), 7 (design PM), and 13 (full governance). Do not pull trust-score or self-modification concepts.',
    startedAt: '2026-04-24T09:15:00Z',
    endedAt: '2026-04-24T09:20:00Z',
    createdAt: '2026-04-24T09:15:00Z',
    updatedAt: '2026-04-24T09:20:00Z',
    tags: ['doc-review', 'scope-curation'],
  },
  {
    id: 'research_kimi_wire_drift',
    workerId: 'worker_sub_02',
    projectId: 'proj_reactjit_carts',
    taskId: undefined,
    question: 'Is the Kimi streaming wire format similar enough to Codex\'s to fold into one raw-event shape?',
    strategy: 'doc-read',
    status: 'complete',
    sources: [
      {
        id: 'src_kimi_docs',
        kind: 'url',
        ref: 'https://platform.moonshot.cn/docs/api/chat',
        accessedAt: '2026-04-24T09:05:00Z',
        relevance: 1.0,
      },
      {
        id: 'src_openai_stream',
        kind: 'url',
        ref: 'https://platform.openai.com/docs/api-reference/chat/streaming',
        accessedAt: '2026-04-24T09:05:30Z',
        relevance: 0.9,
      },
    ],
    findings: [
      {
        id: 'find_kimi_drift',
        statement:
          'Kimi\'s partial-JSON tool-call encoding differs enough from OpenAI\'s that a shared raw-event file would require per-provider branches in every adapter rule.',
        confidence: 0.85,
        supportingSourceIds: ['src_kimi_docs', 'src_openai_stream'],
      },
      {
        id: 'find_kimi_status_frame',
        statement: 'Kimi emits a mid-stream status frame that OpenAI does not. Real capability difference.',
        confidence: 0.95,
        supportingSourceIds: ['src_kimi_docs'],
      },
    ],
    summary: 'Give Kimi its own raw-event file and adapter row; do not fold with Codex.',
    startedAt: '2026-04-24T09:05:00Z',
    endedAt: '2026-04-24T09:20:00Z',
    createdAt: '2026-04-24T09:05:00Z',
    updatedAt: '2026-04-24T09:20:00Z',
    tags: ['adapters', 'kimi', 'wire-format'],
  },
];

export const researchSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Research',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'question',
      'strategy',
      'status',
      'sources',
      'findings',
      'startedAt',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      workerId: { type: 'string' },
      projectId: { type: 'string' },
      planPhaseId: { type: 'string' },
      taskId: { type: 'string' },
      question: { type: 'string' },
      strategy: {
        type: 'string',
        enum: [
          'web-search',
          'web-fetch',
          'code-grep',
          'doc-read',
          'ask-user',
          'memory-lookup',
          'experiment',
          'hybrid',
        ],
      },
      status: { type: 'string', enum: ['active', 'complete', 'abandoned', 'archived'] },
      summary: { type: 'string' },
      startedAt: { type: 'string' },
      endedAt: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind', 'ref', 'accessedAt', 'relevance'],
          properties: {
            id: { type: 'string' },
            kind: {
              type: 'string',
              enum: ['url', 'file', 'docs', 'user-message', 'semantic-memory', 'episodic-memory', 'experiment-output'],
            },
            ref: { type: 'string' },
            excerpt: { type: 'string' },
            accessedAt: { type: 'string' },
            relevance: { type: 'number' },
          },
        },
      },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'statement', 'confidence', 'supportingSourceIds'],
          properties: {
            id: { type: 'string' },
            statement: { type: 'string' },
            confidence: { type: 'number' },
            supportingSourceIds: { type: 'array', items: { type: 'string' } },
            contradictingSourceIds: { type: 'array', items: { type: 'string' } },
            promotedToSemanticMemoryId: { type: 'string' },
          },
        },
      },
      gaps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'question', 'reason'],
          properties: {
            id: { type: 'string' },
            question: { type: 'string' },
            reason: { type: 'string' },
            deferredUntil: { type: 'string' },
          },
        },
      },
    },
  },
};

export const researchReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Worker',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'workerId',
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
    label: 'Planning phase',
    targetSource: 'cart/app/gallery/data/planning-phase.ts',
    sourceField: 'planPhaseId',
    targetField: 'id',
    summary: 'Discovery-kind phases typically carry one or more Research rows.',
  },
  {
    kind: 'references',
    label: 'Task',
    targetSource: 'cart/app/gallery/data/task.ts',
    sourceField: 'taskId',
    targetField: 'id',
    summary: 'Tasks with kind=research attach back to their Research row.',
  },
  {
    kind: 'references',
    label: 'Promoted findings → Semantic memory',
    targetSource: 'cart/app/gallery/data/semantic-memory.ts',
    sourceField: 'findings[].promotedToSemanticMemoryId',
    targetField: 'id',
    summary: 'When a finding crosses confidence + reinforcement thresholds it promotes to a SemanticMemory entry.',
  },
];
