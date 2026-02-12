// ── Schema (Zod-inspired) ───────────────────────────────
export { z, ValidationError, type Infer, type SafeParseResult } from './schema';
export type { Schema, ValidationIssue } from './schema';

// ── Hooks (React) ───────────────────────────────────────
export { useCRUD, useStorage, StorageProvider } from './hooks';

// ── Plain CRUD (no React) ───────────────────────────────
export { createCRUD, type CRUDMethods, type CreateCRUDOptions } from './crud';

// ── Types ───────────────────────────────────────────────
export type {
  StorageAdapter,
  StorageFormat,
  Query,
  WhereClause,
  ComparisonOp,
  MigrationFn,
  MigrationConfig,
  CRUDHandle,
  CRUDOptions,
} from './types';

// ── Adapters ────────────────────────────────────────────
export { MemoryAdapter } from './adapters/memory';
export { Love2DFileAdapter, type Love2DFileAdapterOptions } from './adapters/love2d-files';
export { TerminalSQLiteAdapter, type TerminalSQLiteOptions } from './adapters/terminal-sqlite';
export { LocalStorageAdapter, IndexedDBAdapter } from './adapters/web';

// ── Format utilities ────────────────────────────────────
export { parseContent, serializeContent, formatExtension, detectFormat } from './format';

// ── Query engine ────────────────────────────────────────
export { applyQuery } from './query';

// ── Migrations ──────────────────────────────────────────
export { createMigratingAdapter, migrateRecord, stampVersion, getLatestVersion } from './migrations';
