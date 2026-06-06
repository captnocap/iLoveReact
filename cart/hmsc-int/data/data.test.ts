// data.test.ts — P4 behavior tests for the V20 persistence layer.
//
// Runs under tools/v8cli against real __fs_* bindings, in a scratch root under
// zig-out/ (never the live data/ content). The contract under test IS V20:
// append-only per-concern logs, one total cross-session undo chain, an undo
// point at a log position, snapshots that equal the replayed state, schema
// evolution by addition, the explicit backup story, and the
// stream-without-snapshot incompleteness guard.

import { openStore } from './index';
import { assert, assertEqual, assertThrows, finish, test } from '../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-data';

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
    `${ROOT}/streams/world.jsonl`, `${ROOT}/streams/tuning.jsonl`, `${ROOT}/streams/later.jsonl`,
    `${ROOT}/streams/torn.jsonl`, `${ROOT}/streams/corrupt.jsonl`, `${ROOT}/streams/spliced.jsonl`,
    `${ROOT}/snapshots/world.snapshot.json`,
    `${ROOT}/snapshots/tuning.snapshot.json`, `${ROOT}/snapshots/later.snapshot.json`,
    `${ROOT}/backup/world.jsonl`, `${ROOT}/backup/tuning.jsonl`, `${ROOT}/backup/manifest.json`,
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
  const text = globalThis.__fs_read(`${ROOT}/streams/world.jsonl`);
  assertEqual(text.trim().split('\n').length, 2, 'the log file must carry one line per event');
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
  globalThis.__fs_remove?.(`${ROOT}/streams/seqs.jsonl`); // re-runs must not inherit prior seqs
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

test('the backup story: streams + manifest copy out, byte-faithful', () => {
  const store = openStore(ROOT);
  store.defineStream(WORLD);
  store.defineStream(TUNING);
  const copied = store.exportBackup(`${ROOT}/backup`);
  assertEqual(copied.length, 3, 'two streams + the manifest');
  assertEqual(
    globalThis.__fs_read(`${ROOT}/backup/world.jsonl`),
    globalThis.__fs_read(`${ROOT}/streams/world.jsonl`),
    'the backup must be byte-identical to the log',
  );
  const manifest = JSON.parse(globalThis.__fs_read(`${ROOT}/backup/manifest.json`));
  assertEqual(manifest.streams.world, 2, 'the manifest must count the world events');
});

test('a torn trailing line (crash mid-write) costs one event, never the chain', () => {
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
  // The seam guard: the append must NOT splice onto the torn bytes — a fresh
  // open parses every event written after the tear (the :884 regression).
  const reopened = openStore(ROOT).defineStream({ ...WORLD, name: 'torn' });
  assertEqual(reopened.state().placed.join(','), 'road,house', 'a reopen must replay everything around the tear');
});

test('a corrupt MID-FILE record is skipped + quarantined; the fold never throws (tolerance law)', () => {
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
  // and a later writer (pre-seam-guard) glued a full record onto it.
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

finish('data/store');
