// Behavior tests for the prop-kind registry (P4): assert the TABLE'S MEANING.

import { isTileKind, tileKindDefinition } from './tiles';
import {
  PROP_KIND_DEFINITIONS,
  PROP_KINDS,
  isPropKind,
  propKindDefinition,
  type PropKind,
  propContainer,
  propCoverClass,
  propDynamics,
  propMount,
  propSeat,
} from './props';
import { assert, assertEqual, finish, test } from '../_testkit';

const def = propKindDefinition;

test('every prop borrows a REAL tile kind for its gameplay bundle', () => {
  for (const k of PROP_KINDS) {
    assert(isTileKind(def(k).tileKind), `${k} tileKind '${def(k).tileKind}' exists in the tile registry`);
  }
});

test('solid props block like walls; non-solid props hide like bushes', () => {
  for (const k of PROP_KINDS) {
    const d = def(k);
    if (d.solid) {
      assertEqual(d.tileKind, 'wall', `${k} (solid) borrows the wall bundle`);
      assert(!tileKindDefinition(d.tileKind).pathing.walkable, `${k} bundle is not walkable`);
    } else {
      assertEqual(d.tileKind, 'bush', `${k} (non-solid) borrows the foliage bundle`);
      assert(tileKindDefinition(d.tileKind).pathing.walkable, `${k} bundle is walk-through`);
      assert(tileKindDefinition(d.tileKind).cover.concealment >= 0.8, `${k} bundle conceals`);
    }
  }
});

test('exactly the bush family is non-solid (walk-through foliage)', () => {
  const nonSolid = PROP_KINDS.filter((k) => !def(k).solid);
  assertEqual(nonSolid.join(','), 'bush,bushLarge,bushLow,bushSparse', 'non-solid props');
});

test('traffic control: stop sign always stops, traffic light cycles, scenery is none', () => {
  assertEqual(def('stopSign').trafficControl, 'stopSign', 'stopSign control');
  assertEqual(def('trafficLight').trafficControl, 'signal', 'trafficLight control');
  for (const k of PROP_KINDS) {
    if (k !== 'stopSign' && k !== 'trafficLight') {
      assertEqual(def(k).trafficControl, 'none', `${k} is scenery to traffic`);
    }
  }
});

test('footprints and heights are positive meters; mesh and collider share them', () => {
  for (const k of PROP_KINDS) {
    const d = def(k);
    assert(d.footprintRadiusMeters > 0, `${k} footprint positive`);
    assert(d.heightMeters > 0, `${k} height positive`);
    assertEqual(d.kind, k, `${k} kind field`);
    assert(d.label.length > 0, `${k} label`);
  }
});

test('signage clears the player (visual head-top ~2.04m, R4 scale contract)', () => {
  for (const k of ['streetSign', 'stopSign', 'streetLight', 'trafficLight'] as PropKind[]) {
    assert(def(k).heightMeters > 2.04, `${k} clears head height`);
  }
});

test('a hide-in bush is taller than the player; a hedge is not', () => {
  assert(def('bush').heightMeters > 2.04, 'standing inside the bush conceals you');
  assert(def('bushLarge').heightMeters > def('bush').heightMeters, 'massive bush dwarfs the shrub');
  assert(def('bushLow').heightMeters < 2.04, 'a low hedge does not hide a standing player');
});

test('isPropKind accepts every kind and rejects strangers', () => {
  for (const k of PROP_KINDS) assert(isPropKind(k), `isPropKind(${k})`);
  assert(!isPropKind('tree'), 'no tree prop kind');
  assert(!isPropKind(''), 'empty string is not a kind');
  assertEqual(PROP_KINDS.length, Object.keys(PROP_KIND_DEFINITIONS).length, 'kind list covers the table');
});

// ── PROPUSE-0610: the interaction bundle ─────────────────────────────────────

test('seats: chairs sit 1, sofas/benches sit 3, beds lay — heights land on the prop', () => {
  const sitters: [PropKind, 'sit' | 'lay', number][] = [
    ['chair', 'sit', 1], ['chairRed', 'sit', 1], ['chairBlue', 'sit', 1], ['chairGreen', 'sit', 1],
    ['couch', 'sit', 3], ['bench', 'sit', 3],
    ['bedSingle', 'lay', 1], ['bedDouble', 'lay', 2],
  ];
  for (const [kind, pose, capacity] of sitters) {
    const seat = propSeat(kind);
    assert(seat !== null, `${kind} is sittable`);
    assertEqual(seat!.pose, pose, `${kind} pose`);
    assertEqual(seat!.capacity, capacity, `${kind} capacity`);
    assert(seat!.seatHeightMeters > 0 && seat!.seatHeightMeters <= def(kind).heightMeters, `${kind} seat height on the prop`);
  }
  assertEqual(propSeat('table'), null, 'a table is not a seat');
});

test('containers: junk in trash/dumpsters, category loot in appliances, sane knobs', () => {
  const expected: [PropKind, string, string][] = [
    ['trashCan', 'junk', 'open'], ['dumpster', 'junk', 'open'],
    ['fridge', 'kitchen', 'open'], ['oven', 'kitchen', 'open'],
    ['cupboard', 'clothing', 'open'], ['sink', 'bathroom', 'open'],
    ['mailbox', 'office', 'locked'], ['computer', 'office', 'open'],
  ];
  for (const [kind, category, access] of expected) {
    const container = propContainer(kind);
    assert(container !== null, `${kind} is searchable`);
    assertEqual(container!.lootCategory, category, `${kind} loot category`);
    assertEqual(container!.access, access, `${kind} access`);
    assert(container!.capacity >= 1, `${kind} holds at least one slot`);
    assert(container!.spawnFillChance >= 0 && container!.spawnFillChance <= 1, `${kind} fill chance is a probability`);
    assert(container!.searchSeconds > 0, `${kind} search bar runs`);
  }
  assertEqual(propContainer('rock'), null, 'a rock is not searchable');
});

test('cover classes: foliage and furniture conceal, walls of metal block, decor is air', () => {
  assertEqual(propCoverClass('bush'), 'soft', 'a bush conceals');
  assertEqual(propCoverClass('couch'), 'soft', 'a couch conceals but does not stop bullets');
  assertEqual(propCoverClass('dumpster'), 'hard', 'a dumpster blocks');
  assertEqual(propCoverClass('barrier'), 'hard', 'a jersey barrier blocks');
  assertEqual(propCoverClass('boulder'), 'hard', 'a boulder blocks');
  assertEqual(propCoverClass('fridge'), 'hard', 'a fridge blocks');
  assertEqual(propCoverClass('ballSoccer'), 'none', 'a soccer ball is not cover');
  assertEqual(propCoverClass('wallPainting'), 'none', 'a painting is not cover');
  assertEqual(propCoverClass('mirror'), 'none', 'a mirror is not cover');
  assertEqual(propCoverClass('trafficCone'), 'none', 'a cone is not cover');
});

test('mounts: wall decor hangs, the computer sits on surfaces, the rest stand on the floor', () => {
  for (const k of ['wallPainting', 'ledLight', 'mirror'] as PropKind[]) {
    assertEqual(propMount(k), 'wall', `${k} mounts on walls`);
  }
  assertEqual(propMount('computer'), 'surface', 'a computer sits on a surface');
  assertEqual(propMount('chair'), 'floor', 'a chair stands on the floor');
  assertEqual(propMount('ballBeach'), 'floor', 'a ball rests on the floor');
});

test('dynamics: balls bounce, cones and cans shove; scenery stays static', () => {
  for (const k of ['ballBeach', 'ballSoccer', 'ballBasketball', 'trafficCone', 'trashCan'] as PropKind[]) {
    const dynamics = propDynamics(k);
    assert(dynamics !== null, `${k} is kickable`);
    assert(dynamics!.bodyRadiusMeters > 0, `${k} body radius positive`);
    assert(dynamics!.restitution >= 0 && dynamics!.restitution <= 1, `${k} restitution in range`);
  }
  assert((propDynamics('ballBasketball')?.restitution ?? 0) > (propDynamics('trafficCone')?.restitution ?? 1), 'balls bounce more than cones');
  assertEqual(propDynamics('fridge'), null, 'a fridge does not get kicked around');
});

finish('kinds/props');
