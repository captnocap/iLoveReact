// game/figure/assembly.ts — bones → part instances: the dressed body's
// geometry layer (assembly), plus the anatomy sockets that keep a NAKED
// figure reading attached (deltoids, elbows, hip/knee balls, pecs/belly on
// the bulky shapes) and the finger fans that give hands real digits.
//
// Everything here is BONES-DRIVEN (positions/rotations read off the bones
// record, offsets ride bone rotations) — that is the V1 seam: hand the same
// functions a ragdoll's bones and the whole dressed figure follows. Absolute
// body-space offsets are the recorded bug class ("phantom shoulders":
// world-space bones sent absolutely-placed sockets floating off any body
// standing away from the origin).

import { addRot, type V3 } from './math';
import { BODY_SHAPES, type BodyPoseId, type BodyShapeId, type PartId } from './shapes';
import {
  actionOsc, actionWeight, buildSkeleton, offsetBone,
  type Bones, type BoneId, type RigTimelineAction, type SkeletonBone,
} from './skeleton';

/** One placed part: where a sculptable part instance sits on the body. */
export type BodyInstance = {
  part: PartId;
  bone?: BoneId;
  position: V3;
  scale: number;
  /** degrees [rx, ry, rz] — small rz tilts hang the limbs naturally */
  rotation?: V3;
  /** lateral (x/z) thickness multiplier on top of `scale` — proportions:
   *  the same pipe sculpt renders slimmer as a forearm than as a thigh */
  thickness?: number;
};

type Shape = typeof BODY_SHAPES.neutral;

// The figure-view layout: which part each bone wears. One limb pipe serves
// upper/fore arms AND thighs/shins; `thickness` does the anatomy (thighs
// thickest, shins middle, upper arms slimmer, forearms slimmest).
export function assemblyFromSkeleton(s: Shape, bones: Bones, actions: RigTimelineAction[] = []): BodyInstance[] {
  const inst = (boneId: BoneId, part: PartId): BodyInstance => {
    const b = bones[boneId];
    return { part, bone: boneId, position: b.position, rotation: b.rotation, scale: b.scale, thickness: b.thickness };
  };

  return [
    inst('torso', 'torso'),
    inst('head', 'head'),
    // arms: slim pipes chained shoulder → elbow → hand
    inst('lUpperArm', 'pipe'),
    inst('rUpperArm', 'pipe'),
    inst('lForearm', 'pipe'),
    inst('rForearm', 'pipe'),
    inst('lWrist', 'pipe'),
    inst('rWrist', 'pipe'),
    inst('lHand', 'hand'),
    inst('rHand', 'hand'),
    // real digits layered over the palm blob
    ...fingerFan(bones.lHand, -1, s, actions),
    ...fingerFan(bones.rHand, 1, s, actions),
    // legs: thigh + shin pipes with a slight stance, feet pointing forward
    inst('lThigh', 'pipe'),
    inst('rThigh', 'pipe'),
    inst('lShin', 'pipe'),
    inst('rShin', 'pipe'),
    inst('lFoot', 'foot'),
    inst('rFoot', 'foot'),
  ];
}

export function buildAssembly(shapeId: BodyShapeId = 'neutral', pose: BodyPoseId = 'stand', phase = 0, actions: RigTimelineAction[] = []): BodyInstance[] {
  const s = BODY_SHAPES[shapeId];
  return assemblyFromSkeleton(s, buildSkeleton(shapeId, pose, phase, actions), actions);
}

// ── anatomy sockets — joint balls that bridge naked-figure gaps ─────────────

export function anatomyFromSkeleton(s: Shape, shapeId: BodyShapeId, bones: Bones): BodyInstance[] {
  const y = (v: number) => v * s.height;
  const out: BodyInstance[] = [
    shoulderSocket(-1, s, bones),
    shoulderSocket(1, s, bones),
    elbowSocket(-1, s, bones),
    elbowSocket(1, s, bones),
    pelvisSocket(s, bones),
    hipSocket(-1, s, bones),
    hipSocket(1, s, bones),
    kneeSocket(-1, s, bones),
    kneeSocket(1, s, bones),
  ];

  if (shapeId === 'bodybuilder') {
    out.push(
      // pecs hang OFF THE TORSO BONE — bone-relative, never absolute (the
      // world-space-bones rule above)
      { part: 'hand', bone: 'torso', position: offsetBone(bones.torso, -0.11 * s.torsoWide, y(0.13), -0.17), scale: 0.082, rotation: [10, 0, -8], thickness: 1.25 },
      { part: 'hand', bone: 'torso', position: offsetBone(bones.torso, 0.11 * s.torsoWide, y(0.13), -0.17), scale: 0.082, rotation: [10, 0, 8], thickness: 1.25 },
      { part: 'pipe', bone: 'lUpperArm', position: offsetBone(bones.lUpperArm, -0.01, 0.02, -0.055), scale: 0.075, rotation: bones.lUpperArm.rotation, thickness: 1.55 },
      { part: 'pipe', bone: 'rUpperArm', position: offsetBone(bones.rUpperArm, 0.01, 0.02, -0.055), scale: 0.075, rotation: bones.rUpperArm.rotation, thickness: 1.55 },
      { part: 'pipe', bone: 'lThigh', position: offsetBone(bones.lThigh, -0.01, 0.0, -0.02), scale: 0.09, rotation: bones.lThigh.rotation, thickness: 1.45 },
      { part: 'pipe', bone: 'rThigh', position: offsetBone(bones.rThigh, 0.01, 0.0, -0.02), scale: 0.09, rotation: bones.rThigh.rotation, thickness: 1.45 },
    );
  }

  if (shapeId === 'heavy') {
    // belly rides the torso bone too (same world-space rule as the pecs)
    out.push(
      { part: 'hand', bone: 'torso', position: offsetBone(bones.torso, 0, -y(0.17), -0.19), scale: 0.12, rotation: [10, 0, 0], thickness: 1.45 },
    );
  }

  return out;
}

export function buildAnatomy(shapeId: BodyShapeId = 'neutral', pose: BodyPoseId = 'stand', phase = 0, actions: RigTimelineAction[] = []): BodyInstance[] {
  const s = BODY_SHAPES[shapeId];
  return anatomyFromSkeleton(s, shapeId, buildSkeleton(shapeId, pose, phase, actions));
}

// Deltoid ball: pulled slightly INWARD off the joint (toward the TORSO, not
// toward world x=0) so it always bridges the torso surface and the arm top.
function shoulderSocket(side: -1 | 1, s: Shape, bones: Bones): BodyInstance {
  const shoulder = side < 0 ? bones.lShoulder : bones.rShoulder;
  const torso = bones.torso;
  return {
    part: 'hand',
    bone: side < 0 ? 'lShoulder' : 'rShoulder',
    position: [
      shoulder.position[0] + (torso.position[0] - shoulder.position[0]) * 0.12,
      shoulder.position[1] - 0.012,
      shoulder.position[2],
    ],
    scale: 0.105 * Math.max(0.9, (s.shoulder + s.limbThick) / 2),
    rotation: shoulder.rotation,
    thickness: 1.7,
  };
}

function elbowSocket(side: -1 | 1, s: Shape, bones: Bones): BodyInstance {
  const elbow = side < 0 ? bones.lElbow : bones.rElbow;
  return {
    part: 'hand',
    bone: side < 0 ? 'lElbow' : 'rElbow',
    position: elbow.position,
    scale: 0.068 * Math.max(0.9, s.limbThick),
    rotation: elbow.rotation,
    thickness: 1.35,
  };
}

function pelvisSocket(s: Shape, bones: Bones): BodyInstance {
  return {
    part: 'torso',
    bone: 'pelvis',
    position: bones.pelvis.position,
    scale: bones.pelvis.scale * 1.18,
    rotation: bones.pelvis.rotation,
    thickness: s.hip * 1.18,
  };
}

function hipSocket(side: -1 | 1, s: Shape, bones: Bones): BodyInstance {
  const hip = side < 0 ? bones.lHip : bones.rHip;
  return {
    part: 'hand',
    bone: side < 0 ? 'lHip' : 'rHip',
    position: hip.position,
    scale: 0.076 * Math.max(0.92, s.hip),
    rotation: hip.rotation,
    thickness: 1.38,
  };
}

function kneeSocket(side: -1 | 1, s: Shape, bones: Bones): BodyInstance {
  const knee = side < 0 ? bones.lKnee : bones.rKnee;
  return {
    part: 'hand',
    bone: side < 0 ? 'lKnee' : 'rKnee',
    position: knee.position,
    scale: 0.07 * Math.max(0.9, s.limbThick),
    rotation: knee.rotation,
    thickness: 1.36,
  };
}

// ── finger fans — digits hang OFF THE PALM ───────────────────────────────────
// Every offset is relative to the hand bone's center and the palm block's
// actual half-extents, so finger roots sit INSIDE the palm and the fan stays
// within its width. Finger actions (clench/point/pinch/wiggle/jazz/thumbs_up)
// modulate curl and spread per digit.

export function fingerFan(hand: SkeletonBone, side: -1 | 1, s: Shape, actions: RigTimelineAction[] = []): BodyInstance[] {
  // palm half-height: hand part scale 0.112 × preset scaleY 0.5
  const palmHalfY = 0.056 * s.hand;
  const out: BodyInstance[] = [];
  const clench = Math.max(actionWeight(actions, 'fist', 'clench', side), actionWeight(actions, 'hand', 'grip', side));
  const open = actionWeight(actions, 'hand', 'open', side);
  const point = Math.max(actionWeight(actions, 'finger', 'point', side), actionWeight(actions, 'hand', 'point', side));
  const middle = actionWeight(actions, 'finger', 'middle', side);
  const pinch = Math.max(actionWeight(actions, 'finger', 'pinch', side), actionWeight(actions, 'hand', 'pinch', side));
  const wiggle = actionOsc(actions, 'finger', 'wiggle_loop', side, 5);
  const crawl = actionOsc(actions, 'finger', 'crawl_loop', side, 3);
  const jazz = actionOsc(actions, 'hand', 'jazz_loop', side, 4);
  const thumbUp = Math.max(actionWeight(actions, 'finger', 'thumbs_up', side), actionWeight(actions, 'hand', 'thumbs_up', side));
  const baseClench = Math.max(0, Math.min(1, clench + point * 0.72 + middle * 0.72 + pinch * 0.5 - open * 0.7));
  for (let i = 0; i < 4; i++) {
    const isIndex = i === 1;
    const isMiddle = i === 2;
    const extend = Math.max(isIndex ? point : 0, isMiddle ? middle : 0, open * 0.65);
    const curl = Math.max(0, Math.min(1, baseClench * (1 - extend * 0.9) + pinch * (isIndex || isMiddle ? 0.3 : 0.9)));
    const live = wiggle * (i % 2 === 0 ? 1 : -1) + crawl * Math.sin((i / 4) * Math.PI * 2) + jazz * (0.5 + i * 0.16);
    // tight fan: roots stay within the palm's half-width
    const off = (i - 1.5) * 0.034 * s.hand;
    const scale = (i === 1 || i === 2 ? 0.078 : 0.068) * s.hand * (1 - curl * 0.22 + extend * 0.2);
    const halfLen = 0.79 * scale; // finger preset scaleY × instance scale
    const localRot: V3 = [14 + curl * 78 - extend * 18 + live * 9, 0, side * ((i - 1.5) * 3 + curl * 12 + live * 8)];
    out.push({
      part: 'finger',
      bone: hand.id,
      position: offsetBone(
        hand,
        off * (1 - curl * 0.35),
        // root buried in the palm: center sits palmHalf + 55% of the finger below
        -palmHalfY - halfLen * 0.55 + curl * 0.05 * s.hand - extend * 0.014 * s.height + live * 0.006,
        -0.03 + curl * 0.03 - extend * 0.02,
      ),
      scale,
      rotation: addRot(hand.rotation, localRot),
      thickness: i === 1 || i === 2 ? 1.12 : 1.0,
    });
  }
  // thumb hugs the palm's inner edge, rooted at its upper corner
  const thumbRot: V3 = [12 + baseClench * 55 - thumbUp * 30, 0, -side * (58 - baseClench * 30 + thumbUp * 78)];
  out.push({
    part: 'finger',
    bone: hand.id,
    position: offsetBone(
      hand,
      -side * (0.068 - baseClench * 0.02) * s.hand,
      -(0.022 - baseClench * 0.036 + thumbUp * 0.055) * s.height,
      -0.025 + baseClench * 0.025,
    ),
    scale: 0.058 * s.hand * (1 - baseClench * 0.16 + thumbUp * 0.08),
    rotation: addRot(hand.rotation, thumbRot),
    thickness: 1.25,
  });
  return out;
}
