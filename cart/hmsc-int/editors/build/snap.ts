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
//   3. piece faces stack: a hit piece places on its top surface. Edge-snap
//      walls have ONE anchor: the floor/top perimeter, never the side face base.
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
  /** how close an edge line must be to a floor/roof perimeter to inherit its top Y */
  edgeAnchorToleranceMeters: number;
};

export const SNAP_TUNING_DEFAULTS: SnapTuning = {
  reachMeters: 14,
  groundMarchStepMeters: 0.25,
  gridMeters: 1,
  surfaceSnapMeters: 0.5,
  edgeAnchorToleranceMeters: 0.02,
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

function footprintAt(x: number, z: number, size: BuildPieceSize, yawDegrees: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const halfW = size.widthMeters / 2;
  const halfD = size.depthMeters / 2;
  const normalized = normalizeYaw(yawDegrees);
  const quarter = Math.round(normalized / 90) % 4;
  if (Math.abs(normalized - quarter * 90) < 1e-6 || Math.abs(normalized - 360) < 1e-6) {
    const swapped = quarter % 2 === 1;
    const hx = swapped ? halfD : halfW;
    const hz = swapped ? halfW : halfD;
    return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
  }
  const yaw = yawDegrees * DEG;
  const cos = Math.abs(Math.cos(yaw));
  const sin = Math.abs(Math.sin(yaw));
  const hx = cos * halfW + sin * halfD;
  const hz = sin * halfW + cos * halfD;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}

function planAreaOverlaps(a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
  return Math.min(a.maxX, b.maxX) > Math.max(a.minX, b.minX)
    && Math.min(a.maxZ, b.maxZ) > Math.max(a.minZ, b.minZ);
}

function gridFacePlacementY(
  piece: PlacedBuildPiece,
  size: BuildPieceSize,
  x: number,
  z: number,
  yawDegrees: number,
): number {
  const target = GAME_BUILD.placed.bounds(piece);
  const placed = footprintAt(x, z, size, yawDegrees);
  return planAreaOverlaps(placed, target) ? target.topY : target.baseY;
}

function isTopAnchorPlate(piece: PlacedBuildPiece): boolean {
  const kind = GAME_BUILD.catalog.get(piece.pieceId).kind;
  return kind === 'floor' || kind === 'roof';
}

function inRangeWithTolerance(v: number, min: number, max: number, tolerance: number): boolean {
  return v >= min - tolerance && v <= max + tolerance;
}

function topAnchorYAtEdge(
  pieces: readonly PlacedBuildPiece[],
  axis: 'x' | 'z',
  line: number,
  runCenter: number,
  tolerance: number,
): number | null {
  let top: number | null = null;
  for (const piece of pieces) {
    if (!isTopAnchorPlate(piece)) continue;
    const b = GAME_BUILD.placed.bounds(piece);
    const onEdge = axis === 'x'
      ? (Math.abs(line - b.minX) <= tolerance || Math.abs(line - b.maxX) <= tolerance)
      : (Math.abs(line - b.minZ) <= tolerance || Math.abs(line - b.maxZ) <= tolerance);
    if (!onEdge) continue;
    const withinRun = axis === 'x'
      ? inRangeWithTolerance(runCenter, b.minZ, b.maxZ, tolerance)
      : inRangeWithTolerance(runCenter, b.minX, b.maxX, tolerance);
    if (!withinRun) continue;
    top = top === null ? b.topY : Math.max(top, b.topY);
  }
  return top;
}

/** The snap pitch a piece tiles at (GRIDSNAP-0605, the user's verdict: too
 *  many sub-module positions "make something slightly off set from everything
 *  else"). A piece whose size is a CLEAN multiple of the grid is a module —
 *  it snaps at its own module pitch so neighbors tile FLUSH (a 3m plate has
 *  exactly one lattice, not three near-misses). Anything else (props, poles)
 *  snaps at the 1m substrate. */
export function modulePitch(sizeMeters: number, grid: number): number {
  const cells = Math.round(sizeMeters / grid);
  const clean = cells >= 1 && Math.abs(sizeMeters - cells * grid) < 1e-6;
  return clean ? cells * grid : grid;
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
    baseY = hitBounds.topY;
  } else {
    baseY = hit.y;
  }

  const common = onFace
    ? { surface: 'pieceFace' as const, hit, normal: pieceHit!.normal, targetPieceId: pieceHit!.piece.id }
    : { surface: 'ground' as const, hit };

  // GRIDSNAP-0605: modules tile at their OWN pitch (the yawed footprint per
  // axis), so a 3m plate has ONE lattice instead of three near-miss offsets;
  // sub-module pieces fall back to the 1m substrate.
  const turned = Math.round(yaw / 90) % 2 === 1;
  const spanX = turned ? input.size.depthMeters : input.size.widthMeters;
  const spanZ = turned ? input.size.widthMeters : input.size.depthMeters;
  const pitchX = modulePitch(spanX, grid);
  const pitchZ = modulePitch(spanZ, grid);

  switch (input.snap) {
    case 'grid':
    case 'free': {
      // 'free' rides the same substrate snap (GRIDSNAP-0605: the user's
      // verdict — raw-hit placement left props "slightly off set from
      // everything else"; the 1m grid is the floor for everything placed)
      const x = snapToCellCenter(hit.x, pitchX);
      const z = snapToCellCenter(hit.z, pitchZ);
      // ground under the SNAPPED center, so the piece sits on the terrain it covers
      const y = common.surface === 'ground'
        ? input.groundTopAt(x, z)
        : gridFacePlacementY(pieceHit!.piece, input.size, x, z, yaw);
      return { ...common, placement: { x, y, z, yawDegrees: yaw } };
    }
    case 'edge': {
      // the nearer MODULE line owns the wall: a wall bounds the plates it
      // walls in, so its line lattice is the wall's own module pitch (3m
      // walls land on plate edges, never mid-plate near-misses), and the run
      // centers along the same pitch
      const linePitch = modulePitch(input.size.widthMeters, grid);
      const lineX = Math.round(hit.x / linePitch) * linePitch;
      const lineZ = Math.round(hit.z / linePitch) * linePitch;
      const onXLine = Math.abs(hit.x - lineX) <= Math.abs(hit.z - lineZ);
      if (onXLine) {
        // plane at x = lineX, running along z (the turned frame)
        const z = snapToCellCenter(hit.z, linePitch);
        const y = common.surface === 'ground'
          ? topAnchorYAtEdge(input.pieces, 'x', lineX, z, tuning.edgeAnchorToleranceMeters) ?? input.groundTopAt(lineX, z)
          : baseY;
        return { ...common, placement: { x: lineX, y, z, yawDegrees: 90 } };
      }
      const x = snapToCellCenter(hit.x, linePitch);
      const y = common.surface === 'ground'
        ? topAnchorYAtEdge(input.pieces, 'z', lineZ, x, tuning.edgeAnchorToleranceMeters) ?? input.groundTopAt(x, lineZ)
        : baseY;
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
    default:
      return null;
  }
}
