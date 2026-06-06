// bake.test.ts — P4 behavior tests for the ragdoll contract + the bake entry.
//
// Ragdoll (V1): the SEAM survives — bones seed joints, joints rebuild a full
// dressed-figure bones record, rest lengths are pose-invariant, and the
// tuning table is a coherent body graph. No solver is tested because no
// solver is kept (the host feature validates against the archived JS
// reference when the physics lane lands it).
// Bake (V2-AMENDED): documents/seeds in → deterministic, JSON-able,
// host-shaped figures out; variety preserved; radial-only profile law held.

import {
  JOINT_IDS, JOINT_SEED_BONE, RAGDOLL_TUNING, jointsToBones, ragdollHostReady, restLengths, seedJointsFromBones,
} from './ragdoll';
import { bakeFigure, bakeFigureFromSeed, bakePopulation } from './bake';
import { generateFace } from './hed';
import { buildSkeleton, placeBones } from './skeleton';
import { buildRigFrameFromBones } from './rig';
import { PART_IDS } from './shapes';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

test('the ragdoll tuning is a coherent body graph (P2 data, not code)', () => {
  assertEqual(JOINT_IDS.length, 15, 'the fifteen-joint body');
  for (const c of RAGDOLL_TUNING.constraints) {
    assert(JOINT_IDS.includes(c.a) && JOINT_IDS.includes(c.b), `${c.a}→${c.b} must reference declared joints`);
    assert(c.stiffness > 0 && c.stiffness <= 1, `${c.a}→${c.b} stiffness must be a 0..1 spring`);
  }
  for (const id of JOINT_IDS) {
    assert(RAGDOLL_TUNING.masses[id] > 0, `${id} must have positive mass`);
    assert(RAGDOLL_TUNING.radii[id] > 0, `${id} must have a contact radius`);
    assert(RAGDOLL_TUNING.constraints.some((c) => c.a === id || c.b === id), `${id} must be in the graph`);
  }
  assert(RAGDOLL_TUNING.masses.pelvis > RAGDOLL_TUNING.masses.lHand, 'the trunk must outweigh the extremities');
  assertEqual(ragdollHostReady(), false, 'the host feature is honestly absent until the physics lane lands it');
});

test('the seam: bones → joints → bones keeps the figure whole (V1)', () => {
  // hand the seam a mid-walk skeleton placed away from the origin
  const source = placeBones(buildSkeleton('neutral', 'walk', 0.3), 45, 8, -3);
  const joints = seedJointsFromBones(source);
  for (const id of JOINT_IDS) {
    assertEqual(joints[id].join(','), source[JOINT_SEED_BONE[id]].position.join(','), `${id} must seed from its bone`);
  }
  const rebuilt = jointsToBones(joints);
  assertEqual(Object.keys(rebuilt).length, 25, 'the full 25-bone record must come back');
  assertClose(rebuilt.head.position[0], source.head.position[0], 1e-9, 'joint-backed bones keep their positions');
  assert(rebuilt.lForearm.position[1] !== 0 || rebuilt.lForearm.position[0] !== 0, 'subdivided bones must be placed');
  assert(rebuilt.torso.scale > 0 && rebuilt.torso.hitbox[1] > 0, 'template metadata must ride along');
  // and the whole dressed figure follows (the reason the seam exists)
  const frame = buildRigFrameFromBones(rebuilt);
  assertEqual(frame.hitboxes.length, 25, 'a ragdoll pose still carries its hit volumes');
});

test('rest lengths are pose-invariant facts of the stand skeleton', () => {
  const rests = restLengths();
  assertEqual(rests.length, RAGDOLL_TUNING.constraints.length, 'one rest per constraint');
  for (const r of rests) {
    assert(r.rest > 0.01 && r.rest < 2.5, `${r.a}→${r.b} rest must be a body-scale distance (got ${r.rest.toFixed(3)})`);
  }
  const upper = rests.find((r) => r.a === 'lShoulder' && r.b === 'lElbow')!;
  const mirror = rests.find((r) => r.a === 'rShoulder' && r.b === 'rElbow')!;
  assertClose(upper.rest, mirror.rest, 1e-9, 'mirrored limbs must measure identically');
});

test('the bake is deterministic and host-shaped (V2-AMENDED)', () => {
  const a = bakeFigureFromSeed(1780, { shape: 'heavy' });
  const b = bakeFigureFromSeed(1780, { shape: 'heavy' });
  const strip = (f: any) => JSON.stringify(f, (k, v) => (k === 'createdAt' ? 0 : v));
  assertEqual(strip(a), strip(b), 'same seed must bake the same citizen');
  assertEqual(a.seed, 1780, 'provenance must ride the bake');
  assert(strip(a) !== strip(bakeFigureFromSeed(1781, { shape: 'heavy' })), 'a new seed must bake a new citizen');
  // host-shaped: plain JSON the compile can lower — no functions anywhere
  assert(!strip(a).includes('undefined'), 'the bake must serialize clean');
  for (const id of PART_IDS) {
    const part = a.parts[id];
    assert(part.params.segments > 0 && part.params.rings > 0, `${id} must carry its LOD`);
    assert(part.params.profile.every((v: number) => v > 0), `${id} profile is radial-only positive data`);
  }
  assertEqual(a.parts.head.params.displace?.length, 48 * 24, 'the head bakes its composited depth grid');
  assertEqual(a.parts.pipe.params.amount, 0, 'only the head displaces');
  assertEqual(a.hitboxes.length, 25, 'hit volumes bake in');
  assertEqual(a.anchors.length, 10, 'anchors bake in');
  assert(a.clothing.length > 0, 'the wardrobe bakes in');
  assert(a.faceTexture.layers.length > 0, 'the face texture description bakes in');
});

test('a population preserves variety across seeds and shapes', () => {
  const seeds = [11, 22, 33, 44];
  const population = bakePopulation(seeds);
  assertEqual(population.length, 4, 'one citizen per seed');
  const distinct = new Set(population.map((f) => JSON.stringify(f.parts.head.params.displace)));
  assert(distinct.size === 4, 'every citizen must wear a different face');
  const shapes = new Set(population.map((f) => f.shape));
  assert(shapes.size > 1, 'the population must span body shapes');
});

test('an authored face document bakes the same as its generated twin', () => {
  const face = generateFace(5);
  const fromDoc = bakeFigure(face, 'neutral', { top: 'suit' });
  assertEqual(fromDoc.faceTexture.skin, face.skin, 'the document skin must carry');
  assertEqual(fromDoc.parts.head.params.scaleY, face.scaleY, 'the document skull stretch must carry');
  assert(fromDoc.clothing.length > 0, 'the chosen wardrobe must bake');
});

finish('game/figure/bake');
