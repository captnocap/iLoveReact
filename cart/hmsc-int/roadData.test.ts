// roadData.test.ts — meaning-tests for the road-stroke planner (P4): the
// user-ruled grammar must FALL OUT of a drawn stroke — 3-tile lanes, right-hand
// traffic from draw direction, median between opposing groups, one-way roads
// with no median, junction boxes + zebra bands where strokes cross. Pure CPU,
// runs under tools/v8cli (see game/_testkit.ts header for the bundle+run line).

import { assert, assertClose, assertEqual, finish, test } from './game/_testkit';
import {
  applyMergeGesture, carriagewayTiles, cellKey, clampProfile, crossSection,
  filletPoints, isOneWay, laneGuides, planRoads, profileLabel, ribbonExtents,
  roadMotionProfile, roadRibbonSegments, roadWidthTiles, snapToCenterline,
  snapToRoadEnd, speedLimitAtPoint, speedLimitMps, splitStroke, strokeChevrons, strokeWireFlip,
  type RoadPlan, type RoadStroke,
} from './roadData';
import { roadRibbonSection } from './tileField.wgsl';

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

test('profileLabel reads like the rail chip (speed limit rides it — ROADSPEED-0610)', () => {
  assertEqual(profileLabel({ lanesF: 1, lanesB: 1, sidewalks: true }), '1+1 ·11w +walk ·50', 'two-way defaults to city');
  assertEqual(profileLabel({ lanesF: 2, lanesB: 0, sidewalks: false, speedLimitKph: 90 }), '2→ ·6w ·90', 'one-way rural');
});

test('speed limits (ROADSPEED-0610): the stroke carries them, the route obeys the strictest', () => {
  const city = road('city', [[0, 10], [40, 10]], 1, 1, true);
  const rural = { ...road('rural', [[0, 40], [40, 40]], 1, 1, false), profile: { lanesF: 1, lanesB: 1, sidewalks: false, speedLimitKph: 90 } };
  assertEqual(clampProfile({ lanesF: 1, lanesB: 1, sidewalks: true }).speedLimitKph, 50, 'absent → the city preset');
  assertEqual(clampProfile({ lanesF: 1, lanesB: 1, sidewalks: true, speedLimitKph: 999 }).speedLimitKph, 130, 'clamped to the ceiling');
  assertEqual(Math.round(speedLimitMps(rural.profile) * 3.6), 90, 'kph→mps round-trips');
  // point lookup: on the rural carriageway = 90, on the city = 50, off-road = null
  assertEqual(speedLimitAtPoint([city, rural], 20, 40), 90 / 3.6, 'on the rural stroke');
  assertEqual(speedLimitAtPoint([city, rural], 20, 10), 50 / 3.6, 'on the city stroke');
  assertEqual(speedLimitAtPoint([city, rural], 20, 25), null, 'between roads = off-road');
  // the motion consumer: a route along the rural road keeps 25 m/s capped at
  // 90 kph; passing through the city road binds to the strictest limit
  const base = { maxSpeed: 40, accel: 4, decel: 6 };
  const ruralOnly = roadMotionProfile(base, [city, rural], [[2, 40], [38, 40]]);
  assertClose(ruralOnly.maxSpeed, 90 / 3.6, 0.001, 'the rural route drives the rural limit');
  const mixed = roadMotionProfile(base, [city, rural], [[2, 40], [2, 10], [38, 10]]);
  assertClose(mixed.maxSpeed, 50 / 3.6, 0.001, 'touching the city road binds the strictest limit');
  const jalopy = roadMotionProfile({ maxSpeed: 8, accel: 4, decel: 6 }, [city, rural], [[2, 40], [38, 40]]);
  assertEqual(jalopy.maxSpeed, 8, 'limits clamp DOWN, never up');
});

test('continuing a road from its endpoint is ONE road — no phantom junction at the seam', () => {
  const a = road('a', [[0, 10], [15, 10]], 1, 1, true);
  const b = road('b', [[15, 10], [30, 10]], 1, 1, true);
  const plan = planRoads([a, b]);
  let junctions = 0, crosswalks = 0;
  for (const kind of plan.values()) {
    if (kind === 'junction') junctions += 1;
    if (kind === 'crosswalk') crosswalks += 1;
  }
  assertEqual(junctions, 0, 'parallel overlap never boxes');
  assertEqual(crosswalks, 0, 'no zebras mid-road');
  assertEqual(at(plan, 15, 10), 'median', 'the seam reads as continuous centerline');
  assertEqual(at(plan, 15, 11), 'laneEast', 'lanes flow straight through the seam');
});

test('head-on parallel overlap also stays box-free; crossing axes still box', () => {
  const a = road('a', [[0, 10], [20, 10]], 1, 1, false);
  const headOn = road('b', [[30, 10], [15, 10]], 1, 1, false);
  let junctions = 0;
  for (const kind of planRoads([a, headOn]).values()) if (kind === 'junction') junctions += 1;
  assertEqual(junctions, 0, 'two roads drawn toward each other merge, never box');

  const tee = road('c', [[15, 10], [15, 30]], 1, 1, false);
  let teeJunctions = 0;
  for (const kind of planRoads([a, tee]).values()) if (kind === 'junction') teeJunctions += 1;
  assert(teeJunctions > 0, 'a T (crossing axes) still forms the box');
});

test('laneGuides put each lane wire at its 3-tile group centre', () => {
  const twoWay = laneGuides({ lanesF: 2, lanesB: 1, sidewalks: false });
  assertEqual(
    twoWay.map((g) => `${g.flow[0]}${g.off}`).join(','),
    'f2,f5,b-2',
    'forward lanes at +2/+5, opposing at -2',
  );
  const oneWay = laneGuides({ lanesF: 1, lanesB: 0, sidewalks: false });
  assertEqual(oneWay.length, 1, 'one lane, one wire');
  assertEqual(oneWay[0]!.off, 0, 'single one-way lane centres on the stroke');
});

test('snapToRoadEnd snaps a nearby click to the stroke endpoint, never a far one', () => {
  const a = road('a', [[0, 10], [15, 10]], 1, 1, false);
  const near = snapToRoadEnd([a], { gx: 17, gz: 11 }, 2.5);
  assert(!!near && near.gx === 15 && near.gz === 10, 'click within radius lands exactly on the endpoint');
  assertEqual(snapToRoadEnd([a], { gx: 25, gz: 10 }, 2.5), null, 'click past the radius stays free');
});

test('snapToCenterline lands mid-span clicks on the wire and flags them for a split', () => {
  const a = road('a', [[0, 10], [30, 10]], 3, 1, false);
  const mid = snapToCenterline([a], { gx: 15, gz: 11 }, 2);
  assert(!!mid && mid.point.gx === 15 && mid.point.gz === 10, 'click beside the wire snaps onto it');
  assert(!!mid && mid.midSpan, 'a mid-span hit needs a split');
  const end = snapToCenterline([a], { gx: 30, gz: 11 }, 2);
  assert(!!end && !end.midSpan, 'a hit at the endpoint never splits');
  assertEqual(snapToCenterline([a], { gx: 15, gz: 20 }, 2), null, 'far clicks stay free');
});

test('splitStroke makes two halves sharing the point, profiles copied', () => {
  const a = road('a', [[0, 10], [30, 10]], 3, 1, true);
  const halves = splitStroke(a, { gx: 15, gz: 10 }, 'r_8', 'r_9');
  assert(!!halves, 'mid-span split succeeds');
  const [h1, h2] = halves!;
  assertEqual(h1.points[h1.points.length - 1]!.gx, 15, 'first half ends at the split');
  assertEqual(h2.points[0]!.gx, 15, 'second half starts at the split');
  assertEqual(h1.profile.lanesF, 3, 'profile copies to both halves');
  assert(h1.profile.sidewalks && h2.profile.sidewalks, 'sidewalk flag copies');

  // The split halves replan as ONE continuous road (the parallel-seam rule).
  const plan = planRoads(halves!);
  let junctions = 0;
  for (const kind of plan.values()) if (kind === 'junction') junctions += 1;
  assertEqual(junctions, 0, 'a split road never boxes at its own seam');
  assertEqual(at(plan, 15, 10), 'median', 'centerline continuous through the split');
});

test('splitStroke at an endpoint degenerates to null', () => {
  const a = road('a', [[0, 10], [30, 10]], 1, 1, false);
  assertEqual(splitStroke(a, { gx: 0, gz: 10 }, 'x', 'y'), null, 'no empty half');
});

test("the merge gesture: ramp into C then along to A widens THAT half's receiving side", () => {
  // The user's exact picture: road drawn A(20,0) → B(20,30), 3 forward + 1
  // opposing — so the single opposing lane flows B→A (north). A 2-lane one-way
  // ramp comes in from the east, clicks C(20,15), then continues to A.
  let seq = 100;
  const mint = () => `r_${++seq}`;
  const main = road('main', [[20, 0], [20, 30]], 3, 1, true);
  const draft: [number, number][] = [[30, 15], [20, 15], [20, 0]];
  const res = applyMergeGesture([main], draft.map(([gx, gz]) => ({ gx, gz })), { lanesF: 2, lanesB: 0, sidewalks: false }, mint);
  assert(!!res, 'gesture recognized');
  assertEqual(res!.strokes.length, 2, 'main road split into two halves');
  const widened = res!.strokes.find((r) => r.id === res!.widenedId)!;
  assertEqual(widened.points[0]!.gz, 0, 'the widened half is the C→A side');
  assertEqual(widened.points[widened.points.length - 1]!.gz, 15, 'ending at the split');
  assertEqual(widened.profile.lanesF, 3, 'southbound side untouched');
  assertEqual(widened.profile.lanesB, 3, 'northbound side 1 + 2 incoming = 3 — the merge');
  const otherHalf = res!.strokes.find((r) => r.id !== res!.widenedId)!;
  assertEqual(otherHalf.profile.lanesB, 1, 'the B-side half keeps its single lane');
  assertEqual(res!.points.length, 2, 'the ramp trims to end at C');
  assertEqual(res!.points[res!.points.length - 1]!.gx, 20, 'ramp last point is C');
});

test('the merge gesture at the draft HEAD reads as an exit ramp', () => {
  // Drawn A-first: [A(20,0), C(20,15), ...away east] with lanes → 1: traffic
  // flows A→C then leaves — the A→C half widens on its southbound (forward) side.
  let seq = 200;
  const mint = () => `r_${++seq}`;
  const main = road('main', [[20, 0], [20, 30]], 3, 1, false);
  const draft: [number, number][] = [[20, 0], [20, 15], [30, 15]];
  const res = applyMergeGesture([main], draft.map(([gx, gz]) => ({ gx, gz })), { lanesF: 1, lanesB: 0, sidewalks: false }, mint);
  assert(!!res, 'head gesture recognized');
  const widened = res!.strokes.find((r) => r.id === res!.widenedId)!;
  assertEqual(widened.profile.lanesF, 3, 'cap holds the southbound side at 3 (3 + 1 exit clamps)');
  assertEqual(widened.profile.lanesB, 1, 'opposing side untouched');
  assertEqual(res!.points[0]!.gz, 15, 'ramp now starts at C');
});

test('the merge gesture ignores two-way drafts and free-standing ends', () => {
  let seq = 300;
  const mint = () => `r_${++seq}`;
  const main = road('main', [[20, 0], [20, 30]], 1, 1, false);
  const alongRoad: [number, number][] = [[30, 15], [20, 15], [20, 0]];
  assertEqual(
    applyMergeGesture([main], alongRoad.map(([gx, gz]) => ({ gx, gz })), { lanesF: 1, lanesB: 1, sidewalks: false }, mint),
    null,
    'two-way drafts never merge-widen',
  );
  const freeEnd: [number, number][] = [[30, 15], [25, 15], [25, 5]];
  assertEqual(
    applyMergeGesture([main], freeEnd.map(([gx, gz]) => ({ gx, gz })), { lanesF: 2, lanesB: 0, sidewalks: false }, mint),
    null,
    'a draft not ending along a road is just a road',
  );
});

test('filletPoints rounds corners into arcs, leaves straights and endpoints alone', () => {
  const corner = [{ gx: 0, gz: 20 }, { gx: 20, gz: 20 }, { gx: 20, gz: 0 }];
  const arc = filletPoints(corner, 5);
  assert(arc.length > 4, 'the corner becomes arc samples');
  assertEqual(arc[0]!.gx, 0, 'first endpoint preserved');
  assertEqual(arc[arc.length - 1]!.gz, 0, 'last endpoint preserved');
  assert(!arc.some((p) => p.gx === 20 && p.gz === 20), 'the sharp corner vertex is gone');
  // every arc sample cuts INSIDE the corner
  for (const p of arc) assert(p.gx <= 20 && p.gz <= 20.0001, 'arc stays inside the bend');

  const straight = [{ gx: 0, gz: 10 }, { gx: 10, gz: 10 }, { gx: 20, gz: 10 }];
  assertEqual(filletPoints(straight, 5).length, 3, 'collinear points pass through');
  // and the stamped plan actually cuts the corner: the cell just inside the
  // bend (on the chord) is carriageway even though both straight legs miss it.
  const plan = planRoads([{ id: 'c', points: corner, profile: { lanesF: 1, lanesB: 1, sidewalks: false } }]);
  const chord = plan.get(cellKey(17, 17));
  assert(chord !== undefined && chord !== 'sidewalk', `the arc chord cell is road (got ${String(chord)})`);
});

test('ribbonExtents match the stamped cross-section widths', () => {
  const tw = ribbonExtents({ lanesF: 3, lanesB: 1, sidewalks: true });
  assertEqual(tw.rightExt, 9.5, '3 forward lanes + half median');
  assertEqual(tw.leftExt, 3.5, '1 opposing lane + half median');
  assertEqual(tw.twoWay, 1, 'two-way flag');
  const ow = ribbonExtents({ lanesF: 2, lanesB: 0, sidewalks: false });
  assertEqual(ow.rightExt, 3, 'one-way 2-lane centres ±3');
  assertEqual(ow.phase, 0, 'even lane count divides at the centre');
});

test('roadRibbonSegments emits chunk-local 8-float segments and filters far chunks', () => {
  const r: RoadStroke = { id: 'r', points: [{ gx: 10, gz: 10 }, { gx: 40, gz: 10 }], profile: { lanesF: 1, lanesB: 1, sidewalks: false } };
  const segs = roadRibbonSegments([r], 0, 0, 120);
  assertEqual(segs.length % 8, 0, '8 floats per segment');
  assert(segs.length >= 8, 'the road crosses chunk (0,0)');
  assertEqual(segs[0], 10.5, 'chunk-local cell-centre x');
  assertEqual(segs[1], 10.5, 'chunk-local cell-centre z');
  assertEqual(roadRibbonSegments([r], 5, 5, 120).length, 0, 'a far chunk gets no segments');
});

test('strokeWireFlip canonicalizes wire colours — opposite-drawn halves read as one road (WIRECOLOR-0610)', () => {
  // the user's intersection: r_2 drawn eastward, r_4 drawn westward from the
  // same junction — physically one road, but draw-relative colours flipped
  // at the seam and READ as wrong-way traffic. Canonical = positive on the
  // dominant axis, so exactly one of the pair flips its display colours.
  assertEqual(strokeWireFlip([{ gx: 18, gz: 543 }, { gx: 95, gz: 542 }]), false, 'eastward = canonical');
  assertEqual(strokeWireFlip([{ gx: 18, gz: 543 }, { gx: 3, gz: 543 }]), true, 'westward flips');
  assertEqual(strokeWireFlip([{ gx: 18, gz: 584 }, { gx: 18, gz: 543 }]), true, 'northward flips');
  assertEqual(strokeWireFlip([{ gx: 18, gz: 543 }, { gx: 18, gz: 584 }]), false, 'southward = canonical');
});

test('roadRibbonSection always emits the segN header — empty = explicit 0, never omission (GHOSTROAD-0610)', () => {
  // The Effect GPU data buffer never shrinks (framework/gpu/effects.zig) and
  // the shader gates on arrayLength (capacity). An omitted section leaves the
  // PREVIOUS section alive in the buffer tail — deleted roads kept rendering
  // as ghost ribbons. The encoder must overwrite the slot with segN=0.
  assertEqual(roadRibbonSection(undefined).length, 5, 'no roads still writes the 5-float header');
  assertEqual(roadRibbonSection(undefined)[0], 0, 'segN=0 turns the ribbon pass off');
  assertEqual(roadRibbonSection([])[0], 0, 'empty segs = segN 0');
  const one = roadRibbonSection([1, 2, 3, 4, 5, 6, 7, 8]);
  assertEqual(one[0], 1, 'one segment counted');
  assertEqual(one.length, 5 + 8, 'header + 8 floats');
});

finish('roadData');
