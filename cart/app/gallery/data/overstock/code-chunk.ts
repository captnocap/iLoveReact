// CodeChunk — a window of source code from one file, materialized as a
// retrievable row. The embeddable unit of code.
//
// Distinct from code-snippet.ts (display-time concern; renders in the
// gallery with syntax highlighting and emphasis lines) and code-line.ts
// (one row per rendered line of a snippet, also display-tier). CodeChunk
// is the *retrieval-tier* shape — it exists so the agent can vector-
// search its own codebase.
//
// Why per-file windows, not per-symbol or per-line: tree-sitter symbol-
// aware chunking is the eventual win, but it requires per-language
// parsers and adds a heavy dependency. 200-line windows with 50-line
// overlap are good enough as a baseline; chunkingStrategy records which
// approach produced this row so re-indexing can target one at a time.
//
// What gets embedded: displayText prepends a constructed header
// ('// File: cart/x.ts\n// Symbols: foo, bar\n') before the raw line
// range. The path and symbol names act as a soft category embedding —
// they leak file-level context into the vector without inflating the
// chunk much. fileMtime + contentHash drive re-embed decisions when the
// file changes on disk.

import type { GalleryDataReference, JsonObject } from '../../types';

export type CodeChunkLanguage =
  | 'typescript'
  | 'javascript'
  | 'tsx'
  | 'jsx'
  | 'zig'
  | 'lua'
  | 'python'
  | 'rust'
  | 'go'
  | 'c'
  | 'cpp'
  | 'json'
  | 'yaml'
  | 'markdown'
  | 'shell'
  | 'css'
  | 'html'
  | 'unknown';

export type CodeChunkChunkingStrategy =
  | 'lines-200-overlap-50' // default — fixed-line window
  | 'lines-400-overlap-100' // wider window for sparse files
  | 'symbol-aware' // tree-sitter, one chunk per top-level symbol
  | 'function-boundary' // one chunk per function / method
  | 'file-whole'; // small files indexed as a single chunk

export type CodeChunk = {
  id: string;
  workspaceId?: string;
  projectId?: string;
  /** Anchor for multi-repo indexes. Absolute path. */
  repoRoot: string;
  /** Path relative to repoRoot, forward-slashes always. */
  filePath: string;
  language: CodeChunkLanguage;
  chunkIndex: number;
  chunkingStrategy: CodeChunkChunkingStrategy;
  startLine: number;
  endLine: number;
  /**
   * The exact string fed to the embedder. Includes constructed prefix:
   *   // File: <filePath>
   *   // Symbols: <comma-separated symbol names>
   * followed by the raw line range. Path + symbols leak file-level
   * context into the vector.
   */
  displayText: string;
  /** Short clip surfaced in result lists. */
  textPreview: string;
  /** Symbols extracted from this range (functions, classes, exports). */
  symbolNames: string[];
  /** sha256 of displayText. */
  contentHash: string;
  tokenCount: number;
  /** mtime of the source file at index time, ms since epoch. */
  fileMtime: number;
  /** Optional git blob sha for time-travel queries. */
  gitBlobSha?: string;
  createdAt: string;
};

export const codeChunkMockData: CodeChunk[] = [
  {
    id: 'cc_runtime_useHotState_0_200',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_runtime',
    repoRoot: '/home/siah/creative/reactjit',
    filePath: 'runtime/hooks/useHotState.ts',
    language: 'typescript',
    chunkIndex: 0,
    chunkingStrategy: 'lines-200-overlap-50',
    startLine: 1,
    endLine: 162,
    displayText:
      '// File: runtime/hooks/useHotState.ts\n' +
      '// Symbols: useHotState, getSlotKey, rebuildSlotCache\n' +
      '\n' +
      'import { __hot_get_slot, __hot_set_slot } from \'../host\';\n' +
      '// … 160 more lines …',
    textPreview: 'useHotState — slot cache keyed on component identity; remount invalidates',
    symbolNames: ['useHotState', 'getSlotKey', 'rebuildSlotCache'],
    contentHash: 'sha256:c3d4e5f60718293a4b5c6d7e8f9001122',
    tokenCount: 1480,
    fileMtime: 1714005720000,
    gitBlobSha: '4f5e6d7c8b9a0a1b2c3d4e5f6071829304a5b6c7',
    createdAt: '2026-04-24T08:00:00Z',
  },
  {
    id: 'cc_framework_hotstate_0_200',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_runtime',
    repoRoot: '/home/siah/creative/reactjit',
    filePath: 'framework/hotstate.zig',
    language: 'zig',
    chunkIndex: 0,
    chunkingStrategy: 'lines-200-overlap-50',
    startLine: 1,
    endLine: 198,
    displayText:
      '// File: framework/hotstate.zig\n' +
      '// Symbols: SlotMap, ensureSlot, dropStaleSlots\n' +
      '\n' +
      'const std = @import("std");\n' +
      '// … 196 more lines …',
    textPreview: 'hotstate.zig — SlotMap rebuild on hot reload; ensureSlot does not preserve stable ids',
    symbolNames: ['SlotMap', 'ensureSlot', 'dropStaleSlots'],
    contentHash: 'sha256:71829304a5b6c7d8e9f0a1b2c3d4e5f6',
    tokenCount: 2340,
    fileMtime: 1713920000000,
    gitBlobSha: '8b7a6c5d4e3f201928374650a1b2c3d4e5f60718',
    createdAt: '2026-04-24T08:00:00Z',
  },
  {
    id: 'cc_cart_gallery_data_index_0_200',
    workspaceId: 'ws_reactjit',
    projectId: 'proj_reactjit_carts',
    repoRoot: '/home/siah/creative/reactjit',
    filePath: 'cart/app/gallery/data/embedding.ts',
    language: 'typescript',
    chunkIndex: 0,
    chunkingStrategy: 'lines-200-overlap-50',
    startLine: 1,
    endLine: 213,
    displayText:
      '// File: cart/app/gallery/data/embedding.ts\n' +
      '// Symbols: Embedding, EmbeddingEntityKind, embeddingMockData\n' +
      '\n' +
      '// Embedding — sidecar vector row. Polymorphic on (entityKind, entityId)…',
    textPreview: 'Embedding sidecar polymorphic on (entityKind, entityId, fieldPath, embeddingModelId)',
    symbolNames: ['Embedding', 'EmbeddingEntityKind', 'embeddingMockData', 'embeddingSchema'],
    contentHash: 'sha256:e5f60718293a4b5c6d7e8f9001122334',
    tokenCount: 1980,
    fileMtime: 1714005900000,
    createdAt: '2026-04-25T09:00:00Z',
  },
];

export const codeChunkSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CodeChunk',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'repoRoot',
      'filePath',
      'language',
      'chunkIndex',
      'chunkingStrategy',
      'startLine',
      'endLine',
      'displayText',
      'textPreview',
      'symbolNames',
      'contentHash',
      'tokenCount',
      'fileMtime',
      'createdAt',
    ],
    properties: {
      id: { type: 'string' },
      workspaceId: { type: 'string' },
      projectId: { type: 'string' },
      repoRoot: { type: 'string' },
      filePath: { type: 'string' },
      language: {
        type: 'string',
        enum: [
          'typescript',
          'javascript',
          'tsx',
          'jsx',
          'zig',
          'lua',
          'python',
          'rust',
          'go',
          'c',
          'cpp',
          'json',
          'yaml',
          'markdown',
          'shell',
          'css',
          'html',
          'unknown',
        ],
      },
      chunkIndex: { type: 'number' },
      chunkingStrategy: {
        type: 'string',
        enum: [
          'lines-200-overlap-50',
          'lines-400-overlap-100',
          'symbol-aware',
          'function-boundary',
          'file-whole',
        ],
      },
      startLine: { type: 'number' },
      endLine: { type: 'number' },
      displayText: { type: 'string' },
      textPreview: { type: 'string' },
      symbolNames: { type: 'array', items: { type: 'string' } },
      contentHash: { type: 'string' },
      tokenCount: { type: 'number' },
      fileMtime: { type: 'number' },
      gitBlobSha: { type: 'string' },
      createdAt: { type: 'string' },
    },
  },
};

export const codeChunkReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Workspace / project',
    targetSource: 'cart/app/gallery/data/workspace.ts',
    sourceField: 'workspaceId / projectId',
    targetField: 'id',
    summary:
      'Denormalized for retrieval-time filtering. A multi-repo workspace can host code chunks from several projects.',
  },
  {
    kind: 'has-many',
    label: 'Embeddings',
    targetSource: 'cart/app/gallery/data/embedding.ts',
    sourceField: 'id',
    targetField: '(entityKind="code-chunk", entityId=id)',
    summary:
      'One Embedding row per (chunk, embeddingModelId). Code-specialist models (jina-code-v2, voyage-code-3) and general embedders can coexist on the same chunk.',
  },
  {
    kind: 'references',
    label: 'Source file (filesystem anchor)',
    targetSource: '(filesystem)',
    sourceField: 'repoRoot + filePath',
    targetField: '(absolute path on disk)',
    summary:
      'Not a row-level FK — the chunk traces back to a real file. fileMtime + contentHash detect when the file has changed and the chunk needs re-embedding.',
  },
  {
    kind: 'references',
    label: 'Display-tier code-snippet (loose)',
    targetSource: 'cart/app/gallery/data/code-snippet.ts',
    sourceField: '(none)',
    targetField: 'id',
    summary:
      'CodeChunk and CodeSnippet are intentionally separate. CodeChunk is for retrieval (search the codebase); CodeSnippet is for display (render syntax-highlighted blocks in stories). They may share content but their lifecycles and indexes are different.',
  },
];
