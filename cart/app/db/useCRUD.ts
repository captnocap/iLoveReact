// Postgres-backed useCRUD. Drop-in replacement for the runtime's
// localstore-backed version (runtime/hooks/useCRUD.ts). Same return
// shape, same call signatures — switching imports is sufficient.
//
// Storage model (interim): one JSONB-blob table per entity, with
// (id TEXT PK, data JSONB, created_at, updated_at). Filtering /
// ordering / pagination happen client-side after a SELECT — fine for
// the small config-grain entities (user, settings, character, …) that
// dominate today; entities that grow large (embeddings, chunks) will
// land on bespoke schemas with proper indexes in a follow-up.
//
// Param binding: framework/pg.zig:177 ignores paramsJson, so all SQL
// goes through cart/app/db/sql.ts escape helpers. Once param binding
// lands the SQL bodies here move to $1/$2 placeholders.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { changes, exec, query } from './connections';
import { ensureEntityTable } from './bootstrap';
import { bucketFor } from './registry';
import { ident, lit, tableName, val } from './sql';
import { notifyRowChange } from './buses';

// ── Public types (mirror runtime/hooks/useCRUD.ts) ────────────────────

type ComparisonOp = '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$contains';
type WhereClause = Record<string, any | Partial<Record<ComparisonOp, any>>>;

type Query = {
  where?: WhereClause;
  orderBy?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

type Schema<T> = { parse(value: unknown): T };

type UseCRUDOptions = {
  // Accepted for API parity with runtime's useCRUD. Currently ignored —
  // the JSONB-blob schema doesn't need version stamping the same way
  // the localstore version did. Bespoke per-entity schemas in a
  // follow-up will reintroduce migrations as proper SQL files under
  // cart/app/db/migrations/<bucket>/.
  namespace?: string;
  migrations?: Record<number, (data: any) => any>;
  autoMigrate?: boolean;
};

type CRUDResult<T> = {
  create(data: T): Promise<string>;
  get(id: string): Promise<T | null>;
  update(id: string, partial: Partial<T>): Promise<void>;
  delete(id: string): Promise<void>;
  list(q?: Query): Promise<T[]>;
  useQuery(id: string): { data: T | null; loading: boolean; error: Error | null; refetch: () => void };
  useListQuery(q?: Query): { data: T[]; loading: boolean; error: Error | null; refetch: () => void };
};

// ── ID generation (matches runtime) ───────────────────────────────────

let counter = 0;
function generateId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const seq = (counter++).toString(36);
  return `${now}-${rand}-${seq}`;
}

// ── Client-side filtering (matches runtime's matchesWhere) ────────────

function matchesWhere(item: any, where: WhereClause): boolean {
  for (const [field, condition] of Object.entries(where)) {
    const value = item[field];
    if (typeof condition !== 'object' || condition === null || condition instanceof Date) {
      if (value !== condition) return false;
      continue;
    }
    for (const [op, expected] of Object.entries(condition as Record<string, any>)) {
      switch (op) {
        case '$eq': if (value !== expected) return false; break;
        case '$ne': if (value === expected) return false; break;
        case '$gt': if (!(value > expected)) return false; break;
        case '$gte': if (!(value >= expected)) return false; break;
        case '$lt': if (!(value < expected)) return false; break;
        case '$lte': if (!(value <= expected)) return false; break;
        case '$in':
          if (!Array.isArray(expected) || !expected.includes(value)) return false;
          break;
        case '$contains':
          if (typeof value === 'string') { if (!value.includes(expected)) return false; }
          else if (Array.isArray(value)) { if (!value.includes(expected)) return false; }
          else return false;
          break;
      }
    }
  }
  return true;
}

function applyQuery<T>(items: T[], q?: Query): T[] {
  if (!q) return items;
  let result = items;
  if (q.where) result = result.filter(item => matchesWhere(item, q.where!));
  if (q.orderBy) {
    const field = q.orderBy;
    const dir = q.order === 'desc' ? -1 : 1;
    result = [...result].sort((a, b) => {
      const va = (a as any)[field], vb = (b as any)[field];
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }
  if (q.offset) result = result.slice(q.offset);
  if (q.limit != null) result = result.slice(0, q.limit);
  return result;
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useCRUD<T extends Record<string, any>>(
  collection: string,
  schema: Schema<T>,
  _options?: UseCRUDOptions,
): CRUDResult<T> {
  const bucket = useMemo(() => bucketFor(collection), [collection]);
  const table = useMemo(() => tableName(collection), [collection]);
  const tableId = useMemo(() => ident(table), [table]);

  const create = useCallback(async (data: T): Promise<string> => {
    await ensureEntityTable(collection);
    const validated = schema.parse(data);
    const id = (validated as any).id ?? generateId();
    const row = { ...validated, id };
    const sql =
      `INSERT INTO ${tableId} (id, data) VALUES (${val(id)}, ${val(row)})` +
      ` ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`;
    if (!exec(bucket, sql)) throw new Error(`INSERT ${collection}/${id} failed.`);
    notifyRowChange(collection, row);
    return id;
  }, [bucket, tableId, collection, schema]);

  const get = useCallback(async (id: string): Promise<T | null> => {
    await ensureEntityTable(collection);
    const rows = query<{ data: any }>(bucket, `SELECT data FROM ${tableId} WHERE id = ${lit(id)} LIMIT 1`);
    if (rows.length === 0) return null;
    const data = rows[0].data;
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return schema.parse(parsed);
  }, [bucket, tableId, schema]);

  const update = useCallback(async (id: string, partial: Partial<T>): Promise<void> => {
    await ensureEntityTable(collection);
    const cur = await get(id);
    if (!cur) throw new Error(`Not found: ${collection}/${id}`);
    const merged = { ...cur, ...partial, id };
    const validated = schema.parse(merged);
    const sql = `UPDATE ${tableId} SET data = ${val(validated)}, updated_at = NOW() WHERE id = ${lit(id)}`;
    if (!exec(bucket, sql)) throw new Error(`UPDATE ${collection}/${id} failed.`);
    if (changes(bucket) === 0) throw new Error(`Not found: ${collection}/${id}`);
    notifyRowChange(collection, validated);
  }, [bucket, tableId, collection, schema, get]);

  const del = useCallback(async (id: string): Promise<void> => {
    await ensureEntityTable(collection);
    const sql = `DELETE FROM ${tableId} WHERE id = ${lit(id)}`;
    if (!exec(bucket, sql)) throw new Error(`DELETE ${collection}/${id} failed.`);
  }, [bucket, tableId, collection]);

  const list = useCallback(async (q?: Query): Promise<T[]> => {
    await ensureEntityTable(collection);
    const rows = query<{ data: any }>(bucket, `SELECT data FROM ${tableId}`);
    const out: T[] = rows.map(r => {
      const parsed = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      return schema.parse(parsed);
    });
    return applyQuery(out, q);
  }, [bucket, tableId, schema]);

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
        .then(result => { if (!cancelled) setData(result); })
        .catch(err => { if (!cancelled) setError(err instanceof Error ? err : new Error(String(err))); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [id, version]);

    const refetch = useCallback(() => setVersion(v => v + 1), []);
    return { data, loading, error, refetch };
  };

  const useListQuery = (q?: Query) => {
    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [version, setVersion] = useState(0);
    const queryRef = useRef(q);
    queryRef.current = q;

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      list(queryRef.current)
        .then(result => { if (!cancelled) setData(result); })
        .catch(err => { if (!cancelled) setError(err instanceof Error ? err : new Error(String(err))); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [version]);

    const refetch = useCallback(() => setVersion(v => v + 1), []);
    return { data, loading, error, refetch };
  };

  return { create, get, update, delete: del, list, useQuery, useListQuery };
}
