// First-run bootstrap. Idempotent.
//
// Sequence:
//   1. Connect to the cluster default DB (`embed_bench`).
//   2. For each bucket missing from pg_database, CREATE DATABASE.
//   3. For each bucket, connect and CREATE TABLE IF NOT EXISTS for every
//      entity registered to that bucket.
//
// The framework's embedded postgres must already be bootstrapped (initdb +
// the `embed_bench` cluster). framework/pg.zig:131 won't initdb for us;
// it only re-spawns an existing cluster. If the cluster doesn't exist,
// connect throws and the user sees a clear error.
//
// Schema shape per entity is generic JSONB-blob:
//   id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at, updated_at
// — this is *not* the long-term schema for embeddings (which need a
// vector column + HNSW index). Embedding tables ship with stub blob
// schemas now and will get bespoke schema in a follow-up.

import * as pg from '@reactjit/hooks/pg';
import { BUCKETS, BUCKET_IDS, type BucketId } from './buckets';
import { entitiesByBucket, bucketFor } from './registry';
import { getClusterHandle, getHandle } from './connections';
import { ident, lit, tableName } from './sql';

let bootstrapped = false;
let bootstrapPromise: Promise<void> | null = null;

/** Run the bootstrap exactly once per process. Safe to call from many
 *  components in mount effects — subsequent calls await the first run. */
export function ensureBootstrapped(): Promise<void> {
  if (bootstrapped) return Promise.resolve();
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    try {
      createMissingDatabases();
      createMissingTables();
      // Seed the recipe corpus from disk. Idempotent — uses ON CONFLICT
      // DO NOTHING so user-edited rows survive subsequent boots.
      // Imported lazily to avoid a cycle at module-load time (seed.ts
      // pulls in cart/app/recipes/index.ts which transitively touches
      // gallery composition data).
      const { seedRecipes } = await import('../recipes/seed');
      seedRecipes();
      bootstrapped = true;
    } finally {
      bootstrapPromise = null;
    }
  })();
  return bootstrapPromise;
}

function createMissingDatabases(): void {
  const cluster = getClusterHandle();
  const wanted = BUCKET_IDS.map(id => BUCKETS[id].databaseName);
  const inList = wanted.map(n => lit(n)).join(', ');
  const existing = pg.query<{ datname: string }>(
    cluster,
    `SELECT datname FROM pg_database WHERE datname IN (${inList})`,
  );
  const have = new Set(existing.map(r => r.datname));
  for (const id of BUCKET_IDS) {
    const name = BUCKETS[id].databaseName;
    if (have.has(name)) continue;
    // CREATE DATABASE can't run in a transaction and has no IF NOT EXISTS,
    // so we issued the existence check above. Race window is tolerable —
    // bootstrap runs single-shot per process.
    const ok = pg.exec(cluster, `CREATE DATABASE ${ident(name)}`);
    if (!ok) throw new Error(`CREATE DATABASE ${name} failed.`);
  }
}

/** The generic JSONB-blob DDL, shared by boot-time and on-demand creation. */
function createTableSql(t: string): string {
  return (
    `CREATE TABLE IF NOT EXISTS ${ident(t)} (` +
    `id TEXT PRIMARY KEY, ` +
    `data JSONB NOT NULL, ` +
    `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ` +
    `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` +
    `)`
  );
}

function createMissingTables(): void {
  const grouped = entitiesByBucket();
  for (const id of BUCKET_IDS) {
    const entities = grouped[id] ?? [];
    if (entities.length === 0) continue;
    const handle = getHandle(id);
    for (const entity of entities) {
      const t = tableName(entity);
      if (!pg.exec(handle, createTableSql(t))) throw new Error(`CREATE TABLE ${id}.${t} failed.`);
      ensuredTables.add(entity);
    }
  }
}

// Per-entity table guard. ensureBootstrapped only creates the entities that
// were registered at boot — anything registered LATER (a new entity added
// during a dev session) was invisible until a restart. This closes that hole:
// every collection self-heals its own table on first CRUD access, idempotently
// (CREATE TABLE IF NOT EXISTS is cheap, and we memoize per entity).
const ensuredTables = new Set<string>();

/** Guarantee the table for one entity exists before reading/writing it.
 *  Cheap and idempotent — safe to call on every CRUD op. */
export async function ensureEntityTable(entity: string): Promise<void> {
  await ensureBootstrapped();
  if (ensuredTables.has(entity)) return;
  const bucket = bucketFor(entity);
  const t = tableName(entity);
  if (!pg.exec(getHandle(bucket), createTableSql(t))) {
    throw new Error(`CREATE TABLE ${bucket}.${t} failed.`);
  }
  ensuredTables.add(entity);
}

/** Hard reset of one bucket. DROP DATABASE then re-bootstrap. Use when
 *  a bucket is corrupt or under test. */
export async function resetBucket(bucket: BucketId): Promise<void> {
  const cluster = getClusterHandle();
  const name = BUCKETS[bucket].databaseName;
  // Terminate any open backends on the target db before dropping.
  pg.exec(
    cluster,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${lit(name)} AND pid <> pg_backend_pid()`,
  );
  const ok = pg.exec(cluster, `DROP DATABASE IF EXISTS ${ident(name)}`);
  if (!ok) throw new Error(`DROP DATABASE ${name} failed.`);
  bootstrapped = false;
  await ensureBootstrapped();
}

/** Hard reset of EVERY bucket. DROPs all bucket databases then
 *  re-bootstraps the whole cluster. Throws away every row.
 *
 *  Intended for fast iteration on shapes — when the registry adds /
 *  renames entities, the cleanest path is `resetAll()` + reboot rather
 *  than schema-migration scripting. The DB is treated as derivable
 *  from the registry; nothing in it is canonical.
 *
 *  Mock data does not auto-seed — call your seeders after this resolves. */
export async function resetAll(): Promise<void> {
  const cluster = getClusterHandle();
  for (const id of BUCKET_IDS) {
    const name = BUCKETS[id].databaseName;
    pg.exec(
      cluster,
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${lit(name)} AND pid <> pg_backend_pid()`,
    );
    const ok = pg.exec(cluster, `DROP DATABASE IF EXISTS ${ident(name)}`);
    if (!ok) throw new Error(`DROP DATABASE ${name} failed.`);
  }
  bootstrapped = false;
  await ensureBootstrapped();
}
