// Behavior tests for the tile-kind registry (P4): assert the TABLE'S MEANING —
// what the kinds DO — not the file layout, so a regression in a rewrite is
// caught even if every identifier changes.

import {
  EMBEDDED_TILE_KINDS,
  GAMEPLAY_TILE_KINDS,
  PAINTABLE_TILE_KINDS,
  TILE_FLOW_VECTORS,
  TILE_KIND_DEFINITIONS,
  TILE_KIND_INDEX,
  TILE_KINDS,
  isTileKind,
  tileFlowVector,
  tileKindDefinition,
  type TileKind,
} from './tiles';
import { assert, assertEqual, finish, test } from '../_testkit';

const def = tileKindDefinition;

// ── the locked road grammar ──────────────────────────────────────────────────

test('lane kinds carry flow; the compass matches the hmsc convention (north = -Z)', () => {
  assertEqual(def('laneNorth').flow, 'north', 'laneNorth flow');
  assertEqual(def('laneSouth').flow, 'south', 'laneSouth flow');
  assertEqual(def('laneEast').flow, 'east', 'laneEast flow');
  assertEqual(def('laneWest').flow, 'west', 'laneWest flow');
  assertEqual(TILE_FLOW_VECTORS.north.dz, -1, 'north is -Z');
  assertEqual(TILE_FLOW_VECTORS.south.dz, 1, 'south is +Z');
  assertEqual(TILE_FLOW_VECTORS.east.dx, 1, 'east is +X');
  assertEqual(TILE_FLOW_VECTORS.west.dx, -1, 'west is -X');
  const v = tileFlowVector('laneNorth');
  assert(v !== null && v.dx === 0 && v.dz === -1, 'tileFlowVector(laneNorth) is (0,-1)');
});

test('junction is flow-neutral — the box where turns legally resolve', () => {
  assertEqual(def('junction').flow, 'none', 'junction flow');
  assertEqual(tileFlowVector('junction'), null, 'junction flow vector');
  assert(def('junction').npc.preferredByVehicles, 'junction is vehicle road');
  assert(def('junction').npc.vehicleCost < def('road').npc.vehicleCost,
    'junction rides cheaper than legacy road so routes stay on the grammar');
});

test('every non-lane kind is flow-neutral (flow is lane-trio data only)', () => {
  const laneKinds = new Set<TileKind>(['laneNorth', 'laneSouth', 'laneEast', 'laneWest']);
  for (const k of TILE_KINDS) {
    if (laneKinds.has(k)) assert(def(k).flow !== 'none', `${k} must carry flow`);
    else assertEqual(def(k).flow, 'none', `${k} must be flow-neutral`);
  }
});

test('lane tiles undercut plain road for vehicles (painted lane beats shoulder)', () => {
  for (const k of ['laneNorth', 'laneSouth', 'laneEast', 'laneWest'] as TileKind[]) {
    assert(def(k).npc.vehicleCost < def('road').npc.vehicleCost,
      `${k} vehicleCost must undercut road`);
    assert(def(k).npc.preferredByVehicles, `${k} is preferred by vehicles`);
  }
});

test('all four lane directions share one drivable profile (only flow differs)', () => {
  const base = def('laneNorth');
  for (const k of ['laneSouth', 'laneEast', 'laneWest'] as TileKind[]) {
    const d = def(k);
    assertEqual(d.npc.vehicleCost, base.npc.vehicleCost, `${k} vehicleCost`);
    assertEqual(d.npc.walkCost, base.npc.walkCost, `${k} walkCost`);
    assertEqual(d.pathing.movementCost, base.pathing.movementCost, `${k} movementCost`);
    assertEqual(d.surface.friction, base.surface.friction, `${k} friction`);
  }
});

test('crosswalk is walk-preferred over sidewalk (the zebra is the cost magnet)', () => {
  assert(def('crosswalk').npc.walkCost < def('sidewalk').npc.walkCost,
    'crosswalk walkCost must undercut sidewalk');
  assert(def('crosswalk').npc.walkCost < def('road').npc.walkCost,
    'crosswalk walkCost must undercut road');
  assert(def('crosswalk').pathing.walkable, 'crosswalk is walkable');
});

test('crosswalk is still drivable road (cars cross it; they yield at it)', () => {
  assert(def('crosswalk').traversal.allowedModes.includes('drive'), 'crosswalk allows drive');
  assert(Number.isFinite(def('crosswalk').npc.vehicleCost), 'crosswalk vehicleCost finite');
  assert(!def('crosswalk').npc.preferredByVehicles,
    'crosswalk is not vehicle-preferred (it is a crossing, not a lane)');
});

test('road-family kinds share the road surface texture (markings are paint-layer)', () => {
  for (const k of ['road', 'laneNorth', 'laneSouth', 'laneEast', 'laneWest', 'junction', 'crosswalk'] as TileKind[]) {
    assertEqual(def(k).render.textureKey, 'hmsc.tile.road', `${k} textureKey`);
  }
});

// ── traversal meaning ────────────────────────────────────────────────────────

test('wall is not traversable by anything', () => {
  const w = def('wall');
  assert(!w.pathing.walkable, 'wall is not walkable');
  assert(!w.npc.traversable, 'wall is not NPC-traversable');
  assertEqual(w.pathing.movementCost, Infinity, 'wall movementCost');
  assertEqual(w.npc.vehicleCost, Infinity, 'wall vehicleCost');
  assertEqual(w.traversal.allowedModes.length, 0, 'wall allows no traversal mode');
  assert(w.pathing.blocksLineOfSight, 'wall blocks line of sight');
  assertEqual(w.cover.height, 'full', 'wall is full cover');
  assertEqual(w.cover.protection, 1, 'wall protection');
});

test('water allows swimming only', () => {
  const w = def('water');
  assert(!w.pathing.walkable, 'water is not walkable');
  assertEqual(w.npc.vehicleCost, Infinity, 'no driving into water');
  assert(w.traversal.allowedModes.includes('swim'), 'water allows swim');
  assert(!w.traversal.allowedModes.includes('walk'), 'water disallows walk');
  assert(!w.traversal.allowedModes.includes('drive'), 'water disallows drive');
});

test('door is a pedestrian-only opening with an open cost', () => {
  const d = def('door');
  assert(d.door.isDoor, 'door isDoor');
  assert(d.door.openCost > 0, 'door pays an open cost');
  assert(d.pathing.walkable, 'door is walkable');
  assertEqual(d.npc.vehicleCost, Infinity, 'no driving through doors');
  assert(!d.traversal.allowedModes.includes('drive'), 'door disallows drive');
  assertEqual(d.traversal.width, 'narrow', 'door is narrow');
  for (const k of TILE_KINDS) {
    if (k !== 'door') assert(!def(k).door.isDoor, `${k} is not a door`);
  }
});

test('bush hides without protecting and never carries vehicles', () => {
  const b = def('bush');
  assert(b.pathing.walkable, 'bush is walk-through foliage');
  assert(b.cover.concealment >= 0.8, 'bush conceals');
  assert(b.cover.protection <= 0.1, 'bush does not stop bullets');
  assert(!b.pathing.blocksLineOfSight, 'bush dims but does not block sight');
  assertEqual(b.npc.vehicleCost, Infinity, 'vehicles do not path through bushes');
});

test('spawn/save are ordinary walkable ground (markers, not obstacles)', () => {
  for (const k of ['spawn', 'save', 'marker'] as TileKind[]) {
    const d = def(k);
    assert(d.pathing.walkable, `${k} walkable`);
    assertEqual(d.pathing.movementCost, 1.0, `${k} movementCost is neutral`);
    assertEqual(d.npc.noise, 0, `${k} adds no footstep noise`);
  }
});

// ── placement partitions ─────────────────────────────────────────────────────

test('the paint palette offers surfaces only', () => {
  const paintable = new Set(PAINTABLE_TILE_KINDS);
  for (const k of ['water', 'road', 'asphalt', 'sidewalk', 'mud', 'sand', 'laneNorth', 'laneSouth', 'laneEast', 'laneWest', 'junction', 'crosswalk'] as TileKind[]) {
    assert(paintable.has(k), `${k} is paintable`);
  }
  for (const k of ['wall', 'door', 'bush', 'marker', 'spawn', 'save'] as TileKind[]) {
    assert(!paintable.has(k), `${k} is never bulk-painted`);
  }
});

test('embedded = wall/door/bush; gameplay = spawn/save; every kind in exactly one class', () => {
  assertEqual(EMBEDDED_TILE_KINDS.join(','), 'wall,door,bush', 'embedded kinds');
  assertEqual(GAMEPLAY_TILE_KINDS.join(','), 'spawn,save', 'gameplay kinds');
  const total = PAINTABLE_TILE_KINDS.length + EMBEDDED_TILE_KINDS.length
    + GAMEPLAY_TILE_KINDS.length + TILE_KINDS.filter((k) => def(k).placement === 'dev').length;
  assertEqual(total, TILE_KINDS.length, 'placement classes partition the registry');
});

// ── the wire format ──────────────────────────────────────────────────────────

test('TILE_KINDS index order is locked (host pathing ships kind indices)', () => {
  assertEqual(
    TILE_KINDS.join(','),
    'water,road,asphalt,sidewalk,mud,sand,wall,door,bush,marker,spawn,save,laneNorth,laneSouth,laneEast,laneWest,junction,crosswalk,median,grass,grassDry',
    'TILE_KINDS order',
  );
  for (const k of TILE_KINDS) {
    assertEqual(TILE_KINDS[TILE_KIND_INDEX[k]], k, `TILE_KIND_INDEX round-trips ${k}`);
  }
});

// ── table completeness (P2: the table IS the data) ───────────────────────────

test('every kind has a complete, sane profile', () => {
  for (const k of TILE_KINDS) {
    const d = def(k);
    assertEqual(d.kind, k, `${k} kind field`);
    assert(d.label.length > 0, `${k} label`);
    assert(d.pathing.movementCost > 0, `${k} movementCost positive`);
    assert(d.npc.noise >= 0 && d.npc.noise <= 1, `${k} noise in [0,1]`);
    assert(d.cover.protection >= 0 && d.cover.protection <= 1, `${k} protection in [0,1]`);
    assert(d.cover.concealment >= 0 && d.cover.concealment <= 1, `${k} concealment in [0,1]`);
    assert(d.visibility.opacity >= 0 && d.visibility.opacity <= 1, `${k} opacity in [0,1]`);
    assert(d.surface.friction >= 0 && d.surface.friction <= 1, `${k} friction in [0,1]`);
    assert(d.render.heightMeters > 0, `${k} render height positive`);
    assert(d.render.textureKey.startsWith('hmsc.tile.'), `${k} textureKey namespaced`);
    // Walkability agrees across the pathing and NPC layers.
    assertEqual(d.pathing.walkable, d.npc.traversable, `${k} walkable == traversable`);
    // A walkable kind has a finite walk cost; a blocked one is Infinity.
    assertEqual(Number.isFinite(d.npc.walkCost), d.pathing.walkable, `${k} walkCost finiteness`);
  }
});

test('isTileKind accepts every kind and rejects strangers', () => {
  for (const k of TILE_KINDS) assert(isTileKind(k), `isTileKind(${k})`);
  // GRASSTILE-0611 (req_0642): grass became a REAL paintable surface — the
  // old "sand is the soft-ground stand-in" note is history.
  assert(isTileKind('grass'), 'grass is a kind now');
  assert(!isTileKind('lava'), 'strangers rejected');
  assert(!isTileKind(''), 'empty string is not a kind');
});

test('embedded/dev kinds sit on the cell base; surfaces drape the heightfield', () => {
  for (const k of ['wall', 'door', 'bush'] as TileKind[]) {
    assertEqual(def(k).altitude.sample, 'cellBase', `${k} altitude`);
  }
  for (const k of PAINTABLE_TILE_KINDS) {
    assertEqual(TILE_KIND_DEFINITIONS[k].altitude.sample, 'heightfieldSurface', `${k} altitude`);
  }
});

finish('kinds/tiles');
