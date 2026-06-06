// sessions.test.ts — P4 behavior tests for the route-scoped session history
// (editors/sessions.ts). The contract under test is the user's ruling: route
// opens a session on its channel, every interaction appends one edit-commit,
// session boundaries are recorded, the global sequence orders everything
// across channels, an undo point is a log position, replay is identical.
//
// Runs under tools/v8cli against real __fs_* bindings, in a scratch root
// under zig-out/ (never the live data/ content) — the data.test.ts idiom.

import { openStore } from '../data';
import { createSessionLog, sessionsOnRoute, type SessionsState } from './sessions';
import { assert, assertEqual, finish, test } from '../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-sessions';

type Garage = { docs: Record<string, string> };
type World = { placed: string[] };

const GARAGE = {
  name: 'vehicles',
  initial: (): Garage => ({ docs: {} }),
  apply: (state: Garage, event: any): Garage =>
    event?.kind === 'authored' ? { docs: { ...state.docs, [event.id]: String(event.doc) } } : state,
};
const WORLD = {
  name: 'world',
  initial: (): World => ({ placed: [] }),
  apply: (state: World, event: any): World =>
    event?.kind === 'cellPlaced' ? { placed: [...state.placed, String(event.tile)] } : state,
};

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/store.db`, `${ROOT}/store.db-wal`, `${ROOT}/store.db-shm`, // STOREDB-0606: the scratch store is a DB now
    `${ROOT}/streams/sessions.jsonl`, `${ROOT}/streams/vehicles.jsonl`, `${ROOT}/streams/world.jsonl`,
    `${ROOT}/snapshots/sessions.snapshot.json`, `${ROOT}/snapshots/vehicles.snapshot.json`,
    `${ROOT}/snapshots/world.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

test('an interaction is one edit-commit: content event + labeled marker', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const garage = store.defineStream(GARAGE);
  const ses = log.open('/vehicles', garage, 'ses-a');

  ses.commit({ kind: 'authored', id: 'car-1', doc: 'sedan' }, 'style → sedan');
  assertEqual(garage.length(), 1, 'the content event lands in the concern stream');
  assertEqual(garage.state().docs['car-1'], 'sedan', 'the channel materializes the content');

  const record = log.state().sessions['ses-a'];
  assert(!!record, 'the open marker creates the session record');
  assertEqual(record.route, '/vehicles', 'the session is route-scoped');
  assertEqual(record.channel, 'vehicles', 'the session names its channel');
  assertEqual(record.commits.length, 1, 'one interaction = one commit');
  assertEqual(record.commits[0].label, 'style → sedan', 'the commit carries its label');
  assertEqual(record.commits[0].at, record.commits[0].seq - 1,
    'the marker records its content event — appended immediately below it on the one chain');
});

test('session boundaries: open and close are recorded as log positions', () => {
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const garage = store.defineStream(GARAGE);
  const ses = log.open('/vehicles', garage, 'ses-b');
  const opened = log.state().sessions['ses-b'];
  assert(opened.openedSeq > 0 && opened.closedSeq === null, 'open marker recorded, still open');
  ses.commit({ kind: 'authored', id: 'car-2', doc: 'van' }, 'authored car-2');
  ses.close();
  ses.close(); // idempotent
  const closed = log.state().sessions['ses-b'];
  assert(closed.closedSeq !== null && closed.closedSeq! > closed.openedSeq, 'close marker recorded after open');
  assertEqual(closed.commits.length, 1, 'a double close never re-commits');
});

test('session scoping: each session holds only its own interactions', () => {
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const garage = store.defineStream(GARAGE);
  const world = store.defineStream(WORLD);
  const a = log.open('/vehicles', garage, 'ses-c');
  const b = log.open('/', world, 'ses-d');
  a.commit({ kind: 'authored', id: 'car-3', doc: 'sports' }, 'authored car-3');
  b.note('tile: painted 14 cells');
  a.commit({ kind: 'authored', id: 'car-3', doc: 'sports-red' }, 'paint');
  b.note('height: sculpted');

  const state = log.state();
  assertEqual(state.sessions['ses-c'].commits.length, 2, 'the vehicles session holds its two commits');
  assertEqual(state.sessions['ses-d'].commits.length, 2, 'the world session holds its two notes');
  assertEqual(state.sessions['ses-d'].commits.map((c) => c.label).join('|'),
    'tile: painted 14 cells|height: sculpted', 'notes keep their labels in order');
  assertEqual(state.sessions['ses-d'].commits[0].at, null, 'a note is a marker-only commit');

  const onRoot = sessionsOnRoute(state, '/');
  assertEqual(onRoot.length, 1, 'sessionsOnRoute answers "what did I do on this route"');
  assertEqual(onRoot[0].id, 'ses-d', 'and returns the right session');
});

test('cross-channel global ordering: every marker and event rides ONE chain', () => {
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const garage = store.defineStream(GARAGE);
  const world = store.defineStream(WORLD);
  const a = log.open('/vehicles', garage, 'ses-e');
  const b = log.open('/', world, 'ses-f');
  const p1 = a.commit({ kind: 'authored', id: 'car-4', doc: 'bus' }, 'authored car-4');
  const p2 = b.note('zone: painted');
  const p3 = a.commit({ kind: 'authored', id: 'car-4', doc: 'bus-long' }, 'stretched');
  assert(p1.globalSeq < p2.globalSeq && p2.globalSeq < p3.globalSeq,
    'interleaved commits across channels strictly increase on the global chain');
  const s = log.state();
  const eRec = s.sessions['ses-e'];
  const fRec = s.sessions['ses-f'];
  assert(eRec.commits[0].seq < fRec.commits[0].seq && fRec.commits[0].seq < eRec.commits[1].seq,
    'the session records preserve the cross-channel interleave');
});

test('undo-point resolution: stateAt(commit.seq) is the world as of that interaction', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const garage = store.defineStream(GARAGE);
  const world = store.defineStream(WORLD);
  const ses = log.open('/vehicles', garage, 'ses-g');
  const first = ses.commit({ kind: 'authored', id: 'car-1', doc: 'sedan' }, 'authored');
  world.append({ kind: 'cellPlaced', tile: 'road' }); // unrelated channel activity between interactions
  ses.commit({ kind: 'authored', id: 'car-1', doc: 'sedan-wrecked' }, 'wreck');

  assertEqual(garage.stateAt(first.globalSeq).docs['car-1'], 'sedan',
    'the channel as of the first commit predates the second interaction');
  assertEqual(garage.state().docs['car-1'], 'sedan-wrecked', 'the present keeps the full fold');
  const commits = log.state().sessions['ses-g'].commits;
  assertEqual(log.stateAt(commits[0].seq).sessions['ses-g'].commits.length, 1,
    'the session history itself time-travels to the same position');
  assertEqual(world.stateAt(commits[0].seq).placed.length, 0,
    'an undo point is ONE position valid across every channel');
});

test('replay = identical state: a fresh open folds the same history', () => {
  const before = {
    sessions: createSessionLog(openStore(ROOT)).state(),
    garage: openStore(ROOT).defineStream(GARAGE).state(),
  };
  const reopened = openStore(ROOT);
  const log = createSessionLog(reopened);
  const garage = reopened.defineStream(GARAGE);
  assertEqual(JSON.stringify(log.state()), JSON.stringify(before.sessions),
    'the sessions stream replays identically');
  assertEqual(JSON.stringify(garage.state()), JSON.stringify(before.garage),
    'the concern stream replays identically');
  const ses = log.open('/vehicles', garage, 'ses-h');
  ses.commit({ kind: 'authored', id: 'car-9', doc: 'taxi' }, 'authored after reload');
  assert(reopened.undoPoint() > 0, 'the chain keeps growing across sessions — one total chain');
});

test('a commit re-materializes snapshots; a note does not need to', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const garage = store.defineStream(GARAGE);
  const ses = log.open('/vehicles', garage, 'ses-i');
  ses.commit({ kind: 'authored', id: 'car-1', doc: 'sedan' }, 'authored');
  const snap = store.loadSnapshot<Garage>('vehicles');
  assert(snap !== null, 'the commit materialized the concern snapshot');
  assertEqual(snap!.state.docs['car-1'], 'sedan', 'and it carries the committed content');
  const sessionsSnap = store.loadSnapshot<SessionsState>('sessions');
  assert(sessionsSnap !== null, 'the sessions stream snapshots like any V20 stream');
  assertEqual(sessionsSnap!.state.sessions['ses-i'].commits.length, 1, 'with the commit history in it');
});

finish('editors/sessions');
