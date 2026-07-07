// world/poseSolve.ts — camera keypoints → the figure's frontal pose (req_2786).
//
// The live-sync solve, pure and headless-testable: MoveNet's 17 COCO
// keypoints (source-normalized, y-DOWN image space) become FrontalAngles —
// lateral limb swings, elbow/knee bends, torso lean, head tilt, squat drop —
// which frontalPose() turns into per-node transforms about the body's own
// measured pivots. Single-camera truth: the camera sees the FRONTAL plane,
// so this is a frontal solve by design (depth is the multi-cam phase).
// Low-confidence keypoints HOLD the previous angle (the tracker dropping an
// elbow must not snap the arm to rest), and an EMA smooths the rest.
import type { PoseFrame, PoseKeypoint, PoseKeypointName } from '../../../runtime/capture/pose';
import { FRONTAL_REST, type FrontalAngles } from './playerAnimation';

/** Keypoints below this confidence hold their previous solved angle. */
export const MIN_SCORE = 0.3;
/** EMA blend toward the new solve (higher = snappier, noisier). */
export const SMOOTHING = 0.45;

type KP = Partial<Record<PoseKeypointName, PoseKeypoint>>;

function byName(frame: PoseFrame): KP {
  const out: KP = {};
  for (const kp of frame.keypoints) out[kp.name] = kp;
  return out;
}

/** Angle of the parent→child image vector from straight-down, in degrees.
 *  Image y grows DOWN, so straight-down is +dy; positive result = child
 *  toward image-right. Null when either end is low-confidence. */
function limbAngle(kp: KP, parent: PoseKeypointName, child: PoseKeypointName): number | null {
  const a = kp[parent], b = kp[child];
  if (!a || !b || a.score < MIN_SCORE || b.score < MIN_SCORE) return null;
  return Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI;
}

function mid(kp: KP, l: PoseKeypointName, r: PoseKeypointName): { x: number; y: number } | null {
  const a = kp[l], b = kp[r];
  if (!a || !b || a.score < MIN_SCORE || b.score < MIN_SCORE) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const clampDeg = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

/** Image-right maps to the figure's -X: the capture view watches the model
 *  from BEHIND (third person), so anatomical left binds to the model's left
 *  and the motion reads like a mirror without any flipping. */
const IMG_TO_MODEL = -1;

export type FrontalSolve = { angles: FrontalAngles; standingHipSpan: number };

export function initialSolve(): FrontalSolve {
  return { angles: { ...FRONTAL_REST, armL: { ...FRONTAL_REST.armL }, armR: { ...FRONTAL_REST.armR }, legL: { ...FRONTAL_REST.legL }, legR: { ...FRONTAL_REST.legR } }, standingHipSpan: 0 };
}

/** One solve step: previous state + a fresh frame → smoothed FrontalAngles.
 *  `figureHeightMeters` scales the squat drop onto the body. */
export function solveFrontal(prev: FrontalSolve, frame: PoseFrame, figureHeightMeters = 2.0): FrontalSolve {
  const kp = byName(frame);
  const a = {
    ...prev.angles,
    armL: { ...prev.angles.armL }, armR: { ...prev.angles.armR },
    legL: { ...prev.angles.legL }, legR: { ...prev.angles.legR },
  };
  const blend = (old: number, next: number | null, lim: number): number =>
    next == null ? old : old + (clampDeg(next, lim) - old) * SMOOTHING;

  // Limbs: upper = angle from straight-down; lower = bend RELATIVE to the
  // upper segment (chain-local, exactly what swingLimbFrontal applies).
  const upperArmL = limbAngle(kp, 'shoulder_left', 'elbow_left');
  const lowerArmL = limbAngle(kp, 'elbow_left', 'wrist_left');
  a.armL.upper = blend(a.armL.upper, upperArmL == null ? null : upperArmL * IMG_TO_MODEL, 170);
  a.armL.lower = blend(a.armL.lower, upperArmL == null || lowerArmL == null ? null : (lowerArmL - upperArmL) * IMG_TO_MODEL, 150);
  const upperArmR = limbAngle(kp, 'shoulder_right', 'elbow_right');
  const lowerArmR = limbAngle(kp, 'elbow_right', 'wrist_right');
  a.armR.upper = blend(a.armR.upper, upperArmR == null ? null : upperArmR * IMG_TO_MODEL, 170);
  a.armR.lower = blend(a.armR.lower, upperArmR == null || lowerArmR == null ? null : (lowerArmR - upperArmR) * IMG_TO_MODEL, 150);
  const upperLegL = limbAngle(kp, 'hip_left', 'knee_left');
  const lowerLegL = limbAngle(kp, 'knee_left', 'ankle_left');
  a.legL.upper = blend(a.legL.upper, upperLegL == null ? null : upperLegL * IMG_TO_MODEL, 80);
  a.legL.lower = blend(a.legL.lower, upperLegL == null || lowerLegL == null ? null : (lowerLegL - upperLegL) * IMG_TO_MODEL, 90);
  const upperLegR = limbAngle(kp, 'hip_right', 'knee_right');
  const lowerLegR = limbAngle(kp, 'knee_right', 'ankle_right');
  a.legR.upper = blend(a.legR.upper, upperLegR == null ? null : upperLegR * IMG_TO_MODEL, 80);
  a.legR.lower = blend(a.legR.lower, upperLegR == null || lowerLegR == null ? null : (lowerLegR - upperLegR) * IMG_TO_MODEL, 90);

  // Torso lean: the hips→shoulders line off vertical. Head: nose off the
  // shoulders midpoint, minus the lean already applied under it.
  const shoulders = mid(kp, 'shoulder_left', 'shoulder_right');
  const hips = mid(kp, 'hip_left', 'hip_right');
  const lean = shoulders && hips ? Math.atan2(shoulders.x - hips.x, hips.y - shoulders.y) * 180 / Math.PI : null;
  a.torso = blend(a.torso, lean == null ? null : lean * IMG_TO_MODEL, 40);
  const nose = kp.nose;
  const headTilt = shoulders && nose && nose.score >= MIN_SCORE
    ? Math.atan2(nose.x - shoulders.x, shoulders.y - nose.y) * 180 / Math.PI
    : null;
  a.head = blend(a.head, headTilt == null || lean == null ? headTilt == null ? null : headTilt * IMG_TO_MODEL : (headTilt - lean) * IMG_TO_MODEL, 35);

  // Squat: hip→ankle image span shrinking against the STANDING baseline
  // (the tallest span seen) maps to a whole-body drop in meters.
  const ankles = mid(kp, 'ankle_left', 'ankle_right');
  let standingHipSpan = prev.standingHipSpan;
  if (hips && ankles) {
    const span = Math.max(0.01, ankles.y - hips.y);
    standingHipSpan = Math.max(standingHipSpan * 0.999, span); // slow decay tracks re-framing
    const bend = Math.max(0, 1 - span / standingHipSpan);
    const targetDrop = Math.min(0.6, bend * figureHeightMeters * 0.45);
    a.drop = a.drop + (targetDrop - a.drop) * SMOOTHING;
  }

  return { angles: a, standingHipSpan };
}
