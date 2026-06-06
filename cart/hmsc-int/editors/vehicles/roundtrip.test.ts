// roundtrip.test.ts — P4: the /vehicles wiring's round trip, driven through
// the exact seam the route uses: pure edit steps (edits.ts) → session
// commits (editors/sessions.ts, one labeled edit-commit per interaction) →
// the 'vehicles' stream → materialized snapshot → a FRESH store reload —
// and buildVehicle output is identical on both sides of the reload.
//
// game/vehicle/stream.test.ts covers the raw stream; THIS suite covers the
// session-layer path the editor route actually drives.

import { openStore } from '../../data';
import { GAME_VEHICLE, vehiclesStream, type VehicleDoc, type VehiclesStreamState } from '@game';
import { createSessionLog, sessionsOnRoute } from '../sessions';
import { editGasSide, editRole, editStyle, generateVehicle, setGasZ, setPartDamage, wreck } from './edits';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-vehicles-session';

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/store.db`, `${ROOT}/store.db-wal`, `${ROOT}/store.db-shm`, // STOREDB-0606: the scratch store is a DB now
    `${ROOT}/streams/vehicles.jsonl`, `${ROOT}/streams/sessions.jsonl`,
    `${ROOT}/snapshots/vehicles.snapshot.json`, `${ROOT}/snapshots/sessions.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

test('author edits → session commits → snapshot → reload: buildVehicle identical', () => {
  wipeScratch();

  // ── the authoring session, exactly as the route drives it ────────────────
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const channel = store.defineStream(vehiclesStream);
  const ses = log.open('/vehicles', channel, 'ses-roundtrip');

  let doc: VehicleDoc = generateVehicle(20260604);
  ses.commit({ kind: 'authored', id: 'car-1', doc }, 'car-1: authored');
  doc = editStyle(doc, 'van');
  ses.commit({ kind: 'authored', id: 'car-1', doc }, 'car-1: style → van');
  doc = editRole(doc, 'police');
  ses.commit({ kind: 'authored', id: 'car-1', doc }, 'car-1: service → police');
  doc = editGasSide(doc, 1);
  ses.commit({ kind: 'authored', id: 'car-1', doc }, 'car-1: gas → passenger side');
  doc = setGasZ(doc, 1.1);
  ses.commit({ kind: 'authored', id: 'car-1', doc }, 'car-1: gas z → 1.10');
  doc = wreck(doc, 99);
  ses.commit({ kind: 'authored', id: 'car-1', doc }, 'car-1: wrecked');
  doc = setPartDamage(doc, 'hood', 2);
  ses.commit({ kind: 'authored', id: 'car-1', doc }, 'car-1: hood → dented');
  ses.close();

  const authoredBuild = JSON.stringify(GAME_VEHICLE.build(doc, []));

  // ── the reload: a fresh store (a new process), snapshot first (V20: the
  // game/compile loads snapshots, never the history) ───────────────────────
  const reloaded = openStore(ROOT);
  const snap = reloaded.loadSnapshot<VehiclesStreamState>('vehicles');
  assert(snap !== null, 'the vehicles snapshot exists after the session');
  const snapDoc = snap!.state.vehicles['car-1'];
  assertEqual(JSON.stringify(snapDoc), JSON.stringify(doc), 'the snapshot carries the authored doc exactly');
  assertEqual(JSON.stringify(GAME_VEHICLE.build(snapDoc, [])), authoredBuild,
    'buildVehicle output is identical after the reload — the round trip is exact');

  // ── and the replayed stream agrees with the snapshot ─────────────────────
  const replayed = reloaded.defineStream(vehiclesStream);
  assertEqual(JSON.stringify(replayed.state()), JSON.stringify(snap!.state),
    'replaying the log materializes the same garage the snapshot holds');

  // ── the session history survived too: 7 labeled commits, route-scoped ────
  const sessions = sessionsOnRoute(createSessionLog(reloaded).state(), '/vehicles');
  assertEqual(sessions.length, 1, 'the route has its one recorded session');
  assertEqual(sessions[0].commits.length, 7, 'every interaction is one edit-commit');
  assertEqual(sessions[0].commits[1].label, 'car-1: style → van', 'commits keep their interaction labels');
  assert(sessions[0].closedSeq !== null, 'the session boundary was recorded');

  // ── undo-point resolution across the reload: stepping back works ─────────
  const beforeWreck = sessions[0].commits[4]; // 'gas z → 1.10' — the state before the wreck
  const past = replayed.stateAt(beforeWreck.seq).vehicles['car-1'];
  assertEqual(JSON.stringify(past.damage), JSON.stringify({}),
    'as of the pre-wreck commit the car is undamaged — an undo point is a log position');
});

finish('editors/vehicles roundtrip');
