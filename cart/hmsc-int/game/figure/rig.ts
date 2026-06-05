// game/figure/rig.ts — the full dressed figure for one moment in time.
//
// BodyRigFrame = bones + assembly + clothing + anatomy + hitboxes + anchors.
// Two doors in (and ONLY two):
//   buildRigFrame(...)          — an authored pose (shape/pose/phase/actions)
//   buildRigFrameFromBones(...) — a CUSTOM bones record (the V1 physics seam:
//                                 a host ragdoll only produces bones and the
//                                 whole dressed figure follows; pose/phase
//                                 never enter — the bones ARE the pose)
//
// Damage zones are RULED here (V2): head_lab's spelling — lArm/rArm/lLeg/rLeg
// — over head_lab's oriented-box hit volumes. damageZoneForBone maps each of
// the 25 bones into the six-zone vocabulary every combat consumer speaks.
//
// V2-AMENDED note: per-frame rig building is the EDITOR/LAB PREVIEW path.
// The game path is the bake (./bake.ts) — host-side figure data, never
// per-figure-per-frame JS evaluation.

import { type V3 } from './math';
import { BODY_SHAPES, type BodyPoseId, type BodyShapeId, type BottomsId, type ClothingAccessoryId, type ClothingId, type ClothingSkinId, DEFAULT_BOTTOMS } from './shapes';
import { anatomyFromSkeleton, assemblyFromSkeleton, type BodyInstance } from './assembly';
import { buildClothing, type ClothingInstance } from './clothing';
import { buildSkeleton, offsetBone, type Bones, type BoneId, type RigTimelineAction } from './skeleton';

// ── hit volumes + damage zones (V2 ruled) ────────────────────────────────────

export type BodyHitbox = {
  id: BoneId;
  position: V3;
  rotation: V3;
  size: V3;
};

/** The ruled damage-zone spelling: head_lab's lArm/rArm/lLeg/rLeg. */
export type DamageZoneId = 'head' | 'torso' | 'lArm' | 'rArm' | 'lLeg' | 'rLeg';

export const DAMAGE_ZONES: DamageZoneId[] = ['head', 'torso', 'lArm', 'rArm', 'lLeg', 'rLeg'];

/** Every bone resolves into exactly one damage zone (the combat vocabulary). */
export const DAMAGE_ZONE_BY_BONE: Record<BoneId, DamageZoneId> = {
  head: 'head',
  torso: 'torso', pelvis: 'torso',
  lShoulder: 'lArm', lUpperArm: 'lArm', lElbow: 'lArm', lForearm: 'lArm', lWrist: 'lArm', lHand: 'lArm',
  rShoulder: 'rArm', rUpperArm: 'rArm', rElbow: 'rArm', rForearm: 'rArm', rWrist: 'rArm', rHand: 'rArm',
  lHip: 'lLeg', lThigh: 'lLeg', lKnee: 'lLeg', lShin: 'lLeg', lFoot: 'lLeg',
  rHip: 'rLeg', rThigh: 'rLeg', rKnee: 'rLeg', rShin: 'rLeg', rFoot: 'rLeg',
};

export function damageZoneForBone(bone: BoneId): DamageZoneId {
  return DAMAGE_ZONE_BY_BONE[bone];
}

export function hitboxesFromSkeleton(bones: Bones): BodyHitbox[] {
  return (Object.keys(bones) as BoneId[]).map((id) => ({
    id,
    position: bones[id].position,
    rotation: bones[id].rotation,
    size: bones[id].hitbox,
  }));
}

export function buildHitboxes(shapeId: BodyShapeId = 'neutral', pose: BodyPoseId = 'stand', phase = 0, actions: RigTimelineAction[] = []): BodyHitbox[] {
  return hitboxesFromSkeleton(buildSkeleton(shapeId, pose, phase, actions));
}

// ── semantic anchors — where interactions attach ─────────────────────────────

export type BodyAnchorId =
  | 'head' | 'face' | 'face_grab' | 'eyes' | 'mouth' | 'neck'
  | 'left_palm' | 'right_palm' | 'left_grab_origin' | 'right_grab_origin';

export type BodyAnchor = {
  id: BodyAnchorId;
  bone: BoneId;
  role: 'target' | 'origin' | 'look' | 'socket';
  position: V3;
  rotation: V3;
  radius: number;
  priority: number;
  accepts: string[];
};

export function anchorsFromSkeleton(s: typeof BODY_SHAPES.neutral, bones: Bones): BodyAnchor[] {
  const anchor = (
    id: BodyAnchorId,
    bone: BoneId,
    role: BodyAnchor['role'],
    position: V3,
    radius: number,
    priority: number,
    accepts: string[],
    rotation = bones[bone].rotation,
  ): BodyAnchor => ({ id, bone, role, position, rotation, radius, priority, accepts });

  return [
    anchor('head', 'head', 'target', bones.head.position, 0.18 * s.head, 80, ['look_at', 'hit', 'grab', 'inspect']),
    anchor('face', 'head', 'target', offsetBone(bones.head, 0, 0.0, -0.21 * s.head), 0.145 * s.head, 100, ['look_at', 'grab', 'punch', 'kiss', 'inspect']),
    anchor('face_grab', 'head', 'target', offsetBone(bones.head, 0, -0.03 * s.height, -0.245 * s.head), 0.12 * s.head, 120, ['grab_face', 'cover_mouth', 'shove']),
    anchor('eyes', 'head', 'look', offsetBone(bones.head, 0, 0.07 * s.height, -0.23 * s.head), 0.07 * s.head, 110, ['look_at', 'aim']),
    anchor('mouth', 'head', 'target', offsetBone(bones.head, 0, -0.045 * s.height, -0.235 * s.head), 0.055 * s.head, 105, ['cover_mouth', 'feed', 'talk_to']),
    anchor('neck', 'torso', 'socket', offsetBone(bones.torso, 0, 0.43 * s.torsoLong, -0.02), 0.09 * s.head, 75, ['choke', 'collar', 'attach']),
    anchor('left_palm', 'lHand', 'socket', offsetBone(bones.lHand, 0, -0.02 * s.height, -0.055), 0.065 * s.hand, 70, ['hold', 'touch', 'grab']),
    anchor('right_palm', 'rHand', 'socket', offsetBone(bones.rHand, 0, -0.02 * s.height, -0.055), 0.065 * s.hand, 70, ['hold', 'touch', 'grab']),
    anchor('left_grab_origin', 'lHand', 'origin', offsetBone(bones.lHand, 0, -0.02 * s.height, -0.09), 0.08 * s.hand, 85, ['grab_face', 'grab_item', 'punch']),
    anchor('right_grab_origin', 'rHand', 'origin', offsetBone(bones.rHand, 0, -0.02 * s.height, -0.09), 0.08 * s.hand, 85, ['grab_face', 'grab_item', 'punch']),
  ];
}

export function buildRigAnchors(shapeId: BodyShapeId = 'neutral', pose: BodyPoseId = 'stand', phase = 0, actions: RigTimelineAction[] = []): BodyAnchor[] {
  const s = BODY_SHAPES[shapeId];
  return anchorsFromSkeleton(s, buildSkeleton(shapeId, pose, phase, actions));
}

// ── the frame ────────────────────────────────────────────────────────────────

export type BodyRigFrame = {
  bones: Bones;
  assembly: BodyInstance[];
  clothing: ClothingInstance[];
  anatomy: BodyInstance[];
  hitboxes: BodyHitbox[];
  anchors: BodyAnchor[];
};

export function buildRigFrame(
  shapeId: BodyShapeId = 'neutral',
  pose: BodyPoseId = 'stand',
  phase = 0,
  actions: RigTimelineAction[] = [],
  clothing: ClothingId = 'tee',
  clothingSkin: ClothingSkinId = 'plain',
  accessories: ClothingAccessoryId[] = [],
  bottoms: BottomsId = DEFAULT_BOTTOMS[clothing],
): BodyRigFrame {
  const s = BODY_SHAPES[shapeId];
  const bones = buildSkeleton(shapeId, pose, phase, actions);
  return {
    bones,
    assembly: assemblyFromSkeleton(s, bones, actions),
    clothing: buildClothing(clothing, shapeId, pose, phase, actions, clothingSkin, accessories, bottoms, bones),
    anatomy: anatomyFromSkeleton(s, shapeId, bones),
    hitboxes: hitboxesFromSkeleton(bones),
    anchors: anchorsFromSkeleton(s, bones),
  };
}

/** The physics seam (V1): a full frame from a CUSTOM bones record. */
export function buildRigFrameFromBones(
  bones: Bones,
  shapeId: BodyShapeId = 'neutral',
  clothing: ClothingId = 'tee',
  clothingSkin: ClothingSkinId = 'plain',
  accessories: ClothingAccessoryId[] = [],
  bottoms: BottomsId = DEFAULT_BOTTOMS[clothing],
  actions: RigTimelineAction[] = [],
): BodyRigFrame {
  const s = BODY_SHAPES[shapeId];
  return {
    bones,
    assembly: assemblyFromSkeleton(s, bones, actions),
    clothing: buildClothing(clothing, shapeId, 'stand', 0, actions, clothingSkin, accessories, bottoms, bones),
    anatomy: anatomyFromSkeleton(s, shapeId, bones),
    hitboxes: hitboxesFromSkeleton(bones),
    anchors: anchorsFromSkeleton(s, bones),
  };
}
