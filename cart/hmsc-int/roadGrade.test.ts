// roadGrade.test.ts — meaning-tests for GRADE MODE (ROADGRADE-0610, P4):
// the bed flattens ACROSS the band (zero crossfall), the longitudinal profile
// follows smoothed terrain (climbs hills, ignores potholes), the feather
// blends back to untouched ground, and off-band terrain never moves. Pure CPU
// under tools/v8cli.

import { assert, assertClose, assertEqual, finish, test } from './game/_testkit';
import { DOTS_PER_TILE, makeHeightField } from './heightData';
import { gradeHeightField, strokeGradeProfile, GRADE_TUNING } from './roadGrade';
import { roadWidthTiles, clampProfile, type RoadStroke } from './roadData';

const PROFILE = { lanesF: 1, lanesB: 1, sidewalks: false };

function strokeAlongX(z: number, x0 = 4, x1 = 36): RoadStroke {
  return { id: 'r', points: [{ gx: x0, gz: z }, { gx: x1, gz: z }], profile: PROFILE };
}

function fieldAt(field: ReturnType<typeof makeHeightField>, xTiles: number, zTiles: number): number {
  return field.z[Math.round(zTiles * DOTS_PER_TILE) * field.cols + Math.round(xTiles * DOTS_PER_TILE)]!;
}

test('the bed is flat across the band at the centerline height (zero crossfall)', () => {
  const field = makeHeightField(40, 40);
  // cross-slope: terrain rises along +Z, 0.4m per tile
  for (let j = 0; j < field.rows; j++) for (let i = 0; i < field.cols; i++) field.z[j * field.cols + i] = (j / DOTS_PER_TILE) * 0.4;
  const stroke = strokeAlongX(20);
  const read = (x: number, z: number) => z * 0.4;
  const p = strokeGradeProfile(stroke, read)!;
  const changed = gradeHeightField({ profiles: [p], field, chunkCx: 0, chunkCz: 0, chunkTiles: 40 });
  assert(changed, 'samples moved');
  const centre = fieldAt(field, 20, 20);
  assertClose(centre, 20 * 0.4, 0.05, 'centerline keeps its own height');
  const half = roadWidthTiles(clampProfile(PROFILE)) / 2;
  assertClose(fieldAt(field, 20, 20 + half - 0.5), centre, 0.01, 'the +z curb sits at the centre height');
  assertClose(fieldAt(field, 20, 20 - half + 0.5), centre, 0.01, 'the -z curb sits at the centre height');
});

test('off-band terrain never moves; the feather blends between', () => {
  const field = makeHeightField(40, 40);
  for (let j = 0; j < field.rows; j++) for (let i = 0; i < field.cols; i++) field.z[j * field.cols + i] = (j / DOTS_PER_TILE) * 0.4;
  const stroke = strokeAlongX(20);
  const p = strokeGradeProfile(stroke, (x, z) => z * 0.4)!;
  gradeHeightField({ profiles: [p], field, chunkCx: 0, chunkCz: 0, chunkTiles: 40 });
  const half = roadWidthTiles(clampProfile(PROFILE)) / 2;
  const beyond = 20 + half + GRADE_TUNING.featherTiles + 1;
  assertClose(fieldAt(field, 20, beyond), beyond * 0.4, 0.001, 'past the feather = untouched terrain');
  const mid = fieldAt(field, 20, 20 + half + GRADE_TUNING.featherTiles / 2);
  assert(mid > 20 * 0.4 && mid < (20 + half + GRADE_TUNING.featherTiles / 2) * 0.4, 'the feather sits between bed and terrain');
});

test('the longitudinal profile smooths potholes but climbs real hills', () => {
  // a long slope with one sharp 2m pothole at x=20
  const read = (x: number, _z: number) => x * 0.1 - (Math.abs(x - 20) < 1 ? 2 : 0);
  const p = strokeGradeProfile(strokeAlongX(20, 2, 38), read)!;
  const at = (s: number) => p.h[Math.round(s / GRADE_TUNING.sampleStepTiles)]!;
  // the pothole (raw -2m dip) irons down to a fraction of itself
  const potholeS = 18; // stroke starts at x=2, so x=20 sits at s=18
  const expected = 20 * 0.1;
  assert(Math.abs(at(potholeS) - expected) < 0.7, 'the dip irons out (moving average)');
  // the overall climb survives: end is higher than start by ~the slope
  assert(at(34) - at(2) > 2.4, 'the road still climbs the hill');
});

test('a stroke grades only chunks it reaches', () => {
  const field = makeHeightField(40, 40);
  field.z.fill(5);
  const stroke = strokeAlongX(20); // lives in chunk (0,0) for chunkTiles=40
  const p = strokeGradeProfile(stroke, () => 5)!;
  const farChunkChanged = gradeHeightField({ profiles: [p], field, chunkCx: 3, chunkCz: 3, chunkTiles: 40 });
  assertEqual(farChunkChanged, false, 'a far chunk is untouched');
});

finish('roadGrade');
