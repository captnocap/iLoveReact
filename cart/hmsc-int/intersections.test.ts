// intersections.test.ts — meaning-tests for INTERSECTION POLICY (P4,
// INTERSECTIONS-0619, req_1480). The authored bit (control type) + the derived
// signage must FALL OUT of the road network: junctions derive with their arms,
// each arm gets the right prop facing back against its traffic, the street sign
// prints the crossing names, and a manually-moved prop survives re-derivation.
// Pure CPU — bundle with tools/esbuild, run under tools/v8cli (see _testkit).

import { assert, assertClose, assertEqual, finish, test } from './game/_testkit';
import {
  controlFor, defaultControl, deriveJunctions, junctionRoadNames,
  planIntersectionProps, pruneOverrides, reconcileGenerated,
  type GenPoseOverride, type GeneratedProp, type IntersectionControl,
} from './intersections';
import type { RoadStroke } from './roadData';

function road(id: string, name: string, points: [number, number][]): RoadStroke {
  return { id, name, points: points.map(([gx, gz]) => ({ gx, gz })), profile: { lanesF: 1, lanesB: 1, sidewalks: false } };
}

// A classic 4-way: an E–W road "Main" crossing a N–S road "5th" near (30,30).
const MAIN = road('main', 'Main', [[10, 30], [50, 30]]);
const FIFTH = road('fifth', '5th', [[30, 10], [30, 50]]);
const CROSS = [MAIN, FIFTH];
const NO_CONTROLS = new Map<string, IntersectionControl>();

const propOnSide = (props: GeneratedProp[], side: string, role: string) =>
  props.find((p) => p.side === side && p.role === role)!;

test('two crossing strokes derive ONE junction with four arms', () => {
  const js = deriveJunctions(CROSS);
  assertEqual(js.length, 1, 'one box where the carriageways cross');
  const j = js[0];
  assertEqual(j.legs.length, 4, 'a 4-way has four arms');
  const sides = new Set(j.legs.map((l) => l.side));
  assert(sides.has('N') && sides.has('E') && sides.has('S') && sides.has('W'), 'one arm per compass side');
});

test('arms carry the owning road name and the approach into the box', () => {
  const j = deriveJunctions(CROSS)[0];
  const bySide = new Map(j.legs.map((l) => [l.side, l]));
  // the N/S arms are the N–S road ("5th"); E/W arms are the E–W road ("Main")
  assertEqual(bySide.get('N')!.roadName, '5th', 'north arm is the N–S road');
  assertEqual(bySide.get('S')!.roadName, '5th', 'south arm is the N–S road');
  assertEqual(bySide.get('E')!.roadName, 'Main', 'east arm is the E–W road');
  assertEqual(bySide.get('W')!.roadName, 'Main', 'west arm is the E–W road');
  // approach = travel INTO the box from that side
  assertEqual(bySide.get('N')!.approach, 'posZ', 'from the north you head south into the box');
  assertEqual(bySide.get('S')!.approach, 'negZ', 'from the south you head north');
  assertEqual(bySide.get('W')!.approach, 'posX', 'from the west you head east');
  assertEqual(bySide.get('E')!.approach, 'negX', 'from the east you head west');
  assertEqual(junctionRoadNames(j).sort().join(','), '5th,Main', 'both names, distinct');
});

test('a 4-way defaults to an all-way stop', () => {
  const j = deriveJunctions(CROSS)[0];
  assertEqual(defaultControl(j), 'allWayStop', 'real crossings default to stops');
  assertEqual(controlFor(j, NO_CONTROLS), 'allWayStop', 'no override → default');
});

test('all-way stop emits a stop sign + a street sign on every arm', () => {
  const js = deriveJunctions(CROSS);
  const props = planIntersectionProps(js, NO_CONTROLS, CROSS);
  const controls = props.filter((p) => p.role === 'control');
  const signs = props.filter((p) => p.role === 'sign');
  assertEqual(controls.length, 4, 'a stop on each of four arms');
  assertEqual(signs.length, 4, 'a street sign on each arm');
  assert(controls.every((p) => p.kind === 'stopSign'), 'stops, not lights');
  assert(signs.every((p) => p.kind === 'streetSign'), 'street-name signs');
  assert(signs.every((p) => p.text === 'Main\n5th' || p.text === '5th\nMain'), 'sign prints both crossing names');
  // ids are stable + unique
  assertEqual(new Set(props.map((p) => p.id)).size, props.length, 'ids unique');
});

test('signals swap the stops for traffic lights; uncontrolled drops them', () => {
  const js = deriveJunctions(CROSS);
  const signal = new Map([[js[0].key, 'signals' as IntersectionControl]]);
  const lit = planIntersectionProps(js, signal, CROSS);
  assertEqual(lit.filter((p) => p.role === 'control' && p.kind === 'trafficLight').length, 4, 'four lights');
  const off = new Map([[js[0].key, 'uncontrolled' as IntersectionControl]]);
  const bare = planIntersectionProps(js, off, CROSS);
  assertEqual(bare.filter((p) => p.role === 'control').length, 0, 'no control props');
  assertEqual(bare.filter((p) => p.role === 'sign').length, 4, 'street signs still stand');
});

test('a control faces back against the traffic it governs (runtime yaw convention)', () => {
  const props = planIntersectionProps(deriveJunctions(CROSS), NO_CONTROLS, CROSS);
  assertClose(propOnSide(props, 'N', 'control').rotationDeg, 0, 1e-6, 'north arm faces -Z');
  assertClose(propOnSide(props, 'S', 'control').rotationDeg, 180, 1e-6, 'south arm faces +Z');
  assertClose(propOnSide(props, 'W', 'control').rotationDeg, 90, 1e-6, 'west arm faces +X... governs eastbound');
  assertClose(propOnSide(props, 'E', 'control').rotationDeg, -90, 1e-6, 'east arm faces -X');
});

test('a manually-moved prop keeps its pose but still refreshes text', () => {
  const js = deriveJunctions(CROSS);
  const fresh = planIntersectionProps(js, NO_CONTROLS, CROSS);
  const sign = fresh.find((p) => p.role === 'sign')!;
  const moved: GenPoseOverride = { gx: 999, gz: 888, rotationDeg: 42 };
  const overrides = new Map([[sign.id, moved]]);
  const reconciled = reconcileGenerated(fresh, overrides);
  const after = reconciled.find((p) => p.id === sign.id)!;
  assertClose(after.gx, 999, 1e-9, 'dragged pose preserved');
  assertClose(after.gz, 888, 1e-9, 'dragged pose preserved');
  assertEqual(after.text, sign.text, 'text still comes from the fresh plan');

  // rename the road → re-plan → re-apply the SAME override: pose sticks, text updates
  const renamed = planIntersectionProps(deriveJunctions([{ ...MAIN, name: 'Broadway' }, FIFTH]), NO_CONTROLS, [{ ...MAIN, name: 'Broadway' }, FIFTH]);
  const sign2 = renamed.find((p) => p.id === sign.id)!;
  const after2 = reconcileGenerated(renamed, overrides).find((p) => p.id === sign.id)!;
  assert(after2.text!.includes('Broadway'), 'renamed road reprints on the moved sign');
  assertClose(after2.gx, 999, 1e-9, 'and the move still holds');
  assert(sign2 !== undefined, 'same id survives a rename (geometry unchanged)');
});

test('pruneOverrides drops orphans, keeps live ones', () => {
  const fresh = planIntersectionProps(deriveJunctions(CROSS), NO_CONTROLS, CROSS);
  const live = fresh[0].id;
  const overrides = new Map<string, GenPoseOverride>([
    [live, { gx: 1, gz: 2, rotationDeg: 0 }],
    ['gen:0,0:N:control', { gx: 0, gz: 0, rotationDeg: 0 }], // a junction that no longer exists
  ]);
  const pruned = pruneOverrides(fresh, overrides);
  assert(pruned.has(live), 'live override kept');
  assert(!pruned.has('gen:0,0:N:control'), 'orphan override dropped');
});

finish();
