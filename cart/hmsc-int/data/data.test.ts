// data.test.ts — P4 behavior tests for the V20 persistence layer.
//
// Runs under tools/v8cli against real __fs_* + __sql_* bindings, in scratch
// roots under zig-out/ (never the live data/ content). The contract under
// test IS V20: append-only per-concern logs, one total cross-session undo
// chain, an undo point at a log position, snapshots that equal the replayed
// state, schema evolution by addition, the explicit backup story, the
// stream-without-snapshot incompleteness guard — and, since STOREDB-0606,
// the sqlite backing's two non-negotiables: byte-faithful ingest of the
// legacy .jsonl archive (originals untouched) and two concurrent writer
// PROCESSES hammering one stream with zero corruption and a preserved total
// order.

import { openStore, openWorkspaceStore } from './index';
import { assert, assertEqual, assertThrows, finish, test } from '../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-data';
const WORKSPACE_ROOT = 'zig-out/game/test-data-workspace';

// ── hammer-child mode (the two-writer proof re-execs this very bundle) ──
// `tools/v8cli <this bundle> --hammer-child <root> <count> <writer>` opens
// the SAME store root and appends through the real door, then exits before
// any test registers. The parent test spawns two of these concurrently.
const argv: string[] = (() => {
  try {
    return typeof globalThis.__argv === 'function' ? JSON.parse(globalThis.__argv()) : [];
  } catch {
    return [];
  }
})();
if (argv[1] === '--hammer-child') {
  const root = argv[2];
  const count = Number(argv[3]) || 0;
  const writer = argv[4] || 'w';
  const store = openStore(root);
  const hammer = store.defineStream({ name: 'hammer', initial: () => 0, apply: (n: number) => n + 1 });
  for (let i = 0; i < count; i += 1) hammer.append({ writer, i });
  console.log('DONE');
  globalThis.__exit(0);
}

type World = { placed: string[] };
type Tuning = Record<string, number>;

const WORLD = {
  name: 'world',
  initial: (): World => ({ placed: [] }),
  apply: (state: World, event: any): World => ({ placed: [...state.placed, String(event.place)] }),
};
const TUNING = {
  name: 'tuning',
  initial: (): Tuning => ({}),
  apply: (state: Tuning, event: any): Tuning => ({ ...state, [event.key]: event.value }),
};

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/store.db`, `${ROOT}/store.db-wal`, `${ROOT}/store.db-shm`,
    `${ROOT}/streams/world.jsonl`, `${ROOT}/streams/tuning.jsonl`, `${ROOT}/streams/later.jsonl`,
    `${ROOT}/streams/torn.jsonl`, `${ROOT}/streams/corrupt.jsonl`, `${ROOT}/streams/spliced.jsonl`,
    `${ROOT}/streams/seqs.jsonl`, `${ROOT}/streams/legacy.jsonl`,
    `${ROOT}/snapshots/world.snapshot.json`,
    `${ROOT}/snapshots/tuning.snapshot.json`, `${ROOT}/snapshots/later.snapshot.json`,
    `${ROOT}/backup/world.jsonl`, `${ROOT}/backup/tuning.jsonl`, `${ROOT}/backup/legacy.jsonl`,
    `${ROOT}/backup/manifest.json`,
  ]) globalThis.__fs_remove?.(path);
}

function wipeWorkspaceScratch(): void {
  for (const path of [
    `${WORKSPACE_ROOT}/manifest.json`,
    `${WORKSPACE_ROOT}/store.db`, `${WORKSPACE_ROOT}/store.db-wal`, `${WORKSPACE_ROOT}/store.db-shm`,
    `${WORKSPACE_ROOT}/domains/world/store.db`, `${WORKSPACE_ROOT}/domains/world/store.db-wal`, `${WORKSPACE_ROOT}/domains/world/store.db-shm`,
    `${WORKSPACE_ROOT}/domains/world/snapshots/world.snapshot.json`,
    `${WORKSPACE_ROOT}/domains/world/snapshots/items.snapshot.json`,
    `${WORKSPACE_ROOT}/domains/items/store.db`, `${WORKSPACE_ROOT}/domains/items/store.db-wal`, `${WORKSPACE_ROOT}/domains/items/store.db-shm`,
    `${WORKSPACE_ROOT}/domains/items/snapshots/items.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

test('a stream without snapshot support cannot be registered (V20 guard)', () => {
  wipeScratch();
  const store = openStore(ROOT);
  assertThrows(() => (store.defineStream as any)({ name: 'world', initial: WORLD.initial }), 'missing apply must throw');
  assertThrows(() => (store.defineStream as any)({ name: 'world', apply: WORLD.apply }), 'missing initial must throw');
  assertThrows(() => (store.defineStream as any)({ ...WORLD, name: 'Bad Name' }), 'non-kebab names must throw');
  store.defineStream(WORLD);
  assertThrows(() => store.defineStream(WORLD), 'duplicate registration must throw');
});

test('appends land in the concern log and fold into the materialized state', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const world = store.defineStream(WORLD);
  const first = world.append({ place: 'road' });
  world.append({ place: 'house' });
  assertEqual(world.length(), 2, 'two events must be logged');
  assertEqual(world.state().placed.join(','), 'road,house', 'state must fold in order');
  assertEqual(first.stream, 'world', 'the position must name its stream');
  assertEqual(first.index, 0, 'the first event sits at log index 0');
  const dump = store.exportBackup(`${ROOT}/backup`);
  assert(dump.some((p) => p.endsWith('world.jsonl')), 'the backup must dump the stream');
  const text = globalThis.__fs_read(`${ROOT}/backup/world.jsonl`);
  assertEqual(text.trim().split('\n').length, 2, 'the log must carry one record line per event');
});

test('umbrella manifest routes streams to separate domain databases', () => {
  wipeWorkspaceScratch();
  const workspace = openWorkspaceStore(WORKSPACE_ROOT);
  const world = workspace.defineStream(WORLD);
  const items = workspace.defineStream({ ...WORLD, name: 'items' });
  world.append({ place: 'road' });
  items.append({ place: 'bat' });
  const written = workspace.materializeSnapshots();

  const manifest = JSON.parse(globalThis.__fs_read(`${WORKSPACE_ROOT}/manifest.json`));
  assertEqual(manifest.domains.world.path, 'domains/world', 'world domain is located by the master manifest');
  assertEqual(manifest.domains.items.path, 'domains/items', 'items domain is located by the master manifest');
  assertEqual(Object.keys(manifest.domains).sort().join(','),
    'activities,assist3d,buildings,characters,clothing-variants,cutout,items,materials,missions,sessions,tuning,vehicles,voxels,world',
    'the master manifest predeclares every editor stream domain');
  assert(written.some((p) => p.endsWith('domains/world/snapshots/world.snapshot.json')), 'world snapshot lands under the world domain');
  assert(written.some((p) => p.endsWith('domains/items/snapshots/items.snapshot.json')), 'items snapshot lands under the items domain');

  const worldDbItems = openStore(`${WORKSPACE_ROOT}/domains/world`).defineStream({ ...WORLD, name: 'items' });
  assertEqual(worldDbItems.length(), 0, 'items are not stored inside the world DB');
  const reopenedWorld = openStore(`${WORKSPACE_ROOT}/domains/world`).defineStream(WORLD);
  assertEqual(reopenedWorld.state().placed.join(','), 'road', 'the world DB reopens independently');
});

test('the undo chain survives sessions: a fresh open replays the same state', () => {
  const reopened = openStore(ROOT).defineStream(WORLD);
  assertEqual(reopened.state().placed.join(','), 'road,house', 'a new session must replay the log');
});

test('one TOTAL chain across streams; an undo point is a log position', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const world = store.defineStream(WORLD);
  const tuning = store.defineStream(TUNING);
  const p1 = world.append({ place: 'road' });
  const p2 = tuning.append({ key: 'gravity', value: 10 });
  const checkpoint = store.undoPoint();
  const p3 = world.append({ place: 'tower' });
  const p4 = tuning.append({ key: 'gravity', value: 3 });
  assert(p1.globalSeq < p2.globalSeq && p2.globalSeq < p3.globalSeq && p3.globalSeq < p4.globalSeq,
    'global seqs must strictly increase ACROSS streams');
  assertEqual(world.stateAt(checkpoint).placed.join(','), 'road', 'world as-of the checkpoint');
  assertEqual(tuning.stateAt(checkpoint).gravity, 10, 'tuning as-of the checkpoint');
  assertEqual(world.state().placed.join(','), 'road,tower', 'present state keeps the full fold');
  assertEqual(tuning.state().gravity, 3, 'present tuning keeps the last write');
});

test('a snapshot is the replayed state, stamped with its chain position', () => {
  const store = openStore(ROOT);
  const world = store.defineStream(WORLD);
  const tuning = store.defineStream(TUNING);
  const written = store.materializeSnapshots();
  assertEqual(written.length, 2, 'every registered stream must snapshot');
  const snap = store.loadSnapshot<World>('world');
  assert(snap !== null, 'the world snapshot must load');
  assertEqual(JSON.stringify(snap!.state), JSON.stringify(world.state()), 'snapshot must equal the replayed state');
  assertEqual(snap!.globalSeq, store.undoPoint(), 'snapshot must carry the chain position it materialized at');
  assertEqual(JSON.stringify(store.loadSnapshot('tuning')!.state), JSON.stringify(tuning.state()), 'every concern snapshots');
});

test('schema evolution by addition: a NEW stream leaves old streams untouched', () => {
  const store = openStore(ROOT);
  const world = store.defineStream(WORLD);
  const later = store.defineStream({
    name: 'later',
    initial: () => ({ count: 0 }),
    apply: (s: { count: number }) => ({ count: s.count + 1 }),
  });
  assertEqual(world.state().placed.join(','), 'road,tower', 'old stream state must be intact');
  assertEqual(later.length(), 0, 'the new stream starts empty');
  later.append({});
  assert(store.undoPoint() > 0, 'the new stream joins the same chain');
});

test('apply sees each event\'s log position (an undo point IS a log position)', () => {
  const store = openStore(ROOT);
  const seqs = store.defineStream({
    name: 'seqs',
    initial: (): number[] => [],
    apply: (s: number[], _event: any, seq: number): number[] => [...s, seq],
  });
  const a = seqs.append({});
  const b = seqs.append({});
  assertEqual(seqs.state().join(','), `${a.globalSeq},${b.globalSeq}`,
    'live appends hand the materializer the record seq');
  const replayed = openStore(ROOT).defineStream({
    name: 'seqs',
    initial: (): number[] => [],
    apply: (s: number[], _event: any, seq: number): number[] => [...s, seq],
  });
  assertEqual(replayed.state().join(','), seqs.state().join(','),
    'a disk replay folds the same positions');
});

test('the backup story: streams dump to .jsonl + manifest, one record line per event', () => {
  const store = openStore(ROOT);
  const world = store.defineStream(WORLD);
  store.defineStream(TUNING);
  const copied = store.exportBackup(`${ROOT}/backup`);
  assertEqual(copied.length, 3, 'two streams + the manifest');
  const lines = String(globalThis.__fs_read(`${ROOT}/backup/world.jsonl`)).trim().split('\n');
  assertEqual(lines.length, world.length(), 'one record line per event');
  const parsed = lines.map((l: string) => JSON.parse(l));
  assertEqual(parsed.map((r: any) => r.event.place).join(','), world.state().placed.join(','),
    'the dump must round-trip the events in order');
  const manifest = JSON.parse(globalThis.__fs_read(`${ROOT}/backup/manifest.json`));
  assertEqual(manifest.streams.world, world.length(), 'the manifest must count the world events');
});

test('INGEST: legacy .jsonl joins the DB byte-faithfully; the original is left untouched', () => {
  wipeScratch();
  // Deliberately odd-but-valid bytes: spacing, key order, floats. Ingest
  // must preserve the LINE, not a re-serialization of it.
  const lines = [
    '{"seq":1,"at":10,"event":{"place":"road"}}',
    '{ "at":20, "seq":2 ,"event": {"place":"house"} }',
    '{"seq":3,"at":30.5,"event":{"place":"tower","x":0.10}}',
  ];
  const original = `${lines.join('\n')}\n`;
  const path = `${ROOT}/streams/legacy.jsonl`;
  globalThis.__fs_write(path, original);
  const store = openStore(ROOT);
  const legacy = store.defineStream({ ...WORLD, name: 'legacy' });
  assertEqual(legacy.length(), 3, 'every archive record must fold');
  assertEqual(legacy.state().placed.join(','), 'road,house,tower', 'the archive folds in order');
  assert(store.undoPoint() >= 3, 'the chain resumes from the archive seqs');
  assertEqual(globalThis.__fs_read(path), original, 'the original .jsonl is NEVER touched — it is the archive');
  store.exportBackup(`${ROOT}/backup`);
  assertEqual(globalThis.__fs_read(`${ROOT}/backup/legacy.jsonl`), original,
    'the DB holds the archive bytes exactly — the dump reproduces the original byte-for-byte');
  // Re-open: the ingest marker must prevent a second import.
  const again = openStore(ROOT).defineStream({ ...WORLD, name: 'legacy' });
  assertEqual(again.length(), 3, 'a reopen must not double-ingest');
});

test('INGEST is tail-incremental: archive records appended AFTER the first import still land', () => {
  // The cutover window: an app instance still running the .jsonl-backed code
  // appends to the archive after another instance already imported it. The
  // archive is append-only, so "past the marker count" is exactly the tail.
  const path = `${ROOT}/streams/legacy.jsonl`;
  const tail = `${JSON.stringify({ seq: 9, at: 40, event: { place: 'dock' } })}\n${JSON.stringify({ seq: 10, at: 41, event: { place: 'pier' } })}\n`;
  globalThis.__fs_write(path, `${globalThis.__fs_read(path)}${tail}`);
  const store = openStore(ROOT);
  const legacy = store.defineStream({ ...WORLD, name: 'legacy' });
  assertEqual(legacy.length(), 5, 'the tail must be imported, the head must not duplicate');
  assertEqual(legacy.state().placed.join(','), 'road,house,tower,dock,pier', 'head + tail fold in order');
  const once_more = openStore(ROOT).defineStream({ ...WORLD, name: 'legacy' });
  assertEqual(once_more.length(), 5, 'a further reopen with no new tail imports nothing');
});

test('INGEST markers are spelling-independent: an absolute-path reopen must not re-import', () => {
  // The 2026-06-06 live-store double-import: markers keyed by the caller's
  // spelling of rootDir let a relative-path open and an absolute-path open
  // of the SAME store each import the archive. Keys are rootDir-relative now.
  if (typeof globalThis.__cwd !== 'function') {
    console.warn('data.test: __cwd unavailable in this host — spelling check only runs under tools/v8cli');
    return;
  }
  const viaAbs = openStore(`${globalThis.__cwd()}/${ROOT}`).defineStream({ ...WORLD, name: 'legacy' });
  assertEqual(viaAbs.length(), 5, 'another spelling of the same root must see the ingested history, never re-import it');
});

test('a torn trailing line (crash mid-write) costs one event, never the chain', () => {
  wipeScratch();
  const path = `${ROOT}/streams/torn.jsonl`;
  globalThis.__fs_write(path, `${JSON.stringify({ seq: 1, at: 0, event: { place: 'road' } })}\n{"seq":2,"at":0,"ev`);
  const store = openStore(ROOT);
  const torn = store.defineStream({ ...WORLD, name: 'torn' });
  assertEqual(torn.length(), 1, 'the intact record must survive');
  assertEqual(torn.state().placed.join(','), 'road', 'the fold must use what survived');
  assertEqual(store.quarantine().length, 1, 'the torn line must be quarantined, not silently dropped');
  assert(store.quarantine()[0].trailing, 'a last-line tear is the ordinary crash-mid-write case');
  torn.append({ place: 'house' });
  assertEqual(torn.state().placed.join(','), 'road,house', 'the chain must keep appending after the tear');
  const reopened = openStore(ROOT).defineStream({ ...WORLD, name: 'torn' });
  assertEqual(reopened.state().placed.join(','), 'road,house', 'a reopen must replay everything around the tear');
});

test('a corrupt MID-FILE record is skipped + quarantined; the fold never throws (tolerance law)', () => {
  wipeScratch();
  const path = `${ROOT}/streams/corrupt.jsonl`;
  const garbage = '{"seq":2,"at":0,"event":{"place":"NOT JSON';
  globalThis.__fs_write(path, [
    JSON.stringify({ seq: 1, at: 0, event: { place: 'road' } }),
    garbage,
    JSON.stringify({ seq: 3, at: 0, event: { place: 'house' } }),
    '',
  ].join('\n'));
  const store = openStore(ROOT);
  const stream = store.defineStream({ ...WORLD, name: 'corrupt' });
  assertEqual(stream.length(), 2, 'every valid record must survive a mid-file corruption');
  assertEqual(stream.state().placed.join(','), 'road,house', 'the fold must continue past the corrupt record');
  const q = store.quarantine();
  assertEqual(q.length, 1, 'the corrupt record must be quarantined in memory');
  assertEqual(q[0].line, 2, 'the quarantine must carry the 1-based line number');
  assertEqual(q[0].raw, garbage, 'the quarantine must keep the bytes exactly as they sit on disk');
  assert(!q[0].trailing, 'a mid-file corruption is not the ordinary trailing tear');
  assert(store.undoPoint() >= 3, 'the global sequence must resume from the valid records');
});

test('the :884 shape — a record spliced onto torn bytes — is quarantined, never a repair write', () => {
  // Reproduces sessions.jsonl:884: an interrupted write left a torn record,
  // and a later writer (pre-DB, no seam guard) glued a full record onto it.
  wipeScratch();
  const path = `${ROOT}/streams/spliced.jsonl`;
  const spliced = '{"seq":2,"at":0,"event":{"kind":"c{"seq":7,"at":9,"event":{"place":"lost"}}';
  const before = `${JSON.stringify({ seq: 1, at: 0, event: { place: 'road' } })}\n${spliced}\n${JSON.stringify({ seq: 8, at: 9, event: { place: 'house' } })}\n`;
  globalThis.__fs_write(path, before);
  const store = openStore(ROOT);
  const stream = store.defineStream({ ...WORLD, name: 'spliced' });
  assertEqual(stream.state().placed.join(','), 'road,house', 'the records around the splice must fold');
  assertEqual(store.quarantine().length, 1, 'the spliced line is one quarantined record');
  assertEqual(globalThis.__fs_read(path), before, 'the file is NEVER rewritten — no repair writes, append-only is sacred');
});

test('two writer PROCESSES hammering one stream: zero corruption, total order preserved (STOREDB-0606 proof)', () => {
  if (typeof globalThis.__spawn !== 'function' || typeof globalThis.__childReadLine !== 'function') {
    console.warn('data.test: __spawn unavailable in this host — the two-writer proof only runs under tools/v8cli');
    return;
  }
  const HROOT = 'zig-out/game/test-data-hammer';
  for (const f of ['store.db', 'store.db-wal', 'store.db-shm']) globalThis.__fs_remove?.(`${HROOT}/${f}`);
  const self = argv[0];
  const N = 150;
  const a = globalThis.__spawn('tools/v8cli', JSON.stringify([self, '--hammer-child', HROOT, String(N), 'a']));
  const b = globalThis.__spawn('tools/v8cli', JSON.stringify([self, '--hammer-child', HROOT, String(N), 'b']));
  assert(a >= 0 && b >= 0, 'both writer processes must spawn');
  const waitDone = (id: number): boolean => {
    for (let tries = 0; tries < 120; tries += 1) {
      const line = globalThis.__childReadLine(id, 1000);
      if (line === null || line === undefined) continue;
      if (String(line).includes('DONE')) return true;
    }
    return false;
  };
  assert(waitDone(a), 'writer a must finish its appends');
  assert(waitDone(b), 'writer b must finish its appends');

  const store = openStore(HROOT);
  const seqs: number[] = [];
  const perWriter: Record<string, number[]> = { a: [], b: [] };
  const hammer = store.defineStream({
    name: 'hammer',
    initial: (): number => 0,
    apply: (n: number, e: any, seq?: number): number => {
      seqs.push(seq ?? -1);
      if (perWriter[e.writer]) perWriter[e.writer].push(e.i);
      return n + 1;
    },
  });
  assertEqual(hammer.length(), N * 2, 'every append from BOTH writers must land — nothing torn, nothing lost');
  assertEqual(new Set(seqs).size, seqs.length, 'no duplicate seqs — the 4077 double-mint is impossible now');
  for (let i = 1; i < seqs.length; i += 1) {
    assert(seqs[i] > seqs[i - 1], 'the chain is strictly increasing in physical order — one total order');
  }
  for (const w of ['a', 'b']) {
    assertEqual(perWriter[w].length, N, `writer ${w} landed all of its appends`);
    for (let i = 0; i < perWriter[w].length; i += 1) {
      assertEqual(perWriter[w][i], i, `writer ${w}'s own submission order is preserved`);
    }
  }
  assertEqual(store.quarantine().length, 0, 'zero corruption under concurrency');
});

test('SNAPBOOT: a reopen boots from the snapshot + tail, never the full history', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const world = store.defineStream(WORLD);
  world.append({ place: 'road' });
  world.append({ place: 'house' });
  store.materializeSnapshots();
  const checkpoint = store.undoPoint();
  world.append({ place: 'tower' }); // the tail — appended AFTER the snapshot
  // Direct proof the snapshot is the boot base (not a full replay that merely
  // matches): plant a sentinel in the snapshot's state. A snapshot+tail boot
  // shows the sentinel + the tail; a full replay would show the log only.
  const snapPath = `${ROOT}/snapshots/world.snapshot.json`;
  const snap = JSON.parse(globalThis.__fs_read(snapPath));
  globalThis.__fs_write(snapPath, JSON.stringify({ ...snap, state: { placed: ['SENTINEL', 'house'] } }));
  const rebooted = openStore(ROOT).defineStream(WORLD);
  assertEqual(rebooted.state().placed.join(','), 'SENTINEL,house,tower',
    'boot must fold the TAIL onto the SNAPSHOT state, not refold the log');
  assertEqual(rebooted.length(), 3, 'length counts snapshot-folded events + the tail');
  assertEqual(rebooted.stateAt(checkpoint).placed.join(','), 'road,house',
    'the undo time machine pages the REAL history from the DB — snapshot boot never warps stateAt');
});

test('SNAPBOOT seam guard: a snapshot the DB disagrees with falls back to full replay', () => {
  // The stale-snapshot hazard: events with seq <= snapshot.globalSeq landing
  // AFTER the snapshot was written (e.g. a legacy archive ingested late).
  // The folded-event count catches it; boot must take the full-replay road.
  const snapPath = `${ROOT}/snapshots/world.snapshot.json`;
  const snap = JSON.parse(globalThis.__fs_read(snapPath));
  globalThis.__fs_write(snapPath, JSON.stringify({ ...snap, events: snap.events + 1, state: { placed: ['SENTINEL'] } }));
  const rebooted = openStore(ROOT).defineStream(WORLD);
  assertEqual(rebooted.state().placed.join(','), 'road,house,tower',
    'a seam mismatch must reject the snapshot and refold the whole log');
  assertEqual(rebooted.length(), 3, 'the fallback counts the real log');
});

test('SNAPBOOT tolerates pre-SNAPBOOT and damaged snapshots (full replay, never a throw)', () => {
  const snapPath = `${ROOT}/snapshots/world.snapshot.json`;
  const snap = JSON.parse(globalThis.__fs_read(snapPath));
  // the old shape: no `events` count — unverifiable seam, full replay once
  globalThis.__fs_write(snapPath, JSON.stringify({ name: snap.name, globalSeq: snap.globalSeq, state: { placed: ['SENTINEL'] } }));
  const oldShape = openStore(ROOT).defineStream(WORLD);
  assertEqual(oldShape.state().placed.join(','), 'road,house,tower', 'a pre-SNAPBOOT snapshot takes the fallback');
  // damaged bytes — tolerance law: warn + fallback, never throw
  globalThis.__fs_write(snapPath, '{"name":"world","globa');
  const damaged = openStore(ROOT).defineStream(WORLD);
  assertEqual(damaged.state().placed.join(','), 'road,house,tower', 'a damaged snapshot takes the fallback');
  // and the next materialize writes the verifiable shape again
  const store = openStore(ROOT);
  store.defineStream(WORLD);
  store.materializeSnapshots();
  const rewritten = JSON.parse(globalThis.__fs_read(snapPath));
  assertEqual(rewritten.events, 3, 'materialize stamps the folded-event count (the seam guard)');
});

finish('data/store');
