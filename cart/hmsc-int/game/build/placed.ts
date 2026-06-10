// game/build/placed — a PLACED piece: the V24 grammar standing IN the world.
//
// The catalog (./catalog.ts) is what a piece IS; this module is a piece
// PLACED — a world position + rotation + its meaningful cutout. ONE MODEL,
// TWO VIEWS (V24 addendum 2): a PlacedBuildPiece is the same semantic record
// every authoring mode edits — Creative Build (embodied), Plan Build (Sims),
// and the bake all read THIS shape; nothing here assumes a camera or
// interaction mode.
//
// Storage is the V20 world stream (game/world/stream.ts): placed pieces are
// plain world data — the stream's materialized state is the ONE source of
// truth; ids are minted by the materializer so replay is deterministic. This
// module owns the pure semantics over that data:
//
//   • effective tags          placedPieceTags (catalog row + edit, the one
//                             composition — authored meaning cannot drift)
//   • geometry                pieceBounds / raycastPieces (crosshair targeting)
//   • embodied colliders      placedPieceColliders / placedPieceRamps — the
//                             LIVE-PLAY adapter feeding GAME_PHYSICS, the same
//                             family as game/world/colliders. This is NOT the
//                             bake: the compile-lane emission consumes the full
//                             BakePromise (cover faces, rooms, nav portals);
//                             live play needs only "can I walk through it /
//                             stand on it", derived from the same tags.
//   • prefab stamping         stampPrefabPieces (rotation-aware twin of
//                             decomposePrefab — same see-through law: a stamp
//                             lands as semantic pieces, never a blob) and
//                             prefabFromPieces (clone-from-world capture).
//
// The 1m grid (R4) stays the snap substrate; positions are world meters.

import {
  catalogEntry,
  effectiveTags,
  isCatalogId,
  type BuildPieceDef,
} from './catalog';
import { BUILD_KIND_CONTRACTS, type BuildGameplayTags, type BuildPieceKind } from './pieces';
import { wallEditDefinition, type WallEdit } from './edits';
import type { BuildPrefabDef, PrefabPiece } from './prefabs';
import { BUILD_FACE_SLOTS, resolveFaceSkin, type BuildSkinSet } from './skins';
import type { CameraOcclusionOrientedRect, CameraOcclusionRect, CollisionRect, Heightfield, OrientedCollisionRect } from '../physics';

// ── the placed record (what the world stream stores) ─────────────────────────

export type PlacedBuildPiece = {
  /** `bp_<n>` — minted by the world stream's materializer (replay-deterministic) */
  id: string;
  /** BUILD_CATALOG id */
  pieceId: string;
  /** world meters (R4): x/z is the piece CENTER on the ground plane */
  x: number;
  /** world meters: the piece BASE (bottom face) — stacking sets this to the face top */
  y: number;
  z: number;
  /** rotation about +Y in degrees (snap modes author in 90° steps; the data stays general) */
  yawDegrees: number;
  /** the meaningful cutout on THIS placement (wall-family kinds only) */
  edit?: WallEdit;
  /** resolved per-face skin/material snapshot for this placed instance */
  skin?: BuildSkinSet;
  /** prefab stamp group id, when this piece came from one prefabStamped event */
  stampId?: string;
  /** source prefab id for stamped pieces, so type-skin edits can refresh live instances */
  prefabId?: string;
  /** source piece index inside the prefab definition */
  prefabPieceIndex?: number;
};

// ── P2 tuning: every behavior-affecting number is table data ─────────────────
// (the WORLD_TUNING convention — named rows, never literals in logic)

export const PLACED_TUNING = {
  /** a walk portal's traversable opening (door/arch cutouts), meters */
  walkOpeningWidthMeters: 1.2,
  /** a vehicle portal's opening (garage door), meters */
  vehicleOpeningWidthMeters: 2.6,
  /** where a halfHeight wall's collision band tops out (low cover), meters */
  halfHeightTopMeters: 1.1,
  /** surface feel of built pieces (one material-agnostic profile until the
   *  materials lane gives per-material feel) */
  pieceFriction: 0.85,
  pieceRestitution: 0.02,
  /** ramp/stairs walkable-slope gate (cos): 3m rise over 3m run is 45°;
   *  0.6 keeps the standard ramp walkable with margin */
  rampWalkableSlopeCos: 0.6,
  /** RAMPREAL-0606: ramps are inclined floor slabs, not solid wedges. The
   *  slab thickness matches the catalog plate thickness; tune live if the
   *  catalog's common floor module changes. */
  rampSlabThicknessMeters: 0.2,
  /** Thin plan footprint of a ramp slab edge. This is only the physical edge
   *  lip of the tilted floor, not a full side/back wall mass. */
  rampSlabEdgePlanThicknessMeters: 0.12,
  /** Segment count for sloped side-edge bands; high enough that adjacent bands
   *  overlap vertically for the standard 45° / 3m ramp. */
  rampSlabEdgeSegments: 16,
  /** Uniform host heightfield cell size for ramp/stair slopes. This keeps
   *  non-square links like stairs on their real footprint instead of widening
   *  them to the 3m ramp module. */
  verticalLinkHeightfieldCellMeters: 0.6,
  /** RAMPSIDE-0606 legacy for stairs only: side/back boundary thickness for
   *  stair wall faces. Ramps no longer use this. */
  stairBoundaryWallThicknessMeters: 0.25,
  /** RAMPFOOT-0605: degenerate-band floor when trimming wall overhangs out of
   *  ramp footprints — a trimmed band thinner than this is dropped, meters */
  rampTrimMinBandMeters: 0.01,
  /** SMARTSEL-0605: two pieces TOUCH when their envelopes come within this
   *  (abutting faces count; module-snapped neighbors sit exactly flush) */
  touchToleranceMeters: 0.05,
  /** REQ-0109: numeric recognition tolerance for exact lattice wall joins. */
  wallJoinToleranceMeters: 1e-6,
} as const;

// ── basics ───────────────────────────────────────────────────────────────────

export function placedPieceDef(piece: PlacedBuildPiece): BuildPieceDef {
  return catalogEntry(piece.pieceId);
}

/** The placed piece's EFFECTIVE tags — catalog row + edit, the one composition
 *  point (catalog.effectiveTags), so authored and embodied meaning agree. */
export function placedPieceTags(piece: PlacedBuildPiece): BuildGameplayTags {
  return effectiveTags(placedPieceDef(piece), piece.edit);
}

/** Can this placement take the WallEdit vocabulary? (kind contract, not guesswork) */
export function placedPieceAcceptsEdits(piece: PlacedBuildPiece): boolean {
  return BUILD_KIND_CONTRACTS[placedPieceDef(piece).kind].edits === 'wall';
}

const DEG = Math.PI / 180;

function localOffset(u: number, v: number, yawDegrees: number): { dx: number; dz: number } {
  const cos = Math.cos(yawDegrees * DEG);
  const sin = Math.sin(yawDegrees * DEG);
  // Match Scene3D/render3d yaw: local +v turns toward world +x at yaw 90.
  return { dx: u * cos + v * sin, dz: -u * sin + v * cos };
}

function normalizeYaw(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

/** yaw snapped onto a quarter turn, or null when it is genuinely free-angled */
function quarterTurns(yawDegrees: number): number | null {
  const yaw = normalizeYaw(yawDegrees);
  const quarter = Math.round(yaw / 90) % 4;
  return Math.abs(yaw - quarter * 90) < 1e-6 || Math.abs(yaw - 360) < 1e-6 ? quarter : null;
}

export type PieceBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  baseY: number;
  topY: number;
};

/** Axis-aligned world envelope of a placed piece (exact for quarter-turn yaw,
 *  the rotated envelope otherwise). */
export function pieceBounds(piece: PlacedBuildPiece): PieceBounds {
  const def = placedPieceDef(piece);
  const size = def.size;
  const halfW = size.widthMeters / 2;
  const halfD = size.depthMeters / 2;
  const quarter = quarterTurns(piece.yawDegrees);
  let hx: number;
  let hz: number;
  if (quarter !== null) {
    const swapped = quarter % 2 === 1;
    hx = swapped ? halfD : halfW;
    hz = swapped ? halfW : halfD;
  } else {
    const cos = Math.abs(Math.cos(piece.yawDegrees * DEG));
    const sin = Math.abs(Math.sin(piece.yawDegrees * DEG));
    hx = cos * halfW + sin * halfD;
    hz = sin * halfW + cos * halfD;
  }
  return {
    minX: piece.x - hx,
    maxX: piece.x + hx,
    minZ: piece.z - hz,
    maxZ: piece.z + hz,
    baseY: piece.y,
    topY: piece.y + size.heightMeters,
  };
}

// ── SMARTSEL-0605: the connected shape under one click ───────────────────────

function boundsTouch(a: PieceBounds, b: PieceBounds, tolerance: number): boolean {
  return (
    a.minX <= b.maxX + tolerance && b.minX <= a.maxX + tolerance &&
    a.minZ <= b.maxZ + tolerance && b.minZ <= a.maxZ + tolerance &&
    a.baseY <= b.topY + tolerance && b.baseY <= a.topY + tolerance
  );
}

/**
 * Every piece TRANSITIVELY touching the seed — the connected shape (a wall on
 * a floor touches it; the next storey touches the wall top; module-snapped
 * neighbors abut exactly, so flush faces count as touching). BFS over
 * envelope contact (pieceBounds — exact at quarter turns, the rotated
 * envelope otherwise, so free-yaw pieces err toward inclusion). The seed is
 * always in the result; an unknown seed returns empty.
 */
export function connectedPieceIds(
  seedId: string,
  pieces: readonly PlacedBuildPiece[],
  toleranceMeters: number = PLACED_TUNING.touchToleranceMeters,
): Set<string> {
  const out = new Set<string>();
  const seed = pieces.find((p) => p.id === seedId);
  if (!seed) return out;
  const all = pieces.map((p) => ({ id: p.id, bounds: pieceBounds(p) }));
  out.add(seedId);
  const queue = [pieceBounds(seed)];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const candidate of all) {
      if (out.has(candidate.id)) continue;
      if (boundsTouch(current, candidate.bounds, toleranceMeters)) {
        out.add(candidate.id);
        queue.push(candidate.bounds);
      }
    }
  }
  return out;
}

// ── crosshair targeting: ray vs placed pieces ────────────────────────────────

export type PieceRay = {
  origin: { x: number; y: number; z: number };
  /** normalized direction */
  dir: { x: number; y: number; z: number };
};

export type PieceHit = {
  piece: PlacedBuildPiece;
  /** ray parameter (meters along dir) */
  t: number;
  point: { x: number; y: number; z: number };
  /** world-space outward face normal of the hit face */
  normal: { x: number; y: number; z: number };
};

/** Nearest piece under the ray within maxDistance — exact oriented-box test
 *  (the ray drops into each piece's local frame; any yaw works). */
export function raycastPieces(
  ray: PieceRay,
  pieces: readonly PlacedBuildPiece[],
  maxDistance: number,
): PieceHit | null {
  let best: PieceHit | null = null;
  for (const piece of pieces) {
    const size = placedPieceDef(piece).size;
    const yawRadians = piece.yawDegrees * DEG;
    const cos = Math.cos(-yawRadians);
    const sin = Math.sin(-yawRadians);
    const centerY = piece.y + size.heightMeters / 2;
    // ray → piece frame (translate to center, rotate by -yaw about +Y)
    const relX = ray.origin.x - piece.x;
    const relZ = ray.origin.z - piece.z;
    const ox = relX * cos - relZ * sin;
    const oy = ray.origin.y - centerY;
    const oz = relX * sin + relZ * cos;
    const dx = ray.dir.x * cos - ray.dir.z * sin;
    const dy = ray.dir.y;
    const dz = ray.dir.x * sin + ray.dir.z * cos;
    const half = [size.widthMeters / 2, size.heightMeters / 2, size.depthMeters / 2];
    const origin = [ox, oy, oz];
    const dir = [dx, dy, dz];
    // slab test
    let tNear = 0;
    let tFar = maxDistance;
    let nearAxis = -1;
    let nearSign = 0;
    let miss = false;
    for (let axis = 0; axis < 3; axis += 1) {
      if (Math.abs(dir[axis]) < 1e-9) {
        if (Math.abs(origin[axis]) > half[axis]) { miss = true; break; }
        continue;
      }
      let t0 = (-half[axis] - origin[axis]) / dir[axis];
      let t1 = (half[axis] - origin[axis]) / dir[axis];
      // the entry face is the one the ray travels AGAINST — its outward
      // normal opposes the ray on this axis, regardless of slab ordering
      const sign = dir[axis] > 0 ? -1 : 1;
      if (t0 > t1) { const swap = t0; t0 = t1; t1 = swap; }
      if (t0 > tNear) { tNear = t0; nearAxis = axis; nearSign = sign; }
      if (t1 < tFar) tFar = t1;
      if (tNear > tFar) { miss = true; break; }
    }
    if (miss || nearAxis < 0) continue;
    if (best && tNear >= best.t) continue;
    // local face normal → world (rotate by +yaw)
    const local = [0, 0, 0];
    local[nearAxis] = nearSign;
    const wcos = Math.cos(yawRadians);
    const wsin = Math.sin(yawRadians);
    best = {
      piece,
      t: tNear,
      point: {
        x: ray.origin.x + ray.dir.x * tNear,
        y: ray.origin.y + ray.dir.y * tNear,
        z: ray.origin.z + ray.dir.z * tNear,
      },
      normal: {
        x: local[0] * wcos - local[2] * wsin,
        y: local[1],
        z: local[0] * wsin + local[2] * wcos,
      },
    };
  }
  return best;
}

// ── embodied colliders (live play; the compile bake is the richer consumer) ──

export type PlacedPieceColliders = {
  rects: CollisionRect[];
  orientedRects: OrientedCollisionRect[];
};

export type PlacedPieceCameraOccluders = {
  rects: CameraOcclusionRect[];
  orientedRects: CameraOcclusionOrientedRect[];
  ownerIds: string[];
};

/** One solid band in the piece's own frame: [u0,u1] along the piece width,
 *  full depth, with its own top. Split points come from the edit's opening. */
export type PlacedPieceBand = { u0: number; u1: number; top: number };

type WallRunFrame = {
  axis: 'x' | 'z';
  quarter: number;
  center: number;
  line: number;
  runMin: number;
  runMax: number;
  halfDepth: number;
  baseY: number;
  topY: number;
};

function wallRunFrame(piece: PlacedBuildPiece, def: BuildPieceDef): WallRunFrame | null {
  if (def.kind !== 'wall' || def.snap !== 'edge') return null;
  const quarter = quarterTurns(piece.yawDegrees);
  if (quarter === null) return null;
  const size = def.size;
  const axis = quarter % 2 === 0 ? 'x' : 'z';
  const center = axis === 'x' ? piece.x : piece.z;
  const line = axis === 'x' ? piece.z : piece.x;
  return {
    axis,
    quarter,
    center,
    line,
    runMin: center - size.widthMeters / 2,
    runMax: center + size.widthMeters / 2,
    halfDepth: size.depthMeters / 2,
    baseY: piece.y,
    topY: piece.y + size.heightMeters,
  };
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number, tolerance: number): boolean {
  return Math.min(a1, b1) >= Math.max(a0, b0) - tolerance;
}

function wallJoinRunLimits(piece: PlacedBuildPiece, def: BuildPieceDef, pieces: readonly PlacedBuildPiece[]): { minU: number; maxU: number } {
  const self = wallRunFrame(piece, def);
  if (!self) return { minU: -def.size.widthMeters / 2, maxU: def.size.widthMeters / 2 };
  const tolerance = PLACED_TUNING.wallJoinToleranceMeters;
  let runMin = self.runMin;
  let runMax = self.runMax;
  for (const other of pieces) {
    if (other.id === piece.id) continue;
    const otherDef = placedPieceDef(other);
    const candidate = wallRunFrame(other, otherDef);
    if (!candidate || candidate.axis === self.axis) continue;
    if (!rangesOverlap(self.baseY, self.topY, candidate.baseY, candidate.topY, tolerance)) continue;
    if (Math.abs(candidate.line - self.runMin) <= tolerance && candidate.runMin <= self.line + tolerance && candidate.runMax >= self.line - tolerance) {
      runMin = Math.min(runMin, candidate.line - candidate.halfDepth);
    }
    if (Math.abs(candidate.line - self.runMax) <= tolerance && candidate.runMin <= self.line + tolerance && candidate.runMax >= self.line - tolerance) {
      runMax = Math.max(runMax, candidate.line + candidate.halfDepth);
    }
  }
  const flip = self.quarter === 2 || self.quarter === 3 ? -1 : 1;
  return flip > 0
    ? { minU: runMin - self.center, maxU: runMax - self.center }
    : { minU: self.center - runMax, maxU: self.center - runMin };
}

export function placedPieceBands(piece: PlacedBuildPiece, pieces: readonly PlacedBuildPiece[] = [piece]): PlacedPieceBand[] {
  const def = placedPieceDef(piece);
  const size = def.size;
  const { minU, maxU } = wallJoinRunLimits(piece, def, pieces);
  const fullTop = piece.y + size.heightMeters;
  const edit = piece.edit;
  if (edit !== undefined && BUILD_KIND_CONTRACTS[def.kind].edits === 'wall') {
    const meaning = wallEditDefinition(edit);
    if (meaning.portalKind !== 'none') {
      // a doorway/garage/arch cutout: the opening ADMITS bodies — collision
      // splits into the two jamb segments around it (centered opening)
      const opening = meaning.portalKind === 'vehicle'
        ? PLACED_TUNING.vehicleOpeningWidthMeters
        : PLACED_TUNING.walkOpeningWidthMeters;
      const jamb = (size.widthMeters - opening) / 2;
      if (jamb <= 0) return []; // the cutout consumed the whole face
      return [
        { u0: minU, u1: -size.widthMeters / 2 + jamb, top: fullTop },
        { u0: size.widthMeters / 2 - jamb, u1: maxU, top: fullTop },
      ];
    }
    if (edit === 'halfHeight') {
      return [{ u0: minU, u1: maxU, top: piece.y + PLACED_TUNING.halfHeightTopMeters }];
    }
    // window/doubleWindow/brokenWindow: the pane keeps its collision mass —
    // vault traversal (brokenWindow) waits on a mantle system; surfaced, not faked.
  }
  return [{ u0: minU, u1: maxU, top: fullTop }];
}

/**
 * The live-play solids of the placed pieces: every piece whose EFFECTIVE tags
 * carry collision becomes band(s) the host steps against — quarter-turn yaw
 * lands as plain rects, free yaw as oriented rects. Ramps/stairs are NOT here
 * (they are walkable slopes — placedPieceRamps); pieces with no collision tag
 * (bushes, trim, face signs) contribute nothing.
 *
 * RAMPFOOT-0605 (USER VERDICT: "place a ramp and then a wall, you get nudged
 * off at the top because ur standing on the wall not the ramp anymore"):
 * wall-family bands sit ON grid lines, so half their depth overhangs into the
 * adjacent cell — when that cell is a ramp, the overhang strip is a solid
 * whose flat top sits above the slope (a side-block mid-ramp, a step-onto
 * strip at the crest; the host treats every rect top as standable). The fix
 * is in the grammar's own semantics: a ramp OWNS the footing in its plan
 * footprint, so tall thin blockers (wall/fence/railing/pillar/corner/arch)
 * get their bands TRIMMED out of overlapping ramp footprints. Floors/roofs/
 * props keep full collision (a landing plate at the crest is the delivery
 * surface, not a blocker). Free-yaw bands are not trimmed (oriented-rect
 * subtraction needs host support; quarter-turn is the build grammar's case).
 * Known edge: a wall sandwiched between two ramps can trim away entirely —
 * surfaced in CAPTURE.md, not silently special-cased.
 */
const RAMP_TRIM_KINDS: ReadonlySet<BuildPieceKind> = new Set(['wall', 'fence', 'railing', 'pillar', 'corner', 'arch']);

type PlanRect = { minX: number; maxX: number; minZ: number; maxZ: number };
type LocalPlanRect = { minU: number; maxU: number; minV: number; maxV: number };

/** Trim one axis-aligned band out of one ramp footprint: move the cheapest
 *  edge that eliminates the overlap; null = the band degenerated. */
function trimBandRect<R extends PlanRect>(rect: R, ramp: PieceBounds): R | null {
  const ox0 = Math.max(rect.minX, ramp.minX);
  const ox1 = Math.min(rect.maxX, ramp.maxX);
  const oz0 = Math.max(rect.minZ, ramp.minZ);
  const oz1 = Math.min(rect.maxZ, ramp.maxZ);
  if (ox1 <= ox0 || oz1 <= oz0) return rect; // no overlap
  type Move = { key: 'minX' | 'maxX' | 'minZ' | 'maxZ'; value: number; cost: number };
  const moves: Move[] = [];
  if (ramp.minX <= rect.minX) moves.push({ key: 'minX', value: ox1, cost: (ox1 - rect.minX) * (rect.maxZ - rect.minZ) });
  if (ramp.maxX >= rect.maxX) moves.push({ key: 'maxX', value: ox0, cost: (rect.maxX - ox0) * (rect.maxZ - rect.minZ) });
  if (ramp.minZ <= rect.minZ) moves.push({ key: 'minZ', value: oz1, cost: (oz1 - rect.minZ) * (rect.maxX - rect.minX) });
  if (ramp.maxZ >= rect.maxZ) moves.push({ key: 'maxZ', value: oz0, cost: (rect.maxZ - oz0) * (rect.maxX - rect.minX) });
  if (moves.length === 0) return rect; // ramp strictly interior — cannot edge-trim
  moves.sort((a, b) => a.cost - b.cost);
  const out = { ...rect, [moves[0].key]: moves[0].value } as R;
  const min = PLACED_TUNING.rampTrimMinBandMeters;
  if (out.maxX - out.minX <= min || out.maxZ - out.minZ <= min) return null;
  return out;
}

function localRectToAxisRect(piece: PlacedBuildPiece, local: LocalPlanRect): PlanRect {
  const corners = [
    localOffset(local.minU, local.minV, piece.yawDegrees),
    localOffset(local.minU, local.maxV, piece.yawDegrees),
    localOffset(local.maxU, local.minV, piece.yawDegrees),
    localOffset(local.maxU, local.maxV, piece.yawDegrees),
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, piece.x + c.dx);
    maxX = Math.max(maxX, piece.x + c.dx);
    minZ = Math.min(minZ, piece.z + c.dz);
    maxZ = Math.max(maxZ, piece.z + c.dz);
  }
  return { minX, maxX, minZ, maxZ };
}

function pushStairBoundaryRects(
  rects: CollisionRect[],
  orientedRects: OrientedCollisionRect[],
  piece: PlacedBuildPiece,
  def: BuildPieceDef,
): void {
  const size = def.size;
  const halfW = size.widthMeters / 2;
  const halfD = size.depthMeters / 2;
  const wall = PLACED_TUNING.stairBoundaryWallThicknessMeters;
  const top = piece.y + size.heightMeters;
  const localRects: LocalPlanRect[] = [
    // side walls sit outside the walkable slope footprint; their inner face is
    // flush with the ramp edge, so slope walking stays unchanged.
    { minU: -halfW - wall, maxU: -halfW, minV: -halfD, maxV: halfD },
    { minU: halfW, maxU: halfW + wall, minV: -halfD, maxV: halfD },
    // the far/high face is closed for cover from behind; the low approach
    // edge stays open so the slope itself remains walkable.
    { minU: -halfW - wall, maxU: halfW + wall, minV: halfD, maxV: halfD + wall },
  ];
  const base = {
    topMeters: top,
    floorMeters: piece.y,
    blocksPlayer: true,
    friction: PLACED_TUNING.pieceFriction,
    restitution: PLACED_TUNING.pieceRestitution,
  };
  const quarter = quarterTurns(piece.yawDegrees);
  for (const local of localRects) {
    if (quarter !== null) {
      rects.push({ ...base, ...localRectToAxisRect(piece, local) });
    } else {
      orientedRects.push({
        ...base,
        minX: piece.x + local.minU,
        maxX: piece.x + local.maxU,
        minZ: piece.z + local.minV,
        maxZ: piece.z + local.maxV,
        pivotX: piece.x,
        pivotZ: piece.z,
        yawRadians: piece.yawDegrees * DEG,
      });
    }
  }
}

function pushRampSlabEdgeRects(
  rects: (CollisionRect & { ownerIndex?: number })[],
  orientedRects: (OrientedCollisionRect & { ownerIndex?: number })[],
  piece: PlacedBuildPiece,
  def: BuildPieceDef,
  ownerIndex?: number,
): void {
  const size = def.size;
  const halfW = size.widthMeters / 2;
  const halfD = size.depthMeters / 2;
  const edge = PLACED_TUNING.rampSlabEdgePlanThicknessMeters;
  const thickness = PLACED_TUNING.rampSlabThicknessMeters;
  const segments = Math.max(1, Math.round(PLACED_TUNING.rampSlabEdgeSegments));
  const surfaceAt = (v: number): number => piece.y + ((v + halfD) / size.depthMeters) * size.heightMeters;
  const pushLocal = (local: LocalPlanRect, topMeters: number): void => {
    const floorMeters = topMeters - thickness;
    const base = {
      topMeters,
      floorMeters,
      blocksPlayer: true,
      friction: PLACED_TUNING.pieceFriction,
      restitution: PLACED_TUNING.pieceRestitution,
      ...(ownerIndex === undefined ? {} : { ownerIndex }),
    };
    const quarter = quarterTurns(piece.yawDegrees);
    if (quarter !== null) {
      rects.push({ ...base, ...localRectToAxisRect(piece, local) });
    } else {
      orientedRects.push({
        ...base,
        minX: piece.x + local.minU,
        maxX: piece.x + local.maxU,
        minZ: piece.z + local.minV,
        maxZ: piece.z + local.maxV,
        pivotX: piece.x,
        pivotZ: piece.z,
        yawRadians: piece.yawDegrees * DEG,
      });
    }
  };

  for (let i = 0; i < segments; i += 1) {
    const v0 = -halfD + (i / segments) * size.depthMeters;
    const v1 = -halfD + ((i + 1) / segments) * size.depthMeters;
    const topMeters = surfaceAt(v0);
    pushLocal({ minU: -halfW, maxU: halfW, minV: v0, maxV: v1 }, topMeters);
    pushLocal({ minU: -halfW - edge, maxU: -halfW, minV: v0, maxV: v1 }, topMeters);
    pushLocal({ minU: halfW, maxU: halfW + edge, minV: v0, maxV: v1 }, topMeters);
  }

  pushLocal(
    { minU: -halfW - edge, maxU: halfW + edge, minV: halfD, maxV: halfD + edge },
    piece.y + size.heightMeters,
  );
}

export function placedPieceColliders(pieces: readonly PlacedBuildPiece[]): PlacedPieceColliders {
  const rects: CollisionRect[] = [];
  const orientedRects: OrientedCollisionRect[] = [];
  // ramp plan footprints (quarter-turn exact; free-yaw ramps fall back to
  // their envelope — bounds() already covers both)
  const rampPlans: PieceBounds[] = [];
  for (const piece of pieces) {
    const kind = placedPieceDef(piece).kind;
    if (kind === 'ramp' || kind === 'stairs') rampPlans.push(pieceBounds(piece));
  }
  for (const piece of pieces) {
    const def = placedPieceDef(piece);
    if (def.kind === 'ramp' || def.kind === 'stairs') {
      if (placedPieceTags(piece).collision) {
        if (def.kind === 'ramp') pushRampSlabEdgeRects(rects, orientedRects, piece, def);
        else pushStairBoundaryRects(rects, orientedRects, piece, def);
      }
      continue;
    }
    if (!placedPieceTags(piece).collision) continue;
    const size = def.size;
    const halfD = size.depthMeters / 2;
    const quarter = quarterTurns(piece.yawDegrees);
    for (const band of placedPieceBands(piece, pieces)) {
      const base = {
        topMeters: band.top,
        floorMeters: piece.y,
        blocksPlayer: true,
        friction: PLACED_TUNING.pieceFriction,
        restitution: PLACED_TUNING.pieceRestitution,
      };
      if (quarter !== null) {
        // band [u0,u1] runs along local width; quarter turns map it onto x or z
        const centerU = (band.u0 + band.u1) / 2;
        const halfU = (band.u1 - band.u0) / 2;
        const along = quarter % 2 === 0 ? 'x' : 'z';
        const flip = quarter === 2 || quarter === 3 ? -1 : 1;
        const cu = centerU * flip;
        let rect: CollisionRect | null = along === 'x'
          ? { ...base, minX: piece.x + cu - halfU, maxX: piece.x + cu + halfU, minZ: piece.z - halfD, maxZ: piece.z + halfD }
          : { ...base, minX: piece.x - halfD, maxX: piece.x + halfD, minZ: piece.z + cu - halfU, maxZ: piece.z + cu + halfU };
        // RAMPFOOT-0605: the ramp owns footing in its footprint — trim the
        // band where it coexists with a slope (band base below the ramp top;
        // an upper-storey wall whose base IS the crest blocks legitimately)
        if (RAMP_TRIM_KINDS.has(def.kind)) {
          for (const ramp of rampPlans) {
            if (rect === null) break;
            if (piece.y >= ramp.topY - 1e-6) continue;
            rect = trimBandRect(rect, ramp);
          }
        }
        if (rect !== null) rects.push(rect);
      } else {
        orientedRects.push({
          ...base,
          minX: piece.x + band.u0,
          maxX: piece.x + band.u1,
          minZ: piece.z - halfD,
          maxZ: piece.z + halfD,
          pivotX: piece.x,
          pivotZ: piece.z,
          yawRadians: piece.yawDegrees * DEG,
        });
      }
    }
  }
  return { rects, orientedRects };
}

export function placedPieceCameraOccluders(pieces: readonly PlacedBuildPiece[]): PlacedPieceCameraOccluders {
  const rects: CameraOcclusionRect[] = [];
  const orientedRects: CameraOcclusionOrientedRect[] = [];
  const ownerIds: string[] = [];
  for (const piece of pieces) {
    const def = placedPieceDef(piece);
    const tags = placedPieceTags(piece);
    if (def.kind === 'ramp') {
      if (!tags.collision || !tags.blocksSight) continue;
      const ownerIndex = ownerIds.push(piece.id);
      pushRampSlabEdgeRects(rects, orientedRects, piece, def, ownerIndex);
      continue;
    }
    if (def.kind !== 'wall' && def.kind !== 'roof') continue;
    if (!tags.collision || (!tags.blocksSight && def.kind !== 'roof')) continue;
    const ownerIndex = ownerIds.push(piece.id);
    const size = def.size;
    const halfD = size.depthMeters / 2;
    const quarter = quarterTurns(piece.yawDegrees);
    for (const band of placedPieceBands(piece, pieces)) {
      const base = {
        topMeters: band.top,
        floorMeters: piece.y,
        blocksPlayer: true,
        friction: PLACED_TUNING.pieceFriction,
        restitution: PLACED_TUNING.pieceRestitution,
        ownerIndex,
      };
      if (quarter !== null) {
        const centerU = (band.u0 + band.u1) / 2;
        const halfU = (band.u1 - band.u0) / 2;
        const along = quarter % 2 === 0 ? 'x' : 'z';
        const flip = quarter === 2 || quarter === 3 ? -1 : 1;
        const cu = centerU * flip;
        rects.push(along === 'x'
          ? { ...base, minX: piece.x + cu - halfU, maxX: piece.x + cu + halfU, minZ: piece.z - halfD, maxZ: piece.z + halfD }
          : { ...base, minX: piece.x - halfD, maxX: piece.x + halfD, minZ: piece.z + cu - halfU, maxZ: piece.z + cu + halfU });
      } else {
        orientedRects.push({
          ...base,
          minX: piece.x + band.u0,
          maxX: piece.x + band.u1,
          minZ: piece.z - halfD,
          maxZ: piece.z + halfD,
          pivotX: piece.x,
          pivotZ: piece.z,
          yawRadians: piece.yawDegrees * DEG,
        });
      }
    }
  }
  return { rects, orientedRects, ownerIds };
}

/**
 * Ramps and stairs as walkable slopes: each bakes a small heightfield rising
 * along its local depth (a ramp knows it connects floors — V24), rotated into
 * place via the host's heightfield yaw frame. Slots start AFTER the world's
 * own terrain slots — the caller passes where the world bake stopped.
 */
export function placedPieceRamps(pieces: readonly PlacedBuildPiece[], startSlot: number): Heightfield[] {
  const fields: Heightfield[] = [];
  for (const piece of pieces) {
    const def = placedPieceDef(piece);
    if (def.kind !== 'ramp' && def.kind !== 'stairs') continue;
    const size = def.size;
    const cell = PLACED_TUNING.verticalLinkHeightfieldCellMeters;
    const cols = Math.max(2, Math.round(size.widthMeters / cell) + 1);
    const rows = Math.max(2, Math.round(size.depthMeters / cell) + 1);
    const heights = new Float32Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      const h = (row / (rows - 1)) * size.heightMeters;
      for (let col = 0; col < cols; col += 1) heights[row * cols + col] = h;
    }
    fields.push({
      slot: startSlot + fields.length,
      originX: piece.x - size.widthMeters / 2,
      originZ: piece.z - size.depthMeters / 2,
      cellSizeMeters: cell,
      cols,
      rows,
      baseY: piece.y,
      walkableSlopeCos: PLACED_TUNING.rampWalkableSlopeCos,
      heights,
      yawRadians: piece.yawDegrees * DEG,
      pivotX: piece.x,
      pivotZ: piece.z,
    });
  }
  return fields;
}

// ── prefab stamping + clone-from-world capture ───────────────────────────────

/**
 * Stamp a prefab into the world: the rotation-aware twin of decomposePrefab —
 * locals rotate about the prefab origin, piece yaw composes with the stamp
 * yaw. SAME see-through law: a stamp IS its semantic pieces (the stream
 * materializer appends each one individually; instance edits stay
 * piece-granular). At yawDegrees 0 this is exactly decomposePrefab's placement.
 */
export function stampPrefabPieces(
  prefab: BuildPrefabDef,
  origin: { x: number; y: number; z: number },
  yawDegrees: number,
): Array<Omit<PlacedBuildPiece, 'id'>> {
  const yawRadians = normalizeYaw(yawDegrees) * DEG;
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  // R(+yaw), the SAME frame raycastPieces/placedPieceColliders rotate a
  // piece's own body with — composition turn and piece spin must agree or
  // a turned stamp pulls its walls off its corners
  return prefab.pieces.map((piece, index) => {
    const kind = catalogEntry(piece.pieceId).kind;
    const skin: BuildSkinSet = {};
    for (const slot of BUILD_FACE_SLOTS) {
      const resolved = resolveFaceSkin(prefab.skins, kind, piece.skin, slot).skin;
      if (resolved) skin[slot] = resolved;
    }
    return {
      pieceId: piece.pieceId,
      x: origin.x + piece.x * cos - piece.z * sin,
      y: origin.y + piece.y,
      z: origin.z + piece.x * sin + piece.z * cos,
      yawDegrees: normalizeYaw(piece.yawDegrees + yawDegrees),
      ...(piece.edit !== undefined ? { edit: piece.edit } : {}),
      ...(Object.keys(skin).length > 0 ? { skin } : {}),
      prefabId: prefab.id,
      prefabPieceIndex: index,
    };
  });
}

/** `prefab.<slug>` from a user-facing name (the catalog id convention). */
export function mintPrefabId(name: string): string {
  const slug = name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
  return `prefab.${slug || 'unnamed'}`;
}

/**
 * Clone-from-world: a marked composition of placed pieces becomes a named
 * prefab definition — locals relative to the composition's min corner (so a
 * stamp at that corner reproduces it exactly), edits carried. The result is
 * the SAME BuildPrefabDef family as the static seeds (P2 data; world-saved
 * via the V20 stream's prefabDefined event).
 */
export function prefabFromPieces(
  id: string,
  label: string,
  theme: BuildPrefabDef['theme'],
  pieces: readonly PlacedBuildPiece[],
): BuildPrefabDef {
  let originX = Infinity;
  let originY = Infinity;
  let originZ = Infinity;
  for (const piece of pieces) {
    originX = Math.min(originX, piece.x);
    originY = Math.min(originY, piece.y);
    originZ = Math.min(originZ, piece.z);
  }
  if (pieces.length === 0) {
    originX = 0;
    originY = 0;
    originZ = 0;
  }
  const locals: PrefabPiece[] = pieces.map((piece) => ({
    pieceId: piece.pieceId,
    x: piece.x - originX,
    y: piece.y - originY,
    z: piece.z - originZ,
    yawDegrees: normalizeYaw(piece.yawDegrees),
    ...(piece.edit !== undefined ? { edit: piece.edit } : {}),
    ...(piece.skin !== undefined ? { skin: piece.skin } : {}),
  }));
  return { id, label, theme, pieces: locals };
}

/** Boundary validation for a to-be-appended placement (the stream materializer
 *  is tolerant by contract; the AUTHORING side validates before it appends). */
// Flat-pad terrain lift (USER RULING req_0444: "sit on a flat pad"). A building is
// lifted as ONE rigid pad so its lowest piece sits on the terrain height under the
// group's footprint centre — paint a hill and the building rides up with it, staying
// level (it never warps or tilts). PURE and IDEMPOTENT: it reads the stored
// (terrain-agnostic) y and returns lifted copies, so it can be applied at every
// consumption site (editor render, F2 collide, compile) without the editor and game ever
// drifting, and re-applying it is a no-op (a lifted group's min already equals the
// terrain, so the next offset is 0). Stored data is never mutated, so editing a building
// reads the raw y and this re-lifts the result — no double-lift.
//
// A "building" is a GROUP: prefab pieces group by stampId; hand-built pieces (no stampId)
// group by CONNECTED COMPONENT (bounds-touching, the same adjacency "smart select" uses),
// so a structure you laid out piece-by-piece flat-pads exactly like a prefab and a lone
// piece sits on the ground under it. The component pass is O(loose²) bounds-touch but
// runs only when pieces/terrain change (callers memoize), which is fine at editor scale.
export function liftBuildingsToTerrain<T extends PlacedBuildPiece>(
  pieces: readonly T[],
  terrainAt: (x: number, z: number) => number,
): T[] {
  const groups: T[][] = [];
  const stamped = new Map<string, T[]>();
  const loose: T[] = [];
  for (const p of pieces) {
    if (p.stampId) { const g = stamped.get(p.stampId); if (g) g.push(p); else stamped.set(p.stampId, [p]); }
    else loose.push(p);
  }
  for (const g of stamped.values()) groups.push(g);
  // Union loose pieces into connected structures (union-find over bounds-touch).
  if (loose.length) {
    const bounds = loose.map((p) => pieceBounds(p));
    const parent = loose.map((_, i) => i);
    const find = (i: number): number => { let r = i; while (parent[r] !== r) r = parent[r]; while (parent[i] !== r) { const n = parent[i]; parent[i] = r; i = n; } return r; };
    const tol = PLACED_TUNING.touchToleranceMeters;
    for (let i = 0; i < loose.length; i += 1) {
      for (let j = i + 1; j < loose.length; j += 1) {
        if (boundsTouch(bounds[i], bounds[j], tol)) parent[find(i)] = find(j);
      }
    }
    const byRoot = new Map<number, T[]>();
    for (let i = 0; i < loose.length; i += 1) { const r = find(i); const g = byRoot.get(r); if (g) g.push(loose[i]); else byRoot.set(r, [loose[i]]); }
    for (const g of byRoot.values()) groups.push(g);
  }
  const out: T[] = [];
  for (const g of groups) {
    let sx = 0, sz = 0, minY = Infinity;
    for (const p of g) { sx += p.x; sz += p.z; if (p.y < minY) minY = p.y; }
    const offset = terrainAt(sx / g.length, sz / g.length) - minY;
    if (Math.abs(offset) < 1e-6) { for (const p of g) out.push(p); }
    else for (const p of g) out.push({ ...p, y: p.y + offset });
  }
  return out;
}

export function validatePlacement(placement: Omit<PlacedBuildPiece, 'id'>): string[] {
  const problems: string[] = [];
  if (!isCatalogId(placement.pieceId)) {
    return [`unknown catalog piece '${placement.pieceId}'`];
  }
  if (placement.edit !== undefined && BUILD_KIND_CONTRACTS[catalogEntry(placement.pieceId).kind].edits !== 'wall') {
    problems.push(`kind '${catalogEntry(placement.pieceId).kind}' accepts no edits`);
  }
  if (!Number.isFinite(placement.x) || !Number.isFinite(placement.y) || !Number.isFinite(placement.z)) {
    problems.push('placement position must be finite meters');
  }
  return problems;
}
