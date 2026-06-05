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
    `${ROOT}/streams/torn.jsonl`, `${ROOT}/snapshots/world.snapshot.json`,
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
  torn.append({ place: 'house' });
  assertEqual(torn.state().placed.join(','), 'road,house', 'the chain must keep appending after the tear');
});

finish('data/store');
