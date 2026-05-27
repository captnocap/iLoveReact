import { useCallback, useEffect, useMemo, useState } from 'react';
import { hasHost } from '../ffi';
import { useLatest } from './useLatest';
import { useAsyncResource } from './useAsyncResource';
import { nsDelete, nsGet, nsHas, nsKeys, nsSet } from './localstore';

type ComparisonOp = '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$contains';
type WhereClause = Record<string, any | Partial<Record<ComparisonOp, any>>>;

type Query = {
  where?: WhereClause;
  orderBy?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

type MigrationFn = (data: any) => any;

type Schema<T> = {
  parse(value: unknown): T;
};

type CRUDResult<T> = {
  create(data: T): Promise<string>;
  get(id: string): Promise<T | null>;
  update(id: string, partial: Partial<T>): Promise<void>;
  delete(id: string): Promise<void>;
  list(query?: Query): Promise<T[]>;
  useQuery(id: string): { data: T | null; loading: boolean; error: Error | null; refetch: () => void };
  useListQuery(query?: Query): { data: T[]; loading: boolean; error: Error | null; refetch: () => void };
};

type UseCRUDOptions = {
  namespace?: string;
  migrations?: Record<number, MigrationFn>;
  autoMigrate?: boolean;
};

let counter = 0;
function generateId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const seq = (counter++).toString(36);
  return `${now}-${rand}-${seq}`;
}

function getLatestVersion(migrations?: Record<number, MigrationFn>): number {
  if (!migrations) return 0;
  const versions = Object.keys(migrations).map(Number).filter(n => !Number.isNaN(n));
  return versions.length > 0 ? Math.max(...versions) : 0;
}

function migrateRecord(data: any, migrations?: Record<number, MigrationFn>, autoMigrate = false): any {
  if (!autoMigrate || !migrations) return data;
  const currentVersion = data?._version ?? 0;
  const latestVersion = getLatestVersion(migrations);
  if (currentVersion >= latestVersion) return data;
  let migrated = { ...data };
  for (let v = currentVersion + 1; v <= latestVersion; v++) {
    const fn = migrations[v];
    if (fn) migrated = fn(migrated);
  }
  migrated._version = latestVersion;
  return migrated;
}

function stampVersion(data: any, migrations?: Record<number, MigrationFn>): any {
  const latestVersion = getLatestVersion(migrations);
  if (latestVersion === 0) return data;
  return { ...data, _version: latestVersion };
}

function stripVersion<T extends Record<string, any>>(data: T): T {
  if (!data || typeof data !== 'object') return data;
  if (!Object.prototype.hasOwnProperty.call(data, '_version')) return data;
  const rest = { ...(data as any) };
  delete rest._version;
  return rest as T;
}

function parseJson(raw: string): any | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function matchesWhere(item: any, where: WhereClause): boolean {
  for (const [field, condition] of Object.entries(where)) {
    const value = item[field];
    if (typeof condition !== 'object' || condition === null || condition instanceof Date) {
      if (value !== condition) return false;
      continue;
    }
    for (const [op, expected] of Object.entries(condition as Record<string, any>)) {
      switch (op) {
        case '$eq':
          if (value !== expected) return false;
          break;
        case '$ne':
          if (value === expected) return false;
          break;
        case '$gt':
          if (!(value > expected)) return false;
          break;
        case '$gte':
          if (!(value >= expected)) return false;
          break;
        case '$lt':
          if (!(value < expected)) return false;
          break;
        case '$lte':
          if (!(value <= expected)) return false;
          break;
        case '$in':
          if (!Array.isArray(expected) || !expected.includes(value)) return false;
          break;
        case '$contains':
          if (typeof value === 'string') {
            if (!value.includes(expected)) return false;
          } else if (Array.isArray(value)) {
            if (!value.includes(expected)) return false;
          } else {
            return false;
          }
          break;
      }
    }
  }
  return true;
}

function applyQuery<T>(items: T[], query?: Query): T[] {
  if (!query) return items;
  let result = items;
  if (query.where) {
    result = result.filter(item => matchesWhere(item, query.where!));
  }
  if (query.orderBy) {
    const field = query.orderBy;
    const dir = query.order === 'desc' ? -1 : 1;
    result = [...result].sort((a, b) => {
      const va = (a as any)[field];
      const vb = (b as any)[field];
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }
  if (query.offset) {
    result = result.slice(query.offset);
  }
  if (query.limit != null) {
    result = result.slice(0, query.limit);
  }
  return result;
}

export function useCRUD<T extends Record<string, any>>(
  collection: string,
  schema: Schema<T>,
  options?: UseCRUDOptions,
): CRUDResult<T> {
  const namespace = options?.namespace ?? 'crud';

  if (
    !hasHost('__localstoreGet') ||
    !hasHost('__localstoreHas') ||
    !hasHost('__localstoreSet') ||
    !hasHost('__localstoreDelete') ||
    !hasHost('__localstoreKeysJson')
  ) {
    throw new Error(
      'useCRUD requires V8 localstore host bindings (__localstoreGet/Has/Set/Delete/KeysJson).',
    );
  }

  const migrations = options?.migrations;
  const autoMigrate = options?.autoMigrate ?? false;
  const keyPrefix = useMemo(() => `${collection}:`, [collection]);

  const keyForId = useCallback((id: string) => `${keyPrefix}${id}`, [keyPrefix]);

  const readRecord = useCallback(async (id: string): Promise<any | null> => {
    if (!nsHas(namespace, keyForId(id))) return null;
    const raw = nsGet(namespace, keyForId(id));
    return parseJson(raw);
  }, [namespace, keyForId]);

  const writeRecord = useCallback(async (id: string, data: any): Promise<void> => {
    nsSet(namespace, keyForId(id), JSON.stringify(stampVersion(data, migrations)));
  }, [namespace, keyForId, migrations]);

  const create = useCallback(async (data: T): Promise<string> => {
    const validated = schema.parse(data);
    const id = (validated as any).id ?? generateId();
    const record = { ...validated, id };
    await writeRecord(id, record);
    return id;
  }, [schema, writeRecord]);

  const get = useCallback(async (id: string): Promise<T | null> => {
    const raw = await readRecord(id);
    if (!raw) return null;
    const migrated = migrateRecord(raw, migrations, autoMigrate);
    if (autoMigrate && migrated._version !== raw._version) {
      await writeRecord(id, migrated);
    }
    return schema.parse(stripVersion(migrated));
  }, [readRecord, schema, migrations, autoMigrate, writeRecord]);

  const update = useCallback(async (id: string, partial: Partial<T>): Promise<void> => {
    const currentRaw = await readRecord(id);
    if (!currentRaw) throw new Error(`Not found: ${collection}/${id}`);
    const current = schema.parse(stripVersion(migrateRecord(currentRaw, migrations, autoMigrate)));
    const merged = { ...current, ...partial, id };
    const validated = schema.parse(merged);
    await writeRecord(id, validated);
  }, [readRecord, schema, collection, migrations, autoMigrate, writeRecord]);

  const del = useCallback(async (id: string): Promise<void> => {
    nsDelete(namespace, keyForId(id));
  }, [namespace, keyForId]);

  const list = useCallback(async (query?: Query): Promise<T[]> => {
    const keys = nsKeys(namespace);
    const out: T[] = [];
    for (const key of keys) {
      if (!key.startsWith(keyPrefix)) continue;
      const id = key.slice(keyPrefix.length);
      const raw = await readRecord(id);
      if (!raw) continue;
      const migrated = migrateRecord(raw, migrations, autoMigrate);
      if (autoMigrate && migrated._version !== raw._version) {
        await writeRecord(id, migrated);
      }
      out.push(schema.parse(stripVersion(migrated)));
    }
    return applyQuery(out, query);
  }, [namespace, keyPrefix, readRecord, schema, migrations, autoMigrate, writeRecord]);

  const useQuery = (id: string) => useAsyncResource<T | null>(() => get(id), [id]);

  const useListQuery = (query?: Query) => {
    const queryRef = useLatest(query);
    return useAsyncResource<T[]>(() => list(queryRef.current), []);
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
