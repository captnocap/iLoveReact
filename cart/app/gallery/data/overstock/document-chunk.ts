// DocumentChunk — a section of an arbitrary document, materialized as a
// retrievable row. The embeddable unit of "varying other documents over
// time" — markdown notes, web archives, PDF extracts, transcripts,
// research dumps. Anything that is not chat history (chat-log-chunk),
// not source code (code-chunk), and not a curated memory tier
// (semantic / episodic / procedural / agent-memory).
//
// Why a separate shape from code-chunk: prose chunks naturally split on
// markdown headers, paragraph boundaries, or fixed token windows — line
// numbers do not generalize to PDFs or web archives. Document chunks
// also carry a header path (h1 → h2 → h3) which prose retrieval relies
// on heavily, while code chunks rely on symbol names instead.
//
// Why a separate shape from semantic-memory: semantic-memory is a
// *curated* fact (statement + rationale + confidence + reinforcement).
// DocumentChunk is the raw source material that may *eventually*
// contribute to semantic memory through consolidation. The agent
// searches DocumentChunk to find context; it cites SemanticMemory to
// state knowledge.
//
// What gets embedded: displayText prepends a constructed header
// ('# Title\n# Section: H1 > H2 > H3\n') before the body. The header
// trail leaks document-level context into the vector. textPreview is a
// short clip used in result lists.

import type { GalleryDataReference, JsonObject } from '../../types';

export type DocumentChunkFormat =
  | 'markdown'
  | 'plain-text'
  | 'html'
  | 'pdf-extract'
  | 'web-archive'
  | 'transcript'
  | 'unknown';

export type DocumentChunkChunkingStrategy =
  | 'markdown-headers' // split on H1/H2/H3, cap at 500 tokens
  | 'paragraphs-500' // paragraph-aware, 500-token cap, 100-token overlap
  | 'fixed-tokens-500' // dumb 500-token windows for malformed sources
  | 'whole-document'; // single chunk for short docs

export type DocumentChunk = {
  id: string;
  /** Owning user. Documents may be user-wide (notes) or workspace-scoped. */
  userId: string;
  workspaceId?: string;
  /**
   * Pointer to the source document. file://, https://, or an opaque
   * scheme (claude://session/<id>/export, etc.).
   */
  sourceUri: string;
  /** Document-level title. Falls back to filename / URL host. */
  title: string;
  format: DocumentChunkFormat;
  chunkIndex: number;
  chunkingStrategy: DocumentChunkChunkingStrategy;
  /**
   * Header trail — h1, h2, h3, ... — for this section. Empty for
   * documents without structure (plain-text, transcript).
   */
  headerPath: string[];
  /**
   * The exact string fed to the embedder. Includes constructed prefix:
   *   # <title>
   *   # Section: <headerPath joined by ' > '>
   * followed by the raw section body.
   */
  displayText: string;
  /** Short clip surfaced in result lists. */
  textPreview: string;
  /** sha256 of displayText. */
  contentHash: string;
  tokenCount: number;
  /** When the source was first ingested into the index. */
  addedAt: string;
  /** When the source was last fetched / re-extracted. */
  sourceFetchedAt: string;
  tags?: string[];
};

export const documentChunkMockData: DocumentChunk[] = [
  {
    id: 'doc_claude_md_root_0',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    sourceUri: 'file:///home/siah/creative/reactjit/CLAUDE.md',
    title: 'CLAUDE.md (reactjit)',
    format: 'markdown',
    chunkIndex: 0,
    chunkingStrategy: 'markdown-headers',
    headerPath: ['HARD RULE: V8 IS THE DEFAULT RUNTIME'],
    displayText:
      '# CLAUDE.md (reactjit)\n' +
      '# Section: HARD RULE: V8 IS THE DEFAULT RUNTIME\n' +
      '\n' +
      'The default JS runtime is V8 (embedded via zig-v8). scripts/ship builds V8. --qjs is legacy opt-in. --jsrt is the LuaJIT evaluator alternate path.\n' +
      'The "V8 has baggage" myth is fake. The baggage is Chromium (~200MB CEF), not V8 itself (~6MB standalone). We measured it.',
    textPreview: 'V8 is default; --qjs is legacy; the "V8 has baggage" myth is wrong — baggage is Chromium, not V8.',
    contentHash: 'sha256:0a1b2c3d4e5f60718293a4b5c6d7e8f9',
    tokenCount: 132,
    addedAt: '2026-04-18T00:00:00Z',
    sourceFetchedAt: '2026-04-25T09:00:00Z',
    tags: ['claude-md', 'runtime-policy'],
  },
  {
    id: 'doc_qwen3_embed_paper_0',
    userId: 'user_local',
    sourceUri: 'https://arxiv.org/abs/2509.qwen3-embedding-tech-report',
    title: 'Qwen3-Embedding Technical Report',
    format: 'pdf-extract',
    chunkIndex: 0,
    chunkingStrategy: 'paragraphs-500',
    headerPath: ['Abstract'],
    displayText:
      '# Qwen3-Embedding Technical Report\n' +
      '# Section: Abstract\n' +
      '\n' +
      'We present Qwen3-Embedding, a family of text embedding models built on the Qwen3 base, available at 0.6B, 4B, and 8B parameter scales. The models support 1024-dimensional outputs with matryoshka truncation to 128/256/512/768 dimensions, multilingual coverage, and a 32k-token input window…',
    textPreview:
      'Qwen3-Embedding family: 0.6B / 4B / 8B at 1024-dim with matryoshka truncation, 32k context, multilingual.',
    contentHash: 'sha256:9f8e7d6c5b4a39281706f5e4d3c2b1a0',
    tokenCount: 412,
    addedAt: '2026-04-26T12:00:00Z',
    sourceFetchedAt: '2026-04-26T12:00:00Z',
    tags: ['embedding', 'reference', 'qwen'],
  },
  {
    id: 'doc_jsrt_target_md_3',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    sourceUri: 'file:///home/siah/creative/reactjit/framework/lua/jsrt/TARGET.md',
    title: 'JSRT TARGET (13 milestones)',
    format: 'markdown',
    chunkIndex: 3,
    chunkingStrategy: 'markdown-headers',
    headerPath: ['Milestones', '04 — Closures + Lexical Scope'],
    displayText:
      '# JSRT TARGET (13 milestones)\n' +
      '# Section: Milestones > 04 — Closures + Lexical Scope\n' +
      '\n' +
      'Closures must capture by reference, not by value. The evaluator implements lexical scope via an environment-record chain; nested function definitions snapshot the parent chain on creation, not on call.',
    textPreview:
      'JSRT milestone 04: closures capture by reference; environment-record chain snapshotted on definition.',
    contentHash: 'sha256:5e6d7c8b9a0a1b2c3d4e5f6071829304',
    tokenCount: 218,
    addedAt: '2026-04-21T00:00:00Z',
    sourceFetchedAt: '2026-04-25T09:00:00Z',
    tags: ['jsrt', 'milestone', 'target-md'],
  },
];

export const documentChunkSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'DocumentChunk',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'userId',
      'sourceUri',
      'title',
      'format',
      'chunkIndex',
      'chunkingStrategy',
      'headerPath',
      'displayText',
      'textPreview',
      'contentHash',
      'tokenCount',
      'addedAt',
      'sourceFetchedAt',
    ],
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      workspaceId: { type: 'string' },
      sourceUri: { type: 'string' },
      title: { type: 'string' },
      format: {
        type: 'string',
        enum: ['markdown', 'plain-text', 'html', 'pdf-extract', 'web-archive', 'transcript', 'unknown'],
      },
      chunkIndex: { type: 'number' },
      chunkingStrategy: {
        type: 'string',
        enum: ['markdown-headers', 'paragraphs-500', 'fixed-tokens-500', 'whole-document'],
      },
      headerPath: { type: 'array', items: { type: 'string' } },
      displayText: { type: 'string' },
      textPreview: { type: 'string' },
      contentHash: { type: 'string' },
      tokenCount: { type: 'number' },
      addedAt: { type: 'string' },
      sourceFetchedAt: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
};

export const documentChunkReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'User',
    targetSource: 'cart/app/gallery/data/user.ts',
    sourceField: 'userId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Workspace (optional)',
    targetSource: 'cart/app/gallery/data/workspace.ts',
    sourceField: 'workspaceId',
    targetField: 'id',
    summary: 'Null = user-wide document (a paper, a personal note). Set = workspace-scoped (project README, internal doc).',
  },
  {
    kind: 'has-many',
    label: 'Embeddings',
    targetSource: 'cart/app/gallery/data/embedding.ts',
    sourceField: 'id',
    targetField: '(entityKind="document-chunk", entityId=id)',
    summary: 'One Embedding row per (chunk, embeddingModelId).',
  },
  {
    kind: 'references',
    label: 'Source document (URI anchor)',
    targetSource: '(external — file:// or https:// or opaque scheme)',
    sourceField: 'sourceUri',
    targetField: '(URI)',
    summary:
      'sourceFetchedAt records when the URI was last fetched / extracted. A drift-detection job can re-fetch and re-chunk when the upstream document changes.',
  },
  {
    kind: 'references',
    label: 'Promotes to semantic memory',
    targetSource: 'cart/app/gallery/data/semantic-memory.ts',
    sourceField: '(consolidation)',
    targetField: 'statement',
    summary:
      'A reading / consolidation pass can extract durable facts from documents into semantic memory entries. Not a row-level FK — the relationship is "this chunk contributed to this fact."',
  },
];
