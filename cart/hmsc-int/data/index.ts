// data/index.ts — the V20 persistence layer: per-concern append-only streams,
// one total cross-session undo chain, materialized snapshots.
//
// THE RULES (V20, ruled):
//   - A state update writes to ITS concern's stream — never one monolithic
//     blob. New feature = NEW stream; old streams stay valid forever (schema
//     evolution by addition, not migration).
//   - One total undo chain: every appended event carries a GLOBAL sequence
//     number across all streams. An undo point is a log position (a seq).
//     History is immutable — "undo" reads the state AS OF a position; it never
//     rewrites the log.
//   - The game/compile loads SNAPSHOTS (data/snapshots/<name>.snapshot.json,
//     a materialized view stamped with its globalSeq), never the history.
//   - THE SNAPSHOT SYSTEM GROWS WITH EVERY STREAM: defineStream() demands the
//     materializer (initial + apply) in the same registration — a stream
//     without snapshot support cannot be expressed.
//
// BACKING (STOREDB-0606, the user's ruling after the sessions.jsonl:884
// outage: "we need to move to pg or sqlite which are in the framework
// already"): streams live in ONE sqlite database, <rootDir>/store.db —
// WAL journal + BEGIN IMMEDIATE transactions, so N concurrent app instances
// (user session + census walks + headless boots) can never tear a record or
// mint a duplicate seq again. Only the backing changed; the V20 semantics
// above survive exactly:
//   - the `events` table is append-only (INSERT only — no UPDATE/DELETE path
//     exists in this module); per-concern streams are the indexed `stream`
//     column; the one global sequence is allocated as MAX(seq)+1 INSIDE the
//     write transaction, so it is race-free by construction.
//   - `record` holds each event line byte-for-byte (the exact JSON text) —
//     ingested history keeps its original bytes, including warts like the
//     duplicate seq 4077 pair the old read-concat-write race minted.
//   - INGEST: at openStore(), every <rootDir>/streams/*.jsonl not yet
//     imported is folded into the DB inside one transaction (the marker row
//     in `ingested_files` commits atomically with the rows, and the
//     check-inside-the-transaction makes concurrent first-boots safe).
//     Corrupt records are quarantined + logged, never imported, and the
//     original .jsonl files are LEFT IN PLACE UNTOUCHED as the archive —
//     this module never writes them; the user retires them.
//
// TOLERANCE (the V20 boundary law — boundary validation never throws): a
// corrupt/partial record met while reading (ingest or a damaged row) is
// SKIPPED, logged loudly (console.warn + telemetry), and QUARANTINED in
// memory (store.quarantine()) — the fold continues with every valid record.
// Nothing is ever rewritten: no "repair" writes, on either backing. A failed
// WRITE (transaction error) does throw — losing an append silently would be
// worse; the routes surface store errors already.
//
// Git: store.db / streams / snapshots CONTENT is not git-tracked (.gitignore —
// git is the code time machine, these are the content time machine). The
// BACKUP STORY is explicit: store.exportBackup(destDir) dumps every stream
// back to <name>.jsonl (one record line per event, byte-faithful for ingested
// history) + a manifest; restoring is dropping store.db and placing the dump
// in data/streams/ for re-ingest.
//
// Host surface: `__sql_*` via @reactjit/hooks/sqlite (the import is the
// metafile-gate trigger that flips -Dhas-sqlite, source-driven bundling) +
// `__fs_*` for snapshots/backup/ingest. Identical names under the cart host
// and tools/v8cli, so the same layer serves editors, compile/, and the P4
// tests.
//
// P2: nothing here owns a gameplay number. P3: openStore() is the only door.

import { GAME_TELEMETRY } from '../game/telemetry';
import { open as sqlOpen, exec as sqlExec, query as sqlQuery, type DbHandle } from '@reactjit/hooks/sqlite';

declare const globalThis: any;

export type LogPosition = {
  /** the total-undo-chain coordinate — strictly increasing across ALL streams */
  globalSeq: number;
  stream: string;
  /** 0-based index within the stream's own log */
  index: number;
};

/**
 * ONE registration, BOTH halves (the V20 incompleteness guard): the log needs
 * `name`; the snapshot system needs `initial` + `apply`. TypeScript demands
 * all three, and defineStream validates them again at the boundary for JS
 * callers — a stream without snapshot support cannot be registered.
 */
export type StreamDef<State, Event> = {
  /** concern name — the stream's channel (kebab-case, one word) */
  name: string;
  /** the empty materialized state */
  initial: () => State;
  /** one materializer step; MUST return a new/updated state, never throw on
   *  events it predates (additions arrive later — tolerate unknown shapes).
   *  `seq` is the event's own log position (its globalSeq) — V20 says an undo
   *  point IS a log position, so a materializer that records positions (the
   *  sessions stream) reads them here instead of guessing. The store always
   *  passes it; it is optional only so two-arg materializers (and the tests'
   *  direct-apply idiom) stay valid. */
  apply: (state: State, event: Event, seq?: number) => State;
};

export type StreamHandle<State, Event> = {
  name: string;
  /** append one event to this concern's log; returns its log position */
  append: (event: Event) => LogPosition;
  /** the current materialized state (folded from disk + appends) */
  state: () => State;
  /** the state AS OF an undo point (events with globalSeq <= seq) */
  stateAt: (globalSeq: number) => State;
  /** number of events in this stream's log */
  length: () => number;
};

/** one skipped record, preserved byte-for-byte in memory (nothing on disk is ever rewritten) */
export type QuarantinedRecord = {
  /** where the record was read from (a stream .jsonl during ingest, or store.db#<stream>) */
  path: string;
  /** 1-based line number in a .jsonl, or the row's physical id in the DB */
  line: number;
  /** the raw record text, exactly as it sits on disk */
  raw: string;
  /** true when this was a .jsonl's last line with no trailing newline — the
   *  ordinary crash-mid-write tear of the old backing; false = a mid-file
   *  corruption (or a damaged DB row) */
  trailing: boolean;
};

export type Store = {
  defineStream: <State, Event>(def: StreamDef<State, Event>) => StreamHandle<State, Event>;
  /** Run fn with every append inside folded into ONE write transaction per
   *  touched DB — the batched-commit door (PLACEPERF-0610: a 358-event
   *  commitMany was 716 BEGIN/COMMIT round-trips ≈ 841ms; batched it is one
   *  COMMIT per touched domain). Transactions begin lazily on first write, so
   *  untouched domains never take a lock. fn throwing rolls the batch back —
   *  note the in-memory fold has already applied the batch's earlier events
   *  then (divergence until next boot); an SQL failure mid-batch is loud. */
  batch: <T>(fn: () => T) => T;
  /** the current undo-chain position — pass back to stateAt to time-travel */
  undoPoint: () => number;
  /** write data/snapshots/<name>.snapshot.json for EVERY registered stream */
  materializeSnapshots: () => string[];
  /** read one materialized view (what the game/compile consumes) */
  loadSnapshot: <State>(name: string) => { name: string; globalSeq: number; state: State } | null;
  /** the explicit backup story: dump every stream to <name>.jsonl + manifest in destDir */
  exportBackup: (destDir: string) => string[];
  /** every corrupt record skipped while reading this store's history —
   *  in-memory quarantine only; nothing on disk is ever touched */
  quarantine: () => QuarantinedRecord[];
};

export type StoreDomainRef = {
  /** folder path relative to the umbrella root */
  path: string;
  /** streams known to live in this domain DB */
  streams: string[];
};

export type StoreManifest = {
  version: 1;
  domains: Record<string, StoreDomainRef>;
};

type StoredEvent = { seq: number; at: number; event: unknown };

// ── PLACEPERF-0610: per-append cost breakdown ────────────────────────────────
// Accumulated across every append (all stores) so a batched commit can print
// where its time actually went: seq allocation (the MAX(seq) read), the
// INSERT, the in-memory fold (the stream's apply), and the record stringify.
// A caller resets, runs its batch, then reads — single-threaded JS makes the
// shared counters safe.
export const appendProbe = { seqMs: 0, insertMs: 0, foldMs: 0, jsonMs: 0, count: 0 };
export function resetAppendProbe(): void {
  appendProbe.seqMs = 0;
  appendProbe.insertMs = 0;
  appendProbe.foldMs = 0;
  appendProbe.jsonMs = 0;
  appendProbe.count = 0;
}

const STREAM_NAME_SHAPE = /^[a-z][a-z0-9-]*$/;
const STORE_MANIFEST = 'manifest.json';
const STORE_DOMAINS_DIR = 'domains';
export const EDITOR_STORE_STREAMS = Object.freeze([
  'activities',
  'assist3d',
  'buildings',
  'characters',
  'clothing-variants',
  'cutout',
  'items',
  'materials',
  'missions',
  'sessions',
  'tuning',
  'vehicles',
  'voxels',
  'world',
] as const);

function perfMs(): number {
  const host = globalThis as any;
  if (typeof host.__bench_now_us === 'function') {
    const us = Number(host.__bench_now_us());
    if (Number.isFinite(us)) return us / 1000;
  }
  const perf = (globalThis as any).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

function fs() {
  const host = globalThis;
  if (typeof host.__fs_read !== 'function' || typeof host.__fs_write !== 'function' || typeof host.__fs_mkdir !== 'function') {
    throw new Error('data store: __fs_* host bindings are missing');
  }
  return host;
}

function requireSql(): void {
  const host = globalThis;
  if (typeof host.__sql_open !== 'function' || typeof host.__sql_exec !== 'function' || typeof host.__sql_query_json !== 'function') {
    throw new Error('data store: __sql_* host bindings are missing (host built without the sqlite ingredient — rebuild)');
  }
}

function assertStoreName(name: string, label: string): void {
  if (!STREAM_NAME_SHAPE.test(name)) {
    throw new Error(`data store: ${label} must be kebab-case (got ${JSON.stringify(name)})`);
  }
}

function safeManifestPath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.split('/').some((part) => part === '..' || part === '');
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function emptyManifest(): StoreManifest {
  return { version: 1, domains: {} };
}

function readStoreManifest(rootDir: string): StoreManifest {
  const host = fs();
  const text = host.__fs_read(`${rootDir}/${STORE_MANIFEST}`);
  if (typeof text !== 'string' || text.trim() === '') return emptyManifest();
  try {
    const parsed = JSON.parse(text) as Partial<StoreManifest>;
    const domains: Record<string, StoreDomainRef> = {};
    for (const [domain, ref] of Object.entries(parsed.domains ?? {})) {
      if (!STREAM_NAME_SHAPE.test(domain)) continue;
      const path = typeof ref?.path === 'string' && safeManifestPath(ref.path) ? ref.path : `${STORE_DOMAINS_DIR}/${domain}`;
      const streams = Array.isArray(ref?.streams)
        ? sortedUnique(ref.streams.filter((s): s is string => typeof s === 'string' && STREAM_NAME_SHAPE.test(s)))
        : [];
      domains[domain] = { path, streams };
    }
    return { version: 1, domains };
  } catch {
    console.warn(`data store: ignoring unreadable umbrella manifest at ${rootDir}/${STORE_MANIFEST}`);
    return emptyManifest();
  }
}

function writeStoreManifest(rootDir: string, manifest: StoreManifest): void {
  const host = fs();
  host.__fs_mkdir(rootDir);
  host.__fs_mkdir(`${rootDir}/${STORE_DOMAINS_DIR}`);
  const domains = Object.fromEntries(
    Object.entries(manifest.domains)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([domain, ref]) => [domain, { path: ref.path, streams: sortedUnique(ref.streams) }]),
  );
  host.__fs_write(`${rootDir}/${STORE_MANIFEST}`, JSON.stringify({ version: 1, domains }, null, 2));
}

export function storeDomainForStream(stream: string): string {
  assertStoreName(stream, 'stream');
  // The user's ruling is one DB per stream/domain. Known streams are listed in
  // the manifest as they are opened; new streams get their own DB by default.
  return stream;
}

function ensureDomain(rootDir: string, domain: string, stream?: string): StoreDomainRef {
  assertStoreName(domain, 'domain');
  if (stream !== undefined) assertStoreName(stream, 'stream');
  const host = fs();
  host.__fs_mkdir(rootDir);
  host.__fs_mkdir(`${rootDir}/${STORE_DOMAINS_DIR}`);
  const manifest = readStoreManifest(rootDir);
  const current = manifest.domains[domain];
  const ref: StoreDomainRef = current
    ? { path: current.path, streams: sortedUnique(current.streams) }
    : { path: `${STORE_DOMAINS_DIR}/${domain}`, streams: [] };
  if (!safeManifestPath(ref.path)) {
    throw new Error(`data store: manifest domain "${domain}" has unsafe path ${JSON.stringify(ref.path)}`);
  }
  if (stream && !ref.streams.includes(stream)) ref.streams = sortedUnique([...ref.streams, stream]);
  manifest.domains[domain] = ref;
  host.__fs_mkdir(`${rootDir}/${ref.path}`);
  writeStoreManifest(rootDir, manifest);
  return ref;
}

export function openDomainStore(rootDir: string, domain: string): Store {
  const ref = ensureDomain(rootDir, domain);
  return openStore(`${rootDir}/${ref.path}`);
}

export function openStreamStore(rootDir: string, stream: string): Store {
  const domain = storeDomainForStream(stream);
  const ref = ensureDomain(rootDir, domain, stream);
  return openStore(`${rootDir}/${ref.path}`);
}

/**
 * Umbrella store: one manifest at <rootDir>/manifest.json, one sqlite DB under
 * <rootDir>/domains/<stream>/store.db for each stream/domain. This is a router
 * over per-domain stores, not a wrapper around the old monolithic file.
 */
export function openWorkspaceStore(rootDir: string): Store {
  fs().__fs_mkdir(rootDir);
  for (const stream of EDITOR_STORE_STREAMS) ensureDomain(rootDir, storeDomainForStream(stream), stream);
  const stores = new Map<string, Store>();

  const storeForDomain = (domain: string, stream?: string): Store => {
    const ref = ensureDomain(rootDir, domain, stream);
    const cached = stores.get(domain);
    if (cached) return cached;
    const store = openStore(`${rootDir}/${ref.path}`);
    stores.set(domain, store);
    return store;
  };

  const storeForStream = (stream: string): Store => storeForDomain(storeDomainForStream(stream), stream);

  return {
    defineStream: <State, Event>(def: StreamDef<State, Event>): StreamHandle<State, Event> =>
      storeForStream(def.name).defineStream(def),
    batch: <T,>(fn: () => T): T => {
      // Nest fn inside every cached domain store's batch — domain transactions
      // begin LAZILY on first write, so only the domains the batch actually
      // touches take a lock (a commitMany touches its channel + sessions).
      // A domain store opened mid-batch falls back to per-append commits.
      const list = [...stores.values()];
      const run = (i: number): T => (i >= list.length ? fn() : list[i].batch(() => run(i + 1)));
      return run(0);
    },
    undoPoint: (): number => {
      let seq = 0;
      for (const store of stores.values()) seq = Math.max(seq, store.undoPoint());
      return seq;
    },
    materializeSnapshots: (): string[] => {
      const written: string[] = [];
      for (const store of stores.values()) written.push(...store.materializeSnapshots());
      return written;
    },
    loadSnapshot: <State>(name: string) => storeForStream(name).loadSnapshot<State>(name),
    exportBackup: (destDir: string): string[] => {
      const host = fs();
      host.__fs_mkdir(destDir);
      const copied: string[] = [];
      for (const [domain, store] of stores) {
        copied.push(...store.exportBackup(`${destDir}/${domain}`));
      }
      const manifest = readStoreManifest(rootDir);
      const manifestPath = `${destDir}/${STORE_MANIFEST}`;
      host.__fs_write(manifestPath, JSON.stringify(manifest, null, 2));
      copied.push(manifestPath);
      return copied;
    },
    quarantine: () => {
      const records: QuarantinedRecord[] = [];
      for (const store of stores.values()) records.push(...store.quarantine());
      return records;
    },
  };
}

/** tolerant .jsonl scan for INGEST — the old backing's reader, kept verbatim:
 *  skip + quarantine + log, never throw, never write. */
function scanJsonl(path: string, text: string, quarantine: QuarantinedRecord[]): { raw: string; parsed: StoredEvent }[] {
  const records: { raw: string; parsed: StoredEvent }[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    try {
      records.push({ raw: lines[i], parsed: JSON.parse(line) as StoredEvent });
    } catch {
      const trailing = i === lines.length - 1;
      quarantine.push({ path, line: i + 1, raw: lines[i], trailing });
      console.warn(
        `data store: ${trailing ? 'torn trailing record' : 'CORRUPT RECORD'} skipped + quarantined at ${path}:${i + 1} ` +
        `(${lines[i].length} bytes; ingest continues with every valid record; file left untouched)`,
      );
      GAME_TELEMETRY.recordDiagnostic('worldStream', 'quarantine', {
        path,
        line: i + 1,
        bytes: lines[i].length,
        trailing,
      });
    }
  }
  return records;
}

/**
 * Open the store rooted at <rootDir>: streams in <rootDir>/store.db (WAL),
 * snapshots in <rootDir>/snapshots, legacy .jsonl archive in
 * <rootDir>/streams (read-only — ingested once, then left alone). The global
 * sequence resumes from the largest seq in the DB — the undo chain is one
 * chain across every session that ever wrote here.
 */
export function openStore(rootDir: string): Store {
  const openT0 = perfMs();
  const host = fs();
  requireSql();
  const streamsDir = `${rootDir}/streams`;
  const snapshotsDir = `${rootDir}/snapshots`;
  const setupT0 = perfMs();
  host.__fs_mkdir(rootDir);
  host.__fs_mkdir(streamsDir);
  host.__fs_mkdir(snapshotsDir);

  const dbPath = `${rootDir}/store.db`;
  const db: DbHandle = sqlOpen(dbPath);
  if (!db) throw new Error(`data store: cannot open ${dbPath}`);

  // WAL = readers never block the writer and a crash can't tear the log;
  // busy_timeout serializes concurrent writers instead of failing them;
  // synchronous=NORMAL is the WAL-safe durability point (a power cut may
  // drop the last instants of appends, it can never corrupt — same contract
  // as the old "a crash costs at most the in-flight event").
  sqlExec(db, 'PRAGMA journal_mode=WAL');
  sqlExec(db, 'PRAGMA busy_timeout=5000');
  sqlExec(db, 'PRAGMA synchronous=NORMAL');
  // Append-only by construction: this module only ever INSERTs into events.
  // id = physical total order; seq = the V20 global chain position carried
  // by the record; record = the event line byte-for-byte.
  sqlExec(db, `CREATE TABLE IF NOT EXISTS events(
    id INTEGER PRIMARY KEY,
    seq INTEGER NOT NULL,
    stream TEXT NOT NULL,
    at INTEGER NOT NULL,
    record TEXT NOT NULL
  )`);
  sqlExec(db, 'CREATE INDEX IF NOT EXISTS events_stream ON events(stream, id)');
  // PLACEPERF-0610: seq allocation reads MAX(seq) on EVERY append; without
  // this index that is a full table scan — on a long-lived world log it was
  // ~1-3ms per append, ×716 for a 358-event move (≈ the whole 900ms stall,
  // and why batching the transactions alone didn't dent it). Indexed, MAX is
  // a B-tree rightmost lookup.
  sqlExec(db, 'CREATE INDEX IF NOT EXISTS events_seq ON events(seq)');
  sqlExec(db, `CREATE TABLE IF NOT EXISTS ingested_files(
    path TEXT PRIMARY KEY,
    records INTEGER NOT NULL,
    quarantined INTEGER NOT NULL,
    at INTEGER NOT NULL
  )`);
  const setupMs = perfMs() - setupT0;

  const quarantined: QuarantinedRecord[] = [];
  const nowMs = (): number => (host.__nowMs ? host.__nowMs() : Date.now());

  const beginImmediate = (): void => {
    // busy_timeout already waits up to 5s per attempt; a couple of retries
    // covers a writer pile-up before we surface the failure.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (sqlExec(db, 'BEGIN IMMEDIATE')) return;
    }
    throw new Error(`data store: cannot acquire the write transaction on ${dbPath}`);
  };
  const commitOrThrow = (what: string): void => {
    if (!sqlExec(db, 'COMMIT')) {
      sqlExec(db, 'ROLLBACK');
      throw new Error(`data store: ${what} failed to commit on ${dbPath}`);
    }
  };

  // ── batched appends (PLACEPERF-0610) ────────────────────────────────────────
  // Inside batch(fn), appends share ONE write transaction: the first write
  // does BEGIN IMMEDIATE, batch() commits at the end (or rolls back when fn
  // throws). Per-append BEGIN/COMMIT was ~1ms each — a 358-event commitMany
  // paid it 716× (event + session marker). The lock begins LAZILY so a batch
  // that never writes this domain never blocks other writers on it.
  let batchDepth = 0;
  let batchTouched = false;
  const batch = <T,>(fn: () => T): T => {
    batchDepth += 1;
    let ok = false;
    try {
      const result = fn();
      ok = true;
      return result;
    } finally {
      batchDepth -= 1;
      if (batchDepth === 0 && batchTouched) {
        batchTouched = false;
        if (ok) commitOrThrow('batched append');
        else {
          sqlExec(db, 'ROLLBACK');
          console.warn(`data store: batch rolled back on ${dbPath} — in-memory fold may be ahead of disk until next boot`);
        }
      }
    }
  };

  // ── one-time ingest: every legacy stream file joins the DB, originals stay ──
  const archiveListT0 = perfMs();
  const archiveFiles: string[] = (() => {
    try {
      const listed = host.__fs_list_json ? JSON.parse(host.__fs_list_json(streamsDir)) : [];
      return (Array.isArray(listed) ? listed : []).filter((n: string) => typeof n === 'string' && n.endsWith('.jsonl')).sort();
    } catch {
      return [];
    }
  })();
  const archiveListMs = perfMs() - archiveListT0;
  let ingestTotalMs = 0;
  for (const name of archiveFiles) {
    const fileT0 = perfMs();
    const path = `${streamsDir}/${name}`;
    // The marker key is the file's identity INSIDE this store — its path
    // relative to rootDir — never the caller's spelling of rootDir. Two
    // opens of the same store via different spellings (relative vs absolute)
    // must agree on what was already ingested, or the archive imports twice
    // (this exact bug double-imported the live store on 2026-06-06).
    const markerKey = `streams/${name}`;
    const stream = name.slice(0, -'.jsonl'.length);
    if (!STREAM_NAME_SHAPE.test(stream)) continue;
    const readT0 = perfMs();
    const text = host.__fs_read(path);
    const readMs = perfMs() - readT0;
    if (typeof text !== 'string' || text === '') continue;
    const before = quarantined.length;
    const scanT0 = perfMs();
    const records = scanJsonl(path, text, quarantined);
    const scanMs = perfMs() - scanT0;
    const markerT0 = perfMs();
    beginImmediate();
    // TAIL-INCREMENTAL, and the marker check lives INSIDE the write
    // transaction (concurrent first-boots serialize on BEGIN IMMEDIATE; the
    // second sees the first's marker — no double ingest). The cutover
    // window matters: app instances still running the .jsonl-backed code
    // keep appending to the archive after the first import; because the
    // archive is itself append-only, "everything past the marker count" is
    // exactly the new history — import the tail, bump the marker.
    // Legacy markers: the first cutover wrote rootDir-spelled keys; honor
    // them as the same file so existing stores don't re-import.
    const marker = sqlQuery<{ records: number }>(db, 'SELECT MAX(records) AS records FROM ingested_files WHERE path IN (?, ?)', [markerKey, path]);
    const alreadyImported = marker.length > 0 && typeof marker[0].records === 'number' ? marker[0].records : -1;
    const markerMs = perfMs() - markerT0;
    if (alreadyImported >= records.length) {
      sqlExec(db, 'ROLLBACK');
      const totalMs = perfMs() - fileT0;
      ingestTotalMs += totalMs;
      GAME_TELEMETRY.recordDiagnostic('worldStream', 'jsonl.skip', {
        path,
        stream,
        bytes: text.length,
        records: records.length,
        alreadyImported,
        readMs,
        scanMs,
        markerMs,
        totalMs,
      });
      continue;
    }
    const importT0 = perfMs();
    const startAt = Math.max(0, alreadyImported);
    let imported = 0;
    for (const r of records.slice(startAt)) {
      const seq = typeof r.parsed?.seq === 'number' ? r.parsed.seq : 0;
      const at = typeof r.parsed?.at === 'number' ? r.parsed.at : 0;
      if (!sqlExec(db, 'INSERT INTO events(seq, stream, at, record) VALUES (?, ?, ?, ?)', [seq, stream, at, r.raw])) {
        sqlExec(db, 'ROLLBACK');
        throw new Error(`data store: ingest of ${path} failed at record ${startAt + imported + 1}`);
      }
      imported += 1;
    }
    // Write the marker under the canonical relative key; an UPDATE that
    // matches no row (legacy-keyed marker) falls through to a fresh INSERT.
    sqlExec(db, 'UPDATE ingested_files SET records = ?, at = ? WHERE path = ?', [records.length, nowMs(), markerKey]);
    const bumped = sqlQuery<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM ingested_files WHERE path = ?', [markerKey]);
    if (!(bumped.length > 0 && bumped[0].n > 0)) {
      sqlExec(db, 'INSERT INTO ingested_files(path, records, quarantined, at) VALUES (?, ?, ?, ?)', [markerKey, records.length, quarantined.length - before, nowMs()]);
    }
    commitOrThrow(`ingest of ${path}`);
    const importMs = perfMs() - importT0;
    const totalMs = perfMs() - fileT0;
    ingestTotalMs += totalMs;
    console.warn(`data store: ingested ${imported} record(s) from ${path} into ${dbPath} (${alreadyImported < 0 ? 'first import' : `tail past ${alreadyImported}`}; ${quarantined.length - before} quarantined; original left in place as the archive)`);
    GAME_TELEMETRY.recordDiagnostic('worldStream', 'ingest', {
      path,
      stream,
      records: imported,
      quarantined: quarantined.length - before,
      bytes: text.length,
      alreadyImported,
      readMs,
      scanMs,
      markerMs,
      importMs,
      totalMs,
    });
  }

  type OpenStream = {
    def: StreamDef<any, any>;
    events: StoredEvent[];
    /** memoized fold of `events` (rebuilt after every append — appends are
     *  edit-rate, folds are cheap relative to the disk write beside them) */
    current: any;
  };
  const streams = new Map<string, OpenStream>();
  let globalSeq = 0;
  {
    const maxSeqT0 = perfMs();
    const top = sqlQuery<{ s: number | null }>(db, 'SELECT MAX(seq) AS s FROM events');
    if (top.length > 0 && typeof top[0].s === 'number') globalSeq = top[0].s;
    GAME_TELEMETRY.recordDiagnostic('worldStream', 'openStore.maxSeq', {
      ms: perfMs() - maxSeqT0,
      globalSeq,
    });
  }
  GAME_TELEMETRY.recordDiagnostic('worldStream', 'openStore.ready', {
    rootDir,
    archiveFiles: archiveFiles.length,
    setupMs,
    archiveListMs,
    ingestTotalMs,
    totalMs: perfMs() - openT0,
  });

  const foldUpTo = (open: OpenStream, maxSeq: number): any => {
    let state = open.def.initial();
    for (const record of open.events) {
      if (record.seq > maxSeq) break;
      state = open.def.apply(state, record.event, record.seq);
    }
    return state;
  };

  const defineStream = <State, Event>(def: StreamDef<State, Event>): StreamHandle<State, Event> => {
    // The boundary repeats the type contract for JS callers: BOTH halves or no stream.
    if (!def || typeof def.name !== 'string' || !STREAM_NAME_SHAPE.test(def.name)) {
      throw new Error(`defineStream: name must be kebab-case (got ${JSON.stringify(def?.name)})`);
    }
    if (typeof def.initial !== 'function' || typeof def.apply !== 'function') {
      throw new Error(`defineStream("${def.name}"): a stream without snapshot support is an incomplete change — initial() and apply() are both required (V20)`);
    }
    if (streams.has(def.name)) {
      throw new Error(`defineStream: stream "${def.name}" is already registered`);
    }

    const loadT0 = perfMs();
    const queryT0 = perfMs();
    const rows = sqlQuery<{ id: number; record: string }>(db, 'SELECT id, record FROM events WHERE stream = ? ORDER BY id', [def.name]);
    const queryMs = perfMs() - queryT0;
    const events: StoredEvent[] = [];
    let bytes = 0;
    const parseT0 = perfMs();
    for (const row of rows) {
      bytes += row.record.length;
      try {
        events.push(JSON.parse(row.record) as StoredEvent);
      } catch {
        // A damaged row would be a DB-level fault, but the tolerance law is
        // backing-independent: skip + quarantine + log, fold what survives.
        quarantined.push({ path: `${dbPath}#${def.name}`, line: row.id, raw: row.record, trailing: false });
        console.warn(`data store: CORRUPT RECORD skipped + quarantined at ${dbPath}#${def.name} row ${row.id} (fold continues with every valid record)`);
        GAME_TELEMETRY.recordDiagnostic('worldStream', 'quarantine', {
          path: `${dbPath}#${def.name}`,
          line: row.id,
          bytes: row.record.length,
          trailing: false,
        });
      }
    }
    const parseMs = perfMs() - parseT0;
    for (const record of events) {
      if (record.seq > globalSeq) globalSeq = record.seq;
    }
    const open: OpenStream = { def, events, current: undefined };
    const foldT0 = perfMs();
    open.current = foldUpTo(open, Number.MAX_SAFE_INTEGER);
    const foldMs = perfMs() - foldT0;
    streams.set(def.name, open);
    GAME_TELEMETRY.recordDiagnostic('worldStream', 'defineStream.load', {
      stream: def.name,
      events: events.length,
      rows: rows.length,
      bytes,
      queryMs,
      parseMs,
      foldMs,
      totalMs: perfMs() - loadT0,
    });

    return {
      name: def.name,
      append: (event: Event): LogPosition => {
        // The whole point of the DB backing: seq allocation + insert happen
        // under ONE write lock, so concurrent app instances serialize and
        // the chain stays total — no duplicate seqs, no torn records. Inside
        // a batch() the transaction is shared: the first write begins it,
        // batch() commits it — the MAX(seq) read sees this connection's own
        // uncommitted inserts, so seqs stay dense within the batch.
        if (batchDepth > 0) {
          if (!batchTouched) { beginImmediate(); batchTouched = true; }
        } else {
          beginImmediate();
        }
        const seqT0 = perfMs();
        const next = sqlQuery<{ next: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM events');
        appendProbe.seqMs += perfMs() - seqT0;
        const seq = next.length > 0 && typeof next[0].next === 'number' ? next[0].next : globalSeq + 1;
        const record: StoredEvent = { seq, at: nowMs(), event };
        const jsonT0 = perfMs();
        const line = JSON.stringify(record);
        appendProbe.jsonMs += perfMs() - jsonT0;
        const insertT0 = perfMs();
        if (!sqlExec(db, 'INSERT INTO events(seq, stream, at, record) VALUES (?, ?, ?, ?)', [seq, def.name, record.at, line])) {
          if (batchDepth === 0) sqlExec(db, 'ROLLBACK');
          throw new Error(`data store: append to "${def.name}" failed on ${dbPath}`);
        }
        if (batchDepth === 0) commitOrThrow(`append to "${def.name}"`);
        appendProbe.insertMs += perfMs() - insertT0;
        globalSeq = seq;
        open.events.push(record);
        const foldT0 = perfMs();
        open.current = open.def.apply(open.current, event, record.seq);
        appendProbe.foldMs += perfMs() - foldT0;
        appendProbe.count += 1;
        GAME_TELEMETRY.recordDiagnostic('worldStream', 'append', {
          stream: def.name,
          seq: record.seq,
          eventBytes: line.length,
          events: open.events.length,
        });
        return { globalSeq: record.seq, stream: def.name, index: open.events.length - 1 };
      },
      state: () => open.current as State,
      stateAt: (seq: number) => foldUpTo(open, seq) as State,
      length: () => open.events.length,
    };
  };

  return {
    defineStream,
    batch,
    undoPoint: () => globalSeq,
    materializeSnapshots: (): string[] => {
      const batchT0 = perfMs();
      const written: string[] = [];
      let totalBytes = 0;
      for (const [name, open] of streams) {
        const path = `${snapshotsDir}/${name}.snapshot.json`;
        const stringifyT0 = perfMs();
        const text = JSON.stringify({ name, globalSeq, state: open.current });
        const stringifyMs = perfMs() - stringifyT0;
        const writeT0 = perfMs();
        host.__fs_write(path, text);
        const writeMs = perfMs() - writeT0;
        totalBytes += text.length;
        GAME_TELEMETRY.recordDiagnostic('worldStream', 'snapshot.write', {
          stream: name,
          bytes: text.length,
          globalSeq,
          stringifyMs,
          writeMs,
          totalMs: stringifyMs + writeMs,
        });
        written.push(path);
      }
      GAME_TELEMETRY.recordDiagnostic('worldStream', 'snapshot.batch', {
        streams: written.length,
        bytes: totalBytes,
        globalSeq,
        ms: perfMs() - batchT0,
      });
      return written;
    },
    loadSnapshot: <State>(name: string) => {
      const text = host.__fs_read(`${snapshotsDir}/${name}.snapshot.json`);
      if (typeof text !== 'string' || text === '') return null;
      return JSON.parse(text) as { name: string; globalSeq: number; state: State };
    },
    exportBackup: (destDir: string): string[] => {
      host.__fs_mkdir(destDir);
      const copied: string[] = [];
      const manifest: Record<string, number> = {};
      for (const [name, open] of streams) {
        const dest = `${destDir}/${name}.jsonl`;
        // One record line per event, straight from the DB — byte-faithful
        // for ingested history (the raw line is what was stored).
        const rows = sqlQuery<{ record: string }>(db, 'SELECT record FROM events WHERE stream = ? ORDER BY id', [name]);
        const text = rows.map((r) => `${r.record}\n`).join('');
        host.__fs_write(dest, text);
        GAME_TELEMETRY.recordDiagnostic('worldStream', 'backup.copy', {
          stream: name,
          bytes: text.length,
          events: open.events.length,
        });
        manifest[name] = open.events.length;
        copied.push(dest);
      }
      const manifestPath = `${destDir}/manifest.json`;
      host.__fs_write(manifestPath, JSON.stringify({ exportedAt: nowMs(), globalSeq, streams: manifest }));
      copied.push(manifestPath);
      return copied;
    },
    quarantine: () => quarantined.slice(),
  };
}
