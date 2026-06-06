// bus.test.ts — P4 behavior tests for the session event bus fold
// (editors/settings/bus.ts). The contract: the bus is a pure read over the
// 'sessions' stream's materialized state — every route's commits/notes in
// one list, ordered by the global sequence (newest first), filterable per
// channel, with honest per-channel counts. Built against REAL session-layer
// machinery (createSessionLog on a scratch store), not hand-mocked state —
// if sessions.ts changes shape, this suite is supposed to feel it.

import { openStore } from '../../data';
import { createSessionLog } from '../sessions';
import { busChannels, busRows, filterBusRows } from './bus';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-settings-bus';

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/store.db`, `${ROOT}/store.db-wal`, `${ROOT}/store.db-shm`, // STOREDB-0606: the scratch store is a DB now
    `${ROOT}/streams/sessions.jsonl`, `${ROOT}/streams/vehicles.jsonl`,
    `${ROOT}/streams/world.jsonl`, `${ROOT}/streams/tuning.jsonl`,
    `${ROOT}/snapshots/sessions.snapshot.json`, `${ROOT}/snapshots/vehicles.snapshot.json`,
    `${ROOT}/snapshots/world.snapshot.json`, `${ROOT}/snapshots/tuning.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

type Doc = { docs: Record<string, string> };
const channelDef = (name: string) => ({
  name,
  initial: (): Doc => ({ docs: {} }),
  apply: (state: Doc, event: any): Doc =>
    event?.kind === 'authored' ? { docs: { ...state.docs, [event.id]: String(event.doc) } } : state,
});

/** three routes interleaving on the one store — the bus's real input shape */
function exercise() {
  wipeScratch();
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const vehicles = store.defineStream(channelDef('vehicles'));
  const world = store.defineStream(channelDef('world'));
  const tuning = store.defineStream(channelDef('tuning'));

  const sesV = log.open('/vehicles', vehicles, 'ses-v');
  const sesW = log.open('/', world, 'ses-w');
  const sesT = log.open('/settings', tuning, 'ses-t');
  sesV.commit({ kind: 'authored', id: 'car-1', doc: 'a' }, 'car-1: authored');
  sesW.note('city: tile: painted road');
  sesT.commit({ kind: 'authored', id: 'paint.brushPx', doc: '64' }, 'paint.brushPx → 64');
  sesV.commit({ kind: 'authored', id: 'car-1', doc: 'b' }, 'car-1: style → van');
  sesW.note('city: camera: camera moved');
  sesV.close();
  return { log, state: log.state() };
}

test('busRows flattens every route, newest first on the global seq', () => {
  const { state } = exercise();
  const rows = busRows(state);
  assertEqual(rows.length, 5, 'every commit/note from every route is one row');
  for (let i = 1; i < rows.length; i += 1) {
    assert(rows[i - 1].seq > rows[i].seq, 'rows are strictly seq-descending');
  }
  assertEqual(rows[0].label, 'city: camera: camera moved', 'the newest interaction leads');
  assertEqual(rows[4].label, 'car-1: authored', 'the oldest interaction trails');
  // cross-channel interleave preserved: vehicles, world, tuning, vehicles, world
  assertEqual(rows.map((r) => r.channel).join(','), 'world,vehicles,tuning,world,vehicles',
    'ordering is the one global sequence, not per-channel grouping');
});

test('rows carry route, channel, session and the content position grade', () => {
  const { state } = exercise();
  const rows = busRows(state);
  const commitRow = rows.find((r) => r.label === 'car-1: style → van')!;
  assertEqual(commitRow.route, '/vehicles', 'route rides the row');
  assertEqual(commitRow.session, 'ses-v', 'session id rides the row');
  assert(commitRow.at !== null, 'commit-grade rows carry the content position');
  const noteRow = rows.find((r) => r.label === 'city: tile: painted road')!;
  assertEqual(noteRow.at, null, 'note-grade rows are marker-only');
});

test('filterBusRows scopes per channel; null is everything', () => {
  const { state } = exercise();
  const rows = busRows(state);
  assertEqual(filterBusRows(rows, null).length, 5, 'null filter passes all');
  const vehicles = filterBusRows(rows, 'vehicles');
  assertEqual(vehicles.length, 2, 'channel filter scopes');
  assert(vehicles.every((r) => r.channel === 'vehicles'), 'only the channel survives');
  assertEqual(filterBusRows(rows, 'no-such').length, 0, 'unknown channel filters to empty');
});

test('busChannels rolls up routes, counts and open sessions per channel', () => {
  const { state } = exercise();
  const channels = busChannels(state);
  assertEqual(channels.length, 3, 'one summary per channel');
  const vehicles = channels.find((c) => c.channel === 'vehicles')!;
  assertEqual(vehicles.commits, 2, 'commit count is per channel');
  assertEqual(vehicles.sessions, 1, 'session count is per channel');
  assertEqual(vehicles.open, 0, 'a closed session is not open');
  assertEqual(vehicles.routes.join(','), '/vehicles', 'owning routes listed');
  const world = channels.find((c) => c.channel === 'world')!;
  assertEqual(world.open, 1, 'a session without a close marker counts open');
  assertEqual(world.commits, 2, 'note-grade markers count as commits');
});

test('the fold reads identically after a replay (V20: state is the log)', () => {
  exercise();
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const rows = busRows(log.state());
  assertEqual(rows.length, 5, 'a fresh process folds the same bus');
  assertEqual(rows[0].label, 'city: camera: camera moved', 'same ordering after replay');
  const channels = busChannels(log.state());
  assertEqual(channels.find((c) => c.channel === 'vehicles')?.commits, 2, 'same counts after replay');
});

finish('settings-bus');
