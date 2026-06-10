// game/world/buildings behavior tests (P4) — MEANING tests for req_0513:
// buildings OWN their history. A promoted/towered composition becomes ONE def
// + ONE instance reference; the derived pieces view reproduces the originals
// exactly (the V24 see-through law); a move is ONE event that keeps every
// derived id (selection survives); per-building undo is REVERSE events, never
// a rewind of shared history (V20). Never function-name assertions.

import { assert, assertClose, assertEqual, finish, test } from '../_testkit';
import type { PlacedBuildPiece } from '../build';
import {
  buildingDefFromPieces,
  buildingMutationMapName,
  buildingPieceInstanceId,
  buildingPieceLocalIndex,
  buildingPiecesForMap,
  buildingsStream,
  instancesForMap,
  isBuildingsEvent,
  partitionBuildingSelection,
  reconcileBuildingInstances,
  withBuildingPieces,
  type BuildingsEvent,
  type BuildingsStreamState,
} from './buildings';

function fold(events: BuildingsEvent[], from?: BuildingsStreamState): BuildingsStreamState {
  let state = from ?? buildingsStream.initial();
  for (const event of events) state = buildingsStream.apply(state, event);
  return state;
}

let nextId = 0;
function placed(pieceId: string, x: number, z: number, over: Partial<PlacedBuildPiece> = {}): PlacedBuildPiece {
  nextId += 1;
  return { id: `t_${nextId}`, pieceId, x, y: 0, z, yawDegrees: 0, ...over };
}

/** a small house: floor + two walls (one with a door + a painted face) */
function housePieces(): PlacedBuildPiece[] {
  return [
    placed('floor.concrete.common', 10.5, 10.5),
    placed('wall.concrete.common', 10.5, 9, { edit: 'door' }),
    placed('wall.concrete.common', 10.5, 12, { skin: { front: { kind: 'color', value: '#ff0000' } } as PlacedBuildPiece['skin'] }),
  ];
}

const MAP = 'testmap';

function promote(pieces: PlacedBuildPiece[], mapName = MAP): BuildingsStreamState {
  const capture = buildingDefFromPieces('Test House', pieces);
  assert(capture !== null, 'the capture validates');
  return fold([
    { kind: 'buildingDefined', def: capture!.def },
    { kind: 'buildingPlaced', defId: capture!.def.id, x: capture!.origin.x, y: capture!.origin.y, z: capture!.origin.z, yawDegrees: 0, mapName },
  ]);
}

// ── promote: capture → def + instance, derived pieces reproduce originals ────

test('a promoted composition derives back EXACTLY: positions, edits, skins survive', () => {
  const originals = housePieces();
  const state = promote(originals);
  const derived = buildingPiecesForMap(state, MAP);
  assertEqual(derived.length, originals.length, 'every captured piece stands');
  for (let i = 0; i < originals.length; i += 1) {
    const o = originals[i];
    const d = derived[i];
    assertEqual(d.pieceId, o.pieceId, `piece ${i} keeps its catalog id`);
    assertClose(d.x, o.x, 1e-9, `piece ${i} keeps x`);
    assertClose(d.y, o.y, 1e-9, `piece ${i} keeps y`);
    assertClose(d.z, o.z, 1e-9, `piece ${i} keeps z`);
    assertClose(d.yawDegrees, o.yawDegrees, 1e-9, `piece ${i} keeps yaw`);
    assertEqual(d.edit, o.edit, `piece ${i} keeps its edit`);
    assertEqual(JSON.stringify(d.skin ?? null), JSON.stringify(o.skin ?? null), `piece ${i} keeps its painted faces`);
  }
});

test('derived ids are deterministic and name the building branch', () => {
  const state = promote(housePieces());
  const derived = buildingPiecesForMap(state, MAP);
  assertEqual(derived[0].id, 'bld:bld_1:0', 'instance id + local index, replay-stable');
  assertEqual(buildingPieceInstanceId(derived[2].id), 'bld_1', 'the instance id parses back out');
  assertEqual(buildingPieceLocalIndex(derived[2].id), 2, 'the def-local index parses back out');
  assertEqual(buildingPieceInstanceId('bp_12'), null, 'a loose world piece is not a building piece');
  const stamps = new Set(derived.map((p) => p.stampId));
  assertEqual(stamps.size, 1, 'one stampId — the whole instance is ONE flat-pad lift group');
  assert(stamps.has('bld:bld_1'), 'the stamp id names the instance');
});

test('replaying the same events mints the same instance ids', () => {
  const a = promote(housePieces());
  const b = promote(housePieces());
  assertEqual(Object.keys(instancesForMap(a, MAP)).join(','), Object.keys(instancesForMap(b, MAP)).join(','), 'replay-deterministic');
});

// ── the one-event move ───────────────────────────────────────────────────────

test('a move is ONE event: every derived piece shifts, every id survives', () => {
  const state = promote(housePieces());
  const before = buildingPiecesForMap(state, MAP);
  const inst = Object.values(instancesForMap(state, MAP))[0];
  const moved = fold([{ kind: 'buildingMoved', id: inst.id, x: inst.x + 9, z: inst.z - 6, mapName: MAP }], state);
  const after = buildingPiecesForMap(moved, MAP);
  assertEqual(after.length, before.length, 'nothing re-minted, nothing lost');
  for (let i = 0; i < before.length; i += 1) {
    assertEqual(after[i].id, before[i].id, `piece ${i} keeps its id across the move (selection survives)`);
    assertClose(after[i].x, before[i].x + 9, 1e-9, `piece ${i} shifted x`);
    assertClose(after[i].z, before[i].z - 6, 1e-9, `piece ${i} shifted z`);
    assertClose(after[i].y, before[i].y, 1e-9, `piece ${i} kept its storey`);
  }
});

test('a move may turn the building: optional yaw composes onto every piece', () => {
  const state = promote(housePieces());
  const inst = Object.values(instancesForMap(state, MAP))[0];
  const turned = fold([{ kind: 'buildingMoved', id: inst.id, x: inst.x, z: inst.z, yawDegrees: 90, mapName: MAP }], state);
  const after = buildingPiecesForMap(turned, MAP);
  assertClose(after[1].yawDegrees, 90, 1e-9, 'the door wall turned with the building');
});

// ── removal: instance dies, the def (shared global) survives ─────────────────

test('removing an instance drops its pieces; the def survives and re-places', () => {
  const state = promote(housePieces());
  const inst = Object.values(instancesForMap(state, MAP))[0];
  const removed = fold([{ kind: 'buildingRemoved', id: inst.id, mapName: MAP }], state);
  assertEqual(buildingPiecesForMap(removed, MAP).length, 0, 'no pieces stand');
  const replaced = fold([{ kind: 'buildingPlaced', defId: inst.defId, x: 50, y: 0, z: 50, yawDegrees: 0, mapName: MAP }], removed);
  assertEqual(buildingPiecesForMap(replaced, MAP).length, 3, 'the def was never deleted — it stamps again');
});

// ── multi-map: instances are per-map, defs are shared ────────────────────────

test('instances are map-scoped; the def is a shared global across maps', () => {
  const state = promote(housePieces(), 'mapA');
  assertEqual(buildingPiecesForMap(state, 'mapB').length, 0, 'mapB holds no instance');
  const inst = Object.values(instancesForMap(state, 'mapA'))[0];
  const both = fold([{ kind: 'buildingPlaced', defId: inst.defId, x: 0, y: 0, z: 0, yawDegrees: 0, mapName: 'mapB' }], state);
  assertEqual(buildingPiecesForMap(both, 'mapB').length, 3, 'the SAME def stamps on another map');
  assertEqual(buildingMutationMapName(both, 'mapA', inst.id), 'mapA', 'a mutation on the instance resolves its owning map');
});

// ── tolerance (the V20 materializer contract) ────────────────────────────────

test('the materializer refuses noise and passes unknown kinds through', () => {
  const initial = buildingsStream.initial();
  assertEqual(fold([{ kind: 'buildingPlaced', defId: 'bld.ghost', x: 0, y: 0, z: 0, yawDegrees: 0 }]).instancesByMap[''], undefined, 'a dangling defId places nothing');
  const capture = buildingDefFromPieces('H', housePieces())!;
  const bad = fold([
    { kind: 'buildingDefined', def: capture.def },
    { kind: 'buildingPlaced', defId: capture.def.id, x: Number.NaN, y: 0, z: 0, yawDegrees: 0, mapName: MAP },
  ]);
  assertEqual(buildingPiecesForMap(bad, MAP).length, 0, 'non-finite positions are refused');
  const future = buildingsStream.apply(initial, { kind: 'buildingPainted', whatever: 1 } as unknown as BuildingsEvent);
  assertEqual(future, initial, 'an unknown future kind passes through untouched');
  assert(isBuildingsEvent({ kind: 'buildingMoved', id: 'x', x: 0, z: 0 }), 'building events route to the buildings channel');
  assert(!isBuildingsEvent({ kind: 'piecePlaced' }), 'world events stay on the world channel');
});

test('a buildings-free map keeps the base array identity (no hot-path tax)', () => {
  const base: PlacedBuildPiece[] = [placed('floor.concrete.common', 0, 0)];
  assert(withBuildingPieces(base, buildingsStream.initial(), MAP) === base, 'zero instances → zero allocations');
  assert(withBuildingPieces(base, null, MAP) === base, 'no stream at all → same');
});

test('re-deriving the same state reuses identities (renderer caches survive)', () => {
  const state = promote(housePieces());
  assert(buildingPiecesForMap(state, MAP) === buildingPiecesForMap(state, MAP), 'same state → same array');
  const inst = Object.values(instancesForMap(state, MAP))[0];
  const two = fold([{ kind: 'buildingPlaced', defId: inst.defId, x: 100, y: 0, z: 100, yawDegrees: 0, mapName: MAP }], state);
  const moved = fold([{ kind: 'buildingMoved', id: 'bld_2', x: 120, z: 100, mapName: MAP }], two);
  const beforePieces = buildingPiecesForMap(two, MAP);
  const afterPieces = buildingPiecesForMap(moved, MAP);
  assert(afterPieces[0] === beforePieces[0], 'the untouched instance keeps its piece OBJECTS across a sibling move');
});

// ── selection partition (whole-building ops vs loose pieces) ─────────────────

test('a selection partitions into whole buildings, partial buildings, loose pieces', () => {
  const state = promote(housePieces());
  const derived = buildingPiecesForMap(state, MAP);
  const loose = placed('floor.concrete.common', 99, 99);
  const all = [...derived, loose];
  const whole = partitionBuildingSelection(new Set([...derived.map((p) => p.id), loose.id]), all);
  assertEqual(whole.wholeInstances.join(','), 'bld_1', 'every piece selected → whole-building op');
  assertEqual(whole.loosePieceIds.join(','), loose.id, 'the loose piece stays piece-granular');
  const partial = partitionBuildingSelection(new Set([derived[0].id]), all);
  assertEqual(partial.wholeInstances.length, 0, 'one piece of three is not the building');
  assertEqual(partial.partialInstances.join(','), 'bld_1', 'it is a partial grab — callers must not half-mutate');
});

// ── undo: REVERSE events on the building branch (V20: never rewind) ──────────

test('undoing a move appends ONE buildingMoved back to the old spot', () => {
  const state = promote(housePieces());
  const before = buildingPiecesForMap(state, MAP);
  const inst = Object.values(instancesForMap(state, MAP))[0];
  const moved = fold([{ kind: 'buildingMoved', id: inst.id, x: inst.x + 9, z: inst.z - 6, mapName: MAP }], state);
  const after = buildingPiecesForMap(moved, MAP);
  const events = reconcileBuildingInstances(after, before, moved, MAP);
  assertEqual(events.length, 1, 'one reverse event, not a remove+place storm');
  assertEqual(events[0].kind, 'buildingMoved', 'the reverse of a move is a move');
  const undone = fold(events.map((e) => ({ ...e, mapName: MAP }) as BuildingsEvent), moved);
  const restored = buildingPiecesForMap(undone, MAP);
  for (let i = 0; i < before.length; i += 1) {
    assertClose(restored[i].x, before[i].x, 1e-6, `piece ${i} back at its old x`);
    assertClose(restored[i].z, before[i].z, 1e-6, `piece ${i} back at its old z`);
  }
});

test('undoing a promote removes the instance (the loose diff re-places the originals)', () => {
  const state = promote(housePieces());
  const derived = buildingPiecesForMap(state, MAP);
  // target = the pre-promote snapshot: no building pieces at all
  const events = reconcileBuildingInstances(derived, [], state, MAP);
  assertEqual(events.length, 1, 'one reverse event');
  assertEqual(events[0].kind, 'buildingRemoved', 'the reverse of a place is a remove');
});

test('undoing a delete re-places the instance at its snapshotted pose', () => {
  const state = promote(housePieces());
  const before = buildingPiecesForMap(state, MAP);
  const inst = Object.values(instancesForMap(state, MAP))[0];
  const removed = fold([{ kind: 'buildingRemoved', id: inst.id, mapName: MAP }], state);
  const events = reconcileBuildingInstances([], before, removed, MAP);
  assertEqual(events.length, 1, 'one reverse event');
  assertEqual(events[0].kind, 'buildingPlaced', 'the reverse of a remove is a place');
  const revived = fold(events.map((e) => ({ ...e, mapName: MAP }) as BuildingsEvent), removed);
  const restored = buildingPiecesForMap(revived, MAP);
  assertEqual(restored.length, before.length, 'the building stands again');
  for (let i = 0; i < before.length; i += 1) {
    assertClose(restored[i].x, before[i].x, 1e-6, `piece ${i} restored x`);
    assertClose(restored[i].z, before[i].z, 1e-6, `piece ${i} restored z`);
    assertClose(restored[i].y, before[i].y, 1e-6, `piece ${i} restored storey`);
  }
});

test('a turned instance reconciles by pose, not by translation guesswork', () => {
  const state = promote(housePieces());
  const before = buildingPiecesForMap(state, MAP);
  const inst = Object.values(instancesForMap(state, MAP))[0];
  const turned = fold([{ kind: 'buildingMoved', id: inst.id, x: inst.x + 3, z: inst.z, yawDegrees: 90, mapName: MAP }], state);
  const after = buildingPiecesForMap(turned, MAP);
  const events = reconcileBuildingInstances(after, before, turned, MAP);
  assertEqual(events.length, 1, 'one reverse event covers position AND rotation');
  const undone = fold(events.map((e) => ({ ...e, mapName: MAP }) as BuildingsEvent), turned);
  const restored = buildingPiecesForMap(undone, MAP);
  for (let i = 0; i < before.length; i += 1) {
    assertClose(restored[i].x, before[i].x, 1e-6, `piece ${i} un-turned x`);
    assertClose(restored[i].z, before[i].z, 1e-6, `piece ${i} un-turned z`);
    assertClose(restored[i].yawDegrees, before[i].yawDegrees, 1e-6, `piece ${i} un-turned yaw`);
  }
});

finish('world-buildings');
