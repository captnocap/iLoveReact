// Per-bucket Postgres connection management.
//
// Why module-level cache (and never-close): pg.zig's pool reuse is keyed
// on the URI string, but `pg.close()` doesn't refcount — the first
// component to unmount would invalidate the pool for everyone else
// sharing the bucket. Holding handles for process lifetime sidesteps
// this. Memory cost: 8 buckets × 16-conn pool ceiling.
//
// Connect target: the embedded postgres unix socket spawned by
// framework/pg.zig at `~/.cache/reactjit-embed/embed-pg-sock`. We only
// switch the database name per bucket; everything else (host, role) is
// the same.

import { callHost, hasHost } from '@reactjit/runtime/ffi';
import * as pg from '@reactjit/runtime/hooks/pg';
import { BUCKETS, type BucketId } from './buckets';

const SOCKET_SUBPATH = '.cache/reactjit-embed/embed-pg-sock';
// PG_USER MUST match framework/storage/pg.zig's `default_user` AND
// scripts/dev's `initdb -U <role>` — the third member of the three-way
// lockstep. When pg.zig flipped from `embed` to `postgres` this kept
// the old default and every bucket connection failed with `role
// "embed" does not exist`. Keep all three call sites in sync.
const PG_USER = 'postgres';

function home(): string {
  if (!hasHost('__env_get')) {
    throw new Error('cart/app/db requires __env_get host fn (process.ts).');
  }
  const h = callHost<string | null>('__env_get', null, 'HOME');
  if (!h) throw new Error('HOME env var unset; cannot locate embedded PG socket.');
  return h;
}

/** Build the unix-socket PG URI for a given bucket\'s database.
 *
 *  pg.zig\'s URI parser (lib.zig:145 parseOpts) only accepts two query
 *  params — `tcp_user_timeout` and `sslmode` — and rejects everything
 *  else with `UnsupportedConnectionParam`. So we can\'t use libpq\'s
 *  `?host=…` form. Instead we URL-encode the full socket file path
 *  (including `.s.PGSQL.5432`) into the URI host position, and pg.zig\'s
 *  stream layer (stream.zig:135) auto-detects `host[0] == '/'` as a
 *  unix socket connect.
 */
export function bucketUri(bucket: BucketId): string {
  const b = BUCKETS[bucket];
  const sockPath = `${home()}/${SOCKET_SUBPATH}/.s.PGSQL.5432`;
  return `postgres://${PG_USER}@${encodeURIComponent(sockPath)}/${b.databaseName}`;
}

const handles = new Map<BucketId, pg.PgHandle>();
let pgSpawnPrimed = false;

/** Trigger framework/pg.zig:104 connectDefault, which is the only path
 *  that auto-spawns the embedded postgres binary if it isn\'t running.
 *  Subsequent connections to specific bucket databases via URI go through
 *  connectUri (line 114) which assumes PG is already up. So we always
 *  prime the cluster via the empty-URI path first.
 *
 *  The empty-URI handle also doubles as the "cluster" handle bootstrap
 *  uses to issue cross-DB DDL (CREATE DATABASE / pg_database queries). */
export function ensurePgRunning(): pg.PgHandle {
  const KEY = '__cluster__' as BucketId;
  const cached = handles.get(KEY);
  if (cached && cached !== 0) return cached;
  if (!pg.isAvailable()) {
    throw new Error('Postgres host bindings missing. Build framework/v8_bindings_pg.zig.');
  }
  const h = pg.connect('');
  if (h === 0) {
    throw new Error(
      'Failed to connect to embedded postgres. Has the cluster been initialised? ' +
      "framework/pg.zig:131 won't initdb for us — run the one-shot bootstrap script.",
    );
  }
  handles.set(KEY, h);
  pgSpawnPrimed = true;
  return h;
}

/** Open (or reuse) a connection to a bucket\'s database. Throws on
 *  failure rather than returning 0 — callers should let it bubble so
 *  the user sees a clear error rather than silent zero rows. */
export function getHandle(bucket: BucketId): pg.PgHandle {
  const cached = handles.get(bucket);
  if (cached && cached !== 0) return cached;
  // Always prime the empty-URI path first so framework auto-spawn fires
  // before we try a non-empty bucket URI (which has no spawn fallback).
  if (!pgSpawnPrimed) ensurePgRunning();
  const h = pg.connect(bucketUri(bucket));
  if (h === 0) {
    throw new Error(
      `Failed to connect to bucket '${bucket}' (db ${BUCKETS[bucket].databaseName}). ` +
      `Database may not exist yet — run bootstrap.`,
    );
  }
  handles.set(bucket, h);
  return h;
}

/** Cluster-level handle (the default `embed_bench` DB) — same handle
 *  ensurePgRunning returns. Used by bootstrap for cross-DB DDL like
 *  CREATE DATABASE. */
export function getClusterHandle(): pg.PgHandle {
  return ensurePgRunning();
}

/** Run a SELECT against a bucket. Returns rows as objects keyed by column. */
export function query<T = Record<string, any>>(bucket: BucketId, sql: string): T[] {
  return pg.query<T>(getHandle(bucket), sql);
}

/** Run a write/DDL against a bucket. Returns true on success. */
export function exec(bucket: BucketId, sql: string): boolean {
  return pg.exec(getHandle(bucket), sql);
}

/** Rowcount of the last write on this bucket\'s handle. */
export function changes(bucket: BucketId): number {
  return pg.changes(getHandle(bucket));
}
