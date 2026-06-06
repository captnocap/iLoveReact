// editors/sculptFraming.ts — boot/refocus framing math for the sculpt camera
// (CAMFOCUS-0606, USER VERDICT: "the focus of the camera needs fixed").
//
// PURE registry math only (V26): no React, no host calls — the camera hook
// consumes these and sends the result once at param rate; the headless P4
// suite (sculptFraming.test.ts) proves every formula.
//
// Why this exists (the measured boot-offset cause): the sculpt rig persists
// camMode/flyPose/orbitTargetPan per route in the twig file, and BOOT restored
// them verbatim — a noclip fly pose is relative to NOTHING, so every load
// dropped the camera at the last arbitrary flown-to spot (the on-disk twig
// held pos [1.36, 1.87, -4.65] yaw 15.4° aimed off-subject; orbit's pan sat
// pinned at its clamp and yaw had accumulated to -365°). The fix is a
// deterministic framed pose computed from the SUBJECT'S BOUNDS — used on
// load, on part/model switch, and as the F refocus verb. The persistence
// machinery stays (mid-session mode flips still resume their pose); boot
// framing simply outranks the stale restore.

import { GAME_CAMERA, type Solved } from '../game/camera';

export type V3 = [number, number, number];

/** a subject's bounding sphere — what the framed camera centers and fits */
export type SubjectBounds = { center: V3; radius: number };
export type FrameLook = { yaw: number; pitch: number };
export type FrameClamp = { minDist: number; maxDist: number };

const DEG = Math.PI / 180;
/** a cloudless/degenerate subject still frames as a small object, not a point */
const MIN_SUBJECT_RADIUS = 0.1;

/** wrap accumulated yaw into [-180, 180] (orbit drags are unbounded by design;
 *  the framed pose starts from a normalized angle, not lap 2 of a spin) */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Bounding sphere over grab clouds' world points (xyz-interleaved
 *  Float32Array — grabKit's GrabCloud.points layout). The clouds ARE the
 *  rendered surface cells, so the bounds are the subject as drawn. */
export function cloudBounds(clouds: Array<{ points: Float32Array }>): SubjectBounds | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let n = 0;
  for (const cloud of clouds) {
    const p = cloud.points;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      n++;
    }
  }
  if (n === 0) return null;
  const center: V3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const radius = Math.max(
    MIN_SUBJECT_RADIUS,
    Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2,
  );
  return { center, radius };
}

/** The eye distance that fits a bounding sphere into the vertical fov:
 *  dist = (radius · margin) / tan(fov/2), clamped to the route's zoom range
 *  (the zoom knob's own min/max — framing never lands outside what the knob
 *  can express). margin > 1 leaves air around the subject (P2 tunable). */
export function frameDistance(radius: number, fovDeg: number, margin: number, clampTo: FrameClamp): number {
  const fit = (Math.max(MIN_SUBJECT_RADIUS, radius) * margin) / Math.tan((fovDeg / 2) * DEG);
  return Math.min(clampTo.maxDist, Math.max(clampTo.minDist, fit));
}

export type FramedOrbit = { target: V3; yaw: number; pitch: number; dist: number };

/** The framed ORBIT pose: target = the subject's bounds center (the view
 *  center when no bounds resolve), angles = the route's default look
 *  (normalized), distance = the bounds-fitted distance (the route's default
 *  when no bounds resolve). Deterministic by construction: same subject →
 *  same pose, every load. */
export function frameOrbit(
  bounds: SubjectBounds | null,
  fallbackCenter: V3,
  look: FrameLook,
  fovDeg: number,
  margin: number,
  clampTo: FrameClamp,
  fallbackDist: number,
): FramedOrbit {
  const target: V3 = bounds ? [bounds.center[0], bounds.center[1], bounds.center[2]] : [fallbackCenter[0], fallbackCenter[1], fallbackCenter[2]];
  const dist = bounds
    ? frameDistance(bounds.radius, fovDeg, margin, clampTo)
    : Math.min(clampTo.maxDist, Math.max(clampTo.minDist, fallbackDist));
  return { target, yaw: normalizeDeg(look.yaw), pitch: normalizeDeg(look.pitch), dist };
}

/** eye→target FPS look angles — lookForward's EXACT inverse (the registry
 *  convention runtime/cameras/_util.ts: dir = [-sin(yaw)·cos(p), sin(p),
 *  cos(yaw)·cos(p)]), so a framed fly pose renders looking dead at the
 *  subject on both the host and the JS pick shadow. */
export function fpsLookAt(eye: V3, target: V3): FrameLook {
  const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return { yaw: 0, pitch: 0 };
  const pitch = Math.asin(Math.max(-1, Math.min(1, dy / len))) / DEG;
  const yaw = Math.atan2(-dx, dz) / DEG;
  return { yaw, pitch };
}

export type FramedFly = { pos: V3; yaw: number; pitch: number };

/** The framed FLY pose: the SAME framed orbit eye (one framing, two rigs),
 *  converted to the freefly's position + FPS look angles toward the subject.
 *  Solved through the registry Orbit rig so the eye math is the rig's own. */
export function frameFly(
  bounds: SubjectBounds | null,
  fallbackCenter: V3,
  look: FrameLook,
  fovDeg: number,
  margin: number,
  clampTo: FrameClamp,
  fallbackDist: number,
): FramedFly {
  const o = frameOrbit(bounds, fallbackCenter, look, fovDeg, margin, clampTo, fallbackDist);
  const solved: Solved = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
    target: o.target, yaw: o.yaw, pitch: o.pitch, dist: o.dist, fov: fovDeg,
  });
  const aim = fpsLookAt(solved.pos as V3, o.target);
  return { pos: [solved.pos[0], solved.pos[1], solved.pos[2]], yaw: aim.yaw, pitch: aim.pitch };
}
