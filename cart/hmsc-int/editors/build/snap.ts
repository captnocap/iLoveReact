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
//   3. piece faces stack from actual top faces. Edge-snap walls may stand on a
//      floor/roof top, but only when the crosshair is on that top face; side
//      faces and beside-floor ground hits are not alternate wall anchors.
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
  /** intentional freeform prop placement quantization, meters */
  freeformSnapMeters: number;
  /** held SHIFT sub-grid placement: how many finer cells one substrate cell
   *  splits into (2 → half-cell 0.5m steps). The default snap stays module-pitch
   *  flush (GRIDSNAP-0605: loose sub-tile offsets are a bug); SHIFT is the held
   *  opt-in to a finer-than-grid lattice, the snapped sibling of Alt freeform. */
  subgridDivisions: number;
  /** how close an edge line must be to a floor/roof perimeter to inherit its top Y */
  edgeAnchorToleranceMeters: number;
  /** wall-face edge snap: how close to a wall endpoint a side-face hit turns the corner */
  wallEndpointSnapMeters: number;
  /** REQ-0653: how far a ground edge-snap reaches for REAL geometry (existing
   *  wall lines / plate edges) before falling back to the world lattice */
  wallAnchorMagnetMeters: number;
  /** req_0672: how far a GRID module placement reaches for a standing plate
   *  whose lattice it joins (the floor/roof twin of the wall magnet) before
   *  falling back to the world lattice */
  plateAnchorMagnetMeters: number;
  /** req_1687: how far ABOVE a model's surface level the crosshair may sit and
   *  still land a prop on that layer — the air gap between a shelf's boards is
   *  the slack a body-height cursor needs to pick the board it points into */
  surfacePickToleranceMeters: number;
};

export const SNAP_TUNING_DEFAULTS: SnapTuning = {
  reachMeters: 14,
  groundMarchStepMeters: 0.25,
  gridMeters: 1,
  surfaceSnapMeters: 0.5,
  freeformSnapMeters: 0.01,
  subgridDivisions: 2,
  edgeAnchorToleranceMeters: 0.02,
  wallEndpointSnapMeters: 0.5,
  wallAnchorMagnetMeters: 1,
  plateAnchorMagnetMeters: 3,
  surfacePickToleranceMeters: 0.2,
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
  /** held fine-placement override (Alt): 'free' props land on the raw hit
   *  (REQ-0596); grid/edge MODULES step at the 1m substrate instead of their
   *  module pitch, edges still on tile lines (REQ-0650: module pitch made an
   *  even road setback on both sides of a street unreachable) */
  freeform?: boolean;
  /** held SHIFT sub-grid placement: snap to a finer-than-substrate lattice
   *  (tuning.subgridDivisions cells per 1m, default half-cell 0.5m) instead of
   *  the module pitch. The snapped sibling of `freeform` — still on a clean
   *  lattice (no off-grid drift), just finer. Opts out of module/plate/wall
   *  anchoring (it's an explicit "place between the tiles" gesture). */
  subgrid?: boolean;
  /** lattice anchor (req_0668): a local-frame point (relative to the armed
   *  thing's origin, pre-rotation) that must land on the module lattice
   *  INSTEAD of the origin — a prefab's floor-plate center. A captured
   *  prefab's origin is its min piece center (often a wall line, off the
   *  floor lattice by half a module), so snapping the origin stamped rooms
   *  1–2 tiles off every natively-placed floor. `size` should be the anchor
   *  piece's own size so the pitch is its module pitch. */
  anchorLocal?: { x: number; z: number };
  /** req_1687: the WORLD-Y of each flat surface a hit prop can hold a prop on (a
   *  shelf's boards), low → high. When the ray lands on such a multi-layer prop,
   *  placement drops onto the layer UNDER the crosshair instead of the box top.
   *  undefined / <2 surfaces → unchanged single-top behavior. */
  propSurfacesFor?: (piece: PlacedBuildPiece) => number[] | null;
  tuning?: SnapTuning;
};

const DEG = Math.PI / 180;

// PLACEPERF-0626: the local radius the edge-veto plate query reaches. A plate
// can only veto an edge placement when its edge lies on the chosen line, which
// means it covers the (line, run) point; this radius just needs to outrun the
// grid's own cell size so a point on a cell boundary still finds its plate.
const EDGE_VETO_QUERY_RADIUS_METERS = 4;

function normalizeYaw(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

function quarterTurns(yawDegrees: number): number | null {
  const yaw = normalizeYaw(yawDegrees);
  const quarter = Math.round(yaw / 90) % 4;
  return Math.abs(yaw - quarter * 90) < 1e-6 || Math.abs(yaw - 360) < 1e-6 ? quarter : null;
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

function isTopFace(normal: { x: number; y: number; z: number } | undefined): boolean {
  return !!normal && normal.y > 0.5;
}

function wallEdgeSnapFromWallFace(
  piece: PlacedBuildPiece,
  hit: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  baseY: number,
  linePitch: number,
  endpointSnapMeters: number,
): { x: number; y: number; z: number; yawDegrees: number } | null {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  if (def.kind !== 'wall' || def.snap !== 'edge') return null;
  const quarter = quarterTurns(piece.yawDegrees);
  if (quarter === null) return null;
  const axis = quarter % 2 === 0 ? 'x' : 'z';
  const line = axis === 'x' ? piece.z : piece.x;
  const runCenter = axis === 'x' ? piece.x : piece.z;
  const runHit = axis === 'x' ? hit.x : hit.z;
  const sideHit = axis === 'x' ? hit.z : hit.x;
  const normalAlong = axis === 'x' ? normal.x : normal.z;
  const normalSide = axis === 'x' ? normal.z : normal.x;
  const runMin = runCenter - def.size.widthMeters / 2;
  const runMax = runCenter + def.size.widthMeters / 2;
  const nearestEnd = Math.abs(runHit - runMin) <= Math.abs(runHit - runMax) ? runMin : runMax;

  if (Math.abs(normalAlong) > 0.5) {
    const sign = normalAlong > 0 ? 1 : -1;
    return axis === 'x'
      ? { x: nearestEnd + sign * linePitch / 2, y: baseY, z: line, yawDegrees: 0 }
      : { x: line, y: baseY, z: nearestEnd + sign * linePitch / 2, yawDegrees: 90 };
  }

  if (Math.abs(runHit - nearestEnd) <= endpointSnapMeters) {
    const sideOffset = sideHit - line;
    const sideSign = Math.abs(sideOffset) > 1e-6
      ? (sideOffset > 0 ? 1 : -1)
      : (normalSide >= 0 ? 1 : -1);
    return axis === 'x'
      ? { x: nearestEnd, y: baseY, z: line + sideSign * linePitch / 2, yawDegrees: 90 }
      : { x: line + sideSign * linePitch / 2, y: baseY, z: nearestEnd, yawDegrees: 0 };
  }

  const center = snapToCellCenter(runHit, linePitch);
  return axis === 'x'
    ? { x: center, y: baseY, z: line, yawDegrees: 0 }
    : { x: line, y: baseY, z: center, yawDegrees: 90 };
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

/** Fine (Alt-held) module stepping (REQ-0650): the module-pitch lattice is
 *  world-anchored, so a 3m plate could stand 0/3/6 tiles from a road line but
 *  never 1 or 2 — equal setbacks on both sides of a street were unreachable.
 *  Fine mode steps the piece ONE substrate cell at a time while keeping its
 *  EDGES on tile lines (odd-cell spans center on a cell, even-cell spans on a
 *  line), so the GRIDSNAP-0605 sub-tile "slightly off set" positions still
 *  cannot happen. */
export function fineModuleCenter(v: number, spanMeters: number, grid: number): number {
  const cells = Math.round(spanMeters / grid);
  const cleanEven = cells >= 1 && cells % 2 === 0 && Math.abs(spanMeters - cells * grid) < 1e-6;
  return cleanEven ? Math.round(v / grid) * grid : snapToCellCenter(v, grid);
}

/** REQ-0653: a new wall's line prefers REAL geometry near the cursor — an
 *  existing wall's line, a floor/roof plate's edge — over the world-anchored
 *  module lattice. The lattice only APPROXIMATES "walls land on plate edges"
 *  (the V24 contract): the moment a building sits off the world lattice (Alt
 *  fine placement, a 1-tile building move, a corner-turned run), every
 *  lattice-derived single placement lands 1–2 tiles off the building while
 *  drag strokes stay self-consistent — the user's mismatched-storeys bug.
 *  Returns the anchored line plus the source's OWN run lattice (plates: cells
 *  from the plate corner; walls: module steps from that wall's run center),
 *  or null when nothing anchors within magnetMeters. */
export type WallLineAnchor = { line: number; runOrigin: number; runPhase: 'cell' | 'center' };
export function nearestWallLineAnchor(
  pieces: readonly PlacedBuildPiece[],
  axis: 'x' | 'z',
  lineAt: number,
  runAt: number,
  pitch: number,
  magnetMeters: number,
): WallLineAnchor | null {
  let best: WallLineAnchor | null = null;
  let bestDistance = magnetMeters;
  for (const piece of pieces) {
    const def = GAME_BUILD.catalog.get(piece.pieceId);
    if (def.kind === 'wall') {
      const quarter = quarterTurns(piece.yawDegrees);
      if (quarter === null) continue;
      const lineAxis: 'x' | 'z' = quarter % 2 === 0 ? 'z' : 'x'; // yaw 0 runs along x → its line is z
      if (lineAxis !== axis) continue;
      const line = axis === 'x' ? piece.x : piece.z;
      const runCenter = axis === 'x' ? piece.z : piece.x;
      // reachable run window: the wall itself plus one module past either end,
      // so a click that EXTENDS the run still inherits its line
      if (Math.abs(runAt - runCenter) > def.size.widthMeters / 2 + pitch + magnetMeters) continue;
      const distance = Math.abs(lineAt - line);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { line, runOrigin: runCenter, runPhase: 'center' };
      }
    } else if (isTopAnchorPlate(piece)) {
      const b = GAME_BUILD.placed.bounds(piece);
      const [edgeMin, edgeMax] = axis === 'x' ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
      const [runMin, runMax] = axis === 'x' ? [b.minZ, b.maxZ] : [b.minX, b.maxX];
      if (runAt < runMin - magnetMeters || runAt > runMax + magnetMeters) continue;
      for (const edge of [edgeMin, edgeMax]) {
        const distance = Math.abs(lineAt - edge);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { line: edge, runOrigin: runMin, runPhase: 'cell' };
        }
      }
    }
  }
  return best;
}

export function anchoredRunCenter(anchor: WallLineAnchor, runAt: number, pitch: number): number {
  return anchor.runPhase === 'center'
    ? anchor.runOrigin + Math.round((runAt - anchor.runOrigin) / pitch) * pitch
    : anchor.runOrigin + (Math.floor((runAt - anchor.runOrigin) / pitch) + 0.5) * pitch;
}

/** req_0672: REQ-0653 extended to GRID modules — the nearest standing plate
 *  (floor/roof) within magnetMeters of the hit, whose CENTER is the lattice
 *  origin a new module placement steps from. A building that sits off the
 *  world lattice (a 1m move, an Alt placement, a width+1m clone) defines its
 *  OWN module grid; new plates and prefab stamps beside it must join THAT
 *  grid or they can never tile flush ("prefabs are on a completely different
 *  axis than floors"). Distance is to the plate's footprint bounds, so a
 *  click anywhere on or beside the building anchors; open ground past the
 *  magnet falls back to the world lattice. */
export function nearestPlateLatticeAnchor(
  pieces: readonly PlacedBuildPiece[],
  hitX: number,
  hitZ: number,
  magnetMeters: number,
): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestDistance = magnetMeters;
  for (const piece of pieces) {
    if (!isTopAnchorPlate(piece)) continue;
    const b = GAME_BUILD.placed.bounds(piece);
    const dx = Math.max(b.minX - hitX, 0, hitX - b.maxX);
    const dz = Math.max(b.minZ - hitZ, 0, hitZ - b.maxZ);
    const distance = Math.hypot(dx, dz);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x: piece.x, z: piece.z };
    }
  }
  return best;
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
    baseY = isTopFace(pieceHit!.normal) ? hitBounds.topY : hitBounds.baseY;
  } else {
    baseY = hit.y;
  }

  const common = onFace
    ? { surface: 'pieceFace' as const, hit, normal: pieceHit!.normal, targetPieceId: pieceHit!.piece.id }
    : { surface: 'ground' as const, hit };

  // GRIDSNAP-0605: modules tile at their OWN pitch (the yawed footprint per
  // axis), so a 3m plate has ONE lattice instead of three near-miss offsets;
  // sub-module pieces fall back to the 1m substrate. Held fine mode
  // (REQ-0650) trades the one-lattice guarantee for 1-tile stepping, edges
  // still tile-aligned.
  const fine = !!input.freeform;
  const subgrid = !!input.subgrid;
  // SHIFT sub-grid pitch: the substrate split into N finer cells (default
  // half-cell). Quantize to the line (a multiple), not the cell center, so the
  // finer lattice still tiles cleanly with the coarse one.
  const subPitch = grid / Math.max(1, Math.round(tuning.subgridDivisions));
  const turned = Math.round(yaw / 90) % 2 === 1;
  const spanX = turned ? input.size.depthMeters : input.size.widthMeters;
  const spanZ = turned ? input.size.widthMeters : input.size.depthMeters;
  const pitchX = modulePitch(spanX, grid);
  const pitchZ = modulePitch(spanZ, grid);
  // req_0668: the anchor rotates with the ghost (the same R(+yaw) frame
  // stampPrefabPieces composes locals with), then the ANCHOR point snaps to
  // the lattice and the origin shifts back by the rotated offset — so
  // worldAnchor = placement + a = snap(hit + a) sits on the lattice exactly.
  const yawRadians = yaw * DEG;
  const ax = input.anchorLocal ? input.anchorLocal.x * Math.cos(yawRadians) - input.anchorLocal.z * Math.sin(yawRadians) : 0;
  const az = input.anchorLocal ? input.anchorLocal.x * Math.sin(yawRadians) + input.anchorLocal.z * Math.cos(yawRadians) : 0;
  // req_0672: a MODULE placement near standing plates joins THEIR lattice
  // (the grid twin of the REQ-0653 wall magnet). On a plate's top face the
  // anchor is THAT plate alone (a storey stacks on its own building, wherever
  // it sits); on the ground, the nearest plate within the magnet. Alt (fine)
  // opts out, same as edge snap: fine means "exactly the tile I point at".
  const isModule = pitchX > grid || pitchZ > grid;
  // PLACEPERF-0626: only plates whose bounds lie within the magnet of the hit
  // can win — narrow to those (grid-local) before the scan so a per-place
  // anchor lookup is O(local), not O(world). The radius = the magnet itself is
  // a correct superset (a plate within `magnet` of the point occupies a cell
  // within `magnet` of it).
  const platesNearHit = () => GAME_BUILD.placed.piecesNearPoint(input.pieces, hit.x, hit.z, tuning.plateAnchorMagnetMeters);
  const plateAnchor = !fine && !subgrid && isModule
    ? (onFace
      ? (isTopAnchorPlate(pieceHit!.piece) ? { x: pieceHit!.piece.x, z: pieceHit!.piece.z } : nearestPlateLatticeAnchor(platesNearHit(), hit.x, hit.z, tuning.plateAnchorMagnetMeters))
      : nearestPlateLatticeAnchor(platesNearHit(), hit.x, hit.z, tuning.plateAnchorMagnetMeters))
    : null;
  const snapAxis = (hitV: number, a: number, span: number, pitch: number, originV: number | null) => {
    if (fine) return fineModuleCenter(hitV + a, span, grid) - a;
    if (subgrid) return quantize(hitV + a, subPitch) - a; // SHIFT: finer lattice line
    if (originV !== null && pitch > grid) return originV + Math.round((hitV + a - originV) / pitch) * pitch - a;
    return snapToCellCenter(hitV + a, pitch) - a;
  };
  // req_1687: on a MULTI-LAYER prop (a shelf), land on the board UNDER the
  // crosshair — the highest authored surface at or just below the hit, within a
  // body-height pick window — instead of the whole-box top. A single-top prop
  // (no surfaces, or one) keeps the box-top placement exactly as before.
  const onFacePlacementY = (wx: number, wz: number): number => {
    const boxY = gridFacePlacementY(pieceHit!.piece, input.size, wx, wz, yaw);
    const surfaces = input.propSurfacesFor?.(pieceHit!.piece);
    if (!surfaces || surfaces.length < 2) return boxY;
    let pick: number | null = null;
    for (const sy of surfaces) {
      if (sy <= hit.y + tuning.surfacePickToleranceMeters && (pick === null || sy > pick)) pick = sy;
    }
    return pick ?? surfaces[0]; // below the lowest board → the lowest board, never the box top
  };
  const substratePlacement = () => {
    const x = snapAxis(hit.x, ax, spanX, pitchX, plateAnchor ? plateAnchor.x : null);
    const z = snapAxis(hit.z, az, spanZ, pitchZ, plateAnchor ? plateAnchor.z : null);
    // ground under the SNAPPED center (the anchor piece's center, when one is
    // set), so the piece sits on the terrain it covers
    const y = common.surface === 'ground'
      ? input.groundTopAt(x + ax, z + az)
      : onFacePlacementY(x + ax, z + az);
    return { x, y, z, yawDegrees: yaw };
  };

  switch (input.snap) {
    case 'free': {
      if (input.freeform) {
        const x = quantize(hit.x, tuning.freeformSnapMeters);
        const z = quantize(hit.z, tuning.freeformSnapMeters);
        const y = common.surface === 'ground'
          ? input.groundTopAt(x, z)
          : onFacePlacementY(x, z);
        return { ...common, placement: { x, y, z, yawDegrees: yaw } };
      }
      return { ...common, placement: substratePlacement() };
    }
    case 'grid': {
      // 'free' rides the same substrate snap (GRIDSNAP-0605: the user's
      // verdict — raw-hit placement left props "slightly off set from
      // everything else"; the 1m grid is the floor for everything placed)
      return { ...common, placement: substratePlacement() };
    }
    case 'edge': {
      if (onFace && isTopAnchorPlate(pieceHit!.piece) && !isTopFace(pieceHit!.normal)) return null;
      // the nearer MODULE line owns the wall: a wall bounds the plates it
      // walls in, so its line lattice is the wall's own module pitch (3m
      // walls land on plate edges, never mid-plate near-misses), and the run
      // centers along the same pitch. Fine mode (REQ-0650) frees the GROUND
      // lattice to any 1m tile line; the wall-face continuation below stays
      // module-relative (flush-past-the-end is inherently module math).
      const linePitch = modulePitch(input.size.widthMeters, grid);
      if (onFace && !isTopFace(pieceHit!.normal)) {
        const wallFacePlacement = wallEdgeSnapFromWallFace(
          pieceHit!.piece,
          hit,
          pieceHit!.normal,
          baseY,
          linePitch,
          tuning.wallEndpointSnapMeters,
        );
        if (wallFacePlacement) return { ...common, placement: wallFacePlacement };
      }
      const lineStep = fine ? grid : subgrid ? subPitch : linePitch;
      // REQ-0653: anchor to real geometry before the lattice. On a top face,
      // the anchor set is the HIT piece alone (the plate you stand a wall on /
      // the wall you stack a storey on) with an unbounded magnet — a plate-top
      // click means THAT plate's edge, wherever the plate sits. On the ground,
      // scan the standing world within the magnet so a click extending an
      // off-lattice run inherits its line. Alt (fine) opts out of anchoring:
      // fine mode means "exactly the tile line I point at".
      // PLACEPERF-0626: the ground scan only cares about walls whose footprint
      // passes within (linePitch + magnet) of the hit — its own run window —
      // so narrow to those grid-local pieces once, not the whole world.
      const groundWallPieces = (!fine && !subgrid && !onFace)
        ? GAME_BUILD.placed.piecesNearPoint(input.pieces, hit.x, hit.z, linePitch + tuning.wallAnchorMagnetMeters)
        : input.pieces;
      const candidate = (axis: 'x' | 'z') => {
        const lineAt = axis === 'x' ? hit.x : hit.z;
        const runAt = axis === 'x' ? hit.z : hit.x;
        const anchor = (fine || subgrid) ? null : onFace
          ? nearestWallLineAnchor([pieceHit!.piece], axis, lineAt, runAt, linePitch, Number.POSITIVE_INFINITY)
          : nearestWallLineAnchor(groundWallPieces, axis, lineAt, runAt, linePitch, tuning.wallAnchorMagnetMeters);
        const line = anchor ? anchor.line : Math.round(lineAt / lineStep) * lineStep;
        const run = anchor
          ? anchoredRunCenter(anchor, runAt, linePitch)
          : fine ? fineModuleCenter(runAt, input.size.widthMeters, grid)
          : subgrid ? Math.round(runAt / subPitch) * subPitch
          : snapToCellCenter(runAt, linePitch);
        return { line, run, distance: Math.abs(lineAt - line), anchored: anchor !== null };
      };
      const cx = candidate('x');
      const cz = candidate('z');
      // an anchored line beats an unanchored lattice line outright (stacking on
      // a wall top must not lose a tie to a world lattice line crossing the run)
      const xWins = cx.anchored !== cz.anchored ? cx.anchored : cx.distance <= cz.distance;
      // PLACEPERF-0626: only a plate whose edge lands on the chosen line can
      // veto the placement — those plates cover the (line, run) point, so a
      // grid-local query around it is a correct superset of the full scan.
      const platesAtEdge = (px: number, pz: number) =>
        GAME_BUILD.placed.piecesNearPoint(input.pieces, px, pz, EDGE_VETO_QUERY_RADIUS_METERS);
      if (xWins) {
        // plane at x = line, running along z (the turned frame)
        if (common.surface === 'ground' && topAnchorYAtEdge(platesAtEdge(cx.line, cx.run), 'x', cx.line, cx.run, tuning.edgeAnchorToleranceMeters) !== null) return null;
        const y = common.surface === 'ground' ? input.groundTopAt(cx.line, cx.run) : baseY;
        return { ...common, placement: { x: cx.line, y, z: cx.run, yawDegrees: 90 } };
      }
      if (common.surface === 'ground' && topAnchorYAtEdge(platesAtEdge(cz.run, cz.line), 'z', cz.line, cz.run, tuning.edgeAnchorToleranceMeters) !== null) return null;
      const y = common.surface === 'ground' ? input.groundTopAt(cz.run, cz.line) : baseY;
      return { ...common, placement: { x: cz.run, y, z: cz.line, yawDegrees: 0 } };
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
