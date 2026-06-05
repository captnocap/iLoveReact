// data/index.ts — the V20 persistence layer: per-concern append-only streams,
// one total cross-session undo chain, materialized snapshots.
//
// THE RULES (V20, ruled):
//   - A state update writes to ITS concern's stream (data/streams/<name>.jsonl)
//     — never one monolithic blob. New feature = NEW stream; old streams stay
//     valid forever (schema evolution by addition, not migration).
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
// Git: stream/snapshot CONTENT is not git-tracked (.gitignore — git is the
// code time machine, these are the content time machine). The BACKUP STORY is
// explicit: store.exportBackup(destDir) copies every stream file + a manifest;
// restoring is copying them back into data/streams/. (Equivalent by hand:
// `tar czf streams-backup.tgz cart/hmsc-int/data/streams/`.)
//
// Host surface: only `__fs_*` globals (identical names under the cart host and
// tools/v8cli, so the same layer serves editors, compile/, and the P4 tests).
// The host has no append binding yet, so append = read + concat + write —
// SEMANTICALLY append-only (existing lines are never modified); a real
// `__fs_append` host fn is the queued bindings-lane follow-up (beside C2's
// `__fs_write_bytes`/`__fs_copy`). The reader skips a torn trailing line, so a
// crash mid-write costs at most the one in-flight event, never the chain.
//
// P2: nothing here owns a gameplay number. P3: openStore() is the only door.

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
  /** concern name — the stream's file stem (kebab-case, one word) */
  name: string;
  /** the empty materialized state */
  initial: () => State;
  /** one materializer step; MUST return a new/updated state, never throw on
   *  events it predates (additions arrive later — tolerate unknown shapes).
   *  `seq` is the event's own log position (its globalSeq) — V20 says an undo
   *  point IS a log position, so a materializer that records positions (the
   *  sessions stream) reads them here instead of guessing. Two-arg
   *  materializers ignore it. */
  apply: (state: State, event: Event, seq: number) => State;
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

export type Store = {
  defineStream: <State, Event>(def: StreamDef<State, Event>) => StreamHandle<State, Event>;
  /** the current undo-chain position — pass back to stateAt to time-travel */
  undoPoint: () => number;
  /** write data/snapshots/<name>.snapshot.json for EVERY registered stream */
  materializeSnapshots: () => string[];
  /** read one materialized view (what the game/compile consumes) */
  loadSnapshot: <State>(name: string) => { name: string; globalSeq: number; state: State } | null;
  /** the explicit backup story: copy every stream file + manifest to destDir */
  exportBackup: (destDir: string) => string[];
};

type StoredEvent = { seq: number; at: number; event: unknown };

const STREAM_NAME_SHAPE = /^[a-z][a-z0-9-]*$/;

function fs() {
  const host = globalThis;
  if (typeof host.__fs_read !== 'function' || typeof host.__fs_write !== 'function' || typeof host.__fs_mkdir !== 'function') {
    throw new Error('data store: __fs_* host bindings are missing');
  }
  return host;
}

function readLog(path: string): StoredEvent[] {
  const text = fs().__fs_read(path);
  if (typeof text !== 'string' || text === '') return [];
  const events: StoredEvent[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    try {
      events.push(JSON.parse(line) as StoredEvent);
    } catch {
      // A torn trailing line (crash mid-write) loses only the in-flight event.
      // Anything torn EARLIER would be a real corruption — surface it.
      if (i < lines.length - 1) throw new Error(`data store: corrupt record at ${path}:${i + 1}`);
    }
  }
  return events;
}

/**
 * Open the store rooted at <rootDir>/streams + <rootDir>/snapshots. The global
 * sequence resumes from the largest seq on disk — the undo chain is one chain
 * across every session that ever wrote here.
 */
export function openStore(rootDir: string): Store {
  const host = fs();
  const streamsDir = `${rootDir}/streams`;
  const snapshotsDir = `${rootDir}/snapshots`;
  host.__fs_mkdir(rootDir);
  host.__fs_mkdir(streamsDir);
  host.__fs_mkdir(snapshotsDir);

  type OpenStream = {
    def: StreamDef<any, any>;
    path: string;
    events: StoredEvent[];
    /** memoized fold of `events` (rebuilt after every append — appends are
     *  edit-rate, folds are cheap relative to the disk write beside them) */
    current: any;
  };
  const streams = new Map<string, OpenStream>();
  let globalSeq = 0;

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

    const path = `${streamsDir}/${def.name}.jsonl`;
    const events = readLog(path);
    for (const record of events) {
      if (record.seq > globalSeq) globalSeq = record.seq;
    }
    const open: OpenStream = { def, path, events, current: undefined };
    open.current = foldUpTo(open, Number.MAX_SAFE_INTEGER);
    streams.set(def.name, open);

    return {
      name: def.name,
      append: (event: Event): LogPosition => {
        globalSeq += 1;
        const record: StoredEvent = { seq: globalSeq, at: host.__nowMs ? host.__nowMs() : Date.now(), event };
        // Semantically append-only: existing lines never change. Whole-file
        // write is the host's only write today — see the header note.
        const existing = host.__fs_read(path);
        host.__fs_write(path, `${typeof existing === 'string' ? existing : ''}${JSON.stringify(record)}\n`);
        open.events.push(record);
        open.current = open.def.apply(open.current, event, record.seq);
        return { globalSeq: record.seq, stream: def.name, index: open.events.length - 1 };
      },
      state: () => open.current as State,
      stateAt: (seq: number) => foldUpTo(open, seq) as State,
      length: () => open.events.length,
    };
  };

  return {
    defineStream,
    undoPoint: () => globalSeq,
    materializeSnapshots: (): string[] => {
      const written: string[] = [];
      for (const [name, open] of streams) {
        const path = `${snapshotsDir}/${name}.snapshot.json`;
        host.__fs_write(path, JSON.stringify({ name, globalSeq, state: open.current }));
        written.push(path);
      }
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
        const text = host.__fs_read(open.path);
        host.__fs_write(dest, typeof text === 'string' ? text : '');
        manifest[name] = open.events.length;
        copied.push(dest);
      }
      const manifestPath = `${destDir}/manifest.json`;
      host.__fs_write(manifestPath, JSON.stringify({ exportedAt: host.__nowMs ? host.__nowMs() : Date.now(), globalSeq, streams: manifest }));
      copied.push(manifestPath);
      return copied;
    },
  };
}
