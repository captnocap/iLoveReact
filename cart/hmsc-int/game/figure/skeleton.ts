// game/figure/skeleton.ts — the 25-bone skeleton and its forward kinematics.
//
// buildSkeleton(shape, pose, phase, actions) → Record<BoneId, SkeletonBone>,
// each bone {position, rotation, scale, thickness, hitbox} — the bones record
// is the kit's universal currency: assembly, clothing, hitboxes, anchors, and
// (per V1) the future host ragdoll all speak it (bones-in / bones-out).
//
// Captured fresh from cart/head_lab/parts.ts (V2). The FK is hand-built in
// local space: torso is the root; pelvis/head/shoulders hang off it; limbs
// chain joint→joint with segmentEnd + pitchBetween; timeline ACTIONS
// (RigTimelineAction — the V6 action vocabulary) modulate everything from
// crouch posture to punch styles. Hitbox spelling and the oriented-box hit
// volumes are RULED (V2): the per-bone boxes here are the game's hit volumes.
//
// Bone-record helpers (offsetBones/placeBones/blendBones) live here too —
// they are pose-invariant skeleton utilities, not physics (the Verlet solver
// they used to ship beside is NOT kept, per V1).

import {
  addRot, addVec, alignY, blendVecInto, lerp3, mid3, rotateEulerVec, smoothstep, wrap180, type V3,
} from './math';
import { BODY_SHAPES, type BodyPoseId, type BodyShapeId } from './shapes';

export type BoneId =
  | 'torso' | 'head' | 'pelvis' | 'lHip' | 'rHip'
  | 'lShoulder' | 'rShoulder' | 'lUpperArm' | 'rUpperArm' | 'lElbow' | 'rElbow' | 'lForearm' | 'rForearm' | 'lWrist' | 'rWrist' | 'lHand' | 'rHand'
  | 'lThigh' | 'rThigh' | 'lKnee' | 'rKnee' | 'lShin' | 'rShin' | 'lFoot' | 'rFoot';

export type SkeletonBone = {
  id: BoneId;
  parent?: BoneId;
  position: V3;
  rotation: V3;
  scale: number;
  thickness: number;
  /** oriented-box hit volume half-shape (V2: hit volumes are these boxes) */
  hitbox: V3;
};

export type Bones = Record<BoneId, SkeletonBone>;

/** One timeline action sample — the V6 action vocabulary's runtime shape. */
export type RigTimelineAction = {
  target: string;
  action: string;
  phase: number;
  weight: number;
  args?: string[];
};

type RigFamily = 'arm' | 'hand' | 'wrist' | 'fist' | 'finger' | 'leg' | 'foot' | 'head' | 'torso' | 'body';
type PunchStyle = 'jab' | 'cross' | 'hook' | 'uppercut' | 'body';
const PUNCH_STYLES: PunchStyle[] = ['jab', 'cross', 'hook', 'uppercut', 'body'];

const FAMILY_PLURAL: Record<RigFamily, string> = {
  arm: 'arms', hand: 'hands', wrist: 'wrists', fist: 'fists', finger: 'fingers',
  leg: 'legs', foot: 'feet', head: 'head', torso: 'torso', body: 'body',
};

function targetMatches(target: string, family: RigFamily, side?: -1 | 1): boolean {
  if (family === 'head' || family === 'torso' || family === 'body') {
    return target === family;
  }
  const plural = FAMILY_PLURAL[family];
  if (target === `both_${plural}` || target === family || target === plural) return true;
  if (!side) return false;
  return side < 0 ? target === `left_${family}` : target === `right_${family}`;
}

export function actionWeight(actions: RigTimelineAction[] | undefined, family: RigFamily, action: string, side?: -1 | 1): number {
  if (!actions) return 0;
  let out = 0;
  for (const a of actions) {
    if (a.action !== action) continue;
    if (!targetMatches(a.target, family, side)) continue;
    out += a.weight;
  }
  return Math.max(0, Math.min(1, out));
}

export function actionPhase(actions: RigTimelineAction[] | undefined, family: RigFamily, action: string, side?: -1 | 1): number {
  if (!actions) return 0;
  let out = 0;
  for (const a of actions) {
    if (a.action !== action) continue;
    if (!targetMatches(a.target, family, side)) continue;
    out = Math.max(out, a.phase);
  }
  return Math.max(0, Math.min(1, out));
}

function actionArg<T extends string>(actions: RigTimelineAction[] | undefined, family: RigFamily, action: string, side: -1 | 1 | undefined, allowed: readonly T[], fallback: T): T {
  if (!actions) return fallback;
  for (const a of actions) {
    if (a.action !== action) continue;
    if (!targetMatches(a.target, family, side)) continue;
    const arg = a.args?.find((v): v is T => (allowed as readonly string[]).includes(v));
    if (arg) return arg;
  }
  return fallback;
}

/** Oscillating action read: weight × sin(phase · 2π · cycles), −1..1. */
export function actionOsc(actions: RigTimelineAction[] | undefined, family: RigFamily, action: string, side: -1 | 1 | undefined, cycles: number): number {
  if (!actions) return 0;
  let out = 0;
  for (const a of actions) {
    if (a.action !== action) continue;
    if (!targetMatches(a.target, family, side)) continue;
    out += a.weight * Math.sin(a.phase * Math.PI * 2 * cycles);
  }
  return Math.max(-1, Math.min(1, out));
}

export function buildSkeleton(shapeId: BodyShapeId = 'neutral', pose: BodyPoseId = 'stand', phase = 0, actions: RigTimelineAction[] = []): Bones {
  const s = BODY_SHAPES[shapeId];
  const y = (v: number) => v * s.height;
  const step = Math.sin(phase * Math.PI * 2);
  const flex = pose === 'flex';
  const wave = pose === 'wave';
  const walk = pose === 'walk';
  const kneel = pose === 'kneel';

  const crouch = Math.max(actionPhase(actions, 'body', 'crouch'), actionPhase(actions, 'torso', 'crouch'));
  const sit = Math.max(actionPhase(actions, 'body', 'sit'), actionPhase(actions, 'torso', 'sit'));
  const lay = Math.max(actionPhase(actions, 'body', 'lay'), actionPhase(actions, 'torso', 'lay'));
  const bodyBounce = actionOsc(actions, 'body', 'bounce_loop', undefined, 2);
  const postureDrop = crouch * y(0.26) + sit * y(0.44) + lay * y(0.72);
  const torsoBaseY = kneel ? y(1.1) : y(1.3);
  const torsoY = torsoBaseY - postureDrop + bodyBounce * y(0.025);
  const headNod = actionOsc(actions, 'head', 'nod_loop', undefined, 2);
  const headShake = actionOsc(actions, 'head', 'shake_loop', undefined, 2);
  const torsoTwist = actionOsc(actions, 'torso', 'twist_loop', undefined, 2);
  const torsoPos: V3 = [0, torsoY, kneel ? 0.11 : lay * 0.34];
  const torsoRot: V3 = [(kneel ? 4 : 0) + lay * 72, 0, (flex ? 0 : step * 1.5) + torsoTwist * 8];
  const torsoPoint = (local: V3): V3 => addVec(torsoPos, rotateEulerVec(local, torsoRot));
  const torsoChildRot = (local: V3): V3 => addRot(torsoRot, local);
  // shoulders tuck IN and DOWN onto the torso egg's slope; the deltoid socket
  // (assembly.ts) bridges the rest
  const shoulderX = 0.3 * s.shoulder * s.torsoWide;
  const hipX = 0.17 * s.hip;
  const armTopY = kneel ? y(1.15) : y(1.36);
  const footY = kneel ? y(0.075) : y(0.07);
  const armLen = s.limbLong;
  const legLen = s.limbLong;
  const legSwing = walk ? step * 18 : 0;
  const strideZ = walk ? step * 0.14 * s.limbLong : 0;
  const strideLift = walk ? Math.max(0, step) * 0.045 * s.height : 0;
  const counterStrideZ = -strideZ;
  const counterLift = walk ? Math.max(0, -step) * 0.045 * s.height : 0;
  const waveLift = wave ? 58 + Math.sin(phase * Math.PI * 4) * 8 : 0;
  const headPos = torsoPoint([0, (kneel ? y(1.62) : y(1.8)) - torsoBaseY, 0]);
  const headRot = torsoChildRot([headNod * 12, step * 3 + headShake * 18, 0]);
  const segmentEnd = (start: V3, len: number, rzDeg: number, z = 0): V3 => {
    const r = rzDeg * Math.PI / 180;
    return [start[0] + Math.sin(r) * len, start[1] - Math.cos(r) * len, start[2] + z];
  };
  const pitchBetween = (top: V3, bottom: V3) =>
    Math.atan2(top[2] - bottom[2], top[1] - bottom[1]) * 180 / Math.PI;
  const leftKick = actionWeight(actions, 'leg', 'kick', -1);
  const rightKick = actionWeight(actions, 'leg', 'kick', 1);
  const leftStomp = actionOsc(actions, 'leg', 'stomp_loop', -1, 2);
  const rightStomp = actionOsc(actions, 'leg', 'stomp_loop', 1, 2);
  const leftFootTap = actionOsc(actions, 'foot', 'tap_loop', -1, 4);
  const rightFootTap = actionOsc(actions, 'foot', 'tap_loop', 1, 4);
  const pelvisLocal: V3 = kneel
    ? [0, y(0.82) - torsoBaseY - crouch * y(0.12), 0.09]
    : [
      walk ? step * 0.025 * s.hip : 0,
      y(0.9) - torsoBaseY + crouch * y(0.08) + sit * y(0.16) + lay * y(0.08),
      (walk ? Math.cos(phase * Math.PI * 2) * 0.018 : 0) + sit * 0.08 + lay * 0.04,
    ];
  const pelvisLocalRot: V3 = kneel
    ? [12, 0, 0]
    : [walk ? step * 3 : sit * 8 - lay * 5, 0, walk ? step * 5 : 0];
  const pelvisPos = torsoPoint(pelvisLocal);
  const pelvisRot = torsoChildRot(pelvisLocalRot);
  const pelvisPoint = (local: V3): V3 => addVec(pelvisPos, rotateEulerVec(local, pelvisRot));
  const pelvisChildRot = (local: V3): V3 => addRot(pelvisRot, local);
  const leftHipLocal: V3 = kneel
    ? [-hipX, -y(0.16), -0.02]
    : [-hipX, -y(0.08) + sit * y(0.06), strideZ * 0.12 - sit * 0.03];
  const rightHipLocal: V3 = kneel
    ? [hipX, -y(0.16), -0.02]
    : [hipX, -y(0.08) + sit * y(0.06), counterStrideZ * 0.12 - sit * 0.03];
  const leftHipPos = pelvisPoint(leftHipLocal);
  const rightHipPos = pelvisPoint(rightHipLocal);
  // stance: knee/foot x relative to the hip joint — wide-hip shapes (female)
  // converge below the hip instead of dropping straight down (femur angle)
  const stance = s.stance ?? 1.08;
  const leftKneeLocal: V3 = kneel
    ? [-hipX * 1.08, y(0.19) - y(0.82), -0.12]
    : [
      -hipX * (stance + sit * 0.24),
      -y(0.46) + crouch * y(0.08) + sit * y(0.34) + strideLift * 0.65 + leftKick * y(0.12),
      strideZ * 0.78 - Math.max(0, -step) * 0.035 - leftKick * 0.18 - sit * 0.44 + lay * 0.06,
    ];
  const rightKneeLocal: V3 = kneel
    ? [hipX * 1.08, y(0.19) - y(0.82), -0.12]
    : [
      hipX * (stance + sit * 0.24),
      -y(0.46) + crouch * y(0.08) + sit * y(0.34) + counterLift * 0.65 + rightKick * y(0.12),
      counterStrideZ * 0.78 - Math.max(0, step) * 0.035 - rightKick * 0.18 - sit * 0.44 + lay * 0.06,
    ];
  const leftFootLocal: V3 = kneel
    ? [-hipX * 0.98, footY - y(0.82), 0.06]
    : [
      -hipX * (stance + sit * 0.2),
      -y(0.83) + strideLift * 0.45 + leftKick * y(0.22) + Math.max(0, leftStomp) * y(0.04) + sit * y(0.28),
      -0.055 + strideZ * 1.1 - leftKick * 0.42 - sit * 0.24 + lay * 0.08,
    ];
  const rightFootLocal: V3 = kneel
    ? [hipX * 0.98, footY - y(0.82), 0.06]
    : [
      hipX * (stance + sit * 0.2),
      -y(0.83) + counterLift * 0.45 + rightKick * y(0.22) + Math.max(0, rightStomp) * y(0.04) + sit * y(0.28),
      -0.055 + counterStrideZ * 1.1 - rightKick * 0.42 - sit * 0.24 + lay * 0.08,
    ];
  const leftKneePos = pelvisPoint(leftKneeLocal);
  const rightKneePos = pelvisPoint(rightKneeLocal);
  const leftFootPos = pelvisPoint(leftFootLocal);
  const rightFootPos = pelvisPoint(rightFootLocal);
  const leftThighPos = mid3(leftHipPos, leftKneePos);
  const rightThighPos = mid3(rightHipPos, rightKneePos);
  const leftShinPos = mid3(leftKneePos, leftFootPos);
  const rightShinPos = mid3(rightKneePos, rightFootPos);
  const leftThighRot: V3 = [kneel ? 42 : pitchBetween(leftHipPos, leftKneePos), 0, -3];
  const rightThighRot: V3 = [kneel ? 42 : pitchBetween(rightHipPos, rightKneePos), 0, 3];
  const leftShinRot: V3 = [kneel ? 88 : pitchBetween(leftKneePos, leftFootPos), 0, walk ? -1 : 0];
  const rightShinRot: V3 = [kneel ? 88 : pitchBetween(rightKneePos, rightFootPos), 0, walk ? 1 : 0];
  const leftFootRot = pelvisChildRot(kneel ? [6, 0, 0] : [(walk ? -4 - legSwing * 0.08 : 0) - leftKick * 18 + leftFootTap * 16 - sit * 8, 0, 0]);
  const rightFootRot = pelvisChildRot(kneel ? [6, 0, 0] : [(walk ? -4 + legSwing * 0.08 : 0) - rightKick * 18 + rightFootTap * 16 - sit * 8, 0, 0]);
  const leftLift = actionWeight(actions, 'arm', 'lift_and_bend', -1);
  const rightLift = actionWeight(actions, 'arm', 'lift_and_bend', 1);
  const leftShake = actionWeight(actions, 'arm', 'shake_in_air', -1);
  const rightShake = actionWeight(actions, 'arm', 'shake_in_air', 1);
  const leftShakeWave = actionOsc(actions, 'arm', 'shake_in_air', -1, 4);
  const rightShakeWave = actionOsc(actions, 'arm', 'shake_in_air', 1, 4);
  const leftPoint = Math.max(actionWeight(actions, 'arm', 'point', -1), actionWeight(actions, 'hand', 'point', -1));
  const rightPoint = Math.max(actionWeight(actions, 'arm', 'point', 1), actionWeight(actions, 'hand', 'point', 1));
  const leftPunch = actionWeight(actions, 'arm', 'punch', -1);
  const rightPunch = actionWeight(actions, 'arm', 'punch', 1);
  const leftPunchPhase = actionPhase(actions, 'arm', 'punch', -1);
  const rightPunchPhase = actionPhase(actions, 'arm', 'punch', 1);
  const leftPunchChamber = leftPunch * (1 - smoothstep(0.2, 0.48, leftPunchPhase));
  const rightPunchChamber = rightPunch * (1 - smoothstep(0.2, 0.48, rightPunchPhase));
  const leftPunchThrust = leftPunch * smoothstep(0.28, 0.72, leftPunchPhase);
  const rightPunchThrust = rightPunch * smoothstep(0.28, 0.72, rightPunchPhase);
  const leftPunchFollow = leftPunch * smoothstep(0.58, 0.92, leftPunchPhase);
  const rightPunchFollow = rightPunch * smoothstep(0.58, 0.92, rightPunchPhase);
  const leftPunchStyle = actionArg(actions, 'arm', 'punch', -1, PUNCH_STYLES, 'cross');
  const rightPunchStyle = actionArg(actions, 'arm', 'punch', 1, PUNCH_STYLES, 'cross');
  const leftGuard = actionWeight(actions, 'arm', 'guard', -1);
  const rightGuard = actionWeight(actions, 'arm', 'guard', 1);
  const leftReach = actionPhase(actions, 'arm', 'reach', -1);
  const rightReach = actionPhase(actions, 'arm', 'reach', 1);
  const leftSalute = actionWeight(actions, 'arm', 'salute', -1);
  const rightSalute = actionWeight(actions, 'arm', 'salute', 1);
  const leftCross = actionWeight(actions, 'arm', 'cross', -1);
  const rightCross = actionWeight(actions, 'arm', 'cross', 1);
  const leftWaveLoop = actionOsc(actions, 'arm', 'wave_loop', -1, 3);
  const rightWaveLoop = actionOsc(actions, 'arm', 'wave_loop', 1, 3);
  const leftSwingLoop = actionOsc(actions, 'arm', 'swing_loop', -1, 2);
  const rightSwingLoop = actionOsc(actions, 'arm', 'swing_loop', 1, 2);
  const leftWristFlick = actionOsc(actions, 'wrist', 'flick_loop', -1, 4) + actionOsc(actions, 'wrist', 'wrist_flick_loop', -1, 4);
  const rightWristFlick = actionOsc(actions, 'wrist', 'flick_loop', 1, 4) + actionOsc(actions, 'wrist', 'wrist_flick_loop', 1, 4);
  const leftWristRoll = actionOsc(actions, 'wrist', 'roll_loop', -1, 3) + actionOsc(actions, 'wrist', 'wrist_roll_loop', -1, 3);
  const rightWristRoll = actionOsc(actions, 'wrist', 'roll_loop', 1, 3) + actionOsc(actions, 'wrist', 'wrist_roll_loop', 1, 3);
  const leftWristSnap = actionWeight(actions, 'wrist', 'snap', -1);
  const rightWristSnap = actionWeight(actions, 'wrist', 'snap', 1);
  const lArmLiftZ = -leftLift * 58 - leftShake * 68 - leftGuard * 18 - leftPunchChamber * 38 - leftPunchFollow * 14 - leftSalute * 88 + leftCross * 18 + leftShakeWave * 13 + leftWaveLoop * 15 + leftSwingLoop * 18;
  const rArmLiftZ = rightLift * 58 + rightShake * 68 + rightGuard * 18 + rightPunchChamber * 38 + rightPunchFollow * 14 + rightSalute * 88 - rightCross * 18 + rightShakeWave * 13 + rightWaveLoop * 15 + rightSwingLoop * 18;
  const lForeBendZ = -leftLift * 62 - leftShake * 82 - leftGuard * 96 - leftPunchChamber * 118 - leftPunchThrust * 24 - leftSalute * 116 + leftCross * 52 + leftShakeWave * 18 + leftWaveLoop * 28;
  const rForeBendZ = rightLift * 62 + rightShake * 82 + rightGuard * 96 + rightPunchChamber * 118 + rightPunchThrust * 24 + rightSalute * 116 - rightCross * 52 + rightShakeWave * 18 + rightWaveLoop * 28;
  const lWristShake = leftShakeWave * 22 + leftWristFlick * 26 + leftWristRoll * 16 - leftWristSnap * 42;
  const rWristShake = rightShakeWave * 22 + rightWristFlick * 26 + rightWristRoll * 16 + rightWristSnap * 42;
  const leftForward = -leftPoint * 0.34 + leftPunchChamber * 0.24 - leftPunchThrust * 0.9 - leftPunchFollow * 0.36 - leftReach * 0.42 - leftGuard * 0.16 - (walk ? step * 0.16 : 0);
  const rightForward = -rightPoint * 0.34 + rightPunchChamber * 0.24 - rightPunchThrust * 0.9 - rightPunchFollow * 0.36 - rightReach * 0.42 - rightGuard * 0.16 + (walk ? step * 0.16 : 0);
  const leftForwardLift = Math.max(leftPoint * 0.72, leftPunchChamber * 0.55, leftPunchThrust * 1.22, leftPunchFollow * 0.72, leftReach * 0.72, leftGuard * 0.45);
  const rightForwardLift = Math.max(rightPoint * 0.72, rightPunchChamber * 0.55, rightPunchThrust * 1.22, rightPunchFollow * 0.72, rightReach * 0.72, rightGuard * 0.45);
  const leftUpperArmZ = (flex ? -62 : wave ? -waveLift : -7) + lArmLiftZ;
  const rightUpperArmZ = (flex ? 62 : 7) + rArmLiftZ;
  const leftForearmZ = (flex ? -116 : wave ? -84 : -9) + lForeBendZ;
  const rightForearmZ = (flex ? 116 : 9) + rForeBendZ;
  const leftShoulderLocal: V3 = [-shoulderX, armTopY + 0.16 * armLen - torsoBaseY + leftPunchChamber * 0.04 * armLen, leftPunchChamber * 0.14 - leftPunchThrust * 0.03];
  const rightShoulderLocal: V3 = [shoulderX, armTopY + 0.16 * armLen - torsoBaseY + rightPunchChamber * 0.04 * armLen, rightPunchChamber * 0.14 - rightPunchThrust * 0.03];
  // segment lengths: human-ish — fingertips land mid-thigh, not below the knee
  const leftElbowLocal = segmentEnd(leftShoulderLocal, 0.4 * armLen, leftUpperArmZ, leftForward * 0.42);
  const rightElbowLocal = segmentEnd(rightShoulderLocal, 0.4 * armLen, rightUpperArmZ, rightForward * 0.42);
  leftElbowLocal[1] += leftForwardLift * 0.28 * armLen - leftPunchChamber * 0.06 * armLen;
  rightElbowLocal[1] += rightForwardLift * 0.28 * armLen - rightPunchChamber * 0.06 * armLen;
  leftElbowLocal[2] += leftPunchChamber * 0.22 - leftPunchThrust * 0.1;
  rightElbowLocal[2] += rightPunchChamber * 0.22 - rightPunchThrust * 0.1;
  const leftWristLocal = segmentEnd(leftElbowLocal, 0.33 * armLen, leftForearmZ, leftForward * 0.58);
  const rightWristLocal = segmentEnd(rightElbowLocal, 0.33 * armLen, rightForearmZ, rightForward * 0.58);
  leftWristLocal[1] += leftForwardLift * 0.16 * armLen - leftPunchChamber * 0.1 * armLen;
  rightWristLocal[1] += rightForwardLift * 0.16 * armLen - rightPunchChamber * 0.1 * armLen;
  leftWristLocal[2] += leftPunchChamber * 0.16 - leftPunchThrust * 0.42 - leftPunchFollow * 0.2;
  rightWristLocal[2] += rightPunchChamber * 0.16 - rightPunchThrust * 0.42 - rightPunchFollow * 0.2;
  const leftHandLocal = segmentEnd(leftWristLocal, 0.12 * s.hand, leftForearmZ + lWristShake, leftForward * 0.28);
  const rightHandLocal = segmentEnd(rightWristLocal, 0.12 * s.hand, rightForearmZ + rWristShake, rightForward * 0.28);
  leftHandLocal[2] += leftPunchChamber * 0.08 - leftPunchThrust * 0.28 - leftPunchFollow * 0.14;
  rightHandLocal[2] += rightPunchChamber * 0.08 - rightPunchThrust * 0.28 - rightPunchFollow * 0.14;

  // Punch choreography: per-style chamber + thrust target sets, blended in by
  // the punch envelope. The styles are DATA (target tables) on purpose.
  const punchPose = (
    side: -1 | 1,
    shoulder: V3,
    elbow: V3,
    wrist: V3,
    hand: V3,
    chamber: number,
    thrust: number,
    follow: number,
    style: PunchStyle,
  ) => {
    if (chamber <= 0 && thrust <= 0 && follow <= 0) return;
    const sx = shoulder[0], sy = shoulder[1], sz = shoulder[2];
    const chamberTargets: Record<PunchStyle, { elbow: V3; wrist: V3; hand: V3 }> = {
      jab: {
        elbow: [sx + side * 0.12 * armLen, sy - 0.05 * armLen, sz + 0.06 * armLen],
        wrist: [sx + side * 0.04 * armLen, sy + 0.03 * armLen, sz - 0.06 * armLen],
        hand: [sx + side * 0.03 * armLen, sy + 0.04 * armLen, sz - 0.16 * armLen],
      },
      cross: {
        elbow: [sx + side * 0.18 * armLen, sy - 0.08 * armLen, sz + 0.18 * armLen],
        wrist: [sx + side * 0.06 * armLen, sy + 0.02 * armLen, sz + 0.04 * armLen],
        hand: [sx + side * 0.04 * armLen, sy + 0.03 * armLen, sz - 0.08 * armLen],
      },
      hook: {
        elbow: [sx + side * 0.36 * armLen, sy + 0.02 * armLen, sz - 0.16 * armLen],
        wrist: [sx + side * 0.28 * armLen, sy + 0.06 * armLen, sz - 0.32 * armLen],
        hand: [sx + side * 0.2 * armLen, sy + 0.06 * armLen, sz - 0.42 * armLen],
      },
      uppercut: {
        elbow: [sx + side * 0.16 * armLen, sy - 0.2 * armLen, sz + 0.02 * armLen],
        wrist: [sx + side * 0.08 * armLen, sy - 0.18 * armLen, sz - 0.12 * armLen],
        hand: [sx + side * 0.06 * armLen, sy - 0.12 * armLen, sz - 0.18 * armLen],
      },
      body: {
        elbow: [sx + side * 0.16 * armLen, sy - 0.14 * armLen, sz + 0.12 * armLen],
        wrist: [sx + side * 0.06 * armLen, sy - 0.1 * armLen, sz - 0.02 * armLen],
        hand: [sx + side * 0.04 * armLen, sy - 0.08 * armLen, sz - 0.12 * armLen],
      },
    };
    const thrustTargets: Record<PunchStyle, { elbow: V3; wrist: V3; hand: V3 }> = {
      jab: {
        elbow: [sx + side * 0.08 * armLen, sy - 0.02 * armLen, sz - 0.28 * armLen],
        wrist: [sx + side * 0.02 * armLen, sy + 0.05 * armLen, sz - 0.82 * armLen],
        hand: [sx + side * 0.015 * armLen, sy + 0.05 * armLen, sz - 1.02 * armLen],
      },
      cross: {
        elbow: [sx + side * 0.04 * armLen, sy - 0.02 * armLen, sz - 0.36 * armLen],
        wrist: [sx - side * 0.04 * armLen, sy + 0.04 * armLen, sz - 0.82 * armLen],
        hand: [sx - side * 0.07 * armLen, sy + 0.04 * armLen, sz - 1.02 * armLen],
      },
      hook: {
        elbow: [sx + side * 0.34 * armLen, sy + 0.04 * armLen, sz - 0.34 * armLen],
        wrist: [sx - side * 0.14 * armLen, sy + 0.06 * armLen, sz - 0.5 * armLen],
        hand: [sx - side * 0.34 * armLen, sy + 0.06 * armLen, sz - 0.52 * armLen],
      },
      uppercut: {
        elbow: [sx + side * 0.12 * armLen, sy - 0.14 * armLen, sz - 0.22 * armLen],
        wrist: [sx + side * 0.02 * armLen, sy + 0.24 * armLen, sz - 0.36 * armLen],
        hand: [sx + side * 0.01 * armLen, sy + 0.42 * armLen, sz - 0.42 * armLen],
      },
      body: {
        elbow: [sx + side * 0.08 * armLen, sy - 0.16 * armLen, sz - 0.3 * armLen],
        wrist: [sx + side * 0.02 * armLen, sy - 0.22 * armLen, sz - 0.72 * armLen],
        hand: [sx + side * 0.01 * armLen, sy - 0.24 * armLen, sz - 0.9 * armLen],
      },
    };

    const chamberTarget = chamberTargets[style];
    blendVecInto(elbow, chamberTarget.elbow, chamber);
    blendVecInto(wrist, chamberTarget.wrist, chamber);
    blendVecInto(hand, chamberTarget.hand, chamber);

    const thrustMix = Math.max(thrust, follow * 0.72);
    const thrustTarget = thrustTargets[style];
    blendVecInto(elbow, thrustTarget.elbow, thrustMix);
    blendVecInto(wrist, thrustTarget.wrist, thrustMix);
    blendVecInto(hand, thrustTarget.hand, thrustMix);
  };

  punchPose(-1, leftShoulderLocal, leftElbowLocal, leftWristLocal, leftHandLocal, leftPunchChamber, leftPunchThrust, leftPunchFollow, leftPunchStyle);
  punchPose(1, rightShoulderLocal, rightElbowLocal, rightWristLocal, rightHandLocal, rightPunchChamber, rightPunchThrust, rightPunchFollow, rightPunchStyle);

  const leftUpperArmLocalRot: V3 = [pitchBetween(leftShoulderLocal, leftElbowLocal), 0, leftUpperArmZ];
  const rightUpperArmLocalRot: V3 = [pitchBetween(rightShoulderLocal, rightElbowLocal), 0, rightUpperArmZ];
  const leftForearmLocalRot: V3 = [pitchBetween(leftElbowLocal, leftWristLocal), 0, leftForearmZ];
  const rightForearmLocalRot: V3 = [pitchBetween(rightElbowLocal, rightWristLocal), 0, rightForearmZ];
  const leftWristLocalRot: V3 = [leftForearmLocalRot[0], 0, leftForearmZ + lWristShake * 0.35];
  const rightWristLocalRot: V3 = [rightForearmLocalRot[0], 0, rightForearmZ + rWristShake * 0.35];
  const leftHandLocalRot: V3 = [leftForearmLocalRot[0], 0, leftForearmZ + lWristShake];
  const rightHandLocalRot: V3 = [rightForearmLocalRot[0], 0, rightForearmZ + rWristShake];
  const leftUpperArmRot = torsoChildRot(leftUpperArmLocalRot);
  const rightUpperArmRot = torsoChildRot(rightUpperArmLocalRot);
  const leftForearmRot = torsoChildRot(leftForearmLocalRot);
  const rightForearmRot = torsoChildRot(rightForearmLocalRot);
  const leftWristRot = torsoChildRot(leftWristLocalRot);
  const rightWristRot = torsoChildRot(rightWristLocalRot);
  const leftHandRot = torsoChildRot(leftHandLocalRot);
  const rightHandRot = torsoChildRot(rightHandLocalRot);
  const leftShoulderPos = torsoPoint(leftShoulderLocal);
  const rightShoulderPos = torsoPoint(rightShoulderLocal);
  const leftElbowPos = torsoPoint(leftElbowLocal);
  const rightElbowPos = torsoPoint(rightElbowLocal);
  const leftWristJoint = torsoPoint(leftWristLocal);
  const rightWristJoint = torsoPoint(rightWristLocal);
  const leftHandPos = torsoPoint(leftHandLocal);
  const rightHandPos = torsoPoint(rightHandLocal);
  const leftUpperArmPos = torsoPoint(mid3(leftShoulderLocal, leftElbowLocal));
  const rightUpperArmPos = torsoPoint(mid3(rightShoulderLocal, rightElbowLocal));
  const leftForearmPos = torsoPoint(mid3(leftElbowLocal, leftWristLocal));
  const rightForearmPos = torsoPoint(mid3(rightElbowLocal, rightWristLocal));
  const leftWristPos = torsoPoint(mid3(leftWristLocal, leftHandLocal));
  const rightWristPos = torsoPoint(mid3(rightWristLocal, rightHandLocal));
  void leftWristJoint; void rightWristJoint; // joint points feed wrist midpoints above

  const bone = (
    id: BoneId,
    parent: BoneId | undefined,
    position: V3,
    rotation: V3,
    scale: number,
    thickness: number,
    hitbox: V3,
  ): SkeletonBone => ({ id, parent, position, rotation, scale, thickness, hitbox });

  return {
    torso: bone('torso', undefined, torsoPos, torsoRot, 0.3 * s.torsoLong, s.torsoWide, [0.44 * s.torsoWide, 0.92 * s.torsoLong, 0.32 * s.torsoWide]),
    head: bone('head', 'torso', headPos, headRot, 0.21 * s.head, 1, [0.32 * s.head, 0.42 * s.head, 0.32 * s.head]),
    pelvis: bone('pelvis', 'torso', pelvisPos, pelvisRot, 0.16 * s.torsoLong, s.hip, [0.36 * s.hip, 0.2, 0.28 * s.hip]),
    lHip: bone('lHip', 'pelvis', leftHipPos, pelvisRot, 0.075 * s.hip, 1.15 * s.hip, [0.12 * s.hip, 0.12, 0.12 * s.hip]),
    rHip: bone('rHip', 'pelvis', rightHipPos, pelvisRot, 0.075 * s.hip, 1.15 * s.hip, [0.12 * s.hip, 0.12, 0.12 * s.hip]),
    lShoulder: bone('lShoulder', 'torso', leftShoulderPos, leftUpperArmRot, 0.072 * s.limbThick, 1.25 * s.limbThick, [0.12 * s.limbThick, 0.12 * s.limbThick, 0.12 * s.limbThick]),
    rShoulder: bone('rShoulder', 'torso', rightShoulderPos, rightUpperArmRot, 0.072 * s.limbThick, 1.25 * s.limbThick, [0.12 * s.limbThick, 0.12 * s.limbThick, 0.12 * s.limbThick]),
    lUpperArm: bone('lUpperArm', 'torso', leftUpperArmPos, leftUpperArmRot, 0.165 * armLen, 0.98 * s.limbThick, [0.14 * s.limbThick, 0.36 * armLen, 0.14 * s.limbThick]),
    rUpperArm: bone('rUpperArm', 'torso', rightUpperArmPos, rightUpperArmRot, 0.165 * armLen, 0.98 * s.limbThick, [0.14 * s.limbThick, 0.36 * armLen, 0.14 * s.limbThick]),
    lElbow: bone('lElbow', 'lUpperArm', leftElbowPos, leftForearmRot, 0.064 * s.limbThick, 1.25 * s.limbThick, [0.12 * s.limbThick, 0.12 * s.limbThick, 0.12 * s.limbThick]),
    rElbow: bone('rElbow', 'rUpperArm', rightElbowPos, rightForearmRot, 0.064 * s.limbThick, 1.25 * s.limbThick, [0.12 * s.limbThick, 0.12 * s.limbThick, 0.12 * s.limbThick]),
    lForearm: bone('lForearm', 'lElbow', leftForearmPos, leftForearmRot, 0.145 * armLen, 0.82 * s.limbThick, [0.12 * s.limbThick, 0.3 * armLen, 0.12 * s.limbThick]),
    rForearm: bone('rForearm', 'rElbow', rightForearmPos, rightForearmRot, 0.145 * armLen, 0.82 * s.limbThick, [0.12 * s.limbThick, 0.3 * armLen, 0.12 * s.limbThick]),
    lWrist: bone('lWrist', 'lForearm', leftWristPos, leftWristRot, 0.048 * s.hand, 1.35 * s.limbThick, [0.08, 0.1, 0.08]),
    rWrist: bone('rWrist', 'rForearm', rightWristPos, rightWristRot, 0.048 * s.hand, 1.35 * s.limbThick, [0.08, 0.1, 0.08]),
    lHand: bone('lHand', 'lWrist', leftHandPos, leftHandRot, 0.112 * s.hand, 1, [0.14 * s.hand, 0.16 * s.hand, 0.1 * s.hand]),
    rHand: bone('rHand', 'rWrist', rightHandPos, rightHandRot, 0.112 * s.hand, 1, [0.14 * s.hand, 0.16 * s.hand, 0.1 * s.hand]),
    lThigh: bone('lThigh', 'lHip', leftThighPos, leftThighRot, 0.21 * legLen, 1.3 * s.limbThick, [0.18 * s.limbThick, 0.45 * legLen, 0.18 * s.limbThick]),
    rThigh: bone('rThigh', 'rHip', rightThighPos, rightThighRot, 0.21 * legLen, 1.3 * s.limbThick, [0.18 * s.limbThick, 0.45 * legLen, 0.18 * s.limbThick]),
    lKnee: bone('lKnee', 'lThigh', leftKneePos, leftThighRot, 0.072 * s.limbThick, 1.2 * s.limbThick, [0.14 * s.limbThick, 0.14 * s.limbThick, 0.14 * s.limbThick]),
    rKnee: bone('rKnee', 'rThigh', rightKneePos, rightThighRot, 0.072 * s.limbThick, 1.2 * s.limbThick, [0.14 * s.limbThick, 0.14 * s.limbThick, 0.14 * s.limbThick]),
    lShin: bone('lShin', 'lKnee', leftShinPos, leftShinRot, 0.19 * legLen, s.limbThick, [0.14 * s.limbThick, 0.4 * legLen, 0.14 * s.limbThick]),
    rShin: bone('rShin', 'rKnee', rightShinPos, rightShinRot, 0.19 * legLen, s.limbThick, [0.14 * s.limbThick, 0.4 * legLen, 0.14 * s.limbThick]),
    lFoot: bone('lFoot', 'lShin', leftFootPos, leftFootRot, 0.118 * s.foot, 1, [0.18 * s.foot, 0.08 * s.foot, 0.28 * s.foot]),
    rFoot: bone('rFoot', 'rShin', rightFootPos, rightFootRot, 0.118 * s.foot, 1, [0.18 * s.foot, 0.08 * s.foot, 0.28 * s.foot]),
  };
}

// ── bone-record helpers — shared by everything that places/blends figures ───

/** Translate every bone (an animated local-space skeleton → world). */
export function offsetBones(bones: Bones, o: V3): Bones {
  const out = {} as Bones;
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
export function placeBones(bones: Bones, yawDeg: number, x: number, z: number): Bones {
  const rad = yawDeg * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const out = {} as Bones;
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

/** Per-bone lerp between two bone records (positions linear, rotations
 *  shortest-arc per component) — the ragdoll → stand get-up blend. */
export function blendBones(from: Bones, to: Bones, t: number): Bones {
  const out = {} as Bones;
  for (const id of Object.keys(to) as BoneId[]) {
    const a = from[id], b = to[id];
    out[id] = {
      ...b,
      position: lerp3(a.position, b.position, t),
      rotation: [
        a.rotation[0] + wrap180(b.rotation[0] - a.rotation[0]) * t,
        a.rotation[1] + wrap180(b.rotation[1] - a.rotation[1]) * t,
        a.rotation[2] + wrap180(b.rotation[2] - a.rotation[2]) * t,
      ],
    };
  }
  return out;
}

/** World-space point at a local offset from a bone (rides its rotation). */
export function offsetBone(bone: SkeletonBone, dx: number, dy: number, dz: number): V3 {
  return addVec(bone.position, rotateEulerVec([dx, dy, dz], bone.rotation));
}

export { alignY };
