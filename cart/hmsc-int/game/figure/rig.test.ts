// rig.test.ts — P4 behavior tests for the dressed figure frame.
//
// The contract under test: a frame carries every layer; all layers are
// BONES-DRIVEN (the V1 seam — hand the same functions moved bones and the
// dressed figure follows); the ruled damage-zone vocabulary covers all 25
// bones in head_lab spelling; anchors and sockets ride their bones.

import { offsetBones } from './skeleton';
import {
  DAMAGE_ZONES, DAMAGE_ZONE_BY_BONE, buildMeshFrame, buildRigFrame, buildRigFrameFromBones, damageZoneForBone,
} from './rig';
import { attachOutfit, buildOutfit } from './outfit';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

function dist3(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function turnPlace(p: readonly number[], yawDeg: number, offset: readonly number[]): [number, number, number] {
  const rad = yawDeg * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return [p[0] * c + p[2] * s + offset[0], p[1] + offset[1], -p[0] * s + p[2] * c + offset[2]];
}

function firstMovingIndex<T extends { position: readonly number[] }>(a: T[], b: T[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (dist3(a[i].position, b[i].position) > 1e-7) return i;
  }
  return -1;
}

test('a rig frame carries every layer of the dressed figure', () => {
  const frame = buildRigFrame('neutral', 'stand', 0, [], 'tee');
  assertEqual(Object.keys(frame.bones).length, 25, '25 bones');
  // 17 named parts (incl. the pelvis, PELVISMESH-0606) + two 5-digit finger
  // fans = 27 assembly instances
  assertEqual(frame.assembly.length, 27, 'assembly: 17 parts + 10 fingers');
  assert(frame.assembly.filter((i) => i.part === 'finger').length === 10, 'two hands of five digits');
  // PELVISMESH-0606: the pelvis is a REAL assembly part on the pelvis bone —
  // never an anatomy socket wearing the torso
  const pelvisInstances = frame.assembly.filter((i) => i.part === 'pelvis');
  assertEqual(pelvisInstances.length, 1, 'exactly one pelvis mesh');
  assertEqual(pelvisInstances[0].bone, 'pelvis', 'the pelvis mesh rides the pelvis bone');
  assertEqual(frame.anatomy.filter((i) => i.bone === 'pelvis').length, 0, 'the old torso-wearing pelvis socket is gone');
  assert(frame.anatomy.length >= 8, 'the joint-socket set must be present');
  assert(frame.clothing.length > 0, 'a dressed figure has garments');
  assertEqual(frame.hitboxes.length, 25, 'one oriented-box hit volume per bone');
  assertEqual(frame.anchors.length, 15, 'the semantic anchor set (10 interaction + 5 contact, req_1930)');
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

test('CLOTHSPLIT-0606: the dressed frame IS the mesh frame plus the outfit attached — rig-follow equality', () => {
  // the compat door must equal the explicit composition, byte for byte
  const dressed = buildRigFrame('female', 'walk', 0.3, [], 'hoodie', 'fourtwenty', ['cap'], 'shorts');
  const mesh = buildMeshFrame('female', 'walk', 0.3, []);
  const outfit = buildOutfit({ top: 'hoodie', bottoms: 'shorts', print: 'fourtwenty', accessories: ['cap'] });
  const attached = attachOutfit(mesh.bones, outfit, 'female', 'walk', 0.3, []);
  assertEqual(JSON.stringify(mesh.bones), JSON.stringify(dressed.bones), 'one skeleton');
  assertEqual(JSON.stringify(mesh.assembly), JSON.stringify(dressed.assembly), 'one body assembly');
  assertEqual(JSON.stringify(mesh.anatomy), JSON.stringify(dressed.anatomy), 'one socket set');
  assertEqual(JSON.stringify(mesh.hitboxes), JSON.stringify(dressed.hitboxes), 'one hit-volume set');
  assertEqual(JSON.stringify(mesh.anchors), JSON.stringify(dressed.anchors), 'one anchor set');
  assertEqual(JSON.stringify(attached), JSON.stringify(dressed.clothing), 'the outfit attaches exactly what the dressed frame wears');
  // the mesh frame is the BODY ALONE — what mesh editing looks at
  assert(!('clothing' in mesh), 'the mesh frame carries no clothing');
  // attachments follow ANY bones record (the V1 seam — the prop model)
  const moved = offsetBones(mesh.bones, [2, 0, -1]);
  const movedClothes = attachOutfit(moved, outfit, 'female', 'walk', 0.3, []);
  assertClose(movedClothes[0].position[0], attached[0].position[0] + 2, 1e-9, 'the outfit follows the rig wherever it goes');
});

test('pants track the pose (bones-driven garments, not stand-pose heights)', () => {
  const stand = buildRigFrame('neutral', 'stand', 0, [], 'tee', 'plain', [], 'jeans');
  const kneel = buildRigFrame('neutral', 'kneel', 0, [], 'tee', 'plain', [], 'jeans');
  // the wardrobe as a whole must come DOWN with the kneel, like the body does
  const meanY = (frame: typeof stand) => frame.clothing.reduce((sum, c) => sum + c.position[1], 0) / frame.clothing.length;
  assert(kneel.bones.torso.position[1] < stand.bones.torso.position[1], 'kneel must lower the body');
  assert(meanY(kneel) < meanY(stand) - 0.02, 'garments must follow the lowered pose');
});

test('steady 60hz walk phases move body parts and clothing every consumed frame', () => {
  const dt = 1 / 60;
  const walkCyclesPerSecond = 1.6;
  const yawDeg = 37;
  const root: [number, number, number] = [4, 0.2, -6];
  let prev = buildRigFrame('neutral', 'walk', 0, [], 'tee');
  const probe = buildRigFrame('neutral', 'walk', dt * walkCyclesPerSecond, [], 'tee');
  const assemblyIndex = firstMovingIndex(prev.assembly, probe.assembly);
  const clothingIndex = firstMovingIndex(prev.clothing, probe.clothing);
  assert(assemblyIndex >= 0, 'walk must expose at least one moving body part for the consumption-layer probe');
  assert(clothingIndex >= 0, 'walk must expose at least one moving clothing part for the consumption-layer probe');
  let zeroAssemblyFrames = 0;
  let zeroClothingFrames = 0;
  let maxAssemblyStep = 0;
  let maxClothingStep = 0;
  for (let frame = 1; frame <= 60; frame += 1) {
    const phase = frame * dt * walkCyclesPerSecond;
    const next = buildRigFrame('neutral', 'walk', phase, [], 'tee');
    const assemblyStep = dist3(
      turnPlace(next.assembly[assemblyIndex].position, yawDeg, root),
      turnPlace(prev.assembly[assemblyIndex].position, yawDeg, root),
    );
    const clothingStep = dist3(
      turnPlace(next.clothing[clothingIndex].position, yawDeg, root),
      turnPlace(prev.clothing[clothingIndex].position, yawDeg, root),
    );
    if (assemblyStep <= 1e-7) zeroAssemblyFrames += 1;
    if (clothingStep <= 1e-7) zeroClothingFrames += 1;
    maxAssemblyStep = Math.max(maxAssemblyStep, assemblyStep);
    maxClothingStep = Math.max(maxClothingStep, clothingStep);
    prev = next;
  }
  assertEqual(zeroAssemblyFrames, 0, 'body assembly must not emit zero/zero/jump local pose frames under steady walking');
  assertEqual(zeroClothingFrames, 0, 'clothing must not emit zero/zero/jump local pose frames under steady walking');
  assert(maxAssemblyStep < 0.01, `assembly per-frame step stays small (${maxAssemblyStep})`);
  assert(maxClothingStep < 0.01, `clothing per-frame step stays small (${maxClothingStep})`);
});

finish('game/figure/rig');
