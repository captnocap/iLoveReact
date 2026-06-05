// skeleton.test.ts — P4 behavior tests for the figure skeleton.
//
// Meaning-level assertions against the V2 contract and the behavior the
// head_lab reference exhibits: 25 named bones in a rooted parent chain,
// left/right mirror symmetry at stand, a periodic walk gait, posture actions
// that actually lower the body, oriented-box hit volumes on every bone, and
// place/blend helpers that move a whole skeleton coherently.

import { BODY_SHAPES, PART_IDS, PROFILE_N, defaultProfile } from './shapes';
import { blendBones, buildSkeleton, offsetBones, placeBones, type BoneId } from './skeleton';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

const ALL_BONES: BoneId[] = [
  'torso', 'head', 'pelvis', 'lHip', 'rHip',
  'lShoulder', 'rShoulder', 'lUpperArm', 'rUpperArm', 'lElbow', 'rElbow',
  'lForearm', 'rForearm', 'lWrist', 'rWrist', 'lHand', 'rHand',
  'lThigh', 'rThigh', 'lKnee', 'rKnee', 'lShin', 'rShin', 'lFoot', 'rFoot',
];

test('the skeleton is 25 named bones rooted at the torso', () => {
  const bones = buildSkeleton();
  assertEqual(Object.keys(bones).length, 25, 'bone count');
  for (const id of ALL_BONES) {
    assert(bones[id] != null, `${id} must exist`);
    assertEqual(bones[id].id, id, `${id} must carry its own id`);
  }
  assertEqual(bones.torso.parent, undefined, 'torso is the root');
  // walk one chain to the root from a fingertip-side extremity
  let at: BoneId | undefined = 'lHand';
  const seen: string[] = [];
  while (at) {
    seen.push(at);
    at = bones[at].parent;
  }
  assertEqual(seen.join('>'), 'lHand>lWrist>lForearm>lElbow>lUpperArm>torso', 'the arm chain must parent to the root');
});

test('stand pose is left/right mirror-symmetric and grounded', () => {
  const bones = buildSkeleton('neutral', 'stand');
  for (const [l, r] of [['lShoulder', 'rShoulder'], ['lHand', 'rHand'], ['lFoot', 'rFoot'], ['lKnee', 'rKnee']] as [BoneId, BoneId][]) {
    assertClose(bones[l].position[0], -bones[r].position[0], 1e-9, `${l}/${r} must mirror in x`);
    assertClose(bones[l].position[1], bones[r].position[1], 1e-9, `${l}/${r} must match in y`);
  }
  assert(bones.lFoot.position[1] < 0.12 && bones.lFoot.position[1] > 0, 'feet must sit just above the ground (y=0)');
  // R4: the visual figure is stylized-tall — head TOP around 2 units. The head
  // bone is the skull center; its hitbox half-height tops it out.
  const headTop = bones.head.position[1] + bones.head.hitbox[1] / 2;
  assert(headTop > 1.7 && headTop < 2.3, `visual head-top must be ~2 units (got ${headTop.toFixed(3)})`);
});

test('the walk gait is periodic in phase and actually strides', () => {
  const a = buildSkeleton('neutral', 'walk', 0.25);
  const b = buildSkeleton('neutral', 'walk', 1.25);
  for (const id of ALL_BONES) {
    assertClose(a[id].position[2], b[id].position[2], 1e-9, `${id} must repeat each cycle`);
  }
  const c = buildSkeleton('neutral', 'walk', 0.75);
  assert(Math.abs(a.lFoot.position[2] - c.lFoot.position[2]) > 0.05, 'opposite phases must stride apart');
  // counter-stride: when the left foot is forward the right foot is back
  assert((a.lFoot.position[2] - c.lFoot.position[2]) * (a.rFoot.position[2] - c.rFoot.position[2]) < 0,
    'feet must counter-stride');
});

test('posture actions lower the body (crouch < stand, sit < crouch)', () => {
  const stand = buildSkeleton('neutral', 'stand');
  const crouch = buildSkeleton('neutral', 'stand', 0, [{ target: 'body', action: 'crouch', phase: 1, weight: 1 }]);
  const sit = buildSkeleton('neutral', 'stand', 0, [{ target: 'body', action: 'sit', phase: 1, weight: 1 }]);
  assert(crouch.torso.position[1] < stand.torso.position[1] - 0.1, 'crouch must drop the torso');
  assert(sit.torso.position[1] < crouch.torso.position[1], 'sit must drop further than crouch');
  assert(crouch.head.position[1] < stand.head.position[1], 'the head must come down with the body');
});

test('body shapes scale the skeleton (tall is taller, wide is wider)', () => {
  const neutral = buildSkeleton('neutral');
  const tall = buildSkeleton('tall');
  const builder = buildSkeleton('bodybuilder');
  assert(tall.head.position[1] > neutral.head.position[1], 'tall must raise the head');
  assert(
    builder.rShoulder.position[0] - builder.lShoulder.position[0]
    > neutral.rShoulder.position[0] - neutral.lShoulder.position[0],
    'builder must widen the shoulders',
  );
  for (const id of Object.keys(BODY_SHAPES) as (keyof typeof BODY_SHAPES)[]) {
    const s = BODY_SHAPES[id];
    assert(s.height > 0 && s.limbThick > 0 && s.head > 0, `${id} multipliers must be positive`);
  }
});

test('every bone carries an oriented-box hit volume (V2: boxes, not capsules)', () => {
  const bones = buildSkeleton('neutral', 'walk', 0.3);
  for (const id of ALL_BONES) {
    const [hx, hy, hz] = bones[id].hitbox;
    assert(hx > 0 && hy > 0 && hz > 0, `${id} hitbox must have positive extents`);
    assert(bones[id].rotation.every(Number.isFinite), `${id} hitbox orientation must be finite`);
  }
});

test('placeBones turns and stands the figure at (x, z); offset/blend cohere', () => {
  const bones = buildSkeleton();
  const placed = placeBones(bones, 90, 10, 5);
  // 90° about Y maps local -Z facing to -X: the head stays directly above the feet
  assertClose(placed.head.position[0], 10 + bones.head.position[2], 1e-6, 'yaw must rotate positions about Y');
  assertClose(placed.head.position[1], bones.head.position[1], 1e-9, 'yaw must not change heights');
  assertClose(placed.head.rotation[1], bones.head.rotation[1] + 90, 1e-9, 'yaw must add to every ry');
  const lifted = offsetBones(bones, [0, 2, 0]);
  assertClose(lifted.lFoot.position[1], bones.lFoot.position[1] + 2, 1e-9, 'offset must translate every bone');
  const blended = blendBones(bones, lifted, 1);
  assertClose(blended.torso.position[1], lifted.torso.position[1], 1e-9, 'blend t=1 must equal the target');
  const half = blendBones(bones, lifted, 0.5);
  assertClose(half.torso.position[1], bones.torso.position[1] + 1, 1e-9, 'blend t=0.5 must be the midpoint');
});

test('part profiles are radial-only data on the PROFILE_N grid', () => {
  for (const id of PART_IDS) {
    const profile = defaultProfile(id);
    assertEqual(profile.length, PROFILE_N, `${id} profile must resample to the grid`);
    assert(profile.every((v) => v > 0 && v <= 1.01), `${id} profile must be positive radius multipliers`);
  }
});

finish('game/figure/skeleton');
