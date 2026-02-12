/**
 * createCRUD — Non-React CRUD interface.
 *
 * Same schema validation, ID generation, and migration support
 * as useCRUD, but works in plain scripts, CLI tools, and backends
 * without any React dependency.
 *
 * Usage:
 *   import { createCRUD, z, MemoryAdapter } from '@ilovereact/storage';
 *
 *   const Notes = createCRUD('notes', z.object({
 *     id: z.string(),
 *     title: z.string(),
 *     body: z.string(),
 *   }), new MemoryAdapter());
 *
 *   await Notes.create({ id: 'n1', title: 'Hello', body: 'World' });
 *   const all = await Notes.list();
 */

import type { StorageAdapter, Query, MigrationFn } from './types';
import type { Schema } from './schema';
import { createMigratingAdapter } from './migrations';

// ── ID generation (shared with hooks.ts) ─────────────────

let counter = 0;
function generateId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const seq = (counter++).toString(36);
  return `${now}-${rand}-${seq}`;
}

// ── CRUD handle type (no React hooks) ────────────────────

export interface CRUDMethods<T> {
  create(data: T): Promise<string>;
  get(id: string): Promise<T | null>;
  update(id: string, partial: Partial<T>): Promise<void>;
  delete(id: string): Promise<void>;
  list(query?: Query): Promise<T[]>;
}

export interface CreateCRUDOptions {
  migrations?: Record<number, MigrationFn>;
  autoMigrate?: boolean;
}

// ── createCRUD ───────────────────────────────────────────

export function createCRUD<T extends Record<string, any>>(
  collection: string,
  schema: Schema<T>,
  adapter: StorageAdapter,
  options?: CreateCRUDOptions,
): CRUDMethods<T> {
  let store = adapter;

  if (options?.migrations && Object.keys(options.migrations).length > 0) {
    store = createMigratingAdapter(store, options.migrations, options.autoMigrate ?? false);
  }

  return {
    async create(data: T): Promise<string> {
      const validated = schema.parse(data);
      const id = (validated as any).id ?? generateId();
      const record = { ...validated, id };
      await store.set(collection, id, record);
      return id;
    },

    async get(id: string): Promise<T | null> {
      const data = await store.get(collection, id);
      if (!data) return null;
      return schema.parse(data);
    },

    async update(id: string, partial: Partial<T>): Promise<void> {
      const existing = await store.get(collection, id);
      if (!existing) throw new Error(`Not found: ${collection}/${id}`);
      const merged = { ...existing, ...partial };
      const validated = schema.parse(merged);
      await store.set(collection, id, validated);
    },

    async delete(id: string): Promise<void> {
      await store.delete(collection, id);
    },

    async list(query?: Query): Promise<T[]> {
      const items = await store.list(collection, query);
      return items.map(item => schema.parse(item));
    },
  };
}
