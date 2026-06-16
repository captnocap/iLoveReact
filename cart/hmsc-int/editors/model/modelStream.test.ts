// modelStream.test.ts — P4 behavior tests for the Studio model LIBRARY stream
// (editors/model/modelStream.ts, req_0998/req_1000). The contract: each model is
// a saved scene whose events ARE its branch; a model round-trips save → stream →
// snapshot → cold-reopen exactly; per-model isolation holds (edits never cross);
// the order ops + inverse events hold WITHIN a model; unknown kinds pass through.
//
// Runs under tools/v8cli against real __fs_* bindings in a scratch root under
// zig-out/ (never the live data/ content) — the sessions.test.ts idiom.

import { openStore } from '../../data';
import { libraryModels, modelParts, modelStream, type ModelEvent, type ModelStreamState, type StoredModel, type StoredPart } from './modelStream';
import { addMount, cuboid, setPivot } from './editMesh';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-modelstream';

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/store.db`, `${ROOT}/store.db-wal`, `${ROOT}/store.db-shm`,
    `${ROOT}/streams/sessions.jsonl`, `${ROOT}/streams/model.jsonl`,
    `${ROOT}/snapshots/sessions.snapshot.json`, `${ROOT}/snapshots/model.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

function part(id: string, name = id): StoredPart {
  return { id, name, mesh: cuboid(1, 1, 1), color: '#abc', visible: true, lift: 0.5, version: 0 };
}

function fold(events: ModelEvent[]): ModelStreamState {
  return events.reduce((s, e) => modelStream.apply(s, e), modelStream.initial());
}

const M = 'mdl-a';
function ids(parts: StoredPart[]): string { return parts.map((p) => p.id).join(','); }

test('a model round-trips save → stream → snapshot → cold reopen, exactly', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const channel = store.defineStream(modelStream);

  channel.append({ kind: 'modelCreated', model: M, name: 'new_mesh_001' });
  channel.append({ kind: 'partAdded', model: M, part: part('pt-1', 'Cube 1') });
  channel.append({ kind: 'partMeshUpdated', model: M, id: 'pt-1', mesh: cuboid(2, 3, 2) });
  store.materializeSnapshots();

  const reopened = openStore(ROOT);
  const ch2 = reopened.defineStream(modelStream);
  const lib = libraryModels(ch2.state());
  assertEqual(lib.length, 1, 'one model survives the reopen');
  assertEqual(lib[0].name, 'new_mesh_001', 'model name persisted');
  const parts = modelParts(ch2.state(), M);
  assertEqual(parts.length, 1, 'its part survives');
  assertEqual(parts[0].version, 1, 'the mesh edit bumped version');
  assertEqual(parts[0].mesh.verts.length, 8, 'the edited mesh round-trips as data');
});

test('per-model isolation: an edit on one model never touches another', () => {
  let s = fold([
    { kind: 'modelCreated', model: 'a', name: 'A' },
    { kind: 'modelCreated', model: 'b', name: 'B' },
    { kind: 'partAdded', model: 'a', part: part('a1') },
    { kind: 'partAdded', model: 'b', part: part('b1') },
  ]);
  assertEqual(libraryModels(s).length, 2, 'two models in the library');
  s = modelStream.apply(s, { kind: 'partRemoved', model: 'a', id: 'a1' });
  assertEqual(modelParts(s, 'a').length, 0, "a's part removed");
  assertEqual(modelParts(s, 'b').length, 1, "b's part untouched");
  // an edit for an unknown model is future noise, not a crash
  const s2 = modelStream.apply(s, { kind: 'partAdded', model: 'ghost', part: part('x') });
  assertEqual(libraryModels(s2).length, 2, 'an edit for an unknown model is ignored');
});

test('modelDeleted removes a saved model from the library, leaving siblings (req_1060)', () => {
  let s = fold([
    { kind: 'modelCreated', model: 'a', name: 'A' },
    { kind: 'modelCreated', model: 'b', name: 'B' },
    { kind: 'partAdded', model: 'a', part: part('a1') },
  ]);
  assertEqual(libraryModels(s).length, 2, 'two models before the delete');
  s = modelStream.apply(s, { kind: 'modelDeleted', model: 'a' });
  const lib = libraryModels(s);
  assertEqual(lib.length, 1, 'the deleted model is gone from the library');
  assertEqual(lib[0].id, 'b', 'the sibling survives, in order');
  assert(!s.models.a, 'the deleted model is dropped from the map (parts and all)');
  // deleting an unknown model is a no-op, not a crash (future/duplicate noise)
  const s2 = modelStream.apply(s, { kind: 'modelDeleted', model: 'ghost' });
  assertEqual(libraryModels(s2).length, 1, 'deleting an unknown model changes nothing');
});

test('order ops hold within a model: top-insert, insert-above, reorder, remove', () => {
  let s = fold([
    { kind: 'modelCreated', model: M, name: 'm' },
    { kind: 'partAdded', model: M, part: part('a') },
    { kind: 'partAdded', model: M, part: part('b') },
    { kind: 'partAdded', model: M, part: part('c') },
  ]);
  assertEqual(ids(modelParts(s, M)), 'c,b,a', 'top-insert stacks newest first');
  s = modelStream.apply(s, { kind: 'partAdded', model: M, part: part('b2'), afterId: 'c' });
  assertEqual(ids(modelParts(s, M)), 'c,b2,b,a', 'insert-above puts the copy over its source');
  s = modelStream.apply(s, { kind: 'partReordered', model: M, id: 'a', dir: 'up' });
  assertEqual(ids(modelParts(s, M)), 'c,b2,a,b', 'reorder up swaps with the neighbor');
  s = modelStream.apply(s, { kind: 'partRemoved', model: M, id: 'b2' });
  assertEqual(ids(modelParts(s, M)), 'c,a,b', 'remove drops it from the model');
});

test('unknown event kinds pass through untouched (V20 schema evolution)', () => {
  const s0 = fold([{ kind: 'modelCreated', model: M, name: 'm' }, { kind: 'partAdded', model: M, part: part('a') }]);
  const s1 = modelStream.apply(s0, { kind: 'partFutureThing', model: M, id: 'a' } as unknown as ModelEvent);
  assertEqual(modelParts(s1, M).length, 1, 'a future kind leaves the model intact');
});

test('a forward edit then its inverse returns the exact prior model state', () => {
  const base = fold([
    { kind: 'modelCreated', model: M, name: 'm' },
    { kind: 'partAdded', model: M, part: part('a') },
    { kind: 'partAdded', model: M, part: part('b') },
  ]);
  const before = base.models[M] as StoredModel;

  const renamed = modelStream.apply(base, { kind: 'partRenamed', model: M, id: 'a', name: 'Hand' });
  assertEqual(renamed.models[M].parts['a'].name, 'Hand', 'rename applied');
  const back = modelStream.apply(renamed, { kind: 'partRenamed', model: M, id: 'a', name: before.parts['a'].name });
  assertEqual(back.models[M].parts['a'].name, 'a', 'inverse rename restores the old name');

  const removed = modelStream.apply(base, { kind: 'partRemoved', model: M, id: 'a' });
  assertEqual(ids(modelParts(removed, M)), 'b', 'remove dropped a');
  const restored = modelStream.apply(removed, { kind: 'partAdded', model: M, part: before.parts['a'], afterId: 'b' });
  assertEqual(ids(modelParts(restored, M)), 'b,a', 'undo-of-delete restores a in place');
});

test('a part pivot + joints round-trip through partMeshUpdated reopen + undo (req_1025)', () => {
  // pivot + mounts ride EditMesh, so they persist via StoredPart.mesh and undo via
  // partMeshUpdated's inverse — no new event. Prove the whole loop.
  wipeScratch();
  const store = openStore(ROOT);
  const channel = store.defineStream(modelStream);
  channel.append({ kind: 'modelCreated', model: M, name: 'new_mesh_001' });
  channel.append({ kind: 'partAdded', model: M, part: part('pt-1', 'Wheel') });
  // rig it: set a pivot + add an axle hub joint (an EditMesh swap).
  const rigged = addMount(setPivot(cuboid(1, 1, 1), [0, 0.25, 0]), { name: 'hub', type: 'axle', kind: 'plug', position: [0, 0.25, 0], axis: [1, 0, 0], size: 0.3 });
  channel.append({ kind: 'partMeshUpdated', model: M, id: 'pt-1', mesh: rigged });
  store.materializeSnapshots();

  const reopened = openStore(ROOT);
  const ch2 = reopened.defineStream(modelStream);
  const p = modelParts(ch2.state(), M)[0];
  assert(JSON.stringify(p.mesh.pivot) === JSON.stringify([0, 0.25, 0]), 'the pivot survived the cold reopen');
  assertEqual(p.mesh.mounts!.length, 1, 'the joint survived the cold reopen');
  assertEqual(p.mesh.mounts![0].type, 'axle', 'the joint type round-trips');

  // undo (the partMeshUpdated inverse restores the pre-rig mesh: no pivot/mounts).
  const before = ch2.state().models[M] as StoredModel; // the rigged state
  void before;
  const undone = modelStream.apply(ch2.state(), { kind: 'partMeshUpdated', model: M, id: 'pt-1', mesh: cuboid(1, 1, 1) });
  const up = modelParts(undone, M)[0];
  assert(up.mesh.pivot === undefined, 'the inverse mesh has no pivot (undo restored the plain cube)');
  assert((up.mesh.mounts ?? []).length === 0, 'the inverse mesh has no joints');
});

test('a pre-req_0998 flat-parts snapshot is tolerated, not a crash', () => {
  // the OLD shape: a flat parts library, no `models`, part ids in `order`.
  const oldShape = { parts: { 'pt-x': part('pt-x') }, order: ['pt-x'] } as unknown as ModelStreamState;
  assertEqual(libraryModels(oldShape).length, 0, 'selectors discard the old shape without crashing');
  assertEqual(modelParts(oldShape, 'anything').length, 0, 'modelParts is safe on the old shape');
  // folding a new event on the old shape starts clean (the editor boots to new).
  const recovered = modelStream.apply(oldShape, { kind: 'modelCreated', model: M, name: 'fresh' });
  assertEqual(libraryModels(recovered).map((m) => m.name).join(','), 'fresh', 'a new model lands on a clean library');
});

finish('modelStream');
