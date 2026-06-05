// rig.test.ts — P4 behavior tests for the dressed figure frame.
//
// The contract under test: a frame carries every layer; all layers are
// BONES-DRIVEN (the V1 seam — hand the same functions moved bones and the
// dressed figure follows); the ruled damage-zone vocabulary covers all 25
// bones in head_lab spelling; anchors and sockets ride their bones.

import { offsetBones } from './skeleton';
import {
  DAMAGE_ZONES, DAMAGE_ZONE_BY_BONE, buildRigFrame, buildRigFrameFromBones, damageZoneForBone,
} from './rig';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

test('a rig frame carries every layer of the dressed figure', () => {
  const frame = buildRigFrame('neutral', 'stand', 0, [], 'tee');
  assertEqual(Object.keys(frame.bones).length, 25, '25 bones');
  // 16 named parts + two 5-digit finger fans = 26 assembly instances
  assertEqual(frame.assembly.length, 26, 'assembly: 16 parts + 10 fingers');
  assert(frame.assembly.filter((i) => i.part === 'finger').length === 10, 'two hands of five digits');
  assert(frame.anatomy.length >= 9, 'the joint-socket set must be present');
  assert(frame.clothing.length > 0, 'a dressed figure has garments');
  assertEqual(frame.hitboxes.length, 25, 'one oriented-box hit volume per bone');
  assertEqual(frame.anchors.length, 10, 'the semantic anchor set');
});

test('every bone resolves to one ruled damage zone (lArm/rArm/lLeg/rLeg spelling)', () => {
  assertEqual(DAMAGE_ZONES.join(','), 'head,torso,lArm,rArm,lLeg,rLeg', 'the six-zone vocabulary');
  const counts: Record<string, number> = {};
  for (const bone of Object.keys(DAMAGE_ZONE_BY_BONE)) {
    const zone = damageZoneForBone(bone as any);
    assert(DAMAGE_ZONES.includes(zone), `${bone} must map into the vocabulary`);
    counts[zone] = (counts[zone] ?? 0) + 1;
  }
  assertEqual(Object.keys(DAMAGE_ZONE_BY_BONE).length, 25, 'all 25 bones must be mapped');
  assertEqual(counts.head, 1, 'head zone is the head bone');
  assertEqual(counts.lArm, 6, 'left arm: shoulder→hand chain');
  assertEqual(counts.rArm, 6, 'right arm: shoulder→hand chain');
  assertEqual(counts.lLeg, 5, 'left leg: hip→foot chain');
  assertEqual(counts.rLeg, 5, 'right leg: hip→foot chain');
  assertEqual(counts.torso, 2, 'torso zone: torso + pelvis');
});

test('the whole dressed figure rides custom bones (the V1 bones-in seam)', () => {
  const base = buildRigFrame('neutral', 'stand', 0, [], 'tee');
  const moved = buildRigFrameFromBones(offsetBones(base.bones, [3, 0, -2]), 'neutral', 'tee');
  // every layer must follow the bones — no layer may stay at the origin
  assertClose(moved.assembly[0].position[0], base.assembly[0].position[0] + 3, 1e-9, 'assembly follows');
  assertClose(moved.hitboxes[0].position[2], base.hitboxes[0].position[2] - 2, 1e-9, 'hitboxes follow');
  const baseFace = base.anchors.find((a) => a.id === 'face')!;
  const movedFace = moved.anchors.find((a) => a.id === 'face')!;
  assertClose(movedFace.position[0], baseFace.position[0] + 3, 1e-6, 'anchors follow');
  const baseShoe = base.clothing[base.clothing.length - 1];
  const movedShoe = moved.clothing[moved.clothing.length - 1];
  assertClose(movedShoe.position[0], baseShoe.position[0] + 3, 1e-6, 'clothing follows');
  // the recorded bug class: nothing may remain absolutely placed at the origin
  for (const inst of moved.anatomy) {
    assert(Math.abs(inst.position[0] - 3) < 1.2, 'no phantom sockets stranded at the origin');
  }
});

test('garment choices change the wardrobe, not the body', () => {
  const tee = buildRigFrame('neutral', 'stand', 0, [], 'tee');
  const dress = buildRigFrame('neutral', 'stand', 0, [], 'dress');
  const underwear = buildRigFrame('neutral', 'stand', 0, [], 'underwear');
  assertEqual(JSON.stringify(tee.bones), JSON.stringify(dress.bones), 'clothes must never move bones');
  assert(dress.clothing.some((c) => c.geometry === 'cone'), 'the dress wears its A-line cone');
  assert(underwear.clothing.length < tee.clothing.length, 'underwear is the minimal wardrobe');
  const shades = buildRigFrame('neutral', 'stand', 0, [], 'tee', 'plain', ['shades']);
  assertEqual(shades.clothing.length, tee.clothing.length + 3, 'shades add their three pieces');
});

test('pants track the pose (bones-driven garments, not stand-pose heights)', () => {
  const stand = buildRigFrame('neutral', 'stand', 0, [], 'tee', 'plain', [], 'jeans');
  const kneel = buildRigFrame('neutral', 'kneel', 0, [], 'tee', 'plain', [], 'jeans');
  // the wardrobe as a whole must come DOWN with the kneel, like the body does
  const meanY = (frame: typeof stand) => frame.clothing.reduce((sum, c) => sum + c.position[1], 0) / frame.clothing.length;
  assert(kneel.bones.torso.position[1] < stand.bones.torso.position[1], 'kneel must lower the body');
  assert(meanY(kneel) < meanY(stand) - 0.02, 'garments must follow the lowered pose');
});

finish('game/figure/rig');
