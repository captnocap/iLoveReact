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
import type { CollisionRect, Heightfield, OrientedCollisionRect } from '../physics';

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
  /** RAMPFOOT-0605: degenerate-band floor when trimming wall overhangs out of
   *  ramp footprints — a trimmed band thinner than this is dropped, meters */
  rampTrimMinBandMeters: 0.01,
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
  const size = placedPieceDef(piece).size;
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

/** One solid band in the piece's own frame: [u0,u1] along the piece width,
 *  full depth, with its own top. Split points come from the edit's opening. */
type Band = { u0: number; u1: number; top: number };

function pieceBands(piece: PlacedBuildPiece, def: BuildPieceDef): Band[] {
  const size = def.size;
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
        { u0: -size.widthMeters / 2, u1: -size.widthMeters / 2 + jamb, top: fullTop },
        { u0: size.widthMeters / 2 - jamb, u1: size.widthMeters / 2, top: fullTop },
      ];
    }
    if (edit === 'halfHeight') {
      return [{ u0: -size.widthMeters / 2, u1: size.widthMeters / 2, top: piece.y + PLACED_TUNING.halfHeightTopMeters }];
    }
    // window/doubleWindow/brokenWindow: the pane keeps its collision mass —
    // vault traversal (brokenWindow) waits on a mantle system; surfaced, not faked.
  }
  return [{ u0: -size.widthMeters / 2, u1: size.widthMeters / 2, top: fullTop }];
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
    if (def.kind === 'ramp' || def.kind === 'stairs') continue; // slopes, not bands
    if (!placedPieceTags(piece).collision) continue;
    const size = def.size;
    const halfD = size.depthMeters / 2;
    const quarter = quarterTurns(piece.yawDegrees);
    for (const band of pieceBands(piece, def)) {
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
    const cols = 2;
    const rows = 2;
    // rise along local depth: back edge at base, front edge at full height
    const heights = new Float32Array([0, 0, size.heightMeters, size.heightMeters]);
    fields.push({
      slot: startSlot + fields.length,
      originX: piece.x - size.widthMeters / 2,
      originZ: piece.z - size.depthMeters / 2,
      cellSizeMeters: size.depthMeters / (rows - 1),
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
  return prefab.pieces.map((piece) => ({
    pieceId: piece.pieceId,
    x: origin.x + piece.x * cos - piece.z * sin,
    y: origin.y + piece.y,
    z: origin.z + piece.x * sin + piece.z * cos,
    yawDegrees: normalizeYaw(piece.yawDegrees + yawDegrees),
    ...(piece.edit !== undefined ? { edit: piece.edit } : {}),
  }));
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
  }));
  return { id, label, theme, pieces: locals };
}

/** Boundary validation for a to-be-appended placement (the stream materializer
 *  is tolerant by contract; the AUTHORING side validates before it appends). */
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
