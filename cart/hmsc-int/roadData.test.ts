// roadData.test.ts — meaning-tests for the road-stroke planner (P4): the
// user-ruled grammar must FALL OUT of a drawn stroke — 3-tile lanes, right-hand
// traffic from draw direction, median between opposing groups, one-way roads
// with no median, junction boxes + zebra bands where strokes cross. Pure CPU,
// runs under tools/v8cli (see game/_testkit.ts header for the bundle+run line).

import { assert, assertEqual, finish, test } from './game/_testkit';
import {
  carriagewayTiles, cellKey, clampProfile, crossSection, isOneWay, planRoads,
  profileLabel, roadWidthTiles, strokeChevrons,
  type RoadPlan, type RoadStroke,
} from './roadData';

const at = (plan: RoadPlan, gx: number, gz: number) => plan.get(cellKey(gx, gz));

function road(id: string, points: [number, number][], lanesF: number, lanesB: number, sidewalks: boolean): RoadStroke {
  return { id, points: points.map(([gx, gz]) => ({ gx, gz })), profile: { lanesF, lanesB, sidewalks } };
}

test('a lane is 3 tiles; 1+1 with sidewalks is 11 wide curb to curb', () => {
  assertEqual(carriagewayTiles({ lanesF: 1, lanesB: 1, sidewalks: false }), 7, 'lane+median+lane');
  assertEqual(roadWidthTiles({ lanesF: 1, lanesB: 1, sidewalks: true }), 11, 'plus 2-tile walks both sides');
  assertEqual(roadWidthTiles({ lanesF: 2, lanesB: 0, sidewalks: false }), 6, 'one-way 2-lane has no median');
});

test('an eastbound two-way stroke puts forward lanes south of the median (right-hand traffic)', () => {
  const plan = planRoads([road('r1', [[10, 10], [20, 10]], 1, 1, true)]);
  assertEqual(at(plan, 15, 10), 'median', 'the stroke line is the centerline');
  for (const z of [11, 12, 13]) assertEqual(at(plan, 15, z), 'laneEast', `forward lane on the right (south), z=${z}`);
  for (const z of [9, 8, 7]) assertEqual(at(plan, 15, z), 'laneWest', `opposing lane on the left (north), z=${z}`);
  for (const z of [14, 15, 6, 5]) assertEqual(at(plan, 15, z), 'sidewalk', `2-tile walk ring, z=${z}`);
  assertEqual(at(plan, 15, 16), undefined, 'nothing past the walk ring');
});

test('a northbound stroke flows laneNorth with its forward group on the east side', () => {
  const plan = planRoads([road('r1', [[10, 20], [10, 10]], 1, 1, false)]);
  assertEqual(at(plan, 10, 15), 'median', 'centerline');
  for (const x of [11, 12, 13]) assertEqual(at(plan, x, 15), 'laneNorth', `northbound on the east side, x=${x}`);
  for (const x of [9, 8, 7]) assertEqual(at(plan, x, 15), 'laneSouth', `southbound on the west side, x=${x}`);
});

test('a one-way road has no median and centres the carriageway on the stroke', () => {
  const plan = planRoads([road('r1', [[10, 10], [20, 10]], 1, 0, false)]);
  for (const z of [9, 10, 11]) assertEqual(at(plan, 15, z), 'laneEast', `one-way carriageway, z=${z}`);
  let medians = 0;
  for (const kind of plan.values()) if (kind === 'median') medians += 1;
  assertEqual(medians, 0, 'no median anywhere on a one-way');
});

test('drawing with lanesF=0 flows traffic AGAINST the draw direction', () => {
  const plan = planRoads([road('r1', [[10, 10], [20, 10]], 0, 1, false)]);
  for (const z of [9, 10, 11]) assertEqual(at(plan, 15, z), 'laneWest', `reversed one-way, z=${z}`);
  const chevs = strokeChevrons(road('r1', [[10, 10], [20, 10]], 0, 1, false));
  assertEqual(chevs.length, 1, 'one chevron per segment');
  assertEqual(Math.round(Math.abs(chevs[0]!.angleDeg)), 180, 'chevron points west when flow is reversed');
});

test('crossing strokes form a junction box with zebra bands on all four legs', () => {
  const a = road('ew', [[0, 10], [30, 10]], 1, 1, true);
  const b = road('ns', [[15, 0], [15, 25]], 1, 1, true);
  const plan = planRoads([a, b]);

  // The box: both carriageways are 7 wide → overlap x∈[12..18], z∈[7..13].
  let junctions = 0;
  for (const kind of plan.values()) if (kind === 'junction') junctions += 1;
  assertEqual(junctions, 49, 'the 7×7 overlap is all junction');
  assertEqual(at(plan, 15, 10), 'junction', 'box centre');
  assertEqual(at(plan, 12, 7), 'junction', 'box corner');

  // Zebra bands: 2 deep, full carriageway width, just outside each leg.
  for (const x of [10, 11]) for (const z of [7, 8, 9, 10, 11, 12, 13]) {
    assertEqual(at(plan, x, z), 'crosswalk', `west leg zebra (${x},${z})`);
  }
  for (const x of [19, 20]) assertEqual(at(plan, x, 10), 'crosswalk', `east leg zebra x=${x}`);
  for (const z of [5, 6]) assertEqual(at(plan, 15, z), 'crosswalk', `north leg zebra z=${z}`);
  for (const z of [14, 15]) assertEqual(at(plan, 15, z), 'crosswalk', `south leg zebra z=${z}`);

  // Past the zebra the lanes resume.
  assertEqual(at(plan, 9, 10), 'median', 'median resumes past the west zebra');
  assertEqual(at(plan, 9, 11), 'laneEast', 'eastbound lane resumes');
});

test('clampProfile never returns a lane-less road and isOneWay reads sides', () => {
  const c = clampProfile({ lanesF: 0, lanesB: 0, sidewalks: true });
  assert(c.lanesF === 1 && c.lanesB === 0, 'degenerate profile falls back to one forward lane');
  assert(isOneWay({ lanesF: 2, lanesB: 0, sidewalks: false }), '0 opposing lanes = one-way');
  assert(!isOneWay({ lanesF: 1, lanesB: 1, sidewalks: false }), 'both sides = two-way');
});

test('crossSection one-way width centres around the stroke', () => {
  const xs = crossSection({ lanesF: 1, lanesB: 0, sidewalks: false });
  const offs = xs.carriage.map((c) => c.off).sort((a, b) => a - b);
  assertEqual(offs.join(','), '-1,0,1', 'W=3 centres as -1..1');
});

test('profileLabel reads like the rail chip', () => {
  assertEqual(profileLabel({ lanesF: 1, lanesB: 1, sidewalks: true }), '1+1 ·11w +walk', 'two-way');
  assertEqual(profileLabel({ lanesF: 2, lanesB: 0, sidewalks: false }), '2→ ·6w', 'one-way forward');
});

finish('roadData');
