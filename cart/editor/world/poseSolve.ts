// world/poseSolve.ts — camera keypoints → a stable spatial figure pose.
//
// MoveNet supplies 17 image-space (x, y, confidence) landmarks, not depth.
// This solver therefore does three explicit jobs:
//   1. One-Euro filtering + confidence hysteresis for stable live landmarks.
//   2. Frontal angles directly from image vectors.
//   3. Monocular depth reconstruction from calibrated limb foreshortening.
//
// Foreshortening recovers depth MAGNITUDE but a single 2D view cannot tell
// toward-camera from away-camera. `depthSign` is therefore a surfaced capture
// choice, never a fabricated model output. Both-feet ground tracking supplies
// independent root lift, so jumping is not confused with a squat.
import type { PoseFrame, PoseKeypoint, PoseKeypointName } from '../../../runtime/capture/pose';
import { CAPTURE_REST, type CaptureAngles } from './playerAnimation';

export const POSE_SOLVE_TUNING = Object.freeze({
  defaultFigureHeightMeters: 2,
  minimumMeasuredFigureHeightMeters: 0.5,
  confidenceEnter: 0.36,
  confidenceExit: 0.22,
  lostPointHoldFrames: 3,
  minimumDeltaSeconds: 1 / 120,
  maximumDeltaSeconds: 0.2,
  pointMinCutoffHz: 1.15,
  pointDerivativeCutoffHz: 1.0,
  pointSpeedBeta: 0.045,
  angleBlend: 0.58,
  angleDeadbandDegrees: 0.7,
  depthCalibrationFrames: 8,
  depthBaselineDecay: 0.9995,
  depthDeadZoneRatio: 0.94,
  maximumArmDepthDegrees: 95,
  maximumLegDepthDegrees: 75,
  standingSpanDecay: 0.999,
  groundAcquireBlend: 0.16,
  groundDriftBlend: 0.008,
  groundedToleranceOfLegSpan: 0.035,
  jumpDeadZoneMeters: 0.035,
  maximumJumpMeters: 1.1,
  jumpMetersPerFigureHeight: 0.5,
  maximumSquatMeters: 0.65,
  squatMetersPerFigureHeight: 0.45,
  rootBlend: 0.52,
});

/** Kept as the public overlay threshold: entering a point is deliberately
 * stricter than retaining one already tracked. */
export const MIN_SCORE = POSE_SOLVE_TUNING.confidenceEnter;

type KP = Partial<Record<PoseKeypointName, PoseKeypoint>>;
type FilterPoint = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  score: number;
  visible: boolean;
  missed: number;
};
type FilterState = Partial<Record<PoseKeypointName, FilterPoint>>;
type SegmentId =
  | 'upper_arm_left' | 'lower_arm_left' | 'upper_arm_right' | 'lower_arm_right'
  | 'upper_leg_left' | 'lower_leg_left' | 'upper_leg_right' | 'lower_leg_right';
type SegmentBaselines = Partial<Record<SegmentId, number>>;

export type DepthSign = 1 | -1;

export type SpatialSolve = {
  angles: CaptureAngles;
  filtered: FilterState;
  segmentBaselines: SegmentBaselines;
  standingHipSpan: number;
  groundFootY: number | null;
  calibrationFrames: number;
  sampleTimeMs: number | null;
};

function cloneRestAngles(): CaptureAngles {
  return {
    ...CAPTURE_REST,
    armL: { ...CAPTURE_REST.armL },
    armR: { ...CAPTURE_REST.armR },
    legL: { ...CAPTURE_REST.legL },
    legR: { ...CAPTURE_REST.legR },
  };
}

export function initialSpatialSolve(): SpatialSolve {
  return {
    angles: cloneRestAngles(),
    filtered: {},
    segmentBaselines: {},
    standingHipSpan: 0,
    groundFootY: null,
    calibrationFrames: 0,
    sampleTimeMs: null,
  };
}

function lowPassAlpha(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

function filterFrame(
  previous: FilterState,
  frame: PoseFrame,
  dt: number,
): { state: FilterState; points: KP } {
  const state: FilterState = {};
  const points: KP = {};
  for (const raw of frame.keypoints) {
    const old = previous[raw.name];
    const threshold = old?.visible
      ? POSE_SOLVE_TUNING.confidenceExit
      : POSE_SOLVE_TUNING.confidenceEnter;
    if (raw.score < threshold) {
      if (old && old.missed < POSE_SOLVE_TUNING.lostPointHoldFrames) {
        const held = { ...old, missed: old.missed + 1, score: raw.score };
        state[raw.name] = held;
        points[raw.name] = { name: raw.name, x: held.x, y: held.y, score: 1 };
      } else if (old) {
        state[raw.name] = { ...old, visible: false, missed: old.missed + 1, score: raw.score };
      }
      continue;
    }
    if (!old || !old.visible) {
      const seeded: FilterPoint = {
        x: raw.x, y: raw.y, dx: 0, dy: 0,
        score: raw.score, visible: true, missed: 0,
      };
      state[raw.name] = seeded;
      points[raw.name] = raw;
      continue;
    }
    const rawDx = (raw.x - old.x) / dt;
    const rawDy = (raw.y - old.y) / dt;
    const derivativeAlpha = lowPassAlpha(POSE_SOLVE_TUNING.pointDerivativeCutoffHz, dt);
    const dx = old.dx + derivativeAlpha * (rawDx - old.dx);
    const dy = old.dy + derivativeAlpha * (rawDy - old.dy);
    const speed = Math.hypot(dx, dy);
    const cutoff = POSE_SOLVE_TUNING.pointMinCutoffHz + POSE_SOLVE_TUNING.pointSpeedBeta * speed;
    const pointAlpha = lowPassAlpha(cutoff, dt);
    const filtered: FilterPoint = {
      x: old.x + pointAlpha * (raw.x - old.x),
      y: old.y + pointAlpha * (raw.y - old.y),
      dx, dy, score: raw.score, visible: true, missed: 0,
    };
    state[raw.name] = filtered;
    points[raw.name] = { name: raw.name, x: filtered.x, y: filtered.y, score: 1 };
  }
  return { state, points };
}

function midpoint(kp: KP, left: PoseKeypointName, right: PoseKeypointName): { x: number; y: number } | null {
  const a = kp[left], b = kp[right];
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(kp: KP, aName: PoseKeypointName, bName: PoseKeypointName): number | null {
  const a = kp[aName], b = kp[bName];
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : null;
}

/** Angle of the parent→child image vector from straight-down, in degrees. */
function limbAngle(kp: KP, parent: PoseKeypointName, child: PoseKeypointName): number | null {
  const a = kp[parent], b = kp[child];
  if (!a || !b) return null;
  return Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI;
}

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
const clampDeg = (value: number, limit: number) => clamp(value, -limit, limit);

/** Image-right maps to figure -X because the model viewport watches the
 * figure from behind, preserving anatomical sides like a mirror. */
const IMG_TO_MODEL = -1;

function blendAngle(old: number, next: number | null, limit: number): number {
  if (next == null) return old;
  const target = clampDeg(next, limit);
  if (Math.abs(target - old) < POSE_SOLVE_TUNING.angleDeadbandDegrees) return old;
  return old + (target - old) * POSE_SOLVE_TUNING.angleBlend;
}

function depthDegrees(projected: number | null, baseline: number | undefined, maximum: number): number | null {
  if (projected == null || !baseline || baseline <= 0) return null;
  const ratio = clamp(projected / baseline, 0, 1);
  if (ratio >= POSE_SOLVE_TUNING.depthDeadZoneRatio) return 0;
  return Math.min(maximum, Math.acos(ratio) * 180 / Math.PI);
}

const SEGMENTS: readonly [SegmentId, PoseKeypointName, PoseKeypointName][] = [
  ['upper_arm_left', 'shoulder_left', 'elbow_left'],
  ['lower_arm_left', 'elbow_left', 'wrist_left'],
  ['upper_arm_right', 'shoulder_right', 'elbow_right'],
  ['lower_arm_right', 'elbow_right', 'wrist_right'],
  ['upper_leg_left', 'hip_left', 'knee_left'],
  ['lower_leg_left', 'knee_left', 'ankle_left'],
  ['upper_leg_right', 'hip_right', 'knee_right'],
  ['lower_leg_right', 'knee_right', 'ankle_right'],
];

/** Solve one camera observation. `sampleTimeMs` is injectable for deterministic
 * tests; live capture passes the completion time. */
export function solveSpatial(
  previous: SpatialSolve,
  frame: PoseFrame,
  figureHeightMeters = POSE_SOLVE_TUNING.defaultFigureHeightMeters,
  depthSign: DepthSign = 1,
  sampleTimeMs = Date.now(),
): SpatialSolve {
  const elapsed = previous.sampleTimeMs == null
    ? 1 / 15
    : (sampleTimeMs - previous.sampleTimeMs) / 1000;
  const dt = clamp(
    elapsed,
    POSE_SOLVE_TUNING.minimumDeltaSeconds,
    POSE_SOLVE_TUNING.maximumDeltaSeconds,
  );
  const filtered = filterFrame(previous.filtered, frame, dt);
  const kp = filtered.points;
  const angles: CaptureAngles = {
    ...previous.angles,
    armL: { ...previous.angles.armL },
    armR: { ...previous.angles.armR },
    legL: { ...previous.angles.legL },
    legR: { ...previous.angles.legR },
  };

  const shoulders = midpoint(kp, 'shoulder_left', 'shoulder_right');
  const hips = midpoint(kp, 'hip_left', 'hip_right');
  const torsoScale = shoulders && hips ? Math.max(0.001, Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y)) : null;
  const segmentBaselines: SegmentBaselines = { ...previous.segmentBaselines };
  let completeSegments = 0;
  for (const [id, parent, child] of SEGMENTS) {
    const projected = distance(kp, parent, child);
    if (projected == null || torsoScale == null) continue;
    completeSegments += 1;
    const normalized = projected / torsoScale;
    const old = segmentBaselines[id] ?? 0;
    segmentBaselines[id] = Math.max(normalized, old * POSE_SOLVE_TUNING.depthBaselineDecay);
  }
  const calibrationFrames = completeSegments === SEGMENTS.length
    ? Math.min(POSE_SOLVE_TUNING.depthCalibrationFrames, previous.calibrationFrames + 1)
    : previous.calibrationFrames;
  const depthReady = calibrationFrames >= POSE_SOLVE_TUNING.depthCalibrationFrames;
  const normalizedLength = (id: SegmentId, parent: PoseKeypointName, child: PoseKeypointName): number | null => {
    const value = distance(kp, parent, child);
    return value == null || torsoScale == null ? null : value / torsoScale;
  };

  const solveLimb = (
    side: 'left' | 'right',
    kind: 'arm' | 'leg',
    target: CaptureAngles['armL'],
  ) => {
    const root = kind === 'arm' ? 'shoulder' : 'hip';
    const mid = kind === 'arm' ? 'elbow' : 'knee';
    const end = kind === 'arm' ? 'wrist' : 'ankle';
    const upperId = `${kind === 'arm' ? 'upper_arm' : 'upper_leg'}_${side}` as SegmentId;
    const lowerId = `${kind === 'arm' ? 'lower_arm' : 'lower_leg'}_${side}` as SegmentId;
    const rootName = `${root}_${side}` as PoseKeypointName;
    const midName = `${mid}_${side}` as PoseKeypointName;
    const endName = `${end}_${side}` as PoseKeypointName;
    const upperSide = limbAngle(kp, rootName, midName);
    const lowerSide = limbAngle(kp, midName, endName);
    target.sideUpper = blendAngle(target.sideUpper, upperSide == null ? null : upperSide * IMG_TO_MODEL, kind === 'arm' ? 170 : 85);
    target.sideLower = blendAngle(
      target.sideLower,
      upperSide == null || lowerSide == null ? null : (lowerSide - upperSide) * IMG_TO_MODEL,
      kind === 'arm' ? 150 : 105,
    );
    if (!depthReady) return;
    const upperDepth = depthDegrees(
      normalizedLength(upperId, rootName, midName),
      segmentBaselines[upperId],
      kind === 'arm' ? POSE_SOLVE_TUNING.maximumArmDepthDegrees : POSE_SOLVE_TUNING.maximumLegDepthDegrees,
    );
    const lowerDepth = depthDegrees(
      normalizedLength(lowerId, midName, endName),
      segmentBaselines[lowerId],
      kind === 'arm' ? POSE_SOLVE_TUNING.maximumArmDepthDegrees : POSE_SOLVE_TUNING.maximumLegDepthDegrees,
    );
    target.depthUpper = blendAngle(target.depthUpper, upperDepth == null ? null : upperDepth * depthSign, 110);
    target.depthLower = blendAngle(
      target.depthLower,
      upperDepth == null || lowerDepth == null ? null : (lowerDepth - upperDepth) * depthSign,
      150,
    );
  };
  solveLimb('left', 'arm', angles.armL);
  solveLimb('right', 'arm', angles.armR);
  solveLimb('left', 'leg', angles.legL);
  solveLimb('right', 'leg', angles.legR);

  const lean = shoulders && hips
    ? Math.atan2(shoulders.x - hips.x, hips.y - shoulders.y) * 180 / Math.PI
    : null;
  angles.torso = blendAngle(angles.torso, lean == null ? null : lean * IMG_TO_MODEL, 40);
  const nose = kp.nose;
  const headTilt = shoulders && nose
    ? Math.atan2(nose.x - shoulders.x, shoulders.y - nose.y) * 180 / Math.PI
    : null;
  angles.head = blendAngle(
    angles.head,
    headTilt == null ? null : (headTilt - (lean ?? 0)) * IMG_TO_MODEL,
    35,
  );

  const leftAnkle = kp.ankle_left;
  const rightAnkle = kp.ankle_right;
  const ankleMid = leftAnkle && rightAnkle
    ? { x: (leftAnkle.x + rightAnkle.x) / 2, y: (leftAnkle.y + rightAnkle.y) / 2 }
    : null;
  let standingHipSpan = previous.standingHipSpan;
  if (hips && ankleMid) {
    const span = Math.max(0.01, ankleMid.y - hips.y);
    standingHipSpan = Math.max(span, standingHipSpan * POSE_SOLVE_TUNING.standingSpanDecay);
  }

  // The LOWER visible foot (max image-y) represents ground contact. A kick
  // keeps one foot planted; a jump raises both, so only the latter lifts root.
  const footY = leftAnkle && rightAnkle ? Math.max(leftAnkle.y, rightAnkle.y) : null;
  let groundFootY = previous.groundFootY;
  if (footY != null) {
    if (groundFootY == null) {
      groundFootY = footY;
    } else if (footY >= groundFootY) {
      groundFootY += (footY - groundFootY) * POSE_SOLVE_TUNING.groundAcquireBlend;
    } else if (standingHipSpan > 0 && groundFootY - footY < standingHipSpan * POSE_SOLVE_TUNING.groundedToleranceOfLegSpan) {
      groundFootY += (footY - groundFootY) * POSE_SOLVE_TUNING.groundDriftBlend;
    }
  }
  let jumpMeters = 0;
  if (footY != null && groundFootY != null && standingHipSpan > 0) {
    jumpMeters = (groundFootY - footY) / standingHipSpan
      * figureHeightMeters * POSE_SOLVE_TUNING.jumpMetersPerFigureHeight;
    jumpMeters = clamp(jumpMeters - POSE_SOLVE_TUNING.jumpDeadZoneMeters, 0, POSE_SOLVE_TUNING.maximumJumpMeters);
  }
  let squatMeters = 0;
  if (hips && ankleMid && standingHipSpan > 0) {
    const span = Math.max(0.01, ankleMid.y - hips.y);
    const bend = Math.max(0, 1 - span / standingHipSpan);
    squatMeters = Math.min(
      POSE_SOLVE_TUNING.maximumSquatMeters,
      bend * figureHeightMeters * POSE_SOLVE_TUNING.squatMetersPerFigureHeight,
    );
  }
  const targetRootY = jumpMeters - squatMeters;
  angles.rootY += (targetRootY - angles.rootY) * POSE_SOLVE_TUNING.rootBlend;

  return {
    angles,
    filtered: filtered.state,
    segmentBaselines,
    standingHipSpan,
    groundFootY,
    calibrationFrames,
    sampleTimeMs,
  };
}
