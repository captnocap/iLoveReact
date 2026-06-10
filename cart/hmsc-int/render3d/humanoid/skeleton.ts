// The shared humanoid skeleton. This is the single source of truth for what a
// humanoid IS in HMSC: it solves a pose into named world-space joints, then emits
// BOTH the list of render parts (the meshes the figure draws) AND the hitbox
// capsules (the volumes a shot tests against) from those same joints. Because the
// mesh and the hitbox come from one solve, a headshot box is always exactly where
// the head is drawn — they cannot drift.
//
// Consumers:
//   - Figure.tsx renders `rig.parts` with a material palette (player or NPC).
//   - hitbox.ts ray-tests `rig.zones` for the player's aim → NPC hit detection.
//
// All limb math (orient/segmentPose/point) was extracted verbatim from the
// original inlined PlayerFigure so the silhouette is byte-for-byte the same.

import * as Geometry from '@reactjit/geometries';
import type { HumanoidPose } from './pose';

export type Vec3Tuple = [number, number, number];

// A geometry generator from the registry (Geometry.Box, Geometry.Cylinder, ...).
// They all share one def shape; this aliases it without leaking the internals.
export type GeometryDef = typeof Geometry.Box;

// Which painted region a part belongs to. The Figure resolves slot -> color
// through a palette, so the same skeleton recolors into any character.
export type MaterialSlot = 'skin' | 'shirt' | 'pants' | 'shoe' | 'hat' | 'eye' | 'belt' | 'nose' | 'marker';

// The locational damage zones. A shot resolves to exactly one of these (or a
// miss). `null` on a part means decoration (the teal position ring) — drawn but
// never hittable. Left/right limbs are split so flanking shots read differently.
export type DamageZone = 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR';

export type RigPart = {
  geometry: GeometryDef;
  params: Record<string, number>;
  position: Vec3Tuple;
  rotation?: Vec3Tuple;
  slot: MaterialSlot;
  // A baked StaticSurface key sampled by this part's mesh (the face decal on the
  // head). When set, Figure renders the mesh white so the texture reads true.
  textureKey?: string;
};

// A capsule (segment a->b with a radius) tagged with the zone it represents.
// Coarse on purpose: a handful of capsules per body is cheap to ray-test and
// enough for "head vs torso vs limb" locational damage. Derived from joints, so
// it tracks the pose — a crouched NPC's torso capsule sits where the crouch is.
export type HitCapsule = {
  zone: DamageZone;
  a: Vec3Tuple;
  b: Vec3Tuple;
  radius: number;
};

export type HumanoidRig = {
  parts: RigPart[];
  zones: HitCapsule[];
  // World-space eye point — the origin for this humanoid's own vision/aim rays
  // (NPC line-of-sight later). Sits at the head, oriented with the body.
  eye: Vec3Tuple;
};

function radians(degreesValue: number): number {
  return degreesValue * Math.PI / 180;
}

function degrees(radiansValue: number): number {
  return radiansValue * 180 / Math.PI;
}

function add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function rotateY(v: Vec3Tuple, yawRadians: number): Vec3Tuple {
  const c = Math.cos(yawRadians);
  const s = Math.sin(yawRadians);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

function rotateX(v: Vec3Tuple, pitchRadians: number): Vec3Tuple {
  const c = Math.cos(pitchRadians);
  const s = Math.sin(pitchRadians);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function orient(v: Vec3Tuple, yawRadians: number, rootPitchDegrees = 0): Vec3Tuple {
  return rotateY(rotateX(v, radians(rootPitchDegrees)), yawRadians);
}

function point(base: Vec3Tuple, local: Vec3Tuple, yawRadians: number, rootPitchDegrees = 0): Vec3Tuple {
  return add(base, orient(local, yawRadians, rootPitchDegrees));
}

function downDirection(swingDegrees: number, sideDegrees: number, yawRadians: number, rootPitchDegrees = 0): Vec3Tuple {
  const swingRadians = radians(swingDegrees);
  const sideRadians = radians(sideDegrees);
  return orient([
    Math.sin(sideRadians),
    -Math.cos(sideRadians) * Math.cos(swingRadians),
    -Math.cos(sideRadians) * Math.sin(swingRadians),
  ], yawRadians, rootPitchDegrees);
}

type Segment = { center: Vec3Tuple; end: Vec3Tuple; rotation: Vec3Tuple };

function segmentPose(joint: Vec3Tuple, length: number, swingDegrees: number, sideDegrees: number, yawRadians: number, rootPitchDegrees = 0): Segment {
  const d = downDirection(swingDegrees, sideDegrees, yawRadians, rootPitchDegrees);
  return {
    center: add(joint, [d[0] * length * 0.5, d[1] * length * 0.5, d[2] * length * 0.5] as Vec3Tuple),
    end: add(joint, [d[0] * length, d[1] * length, d[2] * length] as Vec3Tuple),
    rotation: [swingDegrees + rootPitchDegrees, degrees(yawRadians), sideDegrees] as Vec3Tuple,
  };
}

// A limb segment renders as a cylinder centered on its midpoint. `slot` carries
// the material; the geometry/length/radius mirror the original LimbSegment.
function limbPart(seg: Segment, length: number, radius: number, slot: MaterialSlot): RigPart {
  return {
    geometry: Geometry.Cylinder,
    params: { radius, height: length, segments: 12 },
    position: seg.center,
    rotation: seg.rotation,
    slot,
  };
}

// Solve a pose into a full rig. `base` is the ground point under the figure;
// `yawDegrees` faces it; `pose` is the gait frame. Returns the render parts and
// the hitbox zones, both in world space.
//
// `faceKey` (optional) is a baked face texture (humanoid/face.tsx) — the head
// becomes a Head-geometry decal sphere sampling it and the box eyes drop (the
// decal carries eyes/brows/mouth). Without it the original sphere+box-eyes head
// renders unchanged, so consumers that don't mount face captures keep working.
export function solveHumanoid(base: Vec3Tuple, yawDegrees: number, pose: HumanoidPose, faceKey?: string): HumanoidRig {
  const yawRadians = radians(yawDegrees);
  const origin = add(base, [0, pose.bodyY, 0]);
  const rootPitch = pose.rootPitch;

  const hipL = point(origin, [-0.16, 0.98, 0], yawRadians, rootPitch);
  const hipR = point(origin, [0.16, 0.98, 0], yawRadians, rootPitch);
  const shoulderL = point(origin, [-0.39, 1.52, 0], yawRadians, rootPitch);
  const shoulderR = point(origin, [0.39, 1.52, 0], yawRadians, rootPitch);

  const thighL = segmentPose(hipL, 0.48, pose.leftLeg, -2, yawRadians, rootPitch);
  const thighR = segmentPose(hipR, 0.48, pose.rightLeg, 2, yawRadians, rootPitch);
  const shinL = segmentPose(thighL.end, 0.48, pose.leftLeg - pose.leftKnee, -1, yawRadians, rootPitch);
  const shinR = segmentPose(thighR.end, 0.48, pose.rightLeg - pose.rightKnee, 1, yawRadians, rootPitch);
  const upperArmL = segmentPose(shoulderL, 0.36, pose.leftArm, -18 - pose.armLift, yawRadians, rootPitch);
  const upperArmR = segmentPose(shoulderR, 0.36, pose.rightArm, 18 + pose.armLift, yawRadians, rootPitch);
  const foreArmL = segmentPose(upperArmL.end, 0.34, pose.leftArm * 0.5 + 14, -16 - pose.armLift, yawRadians, rootPitch);
  const foreArmR = segmentPose(upperArmR.end, 0.34, pose.rightArm * 0.5 + 14, 16 + pose.armLift, yawRadians, rootPitch);

  const footL = add(shinL.end, orient([0, -0.03, -0.09], yawRadians, rootPitch));
  const footR = add(shinR.end, orient([0, -0.03, -0.09], yawRadians, rootPitch));
  const neck = point(origin, [0, 1.64, 0], yawRadians, rootPitch);
  const head = point(origin, [0, 1.84, 0], yawRadians, rootPitch);

  const headRotation: Vec3Tuple = [pose.headNod + rootPitch, yawDegrees, 0];
  const uprightRotation: Vec3Tuple = [rootPitch, yawDegrees, 0];

  const parts: RigPart[] = [
    // legs
    limbPart(segmentPose(hipL, 0.48, pose.leftLeg, -2, yawRadians, rootPitch), 0.48, 0.105, 'pants'),
    limbPart(segmentPose(hipR, 0.48, pose.rightLeg, 2, yawRadians, rootPitch), 0.48, 0.105, 'pants'),
    limbPart(segmentPose(thighL.end, 0.48, pose.leftLeg - pose.leftKnee, -1, yawRadians, rootPitch), 0.48, 0.095, 'pants'),
    limbPart(segmentPose(thighR.end, 0.48, pose.rightLeg - pose.rightKnee, 1, yawRadians, rootPitch), 0.48, 0.095, 'pants'),
    { geometry: Geometry.Sphere, params: { radius: 0.155, segments: 12, rings: 8 }, position: footL, slot: 'shoe' },
    { geometry: Geometry.Sphere, params: { radius: 0.155, segments: 12, rings: 8 }, position: footR, slot: 'shoe' },

    // torso
    { geometry: Geometry.Box, params: { width: 0.6, height: 0.72, depth: 0.34 }, position: point(origin, [0, 1.23, 0], yawRadians, rootPitch), rotation: [pose.torsoLean + rootPitch, yawDegrees, 0], slot: 'shirt' },

    // arms
    { geometry: Geometry.Sphere, params: { radius: 0.13, segments: 12, rings: 8 }, position: shoulderL, slot: 'shirt' },
    { geometry: Geometry.Sphere, params: { radius: 0.13, segments: 12, rings: 8 }, position: shoulderR, slot: 'shirt' },
    limbPart(upperArmL, 0.36, 0.088, 'shirt'),
    limbPart(upperArmR, 0.36, 0.088, 'shirt'),
    limbPart(foreArmL, 0.34, 0.08, 'shirt'),
    limbPart(foreArmR, 0.34, 0.08, 'shirt'),
    { geometry: Geometry.Sphere, params: { radius: 0.1, segments: 12, rings: 8 }, position: foreArmL.end, slot: 'skin' },
    { geometry: Geometry.Sphere, params: { radius: 0.1, segments: 12, rings: 8 }, position: foreArmR.end, slot: 'skin' },

    // head — with a face the head is a Head-geometry decal sphere sampling the
    // baked face texture (eyes/brows/mouth live in the decal, so the box eyes
    // drop); without one it's the original sphere + box eyes, unchanged. The
    // cone nose stays either way — it gives the profile its silhouette.
    { geometry: Geometry.Cylinder, params: { radius: 0.08, height: 0.12, segments: 12 }, position: neck, rotation: uprightRotation, slot: 'skin' },
    ...(faceKey
      ? [
          { geometry: Geometry.Head, params: { radius: 0.2, segments: 16, rings: 10 }, position: head, rotation: headRotation, slot: 'skin', textureKey: faceKey } as RigPart,
        ]
      : [
          { geometry: Geometry.Sphere, params: { radius: 0.2, segments: 16, rings: 10 }, position: head, rotation: headRotation, slot: 'skin' } as RigPart,
          { geometry: Geometry.Box, params: { width: 0.06, height: 0.06, depth: 0.04 }, position: point(origin, [0.08, 1.88, -0.18], yawRadians, rootPitch), rotation: headRotation, slot: 'eye' } as RigPart,
          { geometry: Geometry.Box, params: { width: 0.06, height: 0.06, depth: 0.04 }, position: point(origin, [-0.08, 1.88, -0.18], yawRadians, rootPitch), rotation: headRotation, slot: 'eye' } as RigPart,
        ]),
    { geometry: Geometry.Cone, params: { radius: 0.05, height: 0.13, segments: 12 }, position: point(origin, [0, 1.82, -0.2], yawRadians, rootPitch), rotation: [-90 + pose.headNod + rootPitch, yawDegrees, 0], slot: 'nose' },
    { geometry: Geometry.Cone, params: { radius: 0.23, height: 0.34, segments: 16 }, position: point(origin, [0, 2.12, 0], yawRadians, rootPitch), rotation: uprightRotation, slot: 'hat' },
  ];

  // Hitbox zones, derived from the same joints. Radii fatten the bare bone lines
  // out to roughly the painted silhouette so a shot grazing the visible body
  // registers. Head spans neck-to-crown; torso spans shoulders-to-hips; each limb
  // spans its root joint to its far end.
  const headTop = point(origin, [0, 2.04, 0], yawRadians, rootPitch);
  const shoulderMid = point(origin, [0, 1.52, 0], yawRadians, rootPitch);
  const hipMid = point(origin, [0, 0.95, 0], yawRadians, rootPitch);
  const zones: HitCapsule[] = [
    { zone: 'head', a: neck, b: headTop, radius: 0.22 },
    { zone: 'torso', a: shoulderMid, b: hipMid, radius: 0.33 },
    { zone: 'armL', a: shoulderL, b: foreArmL.end, radius: 0.11 },
    { zone: 'armR', a: shoulderR, b: foreArmR.end, radius: 0.11 },
    { zone: 'legL', a: hipL, b: footL, radius: 0.14 },
    { zone: 'legR', a: hipR, b: footR, radius: 0.14 },
  ];

  return { parts, zones, eye: head };
}
