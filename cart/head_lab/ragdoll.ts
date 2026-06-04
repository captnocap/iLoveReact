// ragdoll — Verlet particle physics for the head_lab figure.
//
// The host's <Physics> is Box2D (2D only); there are no 3D rigid bodies or
// joint constraints in the framework. So body physics lives here as a small
// position-based (Verlet) solver: the skeleton's JOINTS become particles, the
// BONES become distance constraints, and integration + a few constraint
// relaxation passes per step give a stable tumbling body with zero host
// changes.
//
// The contract with parts.ts is bones-in / bones-out:
//   createRagdoll(bones)   — seed particles from a live BodyRigFrame.bones
//                            (any pose, mid-animation — that's the handoff
//                            frame), with rest lengths from the canonical
//                            stand skeleton so segments keep anatomical size.
//   stepRagdoll(r, dt)     — integrate + solve + ground collide.
//   ragdollImpulse(...)    — kick joints (a car, a punch, an explosion).
//   bonesFromRagdoll(r)    — rebuild a Record<BoneId, SkeletonBone> from the
//                            particles; feed it to buildRigFrameFromBones and
//                            the WHOLE dressed figure (parts, sockets,
//                            clothing, hitboxes) rides the ragdoll.
//
// Limb segments are radially symmetric pipes, so a bone's orientation is just
// "+Y along the joint-to-joint direction" — no twist tracking needed.

import { buildSkeleton, type BoneId, type SkeletonBone } from './parts';

export type V3 = [number, number, number];

export type JointId =
  | 'pelvis' | 'chest' | 'head'
  | 'lShoulder' | 'rShoulder' | 'lElbow' | 'rElbow' | 'lHand' | 'rHand'
  | 'lHip' | 'rHip' | 'lKnee' | 'rKnee' | 'lFoot' | 'rFoot';

export const JOINT_IDS: JointId[] = [
  'pelvis', 'chest', 'head',
  'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHand', 'rHand',
  'lHip', 'rHip', 'lKnee', 'rKnee', 'lFoot', 'rFoot',
];

// Which skeleton bone seeds each particle (centers of the joint bones; the
// chest particle rides the torso bone's center).
const JOINT_SEED_BONE: Record<JointId, BoneId> = {
  pelvis: 'pelvis', chest: 'torso', head: 'head',
  lShoulder: 'lShoulder', rShoulder: 'rShoulder',
  lElbow: 'lElbow', rElbow: 'rElbow',
  lHand: 'lHand', rHand: 'rHand',
  lHip: 'lHip', rHip: 'rHip',
  lKnee: 'lKnee', rKnee: 'rKnee',
  lFoot: 'lFoot', rFoot: 'rFoot',
};

// Heavier particles move less under the same constraint correction — the
// trunk drags the limbs around, not the other way round.
const JOINT_MASS: Record<JointId, number> = {
  pelvis: 2.6, chest: 2.4, head: 1.2,
  lShoulder: 1.0, rShoulder: 1.0,
  lElbow: 0.55, rElbow: 0.55,
  lHand: 0.4, rHand: 0.4,
  lHip: 1.2, rHip: 1.2,
  lKnee: 0.8, rKnee: 0.8,
  lFoot: 0.6, rFoot: 0.6,
};

// Collision radius per joint — what rests on the ground.
const JOINT_RADIUS: Record<JointId, number> = {
  pelvis: 0.16, chest: 0.2, head: 0.22,
  lShoulder: 0.1, rShoulder: 0.1,
  lElbow: 0.07, rElbow: 0.07,
  lHand: 0.07, rHand: 0.07,
  lHip: 0.11, rHip: 0.11,
  lKnee: 0.08, rKnee: 0.08,
  lFoot: 0.06, rFoot: 0.06,
};

type Constraint = { a: JointId; b: JointId; rest: number; stiffness: number };

export type Ragdoll = {
  pos: Record<JointId, V3>;
  prev: Record<JointId, V3>;
  constraints: Constraint[];
  /** stand-pose bone record — scale/thickness/hitbox template for rebuild */
  ref: Record<BoneId, SkeletonBone>;
};

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mid3 = (a: V3, b: V3): V3 => lerp3(a, b, 0.5);
const DEG = 180 / Math.PI;

/** Euler degrees ([rx, ry, 0], host Ry·Rx order) pointing local +Y along d. */
function alignY(d: V3): V3 {
  const l = len3(d) || 1;
  return [Math.acos(Math.max(-1, Math.min(1, d[1] / l))) * DEG, Math.atan2(d[0], d[2]) * DEG, 0];
}

// The skeleton as springs. Spine and girdles are stiff (the trunk is nearly
// rigid); cross braces stop the torso quad from shearing flat; head braces
// stop the skull folding through the chest. Limbs are fully stiff pipes.
const CONSTRAINT_DEFS: { a: JointId; b: JointId; stiffness: number }[] = [
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
];

const GRAVITY = -10.5;
const AIR_DAMPING = 0.995;
const SOLVER_ITERATIONS = 6;
const GROUND_FRICTION = 0.55; // fraction of tangential motion KEPT on contact
const GROUND_RESTITUTION = 0.3;

/**
 * Seed a ragdoll from a live frame's bones — the figure keeps its exact pose
 * at the moment physics takes over. Rest lengths come from the canonical
 * stand skeleton (joint-to-joint distances are pose-invariant for rigid
 * bones), so a mid-stride or mid-punch handoff never snaps segment sizes.
 */
export function createRagdoll(bones: Record<BoneId, SkeletonBone>): Ragdoll {
  const ref = buildSkeleton('neutral', 'stand');
  const pos = {} as Record<JointId, V3>;
  const prev = {} as Record<JointId, V3>;
  for (const id of JOINT_IDS) {
    const p = bones[JOINT_SEED_BONE[id]].position;
    pos[id] = [p[0], p[1], p[2]];
    prev[id] = [p[0], p[1], p[2]];
  }
  const restOf = (a: JointId, b: JointId) =>
    len3(sub(ref[JOINT_SEED_BONE[a]].position, ref[JOINT_SEED_BONE[b]].position));
  const constraints = CONSTRAINT_DEFS.map((c) => ({ ...c, rest: restOf(c.a, c.b) }));
  return { pos, prev, constraints, ref };
}

/** Kick a joint: add velocity (m/s) — e.g. the car's velocity at impact. */
export function ragdollImpulse(r: Ragdoll, id: JointId, v: V3, dt = 1 / 60): void {
  r.prev[id][0] -= v[0] * dt;
  r.prev[id][1] -= v[1] * dt;
  r.prev[id][2] -= v[2] * dt;
}

// Terminal velocity. Impulses STACK (mashing uppercut keeps pumping the same
// joint), and unbounded verlet happily launches the body out of the world —
// the lab's maiden flight. Clamp per-step displacement to this speed.
const MAX_SPEED = 32; // m/s

/** One physics step: Verlet integrate, relax constraints, collide the ground
 *  plane (y=0) with friction + a little bounce. Call at your tick dt (scaled
 *  dt = slow motion for free). `arenaHalf` (optional) adds soft walls at
 *  |x|,|z| ≤ arenaHalf so the body stays on the map. */
export function stepRagdoll(r: Ragdoll, dt: number, arenaHalf = 0): void {
  const dt2 = dt * dt;
  const maxStep = MAX_SPEED * dt;
  // integrate
  for (const id of JOINT_IDS) {
    const p = r.pos[id];
    const q = r.prev[id];
    let vx = (p[0] - q[0]) * AIR_DAMPING;
    let vy = (p[1] - q[1]) * AIR_DAMPING;
    let vz = (p[2] - q[2]) * AIR_DAMPING;
    const step = Math.hypot(vx, vy, vz);
    if (step > maxStep) {
      const k = maxStep / step;
      vx *= k; vy *= k; vz *= k;
    }
    q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
    p[0] += vx;
    p[1] += vy + GRAVITY * dt2;
    p[2] += vz;
  }
  // relax
  for (let it = 0; it < SOLVER_ITERATIONS; it++) {
    for (const c of r.constraints) {
      const pa = r.pos[c.a];
      const pb = r.pos[c.b];
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2];
      const d = Math.hypot(dx, dy, dz) || 1e-6;
      const wa = 1 / JOINT_MASS[c.a];
      const wb = 1 / JOINT_MASS[c.b];
      const corr = ((d - c.rest) / d) * (c.stiffness / (wa + wb));
      pa[0] += dx * corr * wa; pa[1] += dy * corr * wa; pa[2] += dz * corr * wa;
      pb[0] -= dx * corr * wb; pb[1] -= dy * corr * wb; pb[2] -= dz * corr * wb;
    }
  }
  // ground
  for (const id of JOINT_IDS) {
    const radius = JOINT_RADIUS[id];
    const p = r.pos[id];
    if (p[1] >= radius) continue;
    const q = r.prev[id];
    const vy = p[1] - q[1];
    p[1] = radius;
    q[1] = radius + Math.max(0, -vy) * GROUND_RESTITUTION;
    // friction: surrender part of the tangential motion
    q[0] = p[0] - (p[0] - q[0]) * GROUND_FRICTION;
    q[2] = p[2] - (p[2] - q[2]) * GROUND_FRICTION;
  }
  // arena walls — same treatment as the ground, sideways
  if (arenaHalf > 0) {
    for (const id of JOINT_IDS) {
      const p = r.pos[id];
      const q = r.prev[id];
      for (const axis of [0, 2] as const) {
        if (Math.abs(p[axis]) <= arenaHalf) continue;
        const v = p[axis] - q[axis];
        p[axis] = Math.sign(p[axis]) * arenaHalf;
        q[axis] = p[axis] + Math.abs(v) * GROUND_RESTITUTION * Math.sign(p[axis]);
      }
    }
  }
}

/** Max joint displacement this step — the "has it come to rest" signal. */
export function ragdollMaxMotion(r: Ragdoll): number {
  let max = 0;
  for (const id of JOINT_IDS) {
    const m = len3(sub(r.pos[id], r.prev[id]));
    if (m > max) max = m;
  }
  return max;
}

/** The body's center (pelvis) — for cameras and get-up placement. */
export function ragdollCenter(r: Ragdoll): V3 {
  return [...r.pos.pelvis] as V3;
}

// ── bone-record helpers — shared by every cart that places/blends figures ───

/** Translate every bone (an animated local-space skeleton → world). */
export function offsetBones(bones: Record<BoneId, SkeletonBone>, o: V3): Record<BoneId, SkeletonBone> {
  const out = {} as Record<BoneId, SkeletonBone>;
  for (const id of Object.keys(bones) as BoneId[]) {
    const b = bones[id];
    out[id] = { ...b, position: [b.position[0] + o[0], b.position[1] + o[1], b.position[2] + o[2]] };
  }
  return out;
}

/** Yaw the whole skeleton about Y then translate — a figure standing at
 *  (x, z) facing heading yawDeg (parts face -Z at yaw 0, so pass h + 180 to
 *  face along a movement heading h). Host order Ry·Rx·Rz makes the prepend
 *  exact: rotate positions, add yawDeg to each ry. */
export function placeBones(bones: Record<BoneId, SkeletonBone>, yawDeg: number, x: number, z: number): Record<BoneId, SkeletonBone> {
  const rad = yawDeg * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const out = {} as Record<BoneId, SkeletonBone>;
  for (const id of Object.keys(bones) as BoneId[]) {
    const b = bones[id];
    out[id] = {
      ...b,
      position: [b.position[0] * c + b.position[2] * s + x, b.position[1], -b.position[0] * s + b.position[2] * c + z],
      rotation: [b.rotation[0], b.rotation[1] + yawDeg, b.rotation[2]],
    };
  }
  return out;
}

const wrap180 = (d: number) => ((d + 180) % 360 + 360) % 360 - 180;

/** Per-bone lerp between two bone records (positions linear, rotations
 *  shortest-arc per component) — the ragdoll → stand get-up blend. */
export function blendBones(from: Record<BoneId, SkeletonBone>, to: Record<BoneId, SkeletonBone>, t: number): Record<BoneId, SkeletonBone> {
  const out = {} as Record<BoneId, SkeletonBone>;
  for (const id of Object.keys(to) as BoneId[]) {
    const a = from[id], b = to[id];
    out[id] = {
      ...b,
      position: lerp3(a.position as V3, b.position as V3, t),
      rotation: [
        a.rotation[0] + wrap180(b.rotation[0] - a.rotation[0]) * t,
        a.rotation[1] + wrap180(b.rotation[1] - a.rotation[1]) * t,
        a.rotation[2] + wrap180(b.rotation[2] - a.rotation[2]) * t,
      ],
    };
  }
  return out;
}

/**
 * Rebuild a full bones record from the particles. Positions/rotations come
 * from the joints; scale/thickness/hitbox/parent copy from the stand-pose
 * template (they're pose-invariant). One-particle hands/feet inherit their
 * limb line's orientation; the wrist/forearm chain subdivides elbow→hand.
 */
export function bonesFromRagdoll(r: Ragdoll): Record<BoneId, SkeletonBone> {
  const p = r.pos;
  const out = {} as Record<BoneId, SkeletonBone>;
  const set = (id: BoneId, position: V3, rotation: V3) => {
    out[id] = { ...r.ref[id], position, rotation };
  };

  const torsoRot = alignY(sub(p.chest, p.pelvis));
  const headRot = alignY(sub(p.head, p.chest));
  set('pelvis', p.pelvis, torsoRot);
  set('torso', p.chest, torsoRot);
  set('head', p.head, headRot);

  const arm = (side: 'l' | 'r') => {
    const sh = p[`${side}Shoulder` as JointId];
    const el = p[`${side}Elbow` as JointId];
    const ha = p[`${side}Hand` as JointId];
    const upperRot = alignY(sub(sh, el));
    const foreRot = alignY(sub(el, ha));
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
    const thighRot = alignY(sub(hip, knee));
    const shinRot = alignY(sub(knee, foot));
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
