// runtime/capture/pose.ts — camera discovery + pose probe over the __pose_* doors.
//
// Live capture inference has NO raw JS door: the native capture session owns
// the camera lane end to end (req_4390 — the MoveNet-era __pose_estimate_async
// door is gone, and the capture snapshot's `preview` layer carries live
// detection dots during calibration). What remains here:
//   __pose_camera_devices  → validated V4L2 discovery for camera pickers
//   __pose_estimate_image  → single-image BlazePose solve (33 landmarks +
//                            metric world positions) for headless verification
//   __pose_smoothing       → live One Euro tuning (the stability sliders)
//
// Importing this file is what gates the `has-onnx` build flag for pose
// consumers (sdk/dependency-registry.json onnx.triggers) — carts that don't
// capture pay zero.

const g: any = globalThis;

/** MediaPipe's canonical 33 body landmarks — BlazePose output order. */
export const POSE_LANDMARK_NAMES = [
  'nose',
  'eye_inner_left', 'eye_left', 'eye_outer_left',
  'eye_inner_right', 'eye_right', 'eye_outer_right',
  'ear_left', 'ear_right',
  'mouth_left', 'mouth_right',
  'shoulder_left', 'shoulder_right', 'elbow_left', 'elbow_right',
  'wrist_left', 'wrist_right',
  'pinky_left', 'pinky_right', 'index_left', 'index_right', 'thumb_left', 'thumb_right',
  'hip_left', 'hip_right', 'knee_left', 'knee_right', 'ankle_left', 'ankle_right',
  'heel_left', 'heel_right', 'foot_index_left', 'foot_index_right',
] as const;
export type PoseLandmarkName = typeof POSE_LANDMARK_NAMES[number];

export type PoseLandmark = {
  name: PoseLandmarkName;
  x: number;
  y: number;
  visibility: number;
  /** Metres, hip-centred (MediaPipe world convention). */
  world: [number, number, number];
};
export type PoseFrame = { presence: number; landmarks: PoseLandmark[] };
export type PoseResult = PoseFrame | { error: string };
export type PoseCameraDevice = {
  index: number;
  source: string;
  name: string;
  driver: string;
  bus: string;
};

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
    const world: number[] = o.world ?? [];
    const landmarks: PoseLandmark[] = POSE_LANDMARK_NAMES.map((name, i) => ({
      name,
      x: kp[i * 3] ?? 0,
      y: kp[i * 3 + 1] ?? 0,
      visibility: kp[i * 3 + 2] ?? 0,
      world: [world[i * 3] ?? 0, world[i * 3 + 1] ?? 0, world[i * 3 + 2] ?? 0],
    }));
    return { presence: Math.max(0, Math.min(1, Number(o.presence) || 0)), landmarks };
  } catch {
    return { error: 'bad reply' };
  }
}

/** One estimate off an image file — the headless verification path. */
export function estimatePoseImage(path: string): PoseResult {
  if (typeof g.__pose_estimate_image !== 'function') return { error: 'host build has no __pose_estimate_image door' };
  return parsePoseReply(g.__pose_estimate_image(path));
}

/** The live-tunable smoothing surface (req_4391). min cutoffs — LOWER is
 * calmer when still; betas — HIGHER follows fast motion sooner;
 * visibilityAlpha — LOWER means steadier confidence gates. */
export type PoseSmoothingTuning = {
  screenMinCutoff: number;
  screenBeta: number;
  worldMinCutoff: number;
  worldBeta: number;
  auxMinCutoff: number;
  auxBeta: number;
  visibilityAlpha: number;
};

export const POSE_SMOOTHING_DEFAULTS: PoseSmoothingTuning = Object.freeze({
  screenMinCutoff: 0.05,
  screenBeta: 80,
  worldMinCutoff: 0.1,
  worldBeta: 40,
  auxMinCutoff: 0.01,
  auxBeta: 10,
  visibilityAlpha: 0.1,
});

function parseSmoothingReply(reply: unknown): PoseSmoothingTuning | null {
  if (typeof reply !== 'string') return null;
  try {
    const o = JSON.parse(reply);
    const fields = Object.keys(POSE_SMOOTHING_DEFAULTS) as (keyof PoseSmoothingTuning)[];
    const out = {} as PoseSmoothingTuning;
    for (const field of fields) {
      const value = Number(o[field]);
      if (!Number.isFinite(value)) return null;
      out[field] = value;
    }
    return out;
  } catch {
    return null;
  }
}

/** Read the host's current smoothing tuning, or null without the door. */
export function getPoseSmoothing(): PoseSmoothingTuning | null {
  if (typeof g.__pose_smoothing !== 'function') return null;
  try { return parseSmoothingReply(g.__pose_smoothing()); } catch { return null; }
}

/** Apply partial smoothing tuning over the host's current values; returns
 * the full applied tuning (the host rejects out-of-range values wholesale,
 * in which case the returned tuning is the unchanged current one). */
export function setPoseSmoothing(partial: Partial<PoseSmoothingTuning>): PoseSmoothingTuning | null {
  if (typeof g.__pose_smoothing !== 'function') return null;
  try { return parseSmoothingReply(g.__pose_smoothing(JSON.stringify(partial))); } catch { return null; }
}
