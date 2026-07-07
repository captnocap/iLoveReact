// runtime/capture/pose.ts — 2D pose estimation over the __pose_* doors.
//
// The CAPTURE pipeline's per-frame tracker (req_2786, animation workbench
// arc): MoveNet SinglePose through the host ONNX runtime, reading a LIVE
// cam:N render surface's CPU frame (framework/ml/pose.zig). Keypoints come
// back source-normalized (0..1, y-down) in COCO order.
//
// Importing this file is what gates the `has-onnx` build flag for pose
// consumers (sdk/dependency-registry.json onnx.triggers) — carts that don't
// capture pay zero.

const g: any = globalThis;

/** COCO-17 keypoint order — MoveNet's output rows. */
export const POSE_KEYPOINT_NAMES = [
  'nose', 'eye_left', 'eye_right', 'ear_left', 'ear_right',
  'shoulder_left', 'shoulder_right', 'elbow_left', 'elbow_right',
  'wrist_left', 'wrist_right', 'hip_left', 'hip_right',
  'knee_left', 'knee_right', 'ankle_left', 'ankle_right',
] as const;
export type PoseKeypointName = typeof POSE_KEYPOINT_NAMES[number];

export type PoseKeypoint = { name: PoseKeypointName; x: number; y: number; score: number };
export type PoseFrame = { keypoints: PoseKeypoint[] };

export function poseDoorsAvailable(): boolean {
  return typeof g.__pose_estimate === 'function';
}

function parseReply(reply: unknown): PoseFrame | { error: string } {
  if (typeof reply !== 'string') return { error: 'no reply' };
  try {
    const o = JSON.parse(reply);
    if (!o.ok) return { error: String(o.error ?? 'unknown') };
    const kp: number[] = o.kp ?? [];
    const keypoints: PoseKeypoint[] = POSE_KEYPOINT_NAMES.map((name, i) => ({
      name, x: kp[i * 3] ?? 0, y: kp[i * 3 + 1] ?? 0, score: kp[i * 3 + 2] ?? 0,
    }));
    return { keypoints };
  } catch {
    return { error: 'bad reply' };
  }
}

/** One synchronous estimate off a live render surface (cam:N / /dev/video). */
export function estimatePose(src: string): PoseFrame | { error: string } {
  if (!poseDoorsAvailable()) return { error: 'host build has no __pose_estimate door' };
  return parseReply(g.__pose_estimate(src));
}

/** One estimate off an image file — the headless verification path. */
export function estimatePoseImage(path: string): PoseFrame | { error: string } {
  if (typeof g.__pose_estimate_image !== 'function') return { error: 'host build has no __pose_estimate_image door' };
  return parseReply(g.__pose_estimate_image(path));
}
