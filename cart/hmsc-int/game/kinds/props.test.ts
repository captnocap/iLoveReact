// Behavior tests for the prop-kind registry (P4): assert the TABLE'S MEANING.

import { isTileKind, tileKindDefinition } from './tiles';
import {
  PROP_KIND_DEFINITIONS,
  PROP_KINDS,
  isPropKind,
  propKindDefinition,
  type PropKind,
} from './props';
import { assert, assertEqual, report, test } from './testKit';

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

report('kinds/props');
