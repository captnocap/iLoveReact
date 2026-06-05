// editors/build/snap — crosshair → snap target, pure (the /build route's
// non-visual core, P4-tested).
//
// V24 Build Mode UX: "crosshair targets a snap surface … ghost preview
// snapped to grid/edge/surface". The crosshair ray is the solved camera's
// screen-center axis (the crosshair law — never yaw/pitch trig); THIS module
// answers what that ray is pointing at and where the selected piece would
// stand:
//
//   1. the nearest of (placed-piece face, ground) within build reach wins;
//   2. the catalog entry's OWN snap mode (grid/edge/surface/free — registry
//      data, never a mode the route invents) quantizes the hit onto the 1m
//      substrate (R4: the grid is the snap substrate, not the object model);
//   3. piece faces stack: a top face places the next storey (y = face top),
//      a side face places beside at the hit piece's own base.
//
// All numbers are SNAP_TUNING rows (P2) — the route exposes them on its
// tuning surface; nothing here is buried.

import type { BuildPieceSize, BuildSnapMode, PieceRay, PlacedBuildPiece } from '@game';
import { GAME_BUILD } from '@game';

export type SnapTuning = {
  /** how far the crosshair can build, meters */
  reachMeters: number;
  /** terrain ray-march step (refined by bisection), meters */
  groundMarchStepMeters: number;
  /** the R4 substrate the grammar snaps to, meters */
  gridMeters: number;
  /** surface-mode quantization on a piece face, meters */
  surfaceSnapMeters: number;
};

export const SNAP_TUNING_DEFAULTS: SnapTuning = {
  reachMeters: 14,
  groundMarchStepMeters: 0.25,
  gridMeters: 1,
  surfaceSnapMeters: 0.5,
};

export type SnapTarget = {
  /** what the crosshair resolved against */
  surface: 'ground' | 'pieceFace';
  /** where the selected piece would stand (center x/z, BASE y, yaw) */
  placement: { x: number; y: number; z: number; yawDegrees: number };
  /** the raw crosshair hit — the indicator point */
  hit: { x: number; y: number; z: number };
  /** the face normal when surface === 'pieceFace' */
  normal?: { x: number; y: number; z: number };
  /** the placed piece under the crosshair when surface === 'pieceFace' */
  targetPieceId?: string;
};

export type SnapInput = {
  ray: PieceRay;
  pieces: readonly PlacedBuildPiece[];
  /** highest standable ground at (x, z) — the route's door-math column scan */
  groundTopAt: (x: number, z: number) => number;
  /** the selected catalog entry's snap mode (registry data) */
  snap: BuildSnapMode;
  /** the selected catalog entry's size (orients edge runs, offsets faces) */
  size: BuildPieceSize;
  /** the user's ghost rotation (grid/free/surface; edge derives its own run) */
  yawDegrees: number;
  tuning?: SnapTuning;
};

const DEG = Math.PI / 180;

function normalizeYaw(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

/** March the ray until it dips under the ground column, then bisect — the
 *  ground twin of the piece raycast (terrain has no analytic surface here;
 *  the column fn is door math the route supplies). */
export function raycastGround(
  ray: PieceRay,
  groundTopAt: (x: number, z: number) => number,
  reachMeters: number,
  stepMeters: number,
): { t: number; point: { x: number; y: number; z: number } } | null {
  const at = (t: number) => ({
    x: ray.origin.x + ray.dir.x * t,
    y: ray.origin.y + ray.dir.y * t,
    z: ray.origin.z + ray.dir.z * t,
  });
  const under = (p: { x: number; y: number; z: number }) => p.y <= groundTopAt(p.x, p.z);
  if (under(at(0))) return null; // eye already underground — no honest target
  let prev = 0;
  for (let t = stepMeters; t <= reachMeters; t += stepMeters) {
    if (under(at(t))) {
      // bisect [prev, t] onto the crossing
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 12; i += 1) {
        const mid = (lo + hi) / 2;
        if (under(at(mid))) hi = mid;
        else lo = mid;
      }
      const point = at(hi);
      return { t: hi, point: { x: point.x, y: groundTopAt(point.x, point.z), z: point.z } };
    }
    prev = t;
  }
  return null;
}

/** cell-center snap on the substrate (a piece module centers on a cell) */
function snapToCellCenter(v: number, grid: number): number {
  return (Math.floor(v / grid) + 0.5) * grid;
}

function quantize(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/**
 * Resolve the crosshair into the snap target for the selected piece — null
 * when nothing in reach (or the mode demands a face and there is none).
 */
export function resolveSnapTarget(input: SnapInput): SnapTarget | null {
  const tuning = input.tuning ?? SNAP_TUNING_DEFAULTS;
  const grid = tuning.gridMeters;
  const pieceHit = GAME_BUILD.placed.raycast(input.ray, input.pieces, tuning.reachMeters);
  const groundHit = raycastGround(input.ray, input.groundTopAt, tuning.reachMeters, tuning.groundMarchStepMeters);

  const onFace = pieceHit !== null && (groundHit === null || pieceHit.t <= groundHit.t);
  if (!onFace && groundHit === null) return null;
  if (!onFace && input.snap === 'surface') return null; // surface pieces mount on faces only

  const hit = onFace ? pieceHit!.point : groundHit!.point;
  const yaw = normalizeYaw(input.yawDegrees);

  // ── where the base sits ────────────────────────────────────────────────────
  let baseY: number;
  if (onFace) {
    const hitBounds = GAME_BUILD.placed.bounds(pieceHit!.piece);
    // a top face stacks the next storey; any other face places beside,
    // at the hit piece's own base (same storey)
    baseY = pieceHit!.normal.y > 0.5 ? hitBounds.topY : hitBounds.baseY;
  } else {
    baseY = hit.y;
  }

  const common = onFace
    ? { surface: 'pieceFace' as const, hit, normal: pieceHit!.normal, targetPieceId: pieceHit!.piece.id }
    : { surface: 'ground' as const, hit };

  switch (input.snap) {
    case 'grid': {
      const x = snapToCellCenter(hit.x, grid);
      const z = snapToCellCenter(hit.z, grid);
      // ground under the SNAPPED center, so the piece sits on the terrain it covers
      const y = common.surface === 'ground' ? input.groundTopAt(x, z) : baseY;
      return { ...common, placement: { x, y, z, yawDegrees: yaw } };
    }
    case 'edge': {
      // the nearer grid line owns the wall: the run goes ALONG that line
      const lineX = Math.round(hit.x / grid) * grid;
      const lineZ = Math.round(hit.z / grid) * grid;
      const onXLine = Math.abs(hit.x - lineX) <= Math.abs(hit.z - lineZ);
      if (onXLine) {
        // plane at x = lineX, running along z (the turned frame)
        const z = snapToCellCenter(hit.z, grid);
        const y = common.surface === 'ground' ? input.groundTopAt(lineX, z) : baseY;
        return { ...common, placement: { x: lineX, y, z, yawDegrees: 90 } };
      }
      const x = snapToCellCenter(hit.x, grid);
      const y = common.surface === 'ground' ? input.groundTopAt(x, lineZ) : baseY;
      return { ...common, placement: { x, y, z: lineZ, yawDegrees: 0 } };
    }
    case 'surface': {
      // mount ON the face: centered on the quantized hit, proud of the plane
      // by half the piece depth, facing out along the normal
      const n = pieceHit!.normal;
      const step = tuning.surfaceSnapMeters;
      const out = input.size.depthMeters / 2;
      if (n.y > 0.5 || n.y < -0.5) {
        // a horizontal face behaves like a grid drop on that plate
        const x = snapToCellCenter(hit.x, grid);
        const z = snapToCellCenter(hit.z, grid);
        return { ...common, placement: { x, y: baseY, z, yawDegrees: yaw } };
      }
      const faceYaw = normalizeYaw(Math.atan2(n.x, n.z) / DEG);
      // quantize only ALONG the face; the normal axis stays exactly on the
      // hit plane, pushed out by half the piece depth so it sits proud
      return {
        ...common,
        placement: {
          x: Math.abs(n.x) > 0.5 ? hit.x + n.x * out : quantize(hit.x, step),
          y: quantize(hit.y - input.size.heightMeters / 2, step),
          z: Math.abs(n.z) > 0.5 ? hit.z + n.z * out : quantize(hit.z, step),
          yawDegrees: faceYaw,
        },
      };
    }
    case 'free':
      return { ...common, placement: { x: hit.x, y: baseY, z: hit.z, yawDegrees: yaw } };
    default:
      return null;
  }
}
