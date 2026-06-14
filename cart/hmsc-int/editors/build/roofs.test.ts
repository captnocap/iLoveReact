// roofs.test.ts — the pitched-roof profiles (req_0917). A roof lifts its
// profile (shed/gable) over the footprint span, decomposing into the SAME ramp
// primitive the editor renders AND the compiled bake ships — so a pitched roof
// streams to /compiled and is walkable, with no new instance shape. These pin
// the decomposition (shape + scaling) and the editor↔bake parity (ramp rows
// actually reach the instance buffer).

import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';
import { GAME_BUILD, ROOF_PITCH, type PlacedBuildPiece } from '@game';
import { pieceVisualShapes, type VisualShape } from './pieceShapes';
import { buildWorldInstances, INSTANCE_SHAPE_RAMP, INSTANCE_STRIDE } from '../../compile/worldGeometry';

function ramps(shapes: VisualShape[]) {
  return shapes.filter((s) => s.kind === 'ramp').map((s) => (s as Extract<VisualShape, { kind: 'ramp' }>).ramp);
}
function boxes(shapes: VisualShape[]) {
  return shapes.filter((s) => s.kind === 'box').map((s) => (s as Extract<VisualShape, { kind: 'box' }>).box);
}
function roof(pieceId: string, extra: Partial<PlacedBuildPiece> = {}): PlacedBuildPiece {
  return { id: 'r1', pieceId, x: 0, y: 0, z: 0, yawDegrees: 0, ...extra };
}
function bakedRampCount(piece: PlacedBuildPiece): number {
  const built = buildWorldInstances({} as any, [piece], []);
  let n = 0;
  for (let i = 0; i < built.instances.length / INSTANCE_STRIDE; i += 1) {
    if (built.instances[i * INSTANCE_STRIDE + 12] === INSTANCE_SHAPE_RAMP) n += 1;
  }
  return n;
}

test('a shed roof is one ramp spanning the footprint, rising to the pitch', () => {
  const piece = roof('roof.shed.common'); // PLATE_SIZE 3×3, semiSlant 0.5
  const r = ramps(pieceVisualShapes(piece, piece.id, [piece]));
  assertEqual(r.length, 1, 'shed = a single mono-pitch ramp');
  assertClose(r[0].width, 3, 1e-6, 'ramp spans the footprint width');
  assertClose(r[0].depth, 3, 1e-6, 'ramp spans the footprint depth');
  assertClose(r[0].height, 0.5 * 3, 1e-6, 'rise = pitch (0.5) × full-depth run (3)');
});

test('a gable roof is two opposed slopes meeting at a center ridge', () => {
  const piece = roof('roof.gable.suburb'); // semiSlant, 3×3
  const shapes = pieceVisualShapes(piece, piece.id, [piece]);
  const r = ramps(shapes);
  assertEqual(r.length, 2, 'gable = two slopes');
  for (const ramp of r) {
    assertClose(ramp.depth, 1.5, 1e-6, 'each slope covers half the depth');
    assertClose(ramp.height, 0.5 * 1.5, 1e-6, 'ridge rise = pitch × half-depth run');
  }
  const yaws = r.map((x) => ((x.yawDegrees % 360) + 360) % 360).sort((a, b) => a - b);
  assertEqual(yaws[1] - yaws[0], 180, 'the two slopes face opposite ways (mirror at the ridge)');
  assert(boxes(shapes).length > 0, 'the gable ends are closed (stepped infill boxes)');
});

test('a roofSpan footprint scales the profile to the whole base floor', () => {
  const piece = roof('roof.gable.suburb', { roofSpan: { widthMeters: 12, depthMeters: 9 } });
  const r = ramps(pieceVisualShapes(piece, piece.id, [piece]));
  assertEqual(r.length, 2, 'still two slopes, just wider');
  for (const ramp of r) {
    assertClose(ramp.width, 12, 1e-6, 'slopes span the dragged width');
    assertClose(ramp.depth, 4.5, 1e-6, 'each slope covers half the dragged depth');
  }
  assertClose(GAME_BUILD.placed.roofRise(piece), ROOF_PITCH.semiSlant * 4.5, 1e-6, 'ridge scales with the span');
});

test('a steep pitch lifts the ridge higher than a semi-slant', () => {
  const semi = roof('roof.gable.suburb', { roofSpan: { widthMeters: 6, depthMeters: 6 } });
  const steep = roof('roof.gableSteep.suburb', { roofSpan: { widthMeters: 6, depthMeters: 6 } });
  assert(GAME_BUILD.placed.roofRise(steep) > GAME_BUILD.placed.roofRise(semi), 'full-slant out-rises semi-slant');
  assertClose(GAME_BUILD.placed.roofRise(steep), ROOF_PITCH.fullSlant * 3, 1e-6, 'full-slant rise = 1.0 × half-depth');
});

test('a flat roof stays a plate — no ramps', () => {
  const piece = roof('roof.flat.common');
  assertEqual(ramps(pieceVisualShapes(piece, piece.id, [piece])).length, 0, 'flat roof emits no ramps');
  assertEqual(GAME_BUILD.placed.roofRise(piece), 0, 'flat roof has zero rise');
});

test('PARITY: a pitched roof ships its slopes as RAMP rows to the compiled bake', () => {
  assertEqual(bakedRampCount(roof('roof.shed.common')), 1, 'the shed slope reaches the instance buffer');
  assertEqual(bakedRampCount(roof('roof.gable.suburb')), 2, 'both gable slopes reach the instance buffer');
  assertEqual(bakedRampCount(roof('roof.flat.common')), 0, 'a flat roof ships no ramps');
});

test('a pitched roof collides as a walkable slope, not a flat eave slab', () => {
  const gable = roof('roof.gable.suburb', { roofSpan: { widthMeters: 9, depthMeters: 9 } });
  const fields = GAME_BUILD.placed.ramps([gable], 0);
  assertEqual(fields.length, 1, 'a pitched roof emits one slope heightfield');
  assertClose(Math.max(...fields[0].heights), GAME_BUILD.placed.roofRise(gable), 1e-6, 'the ridge reaches the rise');
  const { rects, orientedRects } = GAME_BUILD.placed.colliders([gable]);
  assertEqual(rects.length + orientedRects.length, 0, 'no phantom flat slab — the slope owns footing');
});

test('a flat roof keeps its solid plate collider', () => {
  const flat = roof('roof.flat.common');
  assertEqual(GAME_BUILD.placed.ramps([flat], 0).length, 0, 'a flat roof has no slope field');
  const { rects, orientedRects } = GAME_BUILD.placed.colliders([flat]);
  assert(rects.length + orientedRects.length > 0, 'a flat roof still collides as a plate');
});

finish('roofs');
