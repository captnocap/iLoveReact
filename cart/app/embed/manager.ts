// Module-scoped embed FLEET manager.
//
// The old shape was "one model, one store, one ingest." Real use looks
// nothing like that: a user wants several sources (a repo here, chat
// logs there, notes over there), each with its own model + slug + chunk
// size + schedule, plus they want to run the same source through 2-3
// models and ensemble the query.
//
// So this module manages:
//   1. A CACHE of (model, store) handles keyed by `${modelPath}|${slug}`.
//      First touch loads, repeat touches are no-ops. Models are not
//      auto-evicted — VRAM is the user's tradeoff.
//   2. A QUEUE of source ids waiting to ingest. Only one runs at a time
//      because the Zig pool is process-global.
//   3. A SCHEDULER that ticks every 60s and enqueues sources whose
//      `nextRunAt` has passed. Schedules: '24h' | 'weekly' | 'monthly'
//      | 'never'. ('on-change' is recognized but currently behaves like
//      'never' — file-watch wiring is Phase 2.)
//   4. The CRUD store for EmbedSource entities. The settings UI reads
//      and writes via the manager so the in-memory queue stays in sync.
//
// Lifecycle: this module is imported once by AssistantChatProvider (or
// any cart root) and lives for the cart process. Scheduler tick starts
// on first import. Nothing about React lifecycle touches it.

import { exec as pgExec, query as pgQuery } from '../db/connections';
import { ensureBootstrapped } from '../db/bootstrap';
import { bucketFor } from '../db/registry';
import { ident, lit, tableName, val } from '../db/sql';
import * as embed from '@reactjit/runtime/hooks/embed';
import type { EmbedKind, EmbedMapping } from '@reactjit/runtime/hooks/embed';

// Map legacy vendor-kind values to the new canonical kinds. EmbedSource
// rows written before the canonical-kinds refactor used 'claude',
// 'codex' etc.; readers normalize on load so we don't have to touch the
// stored rows directly. The right mapping for chat-log kinds is
// 'conversation-history', and the old 'memory' kind was misclassified
// as documentation — atomic facts are knowledge, but documentation is
// the closer match for ad-hoc markdown notes. Users can re-pick.
const LEGACY_KIND_MAP: Record<string, EmbedKind> = {
  'claude': 'conversation-history',
  'claude-overflow': 'conversation-history',
  'codex': 'conversation-history',
  'kimi': 'conversation-history',
  'memory': 'documentation',
};

// Pre-fill mappings for known JSONL conversation formats. The settings
// editor exposes these as preset buttons. They reflect the field paths
// the old vendor-specific parsers used.
export const CONVERSATION_PRESETS: Record<string, EmbedMapping> = {
  'Claude JSONL': {
    role: 'message.role',
    content: 'message.content',
    timestamp: 'timestamp',
    session_id: 'sessionId',
  },
  'Codex JSONL': {
    role: 'role',
    content: 'content',
    timestamp: 'timestamp',
    session_id: 'session_id',
  },
  'Kimi context.jsonl': {
    role: 'role',
    content: 'content',
    timestamp: 'created_at',
  },
  'OpenAI chat dump': {
    role: 'role',
    content: 'content',
    timestamp: 'created_at',
  },
};

export const KNOWLEDGE_PRESETS: Record<string, EmbedMapping> = {
  '{title,content}': {
    title: 'title',
    content: 'content',
    source_uri: 'url',
  },
  '{question,answer}': {
    title: 'question',
    content: 'answer',
  },
  '{name,description}': {
    title: 'name',
    content: 'description',
  },
};

function normalizeKind(raw: any): EmbedKind {
  if (typeof raw !== 'string') return 'code';
  if (raw === 'code' || raw === 'documentation' ||
      raw === 'conversation-history' || raw === 'knowledge') {
    return raw;
  }
  return LEGACY_KIND_MAP[raw] || 'code';
}

// ── EmbedSource entity ───────────────────────────────────────────────

export type Schedule = 'on-change' | '24h' | 'weekly' | 'monthly' | 'never';

export interface EmbedSource {
  id: string;
  name: string;
  path: string;
  /**
   * Canonical kind. Drives the walker, chunker, and source_type label.
   * Legacy vendor kinds ('claude', 'codex' etc.) read from disk are
   * normalized to the canonical kind via LEGACY_KIND_MAP.
   */
  kind: EmbedKind;
  /**
   * Absolute path to .gguf. Distinct model per source → distinct
   * pgvector table (slug is derived from this path's basename).
   * Settings → Models is the canonical source of these paths; the
   * embed UI's model picker reads from there.
   */
  modelPath: string;
  workers: number;
  /**
   * Window size, unit per kind:
   *   code / documentation  → lines per chunk
   *   conversation-history  → events per window
   *   knowledge             → ignored (1 record = 1 chunk)
   */
  chunkSize: number;
  /** Path-substring matches to skip during the Zig walk. e.g. ["archive/", "node_modules"]. */
  excludes: string[];
  /**
   * User-declared JSON path mapping. Required for `conversation-history`
   * and `knowledge`; ignored for raw kinds. Empty = parser produces
   * zero records (UI guards against this).
   */
  mapping?: EmbedMapping;
  schedule: Schedule;
  /** false = paused: skipped by scheduler AND excluded from default ensemble query. */
  enabled: boolean;
  /** Wall-clock ms. */
  lastRunAt?: number;
  /** Wall-clock ms. Computed from schedule + lastRunAt on save. */
  nextRunAt?: number;
  /** Filled when an ingest finishes (success or failure). */
  lastResult?: { files: number; chunks: number; ms: number; error?: string };
  createdAt: number;
  updatedAt: number;
}

const ENTITY = 'embed-source';

// ── source CRUD (raw pg, mirrors what useCRUD does internally) ───────
//
// We don't go through useCRUD here because this module is not a React
// component. The settings UI does go through useCRUD; both sides see
// the same JSONB rows.

function sourceTable(): string {
  return ident(tableName(ENTITY));
}

function readSourceRow(raw: any): EmbedSource | null {
  if (!raw) return null;
  const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
  // Migrate legacy `kind` values written before canonical kinds. If the
  // source was a chat-log vendor (claude/codex/kimi/claude-overflow),
  // pick a sensible default mapping so the row produces results on
  // first run — the user can refine in the editor.
  const normalized: EmbedSource = { ...d, kind: normalizeKind(d.kind) };
  if (!normalized.mapping && (normalized.kind === 'conversation-history' || normalized.kind === 'knowledge')) {
    if (d.kind === 'claude' || d.kind === 'claude-overflow') {
      normalized.mapping = CONVERSATION_PRESETS['Claude JSONL'];
    } else if (d.kind === 'codex') {
      normalized.mapping = CONVERSATION_PRESETS['Codex JSONL'];
    } else if (d.kind === 'kimi') {
      normalized.mapping = CONVERSATION_PRESETS['Kimi context.jsonl'];
    }
  }
  return normalized;
}

export function listSources(): EmbedSource[] {
  try {
    const rows = pgQuery<{ data: any }>(bucketFor(ENTITY), `SELECT data FROM ${sourceTable()}`);
    return rows.map((r) => readSourceRow(r.data)).filter((x): x is EmbedSource => !!x);
  } catch {
    // Bootstrap not done yet — return empty; the settings UI will
    // re-query on next render once db is up.
    return [];
  }
}

export function getSource(id: string): EmbedSource | null {
  try {
    const rows = pgQuery<{ data: any }>(
      bucketFor(ENTITY),
      `SELECT data FROM ${sourceTable()} WHERE id = ${lit(id)} LIMIT 1`,
    );
    if (rows.length === 0) return null;
    return readSourceRow(rows[0].data);
  } catch {
    return null;
  }
}

export async function saveSource(s: EmbedSource): Promise<void> {
  await ensureBootstrapped();
  const row = { ...s, updatedAt: Date.now() };
  // Recompute nextRunAt whenever the schedule, enabled flag, or
  // lastRunAt changes. The scheduler only ever reads this field.
  row.nextRunAt = computeNextRunAt(row);
  const sql =
    `INSERT INTO ${sourceTable()} (id, data) VALUES (${val(s.id)}, ${val(row)}) ` +
    `ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`;
  pgExec(bucketFor(ENTITY), sql);
  notify();
}

export async function deleteSource(id: string): Promise<void> {
  await ensureBootstrapped();
  pgExec(bucketFor(ENTITY), `DELETE FROM ${sourceTable()} WHERE id = ${lit(id)}`);
  // Drop from queue if pending.
  state.queue = state.queue.filter((qid) => qid !== id);
  if (state.active === id) {
    embed.ingestCancel();
  }
  notify();
}

export function newSourceDraft(partial?: Partial<EmbedSource>): EmbedSource {
  const now = Date.now();
  const id = `src_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    name: '',
    path: '',
    kind: 'code',
    // Empty by default — the UI requires the user to pick a model from
    // Settings → Models (or download one) before save.
    modelPath: '',
    workers: 2,
    chunkSize: 200,
    excludes: [],
    schedule: 'never',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

// ── slug derivation ──────────────────────────────────────────────────
//
// Slug = sanitized basename of the model file. Must match Zig's
// `sanitizeTableSuffix` (framework/assistant/embed.zig:258) so the
// chunks_<slug> table the cart wipes is the same one Zig writes into.

export function slugFor(modelPath: string): string {
  const base = (modelPath.split('/').pop() || modelPath).replace(/\.gguf$/i, '');
  return base.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

// ── schedule math ────────────────────────────────────────────────────

function scheduleDeltaMs(s: Schedule): number {
  switch (s) {
    case '24h':     return 24 * 60 * 60 * 1000;
    case 'weekly':  return 7 * 24 * 60 * 60 * 1000;
    case 'monthly': return 30 * 24 * 60 * 60 * 1000;
    case 'on-change':
    case 'never':
    default:        return -1;
  }
}

function computeNextRunAt(s: EmbedSource): number | undefined {
  if (!s.enabled) return undefined;
  const delta = scheduleDeltaMs(s.schedule);
  if (delta < 0) return undefined;
  const base = s.lastRunAt ?? Date.now();
  return base + delta;
}

// ── per-source model cache ───────────────────────────────────────────

interface ModelEntry {
  modelHandle: number;
  storeHandle: number;
  nDim: number;
  modelPath: string;
  slug: string;
}

const modelCache = new Map<string, ModelEntry>();

function modelKey(modelPath: string, slug: string): string {
  return `${modelPath}|${slug}`;
}

export function ensureLoaded(modelPath: string, slug: string): ModelEntry | null {
  const key = modelKey(modelPath, slug);
  const cached = modelCache.get(key);
  if (cached) return cached;
  if (!embed.isAvailable()) {
    state.error = 'embed host bindings not registered (framework/v8_bindings_embed.zig)';
    notify();
    return null;
  }
  const m = embed.loadModel(modelPath);
  if (m === 0) {
    state.error = `load failed: ${modelPath}`;
    notify();
    return null;
  }
  const dim = embed.nDim(m);
  const s = embed.openStore(slug, dim);
  if (s === 0) {
    embed.freeModel(m);
    state.error = `store open failed: ${slug}`;
    notify();
    return null;
  }
  const entry: ModelEntry = { modelHandle: m, storeHandle: s, nDim: dim, modelPath, slug };
  modelCache.set(key, entry);
  state.error = null;
  notify();
  return entry;
}

export function unloadAll(): void {
  for (const entry of modelCache.values()) {
    embed.closeStore(entry.storeHandle);
    embed.freeModel(entry.modelHandle);
  }
  modelCache.clear();
  notify();
}

export function loadedModels(): Array<{ modelPath: string; slug: string; nDim: number }> {
  return Array.from(modelCache.values()).map((e) => ({
    modelPath: e.modelPath, slug: e.slug, nDim: e.nDim,
  }));
}

// ── ingest queue ─────────────────────────────────────────────────────

export interface ManagerState {
  /** Source id whose pool is currently running. */
  active: string | null;
  /** Source ids waiting their turn. */
  queue: string[];
  /** Live snapshot of the active pool (or empty when idle). */
  progress: embed.IngestProgress;
  /** Wall-clock ms the active pool started. 0 when idle. */
  startedAt: number;
  /** Last user-visible error from the manager (load failure, etc.). */
  error: string | null;
  /** Last ensemble query, retained across mounts. */
  lastQuery: LastQuery | null;
}

export interface LastQuery {
  text: string;
  /** Per-source hits, keyed by source id. */
  bySource: Record<string, embed.SearchHit[]>;
  /** Reciprocal-rank-fusion merged ranking. */
  merged: MergedHit[];
  /** Wall ms across the full ensemble (sum of model embeds + searches). */
  ms: number;
  at: number;
}

export interface MergedHit {
  source_id: string;
  chunk_index: number;
  display_text: string;
  text_preview: string;
  /** RRF score, higher is better. */
  fused_score: number;
  /** Per-source contributing scores keyed by source id. */
  contributors: Array<{ embedSourceId: string; rank: number; dense_score: number }>;
}

const EMPTY_PROGRESS: embed.IngestProgress = {
  running: false,
  files_total: 0,
  files_done: 0,
  chunks_done: 0,
  embed_ms_sum: 0,
  current_file: '',
  done: false,
  cancelled: false,
  error: '',
};

const state: ManagerState = {
  active: null,
  queue: [],
  progress: EMPTY_PROGRESS,
  startedAt: 0,
  error: null,
  lastQuery: null,
};

const listeners = new Set<() => void>();

function notify(): void { for (const l of listeners) l(); }

export function getState(): ManagerState { return state; }

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Manually trigger a single source. No-op if it's already active or queued. */
export function runSource(id: string): boolean {
  if (state.active === id) return false;
  if (state.queue.includes(id)) return false;
  state.queue.push(id);
  notify();
  pumpQueue();
  return true;
}

/** Drop the source from the pending queue. If it's active, cancel the pool. */
export function pauseSource(id: string): void {
  state.queue = state.queue.filter((q) => q !== id);
  if (state.active === id) embed.ingestCancel();
  notify();
}

/**
 * Drop every chunk in this source's table and reset its lastRunAt. The
 * model handle stays loaded so a re-run is fast.
 */
export async function resetSource(id: string): Promise<void> {
  const src = getSource(id);
  if (!src) return;
  // Cancel if active.
  if (state.active === id) {
    embed.ingestCancel();
    // Let the pool drain so DELETE doesn't race upserts.
    for (let i = 0; i < 50; i += 1) {
      if (!embed.ingestProgress().running) break;
      const t0 = Date.now();
      while (Date.now() - t0 < 20) {}
    }
  }
  // Wipe rows in this source's slug-table that match the source's path-prefix.
  // We use `source_id` LIKE `<kind>/<rel>%` — chunk source_ids are seeded
  // from the relative path under the ingest root.
  if (!src.modelPath) return;
  const t = ident(`chunks_${slugFor(src.modelPath)}`);
  try {
    pgExec(
      // chunks_<slug> lives in the embeddings bucket.
      'embeddings' as any,
      `DELETE FROM ${t} WHERE source_id LIKE ${lit(`${src.kind}/%`)}`,
    );
  } catch {
    // table not yet created; nothing to wipe.
  }
  await saveSource({ ...src, lastRunAt: undefined, nextRunAt: computeNextRunAt(src), lastResult: undefined });
}

function pumpQueue(): void {
  if (state.active) return;
  const next = state.queue.shift();
  if (!next) return;
  const src = getSource(next);
  if (!src) { notify(); pumpQueue(); return; }

  if (!src.modelPath) {
    state.error = `"${src.name}" has no model — pick one in the source editor`;
    notify();
    pumpQueue();
    return;
  }
  const slug = slugFor(src.modelPath);
  const m = ensureLoaded(src.modelPath, slug);
  if (!m) {
    // ensureLoaded already set state.error and notified.
    pumpQueue();
    return;
  }

  // Structured kinds need a content mapping; without it the parsers
  // produce zero events. Surface the misconfig instead of silently
  // running an empty ingest.
  const structured = src.kind === 'conversation-history' || src.kind === 'knowledge';
  if (structured && !src.mapping?.content) {
    state.error = `"${src.name}": ${src.kind} sources require a content mapping — open the editor and set the JSON path for the content field`;
    notify();
    pumpQueue();
    return;
  }

  const ok = embed.ingestStart(src.path.replace(/\/+$/, ''), {
    modelPath: src.modelPath,
    slug,
    kind: src.kind,
    nWorkers: Math.max(1, Math.min(16, src.workers | 0)),
    excludes: src.excludes,
    chunkSize: src.chunkSize,
    mapping: src.mapping,
  });
  if (!ok) {
    state.error = `ingestStart refused for "${src.name}"`;
    notify();
    pumpQueue();
    return;
  }
  state.active = src.id;
  state.startedAt = Date.now();
  state.progress = { ...EMPTY_PROGRESS, running: true };
  notify();
  ensurePolling();
}

let pollHandle: any = null;

function ensurePolling(): void {
  if (pollHandle) return;
  pollHandle = setInterval(() => {
    const snap = embed.ingestProgress();
    state.progress = snap;
    notify();
    if (!snap.running) {
      // Finalize the active source: record lastRunAt and lastResult,
      // recompute its nextRunAt, advance the queue.
      const activeId = state.active;
      if (activeId) {
        const src = getSource(activeId);
        if (src) {
          const result = {
            files: snap.files_done,
            chunks: snap.chunks_done,
            ms: Date.now() - state.startedAt,
            error: snap.error || undefined,
          };
          // fire-and-forget; we're inside the poll tick
          void saveSource({
            ...src,
            lastRunAt: Date.now(),
            lastResult: result,
            // nextRunAt is recomputed inside saveSource()
          });
        }
      }
      state.active = null;
      state.startedAt = 0;
      if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
      pumpQueue();
    }
  }, 200);
}

// On module load, if a pool is already running in Zig (cart hot-reloaded
// mid-ingest), rejoin the live snapshot stream. We can't know which
// source id triggered it, so `active` stays null — the UI shows the
// progress as "(orphan)". Next finish settles the queue clean.
{
  if (embed.isAvailable()) {
    const snap = embed.ingestProgress();
    if (snap.running) {
      state.progress = snap;
      state.startedAt = Date.now();
      ensurePolling();
    }
  }
}

// ── scheduler tick ───────────────────────────────────────────────────

let schedulerHandle: any = null;

function schedulerTick(): void {
  const now = Date.now();
  const due = listSources().filter(
    (s) => s.enabled
      && s.nextRunAt !== undefined
      && s.nextRunAt <= now
      && s.schedule !== 'never'
      && s.schedule !== 'on-change'
      && state.active !== s.id
      && !state.queue.includes(s.id),
  );
  for (const s of due) {
    state.queue.push(s.id);
  }
  if (due.length > 0) {
    notify();
    pumpQueue();
  }
}

{
  // Start once at module load. 60s cadence — schedule precision is
  // measured in days, this is plenty.
  if (!schedulerHandle) {
    schedulerHandle = setInterval(schedulerTick, 60_000);
  }
}

// ── ensemble query (reciprocal rank fusion) ──────────────────────────

export interface QueryOpts {
  /** Source ids to include. Defaults: every enabled source. */
  sourceIds?: string[];
  /** Per-source top-K to pull before fusion. Default 20. */
  perSourceK: number;
  /** Final merged top-K. Default 10. */
  finalK: number;
  /** Optional source_type filter applied to all selected sources. */
  sourceType?: string;
}

const RRF_K = 60; // standard RRF constant

export function runQuery(text: string, opts: Partial<QueryOpts> = {}): LastQuery {
  const t0 = Date.now();
  const perSourceK = opts.perSourceK ?? 20;
  const finalK = opts.finalK ?? 10;
  const allSources = listSources();
  const selectedIds = opts.sourceIds ?? allSources.filter((s) => s.enabled).map((s) => s.id);

  const bySource: Record<string, embed.SearchHit[]> = {};
  const contributorMap = new Map<
    string,
    {
      hit: embed.SearchHit;
      contributors: Array<{ embedSourceId: string; rank: number; dense_score: number }>;
      fused: number;
    }
  >();

  for (const sid of selectedIds) {
    const src = allSources.find((s) => s.id === sid);
    if (!src) continue;
    if (!src.modelPath) continue;
    const m = ensureLoaded(src.modelPath, slugFor(src.modelPath));
    if (!m) continue;
    const qvec = embed.embedText(m.modelHandle, text);
    if (!qvec) continue;
    const hits = embed.search(m.storeHandle, qvec, perSourceK, opts.sourceType ?? '');
    bySource[sid] = hits;
    hits.forEach((h, idx) => {
      const key = `${h.source_id}#${h.chunk_index}`;
      const rank = idx + 1;
      const rrf = 1 / (RRF_K + rank);
      const existing = contributorMap.get(key);
      if (existing) {
        existing.fused += rrf;
        existing.contributors.push({ embedSourceId: sid, rank, dense_score: h.dense_score });
      } else {
        contributorMap.set(key, {
          hit: h,
          fused: rrf,
          contributors: [{ embedSourceId: sid, rank, dense_score: h.dense_score }],
        });
      }
    });
  }

  const merged: MergedHit[] = Array.from(contributorMap.values())
    .sort((a, b) => b.fused - a.fused)
    .slice(0, finalK)
    .map((m) => ({
      source_id: m.hit.source_id,
      chunk_index: m.hit.chunk_index,
      display_text: m.hit.display_text,
      text_preview: m.hit.text_preview,
      fused_score: m.fused,
      contributors: m.contributors,
    }));

  const lq: LastQuery = {
    text,
    bySource,
    merged,
    ms: Date.now() - t0,
    at: Date.now(),
  };
  state.lastQuery = lq;
  notify();
  return lq;
}
