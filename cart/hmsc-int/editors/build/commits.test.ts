// editors/build commit behavior tests (P4) — the /build route's session
// contract on a REAL on-disk store (the sessions.test.ts scratch idiom):
// one placement = ONE labeled commit on the WORLD channel; a prefab stamp is
// ONE commit landing N pieces; the materialized world stream is the one
// placed-piece truth and an undo point steps placements back.

import { openStore } from '../../data';
import { createSessionLog } from '../sessions';
import { worldStream } from '@game';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-build-commits';

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/streams/sessions.jsonl`, `${ROOT}/streams/world.jsonl`,
    `${ROOT}/snapshots/sessions.snapshot.json`, `${ROOT}/snapshots/world.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

test('click places: each placement is one labeled commit on the world channel', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const world = store.defineStream(worldStream);
  const ses = log.open('/build', world, 'ses-build-a');

  ses.commit({ kind: 'piecePlaced', placement: { pieceId: 'wall.concrete.common', x: 0, y: 0, z: 4, yawDegrees: 90 } }, 'placed Concrete Wall @ 0,4');
  ses.commit({ kind: 'piecePlaced', placement: { pieceId: 'floor.concrete.common', x: 2, y: 0, z: 2, yawDegrees: 0 } }, 'placed Concrete Floor @ 2,2');
  ses.commit({ kind: 'pieceEditSet', id: 'bp_1', edit: 'door' }, 'bp_1: edit → door');

  const record = log.state().sessions['ses-build-a'];
  assertEqual(record.commits.length, 3, 'three interactions, three commits');
  assertEqual(record.channel, 'world', 'on the WORLD channel');
  assertEqual(record.commits[0].label, 'placed Concrete Wall @ 0,4', 'each commit carries its label');
  assertEqual(world.state().pieces.length, 2, 'the channel materializes the placements');
  assertEqual(world.state().pieces[0].edit, 'door', 'the edit landed piece-granular');
  ses.close();
});

test('a prefab stamp is ONE commit that lands its semantic pieces', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const world = store.defineStream(worldStream);
  const ses = log.open('/build', world, 'ses-build-b');

  ses.commit({
    kind: 'prefabDefined',
    def: { id: 'prefab.hut', label: 'Hut', theme: 'common', pieces: [
      { pieceId: 'wall.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0, edit: 'door' },
      { pieceId: 'wall.concrete.common', x: 0, y: 0, z: 3, yawDegrees: 0 },
    ] },
  }, 'prefab Hut (2 pieces)');
  ses.commit({ kind: 'prefabStamped', prefabId: 'prefab.hut', origin: { x: 10, y: 0, z: 10 }, yawDegrees: 0 }, 'stamped Hut @ 10,10');
  ses.commit({ kind: 'prefabStamped', prefabId: 'prefab.hut', origin: { x: 20, y: 0, z: 10 }, yawDegrees: 0 }, 'stamped Hut @ 20,10');

  const record = log.state().sessions['ses-build-b'];
  assertEqual(record.commits.length, 3, 'define + two stamps = three commits (a stamp is ONE authoring action)');
  assertEqual(world.state().pieces.length, 4, 'each stamp decomposed to its semantic pieces');
  assert(world.state().pieces.filter((p) => p.edit === 'door').length === 2, 'the cloned doorway is a doorway in both stamps');
  ses.close();
});

test('an undo point steps placements back (V20: the commit position is the undo point)', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const world = store.defineStream(worldStream);
  const ses = log.open('/build', world, 'ses-build-c');

  const first = ses.commit({ kind: 'piecePlaced', placement: { pieceId: 'wall.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0 } }, 'placed wall 1');
  ses.commit({ kind: 'piecePlaced', placement: { pieceId: 'wall.concrete.common', x: 3, y: 0, z: 0, yawDegrees: 0 } }, 'placed wall 2');

  assertEqual(world.state().pieces.length, 2, 'both stand now');
  assertEqual(world.stateAt(first.globalSeq).pieces.length, 1, 'as of the first commit, one stood');
  ses.close();
});

finish('build-commits');
