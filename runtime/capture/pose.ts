// runtime/capture/pose.ts — 2D pose estimation over the __pose_* doors.
//
// The CAPTURE pipeline's live tracker (req_2786, req_2845): MoveNet
// SinglePose through the host ONNX worker, reading an OWNED snapshot of a
// live cam:N render surface. Results return on the FFI bus; inference never
// occupies the V8/UI thread. Keypoints are source-normalized (0..1, y-down)
// in COCO order.
//
// Importing this file is what gates the `has-onnx` build flag for pose
// consumers (sdk/dependency-registry.json onnx.triggers) — carts that don't
// capture pay zero.

import { subscribe } from '../ffi';

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
/** width/height are the inference frame the keypoints are normalized to;
 * hosts older than the dimension-carrying reply omit them. */
export type PoseFrame = { keypoints: PoseKeypoint[]; elapsedMs: number; width?: number; height?: number };
export type PoseResult = PoseFrame | { error: string };
export type PoseCameraDevice = {
  index: number;
  source: string;
  name: string;
  driver: string;
  bus: string;
};

/** Live-capture cadence belongs here, beside the transport that enforces one
 * in-flight inference. `targetIntervalMs` is start-to-start, not an extra
 * delay after a slow estimate. */
export const POSE_CAPTURE_TUNING = Object.freeze({
  // Start-to-start pacing FLOOR (~30 Hz), not the achieved rate — the loop is
  // inference-bound and pipelined (req_3542): the next frame submits the
  // moment a result lands, so the real rate is what the tuned ONNX session
  // sustains. Render-side interpolation still supplies visual 60 Hz motion.
  targetIntervalMs: 33,
  startupDelayMs: 400,
});

const REQUEST_STATUS_ERROR: Record<number, string> = {
  1: 'pose tracker busy',
  2: 'pose worker unavailable',
  3: 'invalid camera frame',
  4: 'pose snapshot allocation failed',
  5: 'pose sources are cam:N / /dev/video only',
  6: 'no live frame',
  7: 'bad pose request',
};

let nextRequestId = 1;

function allocateRequestId(): number {
  const id = nextRequestId;
  nextRequestId = nextRequestId >= 0x7ffffffe ? 1 : nextRequestId + 1;
  return id;
}

export function poseDoorsAvailable(): boolean {
  return typeof g.__pose_estimate_async === 'function';
}

/** Validate the host's V4L2 discovery reply at the bridge. Invalid or
 * duplicate rows never become selectable render sources. */
export function parsePoseCameraDevicesReply(reply: unknown): PoseCameraDevice[] {
  if (typeof reply !== 'string') return [];
  try {
    const parsed = JSON.parse(reply);
    if (!parsed?.ok || !Array.isArray(parsed.devices)) return [];
    const seen = new Set<string>();
    const devices: PoseCameraDevice[] = [];
    for (const row of parsed.devices) {
      const source = typeof row?.source === 'string' ? row.source : '';
      const match = /^\/dev\/video(\d+)$/.exec(source);
      const index = Number(row?.index);
      if (!match || !Number.isInteger(index) || index < 0 || Number(match[1]) !== index || seen.has(source)) continue;
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      if (!name) continue;
      seen.add(source);
      devices.push({
        index,
        source,
        name,
        driver: typeof row?.driver === 'string' ? row.driver : '',
        bus: typeof row?.bus === 'string' ? row.bus : '',
      });
    }
    return devices.sort((left, right) => left.index - right.index);
  } catch {
    return [];
  }
}

export function listPoseCameraDevices(): PoseCameraDevice[] {
  if (typeof g.__pose_camera_devices !== 'function') return [];
  try { return parsePoseCameraDevicesReply(g.__pose_camera_devices()); } catch { return []; }
}

export function parsePoseReply(reply: unknown): PoseResult {
  if (typeof reply !== 'string') return { error: 'no reply' };
  try {
    const o = JSON.parse(reply);
    if (!o.ok) return { error: String(o.error ?? 'unknown') };
    const kp: number[] = o.kp ?? [];
    const keypoints: PoseKeypoint[] = POSE_KEYPOINT_NAMES.map((name, i) => ({
      name, x: kp[i * 3] ?? 0, y: kp[i * 3 + 1] ?? 0, score: kp[i * 3 + 2] ?? 0,
    }));
    const frame: PoseFrame = { keypoints, elapsedMs: Math.max(0, Number(o.elapsed_ms) || 0) };
    if (Number.isFinite(o.w) && o.w > 0 && Number.isFinite(o.h) && o.h > 0) {
      frame.width = Number(o.w);
      frame.height = Number(o.h);
    }
    return frame;
  } catch {
    return { error: 'bad reply' };
  }
}

/** Queue one live estimate. Returns a cancellation function that detaches the
 * correlated result listener; cancellation never waits for the worker. */
export function requestPose(src: string, onResult: (result: PoseResult) => void): () => void {
  if (!poseDoorsAvailable()) {
    const timer = setTimeout(() => onResult({ error: 'host build has no __pose_estimate_async door' }), 0);
    return () => clearTimeout(timer);
  }

  const requestId = allocateRequestId();
  let cancelled = false;
  let settled = false;
  const off = subscribe(`pose:${requestId}`, (payload) => {
    if (settled) return;
    settled = true;
    off();
    if (!cancelled) onResult(parsePoseReply(payload));
  });

  let status = 7;
  try { status = Number(g.__pose_estimate_async(src, requestId)); } catch { status = 2; }
  let errorTimer: any = null;
  if (status !== 0) {
    settled = true;
    off();
    errorTimer = setTimeout(() => {
      if (!cancelled) onResult({ error: REQUEST_STATUS_ERROR[status] ?? `pose request failed (${status})` });
    }, 0);
  }

  return () => {
    cancelled = true;
    off();
    if (errorTimer) clearTimeout(errorTimer);
  };
}

/** One estimate off an image file — the headless verification path. */
export function estimatePoseImage(path: string): PoseFrame | { error: string } {
  if (typeof g.__pose_estimate_image !== 'function') return { error: 'host build has no __pose_estimate_image door' };
  return parsePoseReply(g.__pose_estimate_image(path));
}
