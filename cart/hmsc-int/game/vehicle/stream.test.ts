// stream.test.ts — P4 behavior tests for the V20 'vehicles' concern (the
// garage) and THE deletion-contract round-trip: author → stream → snapshot →
// buildVehicle output identical. Runs under tools/v8cli against real __fs_*
// bindings in a scratch root under zig-out/ (never the live data/ content).

import { openStore } from '../../data';
import { GAME_VEHICLE, buildVehicle, makeVehicle, vehiclesStream, type VehicleDoc } from './index';
import { assert, assertEqual, finish, test } from '../_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-vehicles-data';

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/store.db`, `${ROOT}/store.db-wal`, `${ROOT}/store.db-shm`, // STOREDB-0606: the scratch store is a DB now
    `${ROOT}/streams/vehicles.jsonl`,
    `${ROOT}/snapshots/vehicles.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

test('the garage materializes: authored docs upsert by id, removal forgets', () => {
  const seeded = makeVehicle(7);
  let state = vehiclesStream.initial();
  state = vehiclesStream.apply(state, { kind: 'authored', id: 'a', doc: seeded });
  state = vehiclesStream.apply(state, { kind: 'authored', id: 'b', doc: makeVehicle(8) });
  const repainted: VehicleDoc = { ...seeded, color: '#0f766e' };
  state = vehiclesStream.apply(state, { kind: 'authored', id: 'a', doc: repainted });
  assertEqual(state.order.join(','), 'a,b', 're-authoring must not duplicate the rail entry');
  assertEqual(state.vehicles.a.color, '#0f766e', 'an upsert carries the resulting doc');
  state = vehiclesStream.apply(state, { kind: 'removed', id: 'a' });
  assertEqual(state.order.join(','), 'b', 'removal drops the rail entry');
  assert(!('a' in state.vehicles), 'removal forgets the doc');
  const same = vehiclesStream.apply(state, { kind: 'removed', id: 'ghost' });
  assert(same === state, 'removing an unknown id is a no-op (same reference)');
});

test('unknown event kinds are tolerated (schema evolution by addition, V20)', () => {
  const state = vehiclesStream.apply(vehiclesStream.initial(), { kind: 'paintBooth', hue: 12 } as any);
  assertEqual(Object.keys(state.vehicles).length, 0, 'a future event must not corrupt an old materializer');
});

test('THE round-trip: author → stream → snapshot → buildVehicle identical', () => {
  wipeScratch();
  const authored = makeVehicle(20260604);
  const damaged: VehicleDoc = { ...authored, damage: { windshield: 2, gas_tank: 3, front_left_wheel: 1 } };

  const store = openStore(ROOT);
  const garage = store.defineStream(vehiclesStream);
  garage.append({ kind: 'authored', id: 'hero', doc: authored });
  garage.append({ kind: 'authored', id: 'hero', doc: damaged });
  store.materializeSnapshots();

  // A fresh store (a new session / the compile) loads the SNAPSHOT, never the history.
  const loaded = openStore(ROOT).loadSnapshot<{ vehicles: Record<string, VehicleDoc>; order: string[] }>('vehicles');
  assert(loaded !== null, 'the vehicles snapshot must exist');
  const restored = loaded!.state.vehicles.hero;
  assertEqual(JSON.stringify(restored), JSON.stringify(damaged), 'the doc must survive byte-exact');

  const before = buildVehicle(damaged, []);
  const after = buildVehicle(restored, []);
  assertEqual(JSON.stringify(after.meshes), JSON.stringify(before.meshes), 'meshes identical through the chain');
  assertEqual(JSON.stringify(after.hitboxes), JSON.stringify(before.hitboxes), 'hitboxes identical through the chain');
  assertEqual(JSON.stringify(after.anchors), JSON.stringify(before.anchors), 'anchors identical through the chain');
});

test('an undo point steps the garage back without rewriting the log', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const garage = store.defineStream(vehiclesStream);
  garage.append({ kind: 'authored', id: 'one', doc: makeVehicle(1) });
  const checkpoint = store.undoPoint();
  garage.append({ kind: 'authored', id: 'two', doc: makeVehicle(2) });
  garage.append({ kind: 'removed', id: 'one' });
  assertEqual(garage.stateAt(checkpoint).order.join(','), 'one', 'as-of the checkpoint only one exists');
  assertEqual(garage.state().order.join(','), 'two', 'the present keeps the full fold');
  assertEqual(garage.length(), 3, 'history is immutable — undo never rewrote the log');
});

test('the GAME_VEHICLE door carries the concern', () => {
  assertEqual(GAME_VEHICLE.stream, vehiclesStream, 'GAME_VEHICLE.stream is the V20 concern (like world/missions)');
  assertEqual(GAME_VEHICLE.stream.name, 'vehicles', 'the concern is named for its stream file');
});

finish('game/vehicle/stream');
