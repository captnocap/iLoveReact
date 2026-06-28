// modelStream.test.ts — P4 behavior tests for the Studio model LIBRARY stream
// (editors/model/modelStream.ts, req_0998/req_1000). The contract: each model is
// a saved scene whose events ARE its branch; a model round-trips save → stream →
// snapshot → cold-reopen exactly; per-model isolation holds (edits never cross);
// the order ops + inverse events hold WITHIN a model; unknown kinds pass through.
//
// Runs under tools/v8cli against real __fs_* bindings in a scratch root under
// zig-out/ (never the live data/ content) — the sessions.test.ts idiom.

import { openStore } from '../../data';
import { libraryModels, modelParts, modelStream, slotColor, type ModelEvent, type ModelStreamState, type Palette, type StoredModel, type StoredPart } from './modelStream';
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

test('paint + palette are BRANCH data: round-trip reopen + apply/inverse (req_1288)', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const channel = store.defineStream(modelStream);
  channel.append({ kind: 'modelCreated', model: M, name: 'new_mesh_001' });
  channel.append({ kind: 'partAdded', model: M, part: part('pt-1', 'Body') });
  const paint = { '0:1:2': 0, '0:1:3': 0, '2:0:0': 1 };
  channel.append({ kind: 'partPaintUpdated', model: M, id: 'pt-1', paint });
  const palette: Palette = { variant: 1, slots: [{ id: 0, name: 'Body', pseudo: '#f00', kind: 'color', colors: ['#a00', '#0a0', '#00a'] }] };
  channel.append({ kind: 'modelPaletteSet', model: M, palette });
  store.materializeSnapshots();

  const reopened = openStore(ROOT);
  const ch2 = reopened.defineStream(modelStream);
  const p = modelParts(ch2.state(), M)[0];
  assert(JSON.stringify(p.paint) === JSON.stringify(paint), 'the paint layer survived the cold reopen');
  assertEqual(p.version, 0, 'partPaintUpdated leaves version untouched (no geometry rebake)');
  const m = ch2.state().models[M] as StoredModel;
  assertEqual(m.palette!.slots[0].name, 'Body', 'the palette survived the cold reopen');
  assertEqual(slotColor(m.palette, 0), '#0a0', 'slotColor resolves variant 1 → the 2nd colour');

  // inverse (undo): repaint the prior layer restores it exactly; same for the palette.
  const before = ch2.state().models[M] as StoredModel;
  const cleared = modelStream.apply(ch2.state(), { kind: 'partPaintUpdated', model: M, id: 'pt-1', paint: {} });
  assertEqual(Object.keys(modelParts(cleared, M)[0].paint!).length, 0, 'an empty layer clears the paint');
  const back = modelStream.apply(cleared, { kind: 'partPaintUpdated', model: M, id: 'pt-1', paint: before.parts['pt-1'].paint! });
  assert(JSON.stringify(modelParts(back, M)[0].paint) === JSON.stringify(paint), 'the inverse paint restores the exact prior layer');
});

test('paint-blob GC: a re-bake drops the model superseded blob, keeps shared ones (req_1556)', () => {
  // every stroke bakes a NEW full-atlas blob; the prior one is dead weight. The
  // materializer must drop it (else the store grows ~2 MB/stroke → 444 MB snapshot
  // OOM → empty roster, the bug this fixes).
  const s1 = fold([
    { kind: 'modelCreated', model: 'a', name: 'A' },
    { kind: 'modelPaintBaked', model: 'a', paintRef: 'h1', blobB64: 'AAAA' },
    { kind: 'modelPaintBaked', model: 'a', paintRef: 'h2', blobB64: 'BBBB' },
  ] as ModelEvent[]);
  assertEqual(Object.keys(s1.paintBlobs ?? {}).sort().join(','), 'h2', 'the superseded blob h1 is GC-dropped; only the live h2 remains');
  assertEqual(s1.models['a'].paintRef, 'h2', 'the model points at its current paint');
  // a blob SHARED by another model is NOT dropped when one model moves off it.
  const s2 = fold([
    { kind: 'modelCreated', model: 'a', name: 'A' },
    { kind: 'modelCreated', model: 'b', name: 'B' },
    { kind: 'modelPaintBaked', model: 'a', paintRef: 'shared', blobB64: 'XX' },
    { kind: 'modelPaintBaked', model: 'b', paintRef: 'shared', blobB64: 'XX' },
    { kind: 'modelPaintBaked', model: 'a', paintRef: 'anew', blobB64: 'YY' },
  ] as ModelEvent[]);
  assertEqual(Object.keys(s2.paintBlobs ?? {}).sort().join(','), 'anew,shared', 'shared blob survives because b still references it');
});

test('surface decals persist on the model, replace wholesale, and clear when emptied (req_1730)', () => {
  const doc = { version: 1 as const, width: 256, height: 128, bg: '', nodes: [] };
  const decalA = { id: 'L1', partId: 'pt-1', faceIndex: 3, u: 0.5, v: 0.5, scale: 1, doc };
  const decalB = { id: 'L2', partId: 'pt-1', faceIndex: 7, u: 0.25, v: 0.75, scale: 2, doc };
  const s1 = fold([
    { kind: 'modelCreated', model: 'a', name: 'A' },
    { kind: 'modelDecalsSet', model: 'a', decals: [decalA] },
  ] as ModelEvent[]);
  assertEqual(s1.models['a'].decals?.length, 1, 'a decal persists on the model');
  assertEqual(s1.models['a'].decals?.[0].faceIndex, 3, 'the decal carries its face anchor');
  // a whole-list replace swaps the set (the branch-save shape).
  const s2 = modelStream.apply(s1, { kind: 'modelDecalsSet', model: 'a', decals: [decalA, decalB] });
  assertEqual(s2.models['a'].decals?.length, 2, 'a later set replaces the whole list');
  // an empty list clears decals back to absent (snapshot stays tidy).
  const s3 = modelStream.apply(s2, { kind: 'modelDecalsSet', model: 'a', decals: [] });
  assertEqual(s3.models['a'].decals, undefined, 'an empty set clears decals to absent');
  // a decal set for an unknown model is future noise, not a crash.
  const s4 = modelStream.apply(s3, { kind: 'modelDecalsSet', model: 'ghost', decals: [decalA] });
  assertEqual(s4, s3, 'a decal set for an unknown model is a no-op');
});

test('a model carries its seat rig (whole-list replace, empty clears) — req_2028-2030', () => {
  const seatFace = { part: 'pt-1', face: 0, bodyPart: 'seat' as const };
  const backFace = { part: 'pt-1', face: 3, bodyPart: 'back' as const };
  const s1 = fold([
    { kind: 'modelCreated', model: 'a', name: 'A' },
    { kind: 'modelSeatRigSet', model: 'a', seatRig: [seatFace] },
  ] as ModelEvent[]);
  assertEqual(s1.models['a'].seatRig?.length, 1, 'a rigged face persists on the model');
  assertEqual(s1.models['a'].seatRig?.[0].bodyPart, 'seat', 'the face carries its body part');
  const s2 = modelStream.apply(s1, { kind: 'modelSeatRigSet', model: 'a', seatRig: [seatFace, backFace] });
  assertEqual(s2.models['a'].seatRig?.length, 2, 'a later set replaces the whole list');
  const s3 = modelStream.apply(s2, { kind: 'modelSeatRigSet', model: 'a', seatRig: [] });
  assertEqual(s3.models['a'].seatRig, undefined, 'an empty set clears the rig to absent');
  const s4 = modelStream.apply(s3, { kind: 'modelSeatRigSet', model: 'ghost', seatRig: [seatFace] });
  assertEqual(s4, s3, 'a rig set for an unknown model is a no-op');
});

finish('modelStream');
