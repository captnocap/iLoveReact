// Lightweight Postgres layer for image-gen.
// Uses the framework's embedded postgres (auto-spawned on first connect).

import * as pg from '../../runtime/hooks/pg';
import { hasHost, callHost } from '../../runtime/ffi';

const SOCKET_SUBPATH = '.cache/reactjit-embed/embed-pg-sock';
const PG_USER = 'embed';
const DB_NAME = 'cart_image_gen';

function home(): string {
  if (!hasHost('__env_get')) {
    throw new Error('__env_get host function missing; cannot locate embedded PG socket.');
  }
  const h = callHost<string | null>('__env_get', null, 'HOME');
  if (!h) throw new Error('HOME env var unset; cannot locate embedded PG socket.');
  return h;
}

function makeUri(database: string): string {
  const sockPath = `${home()}/${SOCKET_SUBPATH}/.s.PGSQL.5432`;
  return `postgres://${PG_USER}@${encodeURIComponent(sockPath)}/${database}`;
}

// ── Minimal SQL escaping (framework/pg.zig ignores paramsJson today) ──

function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function ident(s: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(s)) {
    throw new Error(`Refusing to quote identifier with unexpected chars: ${s}`);
  }
  return `"${s.replace(/"/g, '""')}"`;
}

// ── Connection lifecycle ──

let clusterHandle: pg.PgHandle | null = null;
let dbHandle: pg.PgHandle | null = null;
let bootstrapped = false;

function ensureCluster(): pg.PgHandle {
  if (clusterHandle && clusterHandle !== 0) return clusterHandle;
  if (!pg.isAvailable()) {
    throw new Error('Postgres host bindings are not registered. Build framework/v8_bindings_pg.zig.');
  }
  // Connect to the 'postgres' maintenance DB for cluster-level DDL.
  const h = pg.connect(makeUri('postgres'));
  if (h === 0) throw new Error('Failed to connect to embedded postgres cluster (postgres DB).');
  clusterHandle = h;
  return h;
}

function ensureDbHandle(): pg.PgHandle {
  if (dbHandle && dbHandle !== 0) return dbHandle;
  const h = pg.connect(makeUri(DB_NAME));
  if (h === 0) throw new Error(`Failed to connect to database ${DB_NAME}.`);
  dbHandle = h;
  return h;
}

/** Idempotent: creates the cart database and api_keys table once per process. */
export function ensureBootstrapped(): void {
  if (bootstrapped) return;

  const cluster = ensureCluster();

  // CREATE DATABASE has no IF NOT EXISTS in older Postgres, so probe first.
  const existing = pg.query<{ datname: string }>(
    cluster,
    `SELECT datname FROM pg_database WHERE datname = ${lit(DB_NAME)}`,
  );
  if (existing.length === 0) {
    const ok = pg.exec(cluster, `CREATE DATABASE ${ident(DB_NAME)}`);
    if (!ok) throw new Error(`CREATE DATABASE ${DB_NAME} failed.`);
  }

  const h = ensureDbHandle();

  const tables = [
    {
      name: 'api_keys',
      sql:
        `id TEXT PRIMARY KEY, ` +
        `provider TEXT NOT NULL DEFAULT '', ` +
        `label TEXT NOT NULL DEFAULT '', ` +
        `key_value TEXT NOT NULL, ` +
        `is_active BOOLEAN NOT NULL DEFAULT TRUE, ` +
        `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ` +
        `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    },
    {
      name: 'prompts',
      sql:
        `id TEXT PRIMARY KEY, ` +
        `name TEXT NOT NULL UNIQUE, ` +
        `text TEXT NOT NULL, ` +
        `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ` +
        `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    },
    {
      name: 'jobs',
      sql:
        `id TEXT PRIMARY KEY, ` +
        `source TEXT NOT NULL DEFAULT 'interactive', ` +
        `prompt_name TEXT NOT NULL DEFAULT '', ` +
        `prompt_text TEXT NOT NULL DEFAULT '', ` +
        `options JSONB NOT NULL DEFAULT '{}', ` +
        `img2img_refs_pattern TEXT, ` +
        `state TEXT NOT NULL DEFAULT 'queued', ` +
        `stats JSONB NOT NULL DEFAULT '{}', ` +
        `last_error TEXT, ` +
        `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ` +
        `started_at TIMESTAMPTZ, ` +
        `finished_at TIMESTAMPTZ`,
    },
    {
      name: 'batches',
      sql:
        `id TEXT PRIMARY KEY, ` +
        `job_id TEXT NOT NULL REFERENCES ${ident('jobs')}(id) ON DELETE CASCADE, ` +
        `batch_index INTEGER NOT NULL, ` +
        `state TEXT NOT NULL DEFAULT 'queued', ` +
        `image_count INTEGER NOT NULL DEFAULT 0, ` +
        `saved_files JSONB, ` +
        `error TEXT, ` +
        `elapsed_ms INTEGER, ` +
        `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    },
    {
      name: 'generated_images',
      sql:
        `id TEXT PRIMARY KEY, ` +
        `batch_id TEXT NOT NULL REFERENCES ${ident('batches')}(id) ON DELETE CASCADE, ` +
        `filename TEXT NOT NULL, ` +
        `filepath TEXT NOT NULL, ` +
        `size_bytes INTEGER, ` +
        `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    },
  ];

  for (const t of tables) {
    const ok = pg.exec(h, `CREATE TABLE IF NOT EXISTS ${ident(t.name)} (${t.sql})`);
    if (!ok) throw new Error(`CREATE TABLE ${t.name} failed.`);
  }

  // indexes
  pg.exec(h, `CREATE INDEX IF NOT EXISTS idx_jobs_state ON ${ident('jobs')}(state)`);
  pg.exec(h, `CREATE INDEX IF NOT EXISTS idx_jobs_created ON ${ident('jobs')}(created_at DESC)`);
  pg.exec(h, `CREATE INDEX IF NOT EXISTS idx_batches_job ON ${ident('batches')}(job_id)`);
  pg.exec(h, `CREATE INDEX IF NOT EXISTS idx_images_batch ON ${ident('generated_images')}(batch_id)`);

  bootstrapped = true;
}

// ── Types ──

export interface ApiKey {
  id: string;
  provider: string;
  label: string;
  key_value: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Prompt {
  id: string;
  name: string;
  text: string;
  created_at?: string;
  updated_at?: string;
}

export interface Job {
  id: string;
  source: string;
  prompt_name: string;
  prompt_text: string;
  options: Record<string, any>;
  img2img_refs_pattern: string | null;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  stats: Record<string, any>;
  last_error: string | null;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface Batch {
  id: string;
  job_id: string;
  batch_index: number;
  state: 'queued' | 'running' | 'completed' | 'failed';
  image_count: number;
  saved_files: any[] | null;
  error: string | null;
  elapsed_ms: number | null;
  created_at?: string;
}

export interface GeneratedImage {
  id: string;
  batch_id: string;
  filename: string;
  filepath: string;
  size_bytes: number | null;
  created_at?: string;
}

// ── SQL helpers ──

function jsonb(value: unknown): string {
  return `${lit(JSON.stringify(value ?? null))}::jsonb`;
}

// ── ApiKey CRUD ──

export function listApiKeys(): ApiKey[] {
  ensureBootstrapped();
  return pg.query<ApiKey>(
    ensureDbHandle(),
    `SELECT * FROM ${ident('api_keys')} ORDER BY created_at DESC`,
  );
}

export function getApiKey(id: string): ApiKey | null {
  ensureBootstrapped();
  const rows = pg.query<ApiKey>(
    ensureDbHandle(),
    `SELECT * FROM ${ident('api_keys')} WHERE id = ${lit(id)} LIMIT 1`,
  );
  return rows[0] ?? null;
}

export function getActiveApiKey(): ApiKey | null {
  ensureBootstrapped();
  const rows = pg.query<ApiKey>(
    ensureDbHandle(),
    `SELECT * FROM ${ident('api_keys')} WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

export function createApiKey(
  data: Omit<ApiKey, 'id' | 'created_at' | 'updated_at'> & { id?: string },
): string {
  ensureBootstrapped();
  const id = data.id ?? generateId();
  const ok = pg.exec(
    ensureDbHandle(),
    `INSERT INTO ${ident('api_keys')} (id, provider, label, key_value, is_active) ` +
      `VALUES (${lit(id)}, ${lit(data.provider ?? '')}, ${lit(data.label ?? '')}, ${lit(data.key_value)}, ${data.is_active ?? true ? 'TRUE' : 'FALSE'})`,
  );
  if (!ok) throw new Error('INSERT api_keys failed.');
  return id;
}

export function updateApiKey(
  id: string,
  patch: Partial<Omit<ApiKey, 'id' | 'created_at' | 'updated_at'>>,
): void {
  ensureBootstrapped();
  const sets: string[] = [];
  if (patch.provider !== undefined) sets.push(`provider = ${lit(patch.provider)}`);
  if (patch.label !== undefined) sets.push(`label = ${lit(patch.label)}`);
  if (patch.key_value !== undefined) sets.push(`key_value = ${lit(patch.key_value)}`);
  if (patch.is_active !== undefined) sets.push(`is_active = ${patch.is_active ? 'TRUE' : 'FALSE'}`);
  if (sets.length === 0) return;

  const h = ensureDbHandle();
  const ok = pg.exec(
    h,
    `UPDATE ${ident('api_keys')} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ${lit(id)}`,
  );
  if (!ok || pg.changes(h) === 0) throw new Error(`UPDATE api_keys/${id} failed or not found.`);
}

export function deleteApiKey(id: string): void {
  ensureBootstrapped();
  const ok = pg.exec(ensureDbHandle(), `DELETE FROM ${ident('api_keys')} WHERE id = ${lit(id)}`);
  if (!ok) throw new Error(`DELETE api_keys/${id} failed.`);
}

// ── Prompt CRUD ──

export function listPrompts(): Prompt[] {
  ensureBootstrapped();
  return pg.query<Prompt>(ensureDbHandle(), `SELECT * FROM ${ident('prompts')} ORDER BY name`);
}

export function getPrompt(id: string): Prompt | null {
  ensureBootstrapped();
  const rows = pg.query<Prompt>(
    ensureDbHandle(),
    `SELECT * FROM ${ident('prompts')} WHERE id = ${lit(id)} LIMIT 1`,
  );
  return rows[0] ?? null;
}

export function getPromptByName(name: string): Prompt | null {
  ensureBootstrapped();
  const rows = pg.query<Prompt>(
    ensureDbHandle(),
    `SELECT * FROM ${ident('prompts')} WHERE name = ${lit(name)} LIMIT 1`,
  );
  return rows[0] ?? null;
}

export function createPrompt(data: Omit<Prompt, 'id' | 'created_at' | 'updated_at'>): string {
  ensureBootstrapped();
  const id = generateId();
  const ok = pg.exec(
    ensureDbHandle(),
    `INSERT INTO ${ident('prompts')} (id, name, text) ` +
      `VALUES (${lit(id)}, ${lit(data.name)}, ${lit(data.text)}) ` +
      `ON CONFLICT (name) DO UPDATE SET text = EXCLUDED.text, updated_at = NOW()`,
  );
  if (!ok) throw new Error('INSERT prompts failed.');
  return id;
}

export function updatePrompt(id: string, patch: Partial<Omit<Prompt, 'id' | 'created_at' | 'updated_at'>>): void {
  ensureBootstrapped();
  const sets: string[] = [];
  if (patch.name !== undefined) sets.push(`name = ${lit(patch.name)}`);
  if (patch.text !== undefined) sets.push(`text = ${lit(patch.text)}`);
  if (sets.length === 0) return;
  const h = ensureDbHandle();
  const ok = pg.exec(
    h,
    `UPDATE ${ident('prompts')} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ${lit(id)}`,
  );
  if (!ok || pg.changes(h) === 0) throw new Error(`UPDATE prompts/${id} failed or not found.`);
}

export function deletePrompt(id: string): void {
  ensureBootstrapped();
  pg.exec(ensureDbHandle(), `DELETE FROM ${ident('prompts')} WHERE id = ${lit(id)}`);
}

// ── Job CRUD ──

export function listJobs(limit = 100): Job[] {
  ensureBootstrapped();
  return pg.query<Job>(
    ensureDbHandle(),
    `SELECT * FROM ${ident('jobs')} ORDER BY created_at DESC LIMIT ${limit}`,
  );
}

export function getJob(id: string): Job | null {
  ensureBootstrapped();
  const rows = pg.query<Job>(
    ensureDbHandle(),
    `SELECT * FROM ${ident('jobs')} WHERE id = ${lit(id)} LIMIT 1`,
  );
  return rows[0] ?? null;
}

export function createJob(data: Omit<Job, 'id' | 'created_at' | 'started_at' | 'finished_at'> & { id?: string }): string {
  ensureBootstrapped();
  const id = data.id ?? generateId();
  const ok = pg.exec(
    ensureDbHandle(),
    `INSERT INTO ${ident('jobs')} (id, source, prompt_name, prompt_text, options, img2img_refs_pattern, state, stats) ` +
      `VALUES (${lit(id)}, ${lit(data.source)}, ${lit(data.prompt_name)}, ${lit(data.prompt_text)}, ${jsonb(data.options)}, ${data.img2img_refs_pattern ? lit(data.img2img_refs_pattern) : 'NULL'}, ${lit(data.state)}, ${jsonb(data.stats)})`,
  );
  if (!ok) throw new Error('INSERT jobs failed.');
  return id;
}

export function updateJob(id: string, patch: Partial<Omit<Job, 'id' | 'created_at'>>): void {
  ensureBootstrapped();
  const sets: string[] = [];
  if (patch.source !== undefined) sets.push(`source = ${lit(patch.source)}`);
  if (patch.prompt_name !== undefined) sets.push(`prompt_name = ${lit(patch.prompt_name)}`);
  if (patch.prompt_text !== undefined) sets.push(`prompt_text = ${lit(patch.prompt_text)}`);
  if (patch.options !== undefined) sets.push(`options = ${jsonb(patch.options)}`);
  if (patch.img2img_refs_pattern !== undefined) sets.push(`img2img_refs_pattern = ${patch.img2img_refs_pattern ? lit(patch.img2img_refs_pattern) : 'NULL'}`);
  if (patch.state !== undefined) sets.push(`state = ${lit(patch.state)}`);
  if (patch.stats !== undefined) sets.push(`stats = ${jsonb(patch.stats)}`);
  if (patch.last_error !== undefined) sets.push(`last_error = ${patch.last_error ? lit(patch.last_error) : 'NULL'}`);
  if (patch.started_at !== undefined) sets.push(`started_at = ${patch.started_at ? lit(patch.started_at) : 'NULL'}`);
  if (patch.finished_at !== undefined) sets.push(`finished_at = ${patch.finished_at ? lit(patch.finished_at) : 'NULL'}`);
  if (sets.length === 0) return;
  const h = ensureDbHandle();
  pg.exec(h, `UPDATE ${ident('jobs')} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ${lit(id)}`);
}

export function deleteJob(id: string): void {
  ensureBootstrapped();
  pg.exec(ensureDbHandle(), `DELETE FROM ${ident('jobs')} WHERE id = ${lit(id)}`);
}

// ── Batch CRUD ──

export function listBatchesForJob(jobId: string): Batch[] {
  ensureBootstrapped();
  return pg.query<Batch>(
    ensureDbHandle(),
    `SELECT * FROM ${ident('batches')} WHERE job_id = ${lit(jobId)} ORDER BY batch_index`,
  );
}

export function createBatch(data: Omit<Batch, 'id' | 'created_at'> & { id?: string }): string {
  ensureBootstrapped();
  const id = data.id ?? generateId();
  const ok = pg.exec(
    ensureDbHandle(),
    `INSERT INTO ${ident('batches')} (id, job_id, batch_index, state, image_count, saved_files, error, elapsed_ms) ` +
      `VALUES (${lit(id)}, ${lit(data.job_id)}, ${data.batch_index}, ${lit(data.state)}, ${data.image_count}, ${data.saved_files ? jsonb(data.saved_files) : 'NULL'}, ${data.error ? lit(data.error) : 'NULL'}, ${data.elapsed_ms ?? 'NULL'})`,
  );
  if (!ok) throw new Error('INSERT batches failed.');
  return id;
}

export function updateBatch(id: string, patch: Partial<Omit<Batch, 'id' | 'created_at'>>): void {
  ensureBootstrapped();
  const sets: string[] = [];
  if (patch.state !== undefined) sets.push(`state = ${lit(patch.state)}`);
  if (patch.image_count !== undefined) sets.push(`image_count = ${patch.image_count}`);
  if (patch.saved_files !== undefined) sets.push(`saved_files = ${patch.saved_files ? jsonb(patch.saved_files) : 'NULL'}`);
  if (patch.error !== undefined) sets.push(`error = ${patch.error ? lit(patch.error) : 'NULL'}`);
  if (patch.elapsed_ms !== undefined) sets.push(`elapsed_ms = ${patch.elapsed_ms ?? 'NULL'}`);
  if (sets.length === 0) return;
  pg.exec(ensureDbHandle(), `UPDATE ${ident('batches')} SET ${sets.join(', ')} WHERE id = ${lit(id)}`);
}

// ── GeneratedImage CRUD ──

export function listImagesForBatch(batchId: string): GeneratedImage[] {
  ensureBootstrapped();
  return pg.query<GeneratedImage>(
    ensureDbHandle(),
    `SELECT * FROM ${ident('generated_images')} WHERE batch_id = ${lit(batchId)} ORDER BY created_at`,
  );
}

export function createImage(data: Omit<GeneratedImage, 'id' | 'created_at'> & { id?: string }): string {
  ensureBootstrapped();
  const id = data.id ?? generateId();
  pg.exec(
    ensureDbHandle(),
    `INSERT INTO ${ident('generated_images')} (id, batch_id, filename, filepath, size_bytes) ` +
      `VALUES (${lit(id)}, ${lit(data.batch_id)}, ${lit(data.filename)}, ${lit(data.filepath)}, ${data.size_bytes ?? 'NULL'})`,
  );
  return id;
}

// ── Helpers ──

function generateId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now}-${rand}`;
}
