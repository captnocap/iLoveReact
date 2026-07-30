// cart/editor/world/poseSolve.test.ts
//
//   tools/esbuild cart/editor/world/poseSolve.test.ts --bundle \
//     --outfile=/tmp/editor-pose-solve.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-pose-solve.test.js

import { POSE_KEYPOINT_NAMES, type PoseFrame, type PoseKeypointName } from '../../../runtime/capture/pose';
import { capturePose, type AnimNode } from './playerAnimation';
import { initialSpatialSolve, POSE_SOLVE_TUNING, solveSpatial, type SpatialSolve } from './poseSolve';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

type XY = Record<PoseKeypointName, [number, number]>;

const STANDING: XY = {
  nose: [0.50, 0.14],
  eye_left: [0.48, 0.13], eye_right: [0.52, 0.13],
  ear_left: [0.46, 0.15], ear_right: [0.54, 0.15],
  shoulder_left: [0.40, 0.30], shoulder_right: [0.60, 0.30],
  elbow_left: [0.38, 0.48], elbow_right: [0.62, 0.48],
  wrist_left: [0.36, 0.65], wrist_right: [0.64, 0.65],
  hip_left: [0.44, 0.55], hip_right: [0.56, 0.55],
  knee_left: [0.44, 0.72], knee_right: [0.56, 0.72],
  ankle_left: [0.44, 0.90], ankle_right: [0.56, 0.90],
};

function frame(overrides: Partial<XY> = {}, scoreOverrides: Partial<Record<PoseKeypointName, number>> = {}): PoseFrame {
  const points = { ...STANDING, ...overrides };
  return {
    elapsedMs: 15,
    keypoints: POSE_KEYPOINT_NAMES.map((name) => ({
      name,
      x: points[name][0],
      y: points[name][1],
      score: scoreOverrides[name] ?? 0.95,
    })),
  };
}

function advance(
  solve: SpatialSolve,
  pose: PoseFrame,
  frames: number,
  startMs: number,
  depthSign: 1 | -1 = 1,
): SpatialSolve {
  let next = solve;
  for (let i = 0; i < frames; i += 1) {
    next = solveSpatial(next, pose, 2, depthSign, startMs + i * 66);
  }
  return next;
}

function calibratedStanding(): SpatialSolve {
  return advance(
    initialSpatialSolve(),
    frame(),
    POSE_SOLVE_TUNING.depthCalibrationFrames + 4,
    1_000,
  );
}

test('neutral standing calibration produces no invented depth or root motion', () => {
  const solved = calibratedStanding();
  assert(solved.calibrationFrames === POSE_SOLVE_TUNING.depthCalibrationFrames, 'depth calibration did not complete');
  assert(Math.abs(solved.angles.armL.depthUpper) < 0.01, 'neutral upper arm gained depth');
  assert(Math.abs(solved.angles.legR.depthUpper) < 0.01, 'neutral upper leg gained depth');
  assert(Math.abs(solved.angles.rootY) < 0.01, 'standing figure left the floor');
});

test('limb foreshortening becomes model-space depth with an explicit sign', () => {
  const forwardFrame = frame({
    elbow_left: [0.40, 0.38],
    wrist_left: [0.40, 0.45],
  });
  const toward = advance(calibratedStanding(), forwardFrame, 12, 2_000, 1);
  const away = advance(calibratedStanding(), forwardFrame, 12, 2_000, -1);
  assert(toward.angles.armL.depthUpper > 30, `toward depth too small: ${toward.angles.armL.depthUpper}`);
  assert(away.angles.armL.depthUpper < -30, `away depth sign was lost: ${away.angles.armL.depthUpper}`);

  const nodes: AnimNode[] = [
    { name: 'shoulder_left', center: [-0.4, 1.5, 0] },
    { name: 'upper_arm_left', center: [-0.42, 1.4, 0] },
    { name: 'elbow_left', center: [-0.43, 1.15, 0] },
    { name: 'lower_arm_left', center: [-0.44, 1.0, 0] },
    { name: 'wrist_left', center: [-0.45, 0.85, 0] },
  ];
  const posed = capturePose(nodes, toward.angles);
  const elbow = posed[nodes.findIndex((node) => node.name === 'elbow_left')]!;
  assert(Math.abs(elbow.pos[2]) > 0.08, 'solved depth never moved the limb out of the frontal plane');
});

test('both feet rising produces root lift while one raised foot does not', () => {
  const standing = calibratedStanding();
  const bothUp = frame({
    nose: [0.50, 0.04],
    eye_left: [0.48, 0.03], eye_right: [0.52, 0.03],
    ear_left: [0.46, 0.05], ear_right: [0.54, 0.05],
    shoulder_left: [0.40, 0.20], shoulder_right: [0.60, 0.20],
    elbow_left: [0.38, 0.38], elbow_right: [0.62, 0.38],
    wrist_left: [0.36, 0.55], wrist_right: [0.64, 0.55],
    hip_left: [0.44, 0.45], hip_right: [0.56, 0.45],
    knee_left: [0.44, 0.62], knee_right: [0.56, 0.62],
    ankle_left: [0.44, 0.80], ankle_right: [0.56, 0.80],
  });
  const jumped = advance(standing, bothUp, 10, 2_000);
  assert(jumped.angles.rootY > 0.12, `jump produced no useful root lift: ${jumped.angles.rootY}`);

  const kick = frame({ ankle_left: [0.44, 0.72] });
  const kicked = advance(standing, kick, 10, 2_000);
  assert(kicked.angles.rootY < 0.04, `one-foot kick was mistaken for a jump: ${kicked.angles.rootY}`);
});

test('hips lowering over planted feet produces a squat instead of a jump', () => {
  const squatted = advance(calibratedStanding(), frame({
    hip_left: [0.44, 0.66], hip_right: [0.56, 0.66],
    knee_left: [0.42, 0.77], knee_right: [0.58, 0.77],
  }), 12, 2_000);
  assert(squatted.angles.rootY < -0.10, `squat did not lower the root: ${squatted.angles.rootY}`);
});

test('confidence hysteresis holds a briefly dropped wrist instead of snapping', () => {
  const standing = calibratedStanding();
  const raised = advance(standing, frame({ wrist_right: [0.82, 0.32] }), 8, 2_000);
  const before = raised.angles.armR.sideLower;
  const dropped = solveSpatial(raised, frame({}, { wrist_right: 0.1 }), 2, 1, 2_600);
  assert(Math.abs(dropped.angles.armR.sideLower - before) < 0.01, 'one low-confidence sample snapped the wrist');
});

log(`${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} spatial pose solve test(s) failed`);
