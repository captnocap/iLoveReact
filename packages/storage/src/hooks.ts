/**
 * React hooks for storage and CRUD operations.
 *
 * useCRUD() — Full CRUD interface for a collection with schema validation.
 * useStorage() — Low-level access to the storage adapter.
 * StorageProvider — Context provider for the default adapter.
 */

import React, { createContext, useContext, useCallback, useState, useEffect, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { StorageAdapter, CRUDHandle, CRUDOptions, Query } from './types';
import type { Schema } from './schema';
import { createMigratingAdapter } from './migrations';

// ── ID generation ───────────────────────────────────────

let counter = 0;
function generateId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const seq = (counter++).toString(36);
  return `${now}-${rand}-${seq}`;
}

// ── Storage context ─────────────────────────────────────

const StorageContext = createContext<StorageAdapter | null>(null);

export function StorageProvider({
  adapter,
  children,
}: {
  adapter: StorageAdapter;
  children: ReactNode;
}) {
  return React.createElement(StorageContext.Provider, { value: adapter }, children);
}

export function useStorage(): StorageAdapter {
  const adapter = useContext(StorageContext);
  if (!adapter) {
    throw new Error('useStorage must be used within a <StorageProvider>');
  }
  return adapter;
}

// ── useCRUD hook ────────────────────────────────────────

export function useCRUD<T extends Record<string, any>>(
  collection: string,
  schema: Schema<T>,
  options?: CRUDOptions,
): CRUDHandle<T> {
  const contextAdapter = useContext(StorageContext);
  const baseAdapter = options?.adapter ?? contextAdapter;

  if (!baseAdapter) {
    throw new Error(
      'useCRUD requires a storage adapter. Either wrap your app in <StorageProvider> ' +
      'or pass { adapter } in options.'
    );
  }

  // Wrap adapter with migration logic if configured
  const adapter = useMemo(() => {
    if (options?.migrations) {
      return createMigratingAdapter(
        baseAdapter,
        options.migrations,
        options.autoMigrate ?? false,
      );
    }
    return baseAdapter;
  }, [baseAdapter, options?.migrations, options?.autoMigrate]);

  // ── CRUD methods ────────────────────────────────────

  const create = useCallback(async (data: T): Promise<string> => {
    const validated = schema.parse(data);
    const id = (validated as any).id ?? generateId();
    const record = { ...validated, id };
    await adapter.set(collection, id, record);
    return id;
  }, [adapter, collection, schema]);

  const get = useCallback(async (id: string): Promise<T | null> => {
    const data = await adapter.get(collection, id);
    if (!data) return null;
    return schema.parse(data);
  }, [adapter, collection, schema]);

  const update = useCallback(async (id: string, partial: Partial<T>): Promise<void> => {
    const existing = await adapter.get(collection, id);
    if (!existing) throw new Error(`Not found: ${collection}/${id}`);
    const merged = { ...existing, ...partial };
    const validated = schema.parse(merged);
    await adapter.set(collection, id, validated);
  }, [adapter, collection, schema]);

  const del = useCallback(async (id: string): Promise<void> => {
    await adapter.delete(collection, id);
  }, [adapter, collection]);

  const list = useCallback(async (query?: Query): Promise<T[]> => {
    const items = await adapter.list(collection, query);
    return items.map(item => schema.parse(item));
  }, [adapter, collection, schema]);

  // ── Reactive query hooks ────────────────────────────

  const useQuery = (id: string) => {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [version, setVersion] = useState(0);

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);

      get(id)
        .then(result => {
          if (!cancelled) setData(result);
        })
        .catch(err => {
          if (!cancelled) setError(err);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => { cancelled = true; };
    }, [id, version]);

    const refetch = useCallback(() => setVersion(v => v + 1), []);

    return { data, loading, error, refetch };
  };

  const useListQuery = (query?: Query) => {
    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [version, setVersion] = useState(0);
    const queryRef = useRef(query);
    queryRef.current = query;

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);

      list(queryRef.current)
        .then(result => {
          if (!cancelled) setData(result);
        })
        .catch(err => {
          if (!cancelled) setError(err);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => { cancelled = true; };
    }, [version]);

    const refetch = useCallback(() => setVersion(v => v + 1), []);

    return { data, loading, error, refetch };
  };

  return {
    create,
    get,
    update,
    delete: del,
    list,
    useQuery,
    useListQuery,
  };
}
