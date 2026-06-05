// game/figure/ragdoll.ts — the ragdoll CONTRACT. Deliberately not a solver.
//
// V1 (revised, ruled): physics is ONE coherent host-side system, and ragdoll
// becomes a feature of it, written in Zig. The old JS Verlet solver
// (cart/head_lab/ragdoll.ts) is BEHAVIOR REFERENCE ONLY — "likely problematic
// the moment it takes a real load" — its implementation is NOT kept. What the
// ragdoll side actually contributes survives here:
//
//   1. THE SEAM — bones-in / bones-out. A solver only ever produces bone
//      positions/rotations; rig.buildRigFrameFromBones dresses them and the
//      whole figure (parts, sockets, clothing, hitboxes, anchors) follows.
//      The figure never knows who computed its bones.
//   2. THE BODY GRAPH + TUNING — joints, masses, radii, the constraint graph,
//      and the solver feel numbers, as ONE data table (P2). The host feature
//      consumes this table; the lab tunes it here.
//
// The host feature is the PHYSICS lane's work (an honest __game_physics_*
// binding, V18) — this file deliberately probes no host names until that
// binding exists (inventing names is how gates break silently). When it
// lands: bones → seedJointsFromBones() → host → jointsToBones() → the rig.
// Until then, ragdollHostReady() is honestly false. P4 acceptance for the
// Zig solver validates against the archived JS reference per V1.

import { alignY, lerp3, mid3, subVec, type V3 } from './math';
import { buildSkeleton, type Bones, type BoneId } from './skeleton';

export type JointId =
  | 'pelvis' | 'chest' | 'head'
  | 'lShoulder' | 'rShoulder' | 'lElbow' | 'rElbow' | 'lHand' | 'rHand'
  | 'lHip' | 'rHip' | 'lKnee' | 'rKnee' | 'lFoot' | 'rFoot';

export const JOINT_IDS: JointId[] = [
  'pelvis', 'chest', 'head',
  'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHand', 'rHand',
  'lHip', 'rHip', 'lKnee', 'rKnee', 'lFoot', 'rFoot',
];

/** Which skeleton bone seeds each particle (the chest rides the torso bone). */
export const JOINT_SEED_BONE: Record<JointId, BoneId> = {
  pelvis: 'pelvis', chest: 'torso', head: 'head',
  lShoulder: 'lShoulder', rShoulder: 'rShoulder',
  lElbow: 'lElbow', rElbow: 'rElbow',
  lHand: 'lHand', rHand: 'rHand',
  lHip: 'lHip', rHip: 'rHip',
  lKnee: 'lKnee', rKnee: 'rKnee',
  lFoot: 'lFoot', rFoot: 'rFoot',
};

/** One spring of the body graph (rest lengths come from the stand skeleton). */
export type RagdollConstraint = { a: JointId; b: JointId; stiffness: number };

/**
 * THE TUNING TABLE (P2) — every behavior number of the reference solver, as
 * data the host feature consumes and the lab tunes. The graph: spine and
 * girdles stiff (the trunk is nearly rigid); cross braces stop the torso quad
 * shearing flat; head braces stop the skull folding through the chest; limbs
 * are fully stiff pipes. Masses: heavier particles move less under the same
 * correction — the trunk drags the limbs around, not the other way round.
 */
export const RAGDOLL_TUNING = {
  gravity: -10.5,
  airDamping: 0.995,
  solverIterations: 6,
  /** fraction of tangential motion KEPT on ground contact */
  groundFriction: 0.55,
  groundRestitution: 0.3,
  /** terminal velocity, m/s — impulses stack; unbounded verlet launched the
   *  body out of the world (the reference lab's maiden flight) */
  maxSpeed: 32,
  masses: {
    pelvis: 2.6, chest: 2.4, head: 1.2,
    lShoulder: 1.0, rShoulder: 1.0,
    lElbow: 0.55, rElbow: 0.55,
    lHand: 0.4, rHand: 0.4,
    lHip: 1.2, rHip: 1.2,
    lKnee: 0.8, rKnee: 0.8,
    lFoot: 0.6, rFoot: 0.6,
  } as Record<JointId, number>,
  /** collision radius per joint — what rests on the ground */
  radii: {
    pelvis: 0.16, chest: 0.2, head: 0.22,
    lShoulder: 0.1, rShoulder: 0.1,
    lElbow: 0.07, rElbow: 0.07,
    lHand: 0.07, rHand: 0.07,
    lHip: 0.11, rHip: 0.11,
    lKnee: 0.08, rKnee: 0.08,
    lFoot: 0.06, rFoot: 0.06,
  } as Record<JointId, number>,
  constraints: [
    // spine
    { a: 'pelvis', b: 'chest', stiffness: 1 },
    { a: 'chest', b: 'head', stiffness: 1 },
    { a: 'pelvis', b: 'head', stiffness: 0.55 },
    // shoulder girdle
    { a: 'chest', b: 'lShoulder', stiffness: 1 },
    { a: 'chest', b: 'rShoulder', stiffness: 1 },
    { a: 'lShoulder', b: 'rShoulder', stiffness: 1 },
    { a: 'pelvis', b: 'lShoulder', stiffness: 0.7 },
    { a: 'pelvis', b: 'rShoulder', stiffness: 0.7 },
    { a: 'head', b: 'lShoulder', stiffness: 0.45 },
    { a: 'head', b: 'rShoulder', stiffness: 0.45 },
    // arms
    { a: 'lShoulder', b: 'lElbow', stiffness: 1 },
    { a: 'lElbow', b: 'lHand', stiffness: 1 },
    { a: 'rShoulder', b: 'rElbow', stiffness: 1 },
    { a: 'rElbow', b: 'rHand', stiffness: 1 },
    // pelvis girdle
    { a: 'pelvis', b: 'lHip', stiffness: 1 },
    { a: 'pelvis', b: 'rHip', stiffness: 1 },
    { a: 'lHip', b: 'rHip', stiffness: 1 },
    { a: 'chest', b: 'lHip', stiffness: 0.7 },
    { a: 'chest', b: 'rHip', stiffness: 0.7 },
    // legs
    { a: 'lHip', b: 'lKnee', stiffness: 1 },
    { a: 'lKnee', b: 'lFoot', stiffness: 1 },
    { a: 'rHip', b: 'rKnee', stiffness: 1 },
    { a: 'rKnee', b: 'rFoot', stiffness: 1 },
  ] as RagdollConstraint[],
} as const;

/** Joint world positions — what crosses the seam in each direction. */
export type RagdollJoints = Record<JointId, V3>;

/** True when the host ragdoll feature is compiled in. Honestly false until
 *  the physics lane registers its binding (no invented names probed here). */
export function ragdollHostReady(): boolean {
  return false;
}

/**
 * Bones → joint particles: the handoff frame. The figure keeps its exact pose
 * at the moment physics takes over (any pose, mid-animation).
 */
export function seedJointsFromBones(bones: Bones): RagdollJoints {
  const out = {} as RagdollJoints;
  for (const id of JOINT_IDS) {
    const p = bones[JOINT_SEED_BONE[id]].position;
    out[id] = [p[0], p[1], p[2]];
  }
  return out;
}

/** Rest length per constraint, measured on the canonical stand skeleton —
 *  joint-to-joint distances are pose-invariant for rigid bones, so a
 *  mid-stride or mid-punch handoff never snaps segment sizes. */
export function restLengths(): { a: JointId; b: JointId; rest: number; stiffness: number }[] {
  const ref = buildSkeleton('neutral', 'stand');
  return RAGDOLL_TUNING.constraints.map((c) => ({
    ...c,
    rest: Math.hypot(
      ...subVec(ref[JOINT_SEED_BONE[c.a]].position, ref[JOINT_SEED_BONE[c.b]].position),
    ),
  }));
}

/**
 * Joints → a full bones record (the seam's return path). Positions/rotations
 * come from the joints; scale/thickness/hitbox/parent copy from the stand
 * template (pose-invariant). One-particle hands/feet inherit their limb
 * line's orientation; the wrist/forearm chain subdivides elbow→hand.
 */
export function jointsToBones(p: RagdollJoints, template?: Bones): Bones {
  const ref = template ?? buildSkeleton('neutral', 'stand');
  const out = {} as Bones;
  const set = (id: BoneId, position: V3, rotation: V3) => {
    out[id] = { ...ref[id], position, rotation };
  };

  const torsoRot = alignY(subVec(p.chest, p.pelvis));
  const headRot = alignY(subVec(p.head, p.chest));
  set('pelvis', p.pelvis, torsoRot);
  set('torso', p.chest, torsoRot);
  set('head', p.head, headRot);

  const arm = (side: 'l' | 'r') => {
    const sh = p[`${side}Shoulder` as JointId];
    const el = p[`${side}Elbow` as JointId];
    const ha = p[`${side}Hand` as JointId];
    const upperRot = alignY(subVec(sh, el));
    const foreRot = alignY(subVec(el, ha));
    set(`${side}Shoulder` as BoneId, sh, upperRot);
    set(`${side}UpperArm` as BoneId, mid3(sh, el), upperRot);
    set(`${side}Elbow` as BoneId, el, foreRot);
    set(`${side}Forearm` as BoneId, lerp3(el, ha, 0.42), foreRot);
    set(`${side}Wrist` as BoneId, lerp3(el, ha, 0.85), foreRot);
    set(`${side}Hand` as BoneId, ha, foreRot);
  };
  arm('l');
  arm('r');

  const leg = (side: 'l' | 'r') => {
    const hip = p[`${side}Hip` as JointId];
    const knee = p[`${side}Knee` as JointId];
    const foot = p[`${side}Foot` as JointId];
    const thighRot = alignY(subVec(hip, knee));
    const shinRot = alignY(subVec(knee, foot));
    set(`${side}Hip` as BoneId, hip, thighRot);
    set(`${side}Thigh` as BoneId, mid3(hip, knee), thighRot);
    set(`${side}Knee` as BoneId, knee, shinRot);
    set(`${side}Shin` as BoneId, mid3(knee, foot), shinRot);
    // the foot block reads better staying flatter than the shin line
    set(`${side}Foot` as BoneId, foot, [shinRot[0] * 0.35, shinRot[1], 0]);
  };
  leg('l');
  leg('r');

  return out;
}
