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
  ROOF_PITCH,
  type BuildPieceDef,
  type RoofShape,
} from './catalog';
import { BUILD_KIND_CONTRACTS, type BuildGameplayTags, type BuildPieceKind } from './pieces';
import { propDynamics, propKindDefinition } from '../kinds';
import type { PropKind } from '../kinds/props';
import { propCollisionBoxes, propModelFootprintMeters, propVerticalBand } from '../../compile/propRecipes/footprint';
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
  /** Runtime state for interactive door-family edits. Undefined = the edit's
   *  default state (door/garageDoor default closed); true = open. This is live
   *  state, not prefab-authoring structure. */
  doorOpen?: boolean;
  /** resolved per-face skin/material snapshot for this placed instance */
  skin?: BuildSkinSet;
  /** PROPSKIN-0766: per-PART texture overrides for a placed PROP piece (kind
   *  'prop') — partId → TEXTURE_REGISTRY id, the WorldProp.partTextures channel.
   *  A prop has named parts (a vending front, a chassis) rather than the
   *  front/back/sides `skin` slots, so it carries this map instead. */
  partTextures?: Record<string, string>;
  /** PARAMETRIC props (req_0893): per-instance text for a parametric prop kind
   *  (a block-letter business name, a neon caption, an LED ticker message). The
   *  prop's recipe lowers it to geometry/material; non-parametric kinds ignore
   *  it. Rides into the rendered WorldProp the same way `partTextures` does. */
  text?: string;
  /** prefab stamp group id, when this piece came from one prefabStamped event */
  stampId?: string;
  /** source prefab id for stamped pieces, so type-skin edits can refresh live instances */
  prefabId?: string;
  /** source piece index inside the prefab definition */
  prefabPieceIndex?: number;
  /** ROOFSPAN (req_0917): a roof placed by the Roof drag tool covers a whole
   *  base floor, not one 3×3 plate. The dragged footprint (meters) overrides
   *  the catalog row's `size` width/depth for THIS placement — the profile
   *  (gable ridge / shed slope / hip apex) scales to fit it. Roof-kind only;
   *  absent = the catalog plate size (a single-click roof tile). */
  roofSpan?: { widthMeters: number; depthMeters: number };
  /** FLOOR 3×3 micro-grid (MICROGRID-0610): 9 row-major authored cell kinds,
   *  null = the material default. Floor-family kinds only; absent = a bare
   *  floor. See game/build/microGrid.ts for semantics + resolution. */
  cells?: (import('../kinds').TileKind | null)[];
};

// ── P2 tuning: every behavior-affecting number is table data ─────────────────
// (the WORLD_TUNING convention — named rows, never literals in logic)

export const PLACED_TUNING = {
  /** a walk portal's traversable opening (door/arch cutouts), meters */
  walkOpeningWidthMeters: 1.2,
  /** a vehicle portal's opening (garage door), meters */
  vehicleOpeningWidthMeters: 2.6,
  /** closed door panels fill only the portal opening, not the wall jambs */
  walkDoorPanelHeightMeters: 2.2,
  garageDoorPanelHeightMeters: 2.8,
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
  /** Stairs lower to this many visible step boxes in every renderer. This is
   *  presentation, but it must live with placed-build semantics so editor and
   *  compiled game never drift into different stair models. */
  stairVisualSteps: 10,
  /** ── ELEVATOR (REQ-0647): the moving vertical link ─────────────────────
   *  One catalog module per storey; stacked modules form a SHAFT whose car
   *  serves one stop per storey (game/build/elevators.ts derives both). The
   *  shaft is an open-front frame: back + side walls collide, the front face
   *  stays open so a body walks onto the car. */
  elevatorShaftWallThicknessMeters: 0.12,
  elevatorPostSizeMeters: 0.18,
  /** the visual beam over the open front (reads as the shaft doorway) */
  elevatorHeaderHeightMeters: 0.35,
  /** the car: a platform slab; its TOP surface = stop level + this thickness
   *  (matches the 0.2m floor-plate top at each storey within a step) */
  elevatorCarFloorThicknessMeters: 0.22,
  /** the car sits this far inside the shaft's inner walls on every side */
  elevatorCarInsetMeters: 0.06,
  elevatorCarSpeedMetersPerSecond: 2.2,
  /** stacked storeys whose seams sit within this are ONE shaft */
  elevatorStackToleranceMeters: 0.05,
  /** |carY - stop| under this = the car has arrived */
  elevatorArriveToleranceMeters: 0.02,
  /** how far above/below a stop a body can stand and still board/call */
  elevatorBoardVerticalReachMeters: 1.2,
  /** horizontal reach for calling the car from a landing */
  elevatorCallReachMeters: 2.8,
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

/** The placed piece's EFFECTIVE plan size — the catalog row's `size` with a
 *  roof's dragged footprint (ROOFSPAN, req_0917) substituted for width/depth.
 *  ONE source so visuals, bounds, snap and colliders all read the same span. */
export function placedPieceSize(piece: PlacedBuildPiece): BuildPieceDef['size'] {
  const size = placedPieceDef(piece).size;
  if (piece.roofSpan && piece.roofSpan.widthMeters > 0 && piece.roofSpan.depthMeters > 0) {
    return { widthMeters: piece.roofSpan.widthMeters, heightMeters: size.heightMeters, depthMeters: piece.roofSpan.depthMeters };
  }
  return size;
}

/** A pitched roof's effective PROFILE (shape + pitch), the one place the
 *  defaults resolve. Non-roof / flat rows report shape 'flat', rise 0. */
export function placedRoofProfile(piece: PlacedBuildPiece): { shape: RoofShape; pitch: number } {
  const def = placedPieceDef(piece);
  if (def.kind !== 'roof') return { shape: 'flat', pitch: 0 };
  return { shape: def.roofShape ?? 'flat', pitch: def.roofPitch ?? ROOF_PITCH.semiSlant };
}

/** The vertical rise of a placed roof's ridge/apex above its eave, scaled to
 *  the footprint span (req_0917). 0 for flat roofs and non-roof pieces. The run
 *  is the horizontal distance eave→ridge: full depth (shed), half depth
 *  (gable), or half the short footprint axis (hip/pyramid). ONE source for
 *  bounds, stacking, and the pieceShapes decomposition. */
export function roofRiseMeters(piece: PlacedBuildPiece): number {
  const { shape, pitch } = placedRoofProfile(piece);
  if (shape === 'flat') return 0;
  const size = placedPieceSize(piece);
  const run = shape === 'shed' ? size.depthMeters
    : shape === 'gable' ? size.depthMeters / 2
    : Math.min(size.widthMeters, size.depthMeters) / 2; // hip / pyramid
  return Math.max(0, pitch * run);
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

// WALLTOP (req_0099 / req_1477/1478): wall-family pieces ALWAYS rest on the
// floor at their cell, never on its side at ground Y. The prior fix patched one
// placement path and line-drawn / floor-after-wall placements slipped through;
// the durable cure derives the rest-Y at geometry time (render + collision) so
// no placement path can miss it. This is a READ-TIME projection — the stored Y
// is left untouched, so editing/selection never double-lifts, and it is
// idempotent (a wall already on its floor is unchanged). Delete the floor and
// the wall drops back to ground for free (no floor → no lift).
const WALL_REST_KINDS: ReadonlySet<BuildPieceKind> = new Set(['wall', 'fence', 'railing', 'pillar', 'corner', 'arch']);
// A floor counts as "under" a wall when its top sits at/just above the wall's
// authored base (same storey) — not a plate a full storey below. 1.5m is well
// under a 3m storey and well over any floor thickness.
const WALL_REST_MAX_RISE_METERS = 1.5;
const WALL_REST_EPSILON_METERS = 0.02;

/** The Y a wall-family piece should REST at: the top of the highest floor/roof
 *  plate overlapping its footprint at its own storey, else its authored Y. */
export function liftedWallBaseY(piece: PlacedBuildPiece, pieces: readonly PlacedBuildPiece[]): number {
  if (!WALL_REST_KINDS.has(placedPieceDef(piece).kind)) return piece.y;
  const wall = pieceBounds(piece);
  let restY = piece.y;
  for (const other of pieces) {
    if (other === piece || other.id === piece.id) continue;
    if (!isSupportPlate(placedPieceDef(other).kind)) continue;
    const plate = pieceBounds(other);
    if (Math.min(wall.maxX, plate.maxX) <= Math.max(wall.minX, plate.minX)) continue; // no plan overlap (x)
    if (Math.min(wall.maxZ, plate.maxZ) <= Math.max(wall.minZ, plate.minZ)) continue; // no plan overlap (z)
    if (plate.topY < piece.y - WALL_REST_EPSILON_METERS) continue; // below the wall — not its floor
    if (plate.topY > piece.y + WALL_REST_MAX_RISE_METERS) continue; // a storey up — not its floor
    if (plate.topY > restY) restY = plate.topY;
  }
  return restY;
}

/** The piece list with every wall-family piece lifted onto the floor beneath it
 *  (READ-TIME — geometry/collision only; stored data is unchanged). Idempotent. */
export function liftWallsOntoFloors(pieces: readonly PlacedBuildPiece[]): PlacedBuildPiece[] {
  let changed = false;
  const out = pieces.map((piece) => {
    const restY = liftedWallBaseY(piece, pieces);
    if (restY <= piece.y + WALL_REST_EPSILON_METERS) return piece;
    changed = true;
    return { ...piece, y: restY };
  });
  return changed ? out : pieces.slice();
}

export type PlacedPieceDepthSpan = { minV: number; maxV: number };

/** Axis-aligned world envelope of a placed piece (exact for quarter-turn yaw,
 *  the rotated envelope otherwise). */
export function pieceBounds(piece: PlacedBuildPiece): PieceBounds {
  const size = placedPieceSize(piece);
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
    // A pitched roof's envelope tops out at the ridge/apex, not its eave plate.
    topY: piece.y + Math.max(size.heightMeters, roofRiseMeters(piece)),
  };
}

/** The prop-LOCAL vertical band [minY,maxY] of a prop's actual mesh (anchor at 0,
 *  Y up from the ground it rests on) — the SAME lifted local coords the mesh renders
 *  and the colliders use (placedPieceColliders ~1057). Cooked Studio props author it as
 *  `collisionBoxes`; data-recipe props derive it from their parts. null ⇒ no off-ground
 *  geometry, so the legacy ground-to-top band applies. */
function propLocalYBand(kind: PropKind): { minY: number; maxY: number } | null {
  const boxes = propKindDefinition(kind).collisionBoxes ?? propCollisionBoxes(kind);
  if (boxes && boxes.length) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const b of boxes) {
      if (b.minY < minY) minY = b.minY;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    if (Number.isFinite(minY) && maxY > minY) return { minY, maxY };
  }
  const band = propVerticalBand(kind);
  return band ? { minY: band.baseY, maxY: band.baseY + band.height } : null;
}

/** The VISUAL world envelope used for selection/highlight. Identical to pieceBounds
 *  EXCEPT a prop whose mesh sits OFF the ground (a Studio prop exported elevated, or a
 *  walk-under shape) is lifted to its real vertical band, so the selection outline wraps
 *  where the mesh actually renders instead of a ground-anchored box one storey too low
 *  (req_1902). X/Z stay the footprint envelope; only the Y band moves. */
export function pieceVisualBounds(piece: PlacedBuildPiece): PieceBounds {
  const base = pieceBounds(piece);
  const def = placedPieceDef(piece);
  if (def.kind === 'prop' && def.propKind) {
    const band = propLocalYBand(def.propKind);
    if (band) return { ...base, baseY: piece.y + band.minY, topY: piece.y + band.maxY };
  }
  return base;
}

// ── SMARTSEL-0605: the connected shape under one click ───────────────────────

function boundsTouch(a: PieceBounds, b: PieceBounds, tolerance: number): boolean {
  return (
    a.minX <= b.maxX + tolerance && b.minX <= a.maxX + tolerance &&
    a.minZ <= b.maxZ + tolerance && b.minZ <= a.maxZ + tolerance &&
    a.baseY <= b.topY + tolerance && b.baseY <= a.topY + tolerance
  );
}

// ── PLACEPERF-0610: spatial grid over piece footprints ───────────────────────
// Every neighbor question in this file (wall depth spans, wall-end joins,
// smart-select adjacency, flat-pad grouping) is LOCAL — the 3m module pitch
// means a piece only interacts with pieces within a cell or two. These used to
// scan the whole piece array per piece (O(N²): ~970ms/frame at 785 pieces, the
// PLACEFREEZE visualBoxes stall). The grid is built ONCE per distinct pieces
// array (O(N)) and cached on the array identity, so per-piece queries are O(k).
// Predicates re-check exactly; the grid only shrinks the candidate set.

const GRID_CELL_METERS = 4; // ≥ the 3m module pitch; pieces span few cells

type PieceGridEntry = { piece: PlacedBuildPiece; bounds: PieceBounds };
type PieceGrid = Map<string, PieceGridEntry[]>;

const pieceGridCache = new WeakMap<readonly PlacedBuildPiece[], PieceGrid>();

function pieceGridOf(pieces: readonly PlacedBuildPiece[]): PieceGrid {
  let grid = pieceGridCache.get(pieces);
  if (grid) return grid;
  grid = new Map();
  for (const piece of pieces) {
    const entry: PieceGridEntry = { piece, bounds: pieceBounds(piece) };
    const ix0 = Math.floor(entry.bounds.minX / GRID_CELL_METERS);
    const ix1 = Math.floor(entry.bounds.maxX / GRID_CELL_METERS);
    const iz0 = Math.floor(entry.bounds.minZ / GRID_CELL_METERS);
    const iz1 = Math.floor(entry.bounds.maxZ / GRID_CELL_METERS);
    for (let ix = ix0; ix <= ix1; ix += 1) {
      for (let iz = iz0; iz <= iz1; iz += 1) {
        const key = `${ix},${iz}`;
        const cell = grid.get(key);
        if (cell) cell.push(entry); else grid.set(key, [entry]);
      }
    }
  }
  pieceGridCache.set(pieces, grid);
  return grid;
}

/** Pieces whose footprint MAY overlap the world rect (superset — callers keep
 *  their exact predicates). Entries spanning cells are deduped via the Set. */
function piecesNear(
  pieces: readonly PlacedBuildPiece[],
  minX: number, maxX: number, minZ: number, maxZ: number,
  out: Set<PieceGridEntry> = new Set(),
): Set<PieceGridEntry> {
  const grid = pieceGridOf(pieces);
  const ix0 = Math.floor(minX / GRID_CELL_METERS);
  const ix1 = Math.floor(maxX / GRID_CELL_METERS);
  const iz0 = Math.floor(minZ / GRID_CELL_METERS);
  const iz1 = Math.floor(maxZ / GRID_CELL_METERS);
  for (let ix = ix0; ix <= ix1; ix += 1) {
    for (let iz = iz0; iz <= iz1; iz += 1) {
      const cell = grid.get(`${ix},${iz}`);
      if (cell) for (const entry of cell) out.add(entry);
    }
  }
  return out;
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
  out.add(seedId);
  const queue = [pieceBounds(seed)];
  while (queue.length > 0) {
    const current = queue.pop()!;
    // Grid-local candidates only (PLACEPERF-0610): touching is bounded by the
    // tolerance, so anything outside the expanded envelope can't touch.
    const near = piecesNear(
      pieces,
      current.minX - toleranceMeters, current.maxX + toleranceMeters,
      current.minZ - toleranceMeters, current.maxZ + toleranceMeters,
    );
    for (const candidate of near) {
      if (out.has(candidate.piece.id)) continue;
      if (boundsTouch(current, candidate.bounds, toleranceMeters)) {
        out.add(candidate.piece.id);
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
    const def = placedPieceDef(piece);
    const size = def.size;
    const depthSpan = placedPieceDepthSpan(piece, pieces);
    const depthCenter = (depthSpan.minV + depthSpan.maxV) / 2;
    const depthSize = depthSpan.maxV - depthSpan.minV;
    const yawRadians = piece.yawDegrees * DEG;
    const cos = Math.cos(-yawRadians);
    const sin = Math.sin(-yawRadians);
    // A prop whose mesh floats off the ground (a hung frame) is pickable where it
    // is DRAWN: its vertical band tracks the geometry (req_1681). Non-props and
    // ground-resting props keep [piece.y, piece.y+heightMeters] — band is null/0.
    const band = def.propKind ? propVerticalBand(def.propKind) : null;
    const baseY = band?.baseY ?? 0;
    const heightY = band?.height ?? size.heightMeters;
    const centerY = piece.y + baseY + heightY / 2;
    // ray → piece frame (translate to center, rotate by -yaw about +Y)
    const relX = ray.origin.x - piece.x;
    const relZ = ray.origin.z - piece.z;
    const ox = relX * cos - relZ * sin;
    const oy = ray.origin.y - centerY;
    const oz = relX * sin + relZ * cos - depthCenter;
    const dx = ray.dir.x * cos - ray.dir.z * sin;
    const dy = ray.dir.y;
    const dz = ray.dir.x * sin + ray.dir.z * cos;
    const half = [size.widthMeters / 2, heightY / 2, depthSize / 2];
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
    baseY: piece.y,
    topY: piece.y + size.heightMeters,
  };
}

function centeredDepthSpan(size: BuildPieceDef['size']): PlacedPieceDepthSpan {
  return { minV: -size.depthMeters / 2, maxV: size.depthMeters / 2 };
}

function isSupportPlate(kind: BuildPieceKind): boolean {
  return kind === 'floor' || kind === 'roof';
}

/** A wall is ALWAYS centered on its grid line (req_1714/1719, USER RULING — the
 *  Sims/Fortnite model). The body is symmetric on the line regardless of which
 *  floors exist, so every wall on a line aligns: horizontal runs that border
 *  different rooms along their length, AND vertical multi-storey stacks with no
 *  floor between storeys (a floorless upper wall used to read centered while the
 *  floor-backed lower wall offset → the stack stepped). The floor extends UNDER
 *  the wall to its outer face (floorWallExtensions, in the floor render) so a
 *  centered wall never overhangs its floor — the "floor sacrifices, not the
 *  wall" resolution. Reverts REQ-0466's offset-onto-floor, which stepped runs
 *  and stacks. (`pieces` kept for signature stability; offset detection gone.) */
export function placedPieceDepthSpan(piece: PlacedBuildPiece, pieces: readonly PlacedBuildPiece[] = [piece]): PlacedPieceDepthSpan {
  void pieces;
  return centeredDepthSpan(placedPieceDef(piece).size);
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number, tolerance: number): boolean {
  return Math.min(a1, b1) >= Math.max(a0, b0) - tolerance;
}

function wallDepthWorldRangeAlong(piece: PlacedBuildPiece, axis: 'x' | 'z', pieces: readonly PlacedBuildPiece[]): { min: number; max: number } {
  const span = placedPieceDepthSpan(piece, pieces);
  const a = localOffset(0, span.minV, piece.yawDegrees);
  const b = localOffset(0, span.maxV, piece.yawDegrees);
  const va = axis === 'x' ? piece.x + a.dx : piece.z + a.dz;
  const vb = axis === 'x' ? piece.x + b.dx : piece.z + b.dz;
  return { min: Math.min(va, vb), max: Math.max(va, vb) };
}

/** A corner join at one end of a wall's run (CORNERSEAM-0610): a perpendicular
 *  wall meets this end with its run entirely on ONE side, leaving the opposite
 *  side an exposed (convex) corner. `outerV` is that exposed side as a local
 *  ±v sign — the face slab on that side is the one the renderer miters.
 *  `squareU` is the local-u CENTER of the corner square the miter must fill —
 *  the midpoint of the joining wall's depth band projected onto this run. It
 *  tracks where the partner's body actually sits (centered walls land on the
 *  line; floor-offset walls sit half a thickness to one side), so the miter
 *  lands on the real crossing instead of a hardcoded half-thickness guess. A
 *  T-junction (runs on both sides) exposes nothing and reports null. */
export type WallEndJoin = { outerV: 1 | -1; squareU: number };
export type WallEnds = { axis: 'x' | 'z' | null; minU: WallEndJoin | null; maxU: WallEndJoin | null };
const NO_WALL_ENDS: WallEnds = { axis: null, minU: null, maxU: null };

function wallJoinRunLimits(
  piece: PlacedBuildPiece,
  def: BuildPieceDef,
  pieces: readonly PlacedBuildPiece[],
): { minU: number; maxU: number; ends: WallEnds } {
  const self = wallRunFrame(piece, def);
  if (!self) return { minU: -def.size.widthMeters / 2, maxU: def.size.widthMeters / 2, ends: NO_WALL_ENDS };
  const tolerance = PLACED_TUNING.wallJoinToleranceMeters;
  // Per world end: did a perpendicular wall join, and which side(s) of this
  // wall's line does its run occupy (one side = corner, both = T-junction).
  const sideTol = PLACED_TUNING.touchToleranceMeters;
  const restY = (p: PlacedBuildPiece): number => liftedWallBaseY(p, pieces);
  let extMin = self.runMin, extMax = self.runMax;
  let minJoined = false, minPos = false, minNeg = false;
  let maxJoined = false, maxPos = false, maxNeg = false;
  // World center (along this run) of the corner square each end must miter —
  // the midpoint of the joining wall's depth band. Defaults to the run end (the
  // partner's line) until a join refines it to where the partner body sits.
  let minSqCenter = self.runMin, maxSqCenter = self.runMax;
  // An end a COLLINEAR same-line wall reaches and passes (or meets flush) is a
  // CONTINUATION, not a corner: the neighbor owns the geometry beyond, so
  // extending/mitering there would double it (coplanar slabs → z-fight).
  let minOwned = false, maxOwned = false;
  // Grid-local candidates (PLACEPERF-0610): a joining perpendicular wall's
  // body contains one of this wall's run ENDPOINTS — query around both.
  const margin = 0.5;
  const endA = self.axis === 'x' ? { x: self.runMin, z: self.line } : { x: self.line, z: self.runMin };
  const endB = self.axis === 'x' ? { x: self.runMax, z: self.line } : { x: self.line, z: self.runMax };
  const near = piecesNear(pieces, endA.x - margin, endA.x + margin, endA.z - margin, endA.z + margin);
  piecesNear(pieces, endB.x - margin, endB.x + margin, endB.z - margin, endB.z + margin, near);
  for (const entry of near) {
    const other = entry.piece;
    if (other.id === piece.id) continue;
    const otherDef = placedPieceDef(other);
    const candidate = wallRunFrame(other, otherDef);
    if (!candidate) continue;
    if (!rangesOverlap(self.baseY, self.topY, candidate.baseY, candidate.topY, tolerance)) continue;
    if (candidate.axis === self.axis) {
      if (Math.abs(candidate.line - self.line) > tolerance) continue;
      if (candidate.runMax >= self.runMin - tolerance && candidate.runMin < self.runMin - sideTol) minOwned = true;
      if (candidate.runMin <= self.runMax + tolerance && candidate.runMax > self.runMax + sideTol) maxOwned = true;
      continue;
    }
    // Run EXTENSION (collider closes the join gap) reads the partner's raw band
    // — unchanged behavior. The miter SQUARE center, though, must match where
    // the partner's body actually RENDERS: lifted onto its own floor (WALLTOP),
    // the same depthSpan pieceVisualShapes resolves. A floor-offset partner read
    // raw reports centered, so the two paired triangles would drift apart.
    const candidateDepth = wallDepthWorldRangeAlong(other, self.axis, pieces);
    const otherRest = other.y === restY(other) ? other : { ...other, y: restY(other) };
    const candidateDepthRest = otherRest === other ? candidateDepth : wallDepthWorldRangeAlong(otherRest, self.axis, pieces);
    if (Math.abs(candidate.line - self.runMin) <= tolerance && candidate.runMin <= self.line + tolerance && candidate.runMax >= self.line - tolerance) {
      extMin = Math.min(extMin, candidateDepth.min);
      minSqCenter = (candidateDepthRest.min + candidateDepthRest.max) / 2;
      minJoined = true;
      if (candidate.runMin >= self.line - sideTol) minPos = true;
      else if (candidate.runMax <= self.line + sideTol) minNeg = true;
      else { minPos = true; minNeg = true; } // straddles the line: a T
    }
    if (Math.abs(candidate.line - self.runMax) <= tolerance && candidate.runMin <= self.line + tolerance && candidate.runMax >= self.line - tolerance) {
      extMax = Math.max(extMax, candidateDepth.max);
      maxSqCenter = (candidateDepthRest.min + candidateDepthRest.max) / 2;
      maxJoined = true;
      if (candidate.runMin >= self.line - sideTol) maxPos = true;
      else if (candidate.runMax <= self.line + sideTol) maxNeg = true;
      else { maxPos = true; maxNeg = true; }
    }
  }
  const runMin = minOwned ? self.runMin : extMin;
  const runMax = maxOwned ? self.runMax : extMax;
  // World side of the joining run → local ±v: project world +side onto the
  // piece's +v axis (its perpendicular world component). The exposed corner is
  // the OPPOSITE side of the joining run.
  const vAxis = localOffset(0, 1, piece.yawDegrees);
  const vComp = self.axis === 'x' ? vAxis.dz : vAxis.dx;
  // World run → local u. localOffset maps +u to the world NEGATIVE axis
  // direction for quarters 1 (yaw 90 → −z) and 2 (yaw 180 → −x); the world
  // ends swap under that mirror. (Was `quarter 2 || 3` — REQ_0474: yaw-90/270
  // walls grew their corner extension at the EMPTY end and left the joint
  // open, the "gap at the corner + overhang past the corner" screenshots.)
  const flip = self.quarter === 1 || self.quarter === 2 ? -1 : 1;
  const toLocalU = (world: number): number => flip > 0 ? world - self.center : self.center - world;
  const endJoin = (joined: boolean, pos: boolean, neg: boolean, sqCenterWorld: number): WallEndJoin | null => {
    if (!joined || pos === neg) return null; // nothing joins, or a T — no exposed corner
    const joinV = (pos ? 1 : -1) * (vComp >= 0 ? 1 : -1);
    return { outerV: joinV > 0 ? -1 : 1, squareU: toLocalU(sqCenterWorld) };
  };
  const minEnd = minOwned ? null : endJoin(minJoined, minPos, minNeg, minSqCenter);
  const maxEnd = maxOwned ? null : endJoin(maxJoined, maxPos, maxNeg, maxSqCenter);
  return flip > 0
    ? { minU: runMin - self.center, maxU: runMax - self.center, ends: { axis: self.axis, minU: minEnd, maxU: maxEnd } }
    : { minU: self.center - runMax, maxU: self.center - runMin, ends: { axis: self.axis, minU: maxEnd, maxU: minEnd } };
}

/** Per-end corner joins of an edge-snapped wall (renderer input for the slab
 *  miter that closes the corner pocket). Non-wall/free-yaw pieces: all null. */
export function placedPieceWallEnds(piece: PlacedBuildPiece, pieces: readonly PlacedBuildPiece[] = [piece]): WallEnds {
  const def = placedPieceDef(piece);
  if (def.kind !== 'wall' || def.snap !== 'edge') return NO_WALL_ENDS;
  return wallJoinRunLimits(piece, def, pieces).ends;
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
      const opening = doorOpeningWidth(meaning);
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

/** A door/portal's opening width: the edit's own override (req_1725 — the
 *  double-wide sliding door declares its own) or the portalKind default. One
 *  source for the jamb split AND the closed-panel band so the cutout and the
 *  collision always agree. */
function doorOpeningWidth(meaning: ReturnType<typeof wallEditDefinition>): number {
  if (meaning.openingWidthMeters !== undefined) return meaning.openingWidthMeters;
  return meaning.portalKind === 'vehicle'
    ? PLACED_TUNING.vehicleOpeningWidthMeters
    : PLACED_TUNING.walkOpeningWidthMeters;
}

function placedClosedDoorBand(piece: PlacedBuildPiece, def: BuildPieceDef): PlacedPieceBand | null {
  if (piece.doorOpen === true) return null;
  const edit = piece.edit;
  if (edit === undefined || BUILD_KIND_CONTRACTS[def.kind].edits !== 'wall') return null;
  const meaning = wallEditDefinition(edit);
  if (!meaning.interaction || meaning.portalKind === 'none') return null;
  const opening = doorOpeningWidth(meaning);
  const panelHeight = meaning.portalKind === 'vehicle'
    ? PLACED_TUNING.garageDoorPanelHeightMeters
    : PLACED_TUNING.walkDoorPanelHeightMeters;
  return {
    u0: -opening / 2,
    u1: opening / 2,
    top: piece.y + Math.min(def.size.heightMeters, panelHeight),
  };
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
  // A WALL MUST NEVER BECOME WALK-THROUGH (USER RULING req_1711). When the trim
  // would collapse the band to nothing — a wall whose whole footprint sits
  // inside a ramp's (e.g. a side rail offset onto its floor, fully under a
  // staircase's plan footprint) — keep the wall solid rather than deleting its
  // collider. We forgo trimming the slope here; a wall deliberately placed
  // across a stair foot now re-blocks (author a doorway/gap there instead).
  if (out.maxX - out.minX <= min || out.maxZ - out.minZ <= min) return rect;
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

function signedRange(center: number, minLocal: number, maxLocal: number, sign: number): { min: number; max: number } {
  const a = center + minLocal * sign;
  const b = center + maxLocal * sign;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

// (removed pushStairBoundaryRects — STAIRWALLS req_1501: stairs collide as their
//  heightfield slope only; the old invisible full-height side/far walls floated
//  standable platforms beside the run and walled off the top transition.)

/** REQ-0647: one elevator storey's static solids — an OPEN-FRONT frame. The
 *  back and side walls (inside the module footprint, flush with its edges)
 *  collide; the front face (local −v) stays open so a body walks onto the
 *  car. The CAR is deliberately NOT here: it is live, moving collision —
 *  the play route owns its rect (editors/play), and the compiled loader owns
 *  its own through the ELEVATORS lump (REQ-0652). */
function pushElevatorShaftRects(
  rects: (CollisionRect & { ownerIndex?: number })[],
  orientedRects: (OrientedCollisionRect & { ownerIndex?: number })[],
  piece: PlacedBuildPiece,
  def: BuildPieceDef,
  ownerIndex?: number,
): void {
  const size = def.size;
  const halfW = size.widthMeters / 2;
  const halfD = size.depthMeters / 2;
  const wall = PLACED_TUNING.elevatorShaftWallThicknessMeters;
  const base = {
    topMeters: piece.y + size.heightMeters,
    floorMeters: piece.y,
    blocksPlayer: true,
    friction: PLACED_TUNING.pieceFriction,
    restitution: PLACED_TUNING.pieceRestitution,
    ...(ownerIndex === undefined ? {} : { ownerIndex }),
  };
  const localRects: LocalPlanRect[] = [
    { minU: -halfW, maxU: -halfW + wall, minV: -halfD, maxV: halfD }, // left wall
    { minU: halfW - wall, maxU: halfW, minV: -halfD, maxV: halfD }, // right wall
    { minU: -halfW, maxU: halfW, minV: halfD - wall, maxV: halfD }, // back wall
  ];
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

/** The walkable-slope FAMILY a placed piece collides as (req_1700): a real ramp/stairs
 *  by kind, OR a cooked custom piece that declared `buildPlacement.pieceKind` of
 *  'stairs'/'ramp' — so a Studio staircase you compiled gets the walkable heightfield
 *  slope (placedPieceRamps) instead of a solid prop box you cannot climb. null = not a
 *  slope (a real prop, wall, floor…). */
export function pieceSlopeKind(def: BuildPieceDef): 'ramp' | 'stairs' | null {
  if (def.kind === 'ramp' || def.kind === 'stairs') return def.kind;
  if (def.kind === 'prop' && def.propKind) {
    const pk = propKindDefinition(def.propKind).buildPlacement?.pieceKind;
    if (pk === 'ramp' || pk === 'stairs') return pk;
  }
  return null;
}

export function placedPieceColliders(
  pieces: readonly PlacedBuildPiece[],
  opts?: {
    /** DOORS-0611: the compiled loader owns door panels as LIVE rects (the
     *  DOORS lump toggles them open/closed at play time) — the bake skips the
     *  static closed-panel band so a door isn't doubly solid. The editor's
     *  live play keeps the default (panels re-materialize with doorOpen). */
    liveDoorPanels?: boolean;
  },
): PlacedPieceColliders {
  // WALLTOP: walls collide where they REST — on the floor at their cell, not at
  // the side/ground Y a placement path happened to author (req_0099/1477).
  pieces = liftWallsOntoFloors(pieces);
  const rects: CollisionRect[] = [];
  const orientedRects: OrientedCollisionRect[] = [];
  // ramp plan footprints (quarter-turn exact; free-yaw ramps fall back to
  // their envelope — bounds() already covers both)
  const rampPlans: PieceBounds[] = [];
  for (const piece of pieces) {
    if (pieceSlopeKind(placedPieceDef(piece))) rampPlans.push(pieceBounds(piece));
  }
  for (const piece of pieces) {
    const def = placedPieceDef(piece);
    if (def.kind === 'ramp' || def.kind === 'stairs') {
      if (placedPieceTags(piece).collision && def.kind === 'ramp') {
        pushRampSlabEdgeRects(rects, orientedRects, piece, def);
      }
      // STAIRWALLS (req_1501): stairs no longer get boundary-wall rects. Those
      // were INVISIBLE, full-height, flat-topped solids that extended 0.25m past
      // the steps — so their tops were standable platforms floating at the
      // stair's peak height beside the visible run (the "floating on an invisible
      // wall" bug), and the far/high one was a solid wall right at the top step
      // that blocked the landing transition ("stuck at the top"). The heightfield
      // slope (placedPieceRamps) is the real walkable collision and matches the
      // rendered stepped geometry — see-it == walk-it.
      continue;
    }
    if (def.kind === 'elevator') {
      if (placedPieceTags(piece).collision) pushElevatorShaftRects(rects, orientedRects, piece, def);
      continue;
    }
    // A pitched roof's footing is its slope heightfield (placedPieceRamps) — the
    // flat band path below would stamp a phantom eave-height slab (req_0917).
    if (def.kind === 'roof' && roofRiseMeters(piece) > 0.01) continue;
    // KICKPROP-0610: a dynamic prop (ball, cone, can) is a host sphere BODY,
    // not a wall — it contributes no static rect; the play route owns its sim.
    if (def.kind === 'prop' && def.propKind && propDynamics(def.propKind)) continue;
    // A cooked staircase/ramp piece (req_1700) collides as its walkable slope
    // (placedPieceRamps), NOT a solid prop box — so you can walk up your custom stairs.
    if (def.kind === 'prop' && pieceSlopeKind(def)) continue;
    if (!placedPieceTags(piece).collision) continue;
    // SHAPE-AWARE prop collider (req_1587): a multi-part / multi-island prop (an
    // archway or big sign: two posts + a high board) carries one box PER part, each
    // with its own vertical band — so the board is a band the player walks UNDER
    // instead of one ground-to-top wall that fills the gap between the posts. Cooked
    // assets author these boxes (collisionBoxes); data-recipe props derive them from
    // the same recipe parts on demand (propCollisionBoxes, gated to walk-under shapes).
    // Local box coords map straight to world: the mesh renders at the anchor in these
    // same lifted local coords.
    if (def.kind === 'prop' && def.propKind) {
      const boxes = propKindDefinition(def.propKind).collisionBoxes ?? propCollisionBoxes(def.propKind);
      if (boxes && boxes.length) {
        for (const b of boxes) {
          orientedRects.push({
            topMeters: piece.y + b.maxY,
            floorMeters: piece.y + b.minY,
            blocksPlayer: true,
            friction: PLACED_TUNING.pieceFriction,
            restitution: PLACED_TUNING.pieceRestitution,
            minX: piece.x + b.minX,
            maxX: piece.x + b.maxX,
            minZ: piece.z + b.minZ,
            maxZ: piece.z + b.maxZ,
            pivotX: piece.x,
            pivotZ: piece.z,
            yawRadians: piece.yawDegrees * DEG,
          });
        }
        continue;
      }
    }
    // FOOTPRINT-0765: a data-recipe prop collides as its EXACT measured footprint
    // — width/depth span plus the model-center offset, so an off-center body (an
    // arcade cabinet whose mass sits forward of its anchor) tracks the drawn mesh
    // at any yaw instead of a centered box that swings off under rotation. One
    // oriented rect about the anchor. Bespoke props (no recipe) fall through to
    // the generic def.size band path below.
    if (def.kind === 'prop' && def.propKind && def.propKind !== 'dumpster') {
      const fp = propModelFootprintMeters(def.propKind);
      if (fp) {
        orientedRects.push({
          topMeters: piece.y + def.size.heightMeters,
          floorMeters: piece.y,
          blocksPlayer: true,
          friction: PLACED_TUNING.pieceFriction,
          restitution: PLACED_TUNING.pieceRestitution,
          minX: piece.x + fp.offsetXMeters - fp.widthMeters / 2,
          maxX: piece.x + fp.offsetXMeters + fp.widthMeters / 2,
          minZ: piece.z + fp.offsetZMeters - fp.depthMeters / 2,
          maxZ: piece.z + fp.offsetZMeters + fp.depthMeters / 2,
          pivotX: piece.x,
          pivotZ: piece.z,
          yawRadians: piece.yawDegrees * DEG,
        });
        continue;
      }
    }
    const quarter = quarterTurns(piece.yawDegrees);
    const depthSpan = placedPieceDepthSpan(piece, pieces);
    const closedDoor = opts?.liveDoorPanels ? null : placedClosedDoorBand(piece, def);
    const bands = closedDoor ? [...placedPieceBands(piece, pieces), closedDoor] : placedPieceBands(piece, pieces);
    for (const band of bands) {
      const base = {
        topMeters: band.top,
        floorMeters: piece.y,
        blocksPlayer: true,
        friction: PLACED_TUNING.pieceFriction,
        restitution: PLACED_TUNING.pieceRestitution,
      };
      if (quarter !== null) {
        // band [u0,u1] runs along local width; quarter turns map it onto x or z.
        // The u→world sign MUST match localOffset (+u → −z at q1, −x at q2):
        // REQ_0474 — this used to mirror q2|q3 while the band builder mirrored
        // the same way, two wrongs canceling for collision while the renderer
        // (which maps through localOffset) showed extensions at the wrong end.
        const centerU = (band.u0 + band.u1) / 2;
        const halfU = (band.u1 - band.u0) / 2;
        const along = quarter % 2 === 0 ? 'x' : 'z';
        const flip = quarter === 1 || quarter === 2 ? -1 : 1;
        const cu = centerU * flip;
        const vAxis = localOffset(0, 1, piece.yawDegrees);
        const depthX = signedRange(piece.x, depthSpan.minV, depthSpan.maxV, vAxis.dx);
        const depthZ = signedRange(piece.z, depthSpan.minV, depthSpan.maxV, vAxis.dz);
        let rect: CollisionRect | null = along === 'x'
          ? { ...base, minX: piece.x + cu - halfU, maxX: piece.x + cu + halfU, minZ: depthZ.min, maxZ: depthZ.max }
          : { ...base, minX: depthX.min, maxX: depthX.max, minZ: piece.z + cu - halfU, maxZ: piece.z + cu + halfU };
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
          minZ: piece.z + depthSpan.minV,
          maxZ: piece.z + depthSpan.maxV,
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
    if (def.kind === 'elevator') {
      // REQ-0652 parity (USER report): the compiled camera collides with the
      // baked shaft walls (its camera set IS the COLLIDERS lump), so the
      // editor spring-arm must see the same thin frame — otherwise /test
      // looks through a shaft the shipped game pushes in on.
      if (!tags.collision) continue;
      const ownerIndex = ownerIds.push(piece.id);
      pushElevatorShaftRects(rects, orientedRects, piece, def, ownerIndex);
      continue;
    }
    if (def.kind !== 'wall' && def.kind !== 'roof') continue;
    if (!tags.collision || (!tags.blocksSight && def.kind !== 'roof')) continue;
    const ownerIndex = ownerIds.push(piece.id);
    const quarter = quarterTurns(piece.yawDegrees);
    const depthSpan = placedPieceDepthSpan(piece, pieces);
    const closedDoor = placedClosedDoorBand(piece, def);
    const bands = closedDoor ? [...placedPieceBands(piece, pieces), closedDoor] : placedPieceBands(piece, pieces);
    for (const band of bands) {
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
        // u→world sign matches localOffset (REQ_0474, same as colliders above)
        const flip = quarter === 1 || quarter === 2 ? -1 : 1;
        const cu = centerU * flip;
        const vAxis = localOffset(0, 1, piece.yawDegrees);
        const depthX = signedRange(piece.x, depthSpan.minV, depthSpan.maxV, vAxis.dx);
        const depthZ = signedRange(piece.z, depthSpan.minV, depthSpan.maxV, vAxis.dz);
        rects.push(along === 'x'
          ? { ...base, minX: piece.x + cu - halfU, maxX: piece.x + cu + halfU, minZ: depthZ.min, maxZ: depthZ.max }
          : { ...base, minX: depthX.min, maxX: depthX.max, minZ: piece.z + cu - halfU, maxZ: piece.z + cu + halfU });
      } else {
        orientedRects.push({
          ...base,
          minX: piece.x + band.u0,
          maxX: piece.x + band.u1,
          minZ: piece.z + depthSpan.minV,
          maxZ: piece.z + depthSpan.maxV,
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
    const roofRise = roofRiseMeters(piece);
    const isPitchedRoof = def.kind === 'roof' && roofRise > 0.01;
    // Real ramps/stairs AND cooked custom stairs/ramp pieces (req_1700) bake a walkable
    // slope here; everything else (pitched roofs excepted) is solid collision elsewhere.
    if (!pieceSlopeKind(def) && !isPitchedRoof) continue;
    // A pitched roof collides as its own SLOPE surface — the same heightfield
    // mechanism a ramp uses, so a gable/shed is walkable in /test AND compiled
    // and never a phantom flat slab at the eave (req_0917). The height function
    // matches pieceShapes' ramp decomposition: shed = a single plane along the
    // depth, gable = a tent rising to the center ridge.
    const size = placedPieceSize(piece);
    const profile = placedRoofProfile(piece);
    const cell = PLACED_TUNING.verticalLinkHeightfieldCellMeters;
    const cols = Math.max(2, Math.round(size.widthMeters / cell) + 1);
    let rows = Math.max(2, Math.round(size.depthMeters / cell) + 1);
    // A gable's ridge sits at the center depth row — force an odd row count so a
    // sample lands exactly on it (else the heightfield peak clips a cell short).
    if (isPitchedRoof && profile.shape === 'gable' && rows % 2 === 0) rows += 1;
    const heights = new Float32Array(cols * rows);
    const heightAtRow = (row: number): number => {
      const t = row / (rows - 1); // 0..1 along depth (−D/2 → +D/2)
      if (!isPitchedRoof) return t * size.heightMeters; // ramp/stairs: linear rise
      if (profile.shape === 'gable') return roofRise * (1 - Math.abs(t - 0.5) * 2); // tent to the ridge
      return t * roofRise; // shed: single plane
    };
    for (let row = 0; row < rows; row += 1) {
      const h = heightAtRow(row);
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
      // MICROGRID-0610: a floor's authored 3×3 cells ride the stamp — the
      // placed piece's composed yaw (just above) is what floorCellRects
      // rotates them by, so cells turn with the building.
      ...(piece.cells !== undefined ? { cells: piece.cells } : {}),
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
// piece sits on the ground under it. The component pass buckets pieces into a spatial
// hash and only bounds-tests pairs sharing a cell (PLACEPERF-0610 — the pairwise
// O(loose²) loop was half of the ~970ms/frame stall at 785 pieces); touching pieces
// always share a cell, so the components are identical to the pairwise answer.
// Two placed pieces at the SAME footprint — identical pieceId, position (to the
// millimetre), yaw, edit, and stamp group — are COLOCATED: their faces share
// exact depth, so the GPU can't order them and they z-fight (the floor/wall
// "fighting for which one renders" jitter, req_0712/req_0713). Painting a floor
// area over an existing one, or clicking a piece onto its twin, stacks them and
// nothing rejects it. This collapses each such cluster to ONE, keeping the LAST
// (most-recently placed → the look you just painted wins). A different y (a
// stacked storey), a different footprint (a corner), or a different building
// stamp (two instances) is NOT colocated and is left untouched.
const COLOCATE_MM = 1000; // mm key resolution — kills float noise, never merges real neighbours
function colocationKey(p: PlacedBuildPiece): string {
  const q = (v: number) => Math.round(v * COLOCATE_MM);
  return `${p.pieceId}|${q(p.x)}|${q(p.y)}|${q(p.z)}|${Math.round(p.yawDegrees)}|${p.edit ?? ''}|${p.stampId ?? ''}`;
}
export function dedupeColocatedPieces<T extends PlacedBuildPiece>(pieces: readonly T[]): T[] {
  // ONLY loose pieces (no stampId) dedup. A building instance's pieces are a
  // coherent set — never drop a member, even if two happen to overlap (that's
  // the building's geometry, not a z-fight twin the user accidentally stacked).
  // The reported clash is loose painted/placed floors and walls; scoping here
  // keeps that fix while guaranteeing buildings are untouched.
  const lastAt = new Map<string, number>();
  for (let i = 0; i < pieces.length; i += 1) {
    if (pieces[i].stampId) continue;
    lastAt.set(colocationKey(pieces[i]), i);
  }
  const survivors = pieces.filter((p, i) => p.stampId !== undefined || lastAt.get(colocationKey(p)) === i);
  return survivors.length === pieces.length ? (pieces as T[]) : survivors; // no twins → same ref (memo-friendly)
}

export function liftBuildingsToTerrain<T extends PlacedBuildPiece>(
  pieces: readonly T[],
  terrainAt: (x: number, z: number) => number,
): T[] {
  // Collapse colocated z-fighting twins BEFORE grouping/lift — one render-prep
  // chokepoint both the editor (IsoAuthor displayPieces) and the bake
  // (packageMap, render + colliders) flow through, so the fix lands everywhere.
  const src = dedupeColocatedPieces(pieces);
  const groups: T[][] = [];
  const stamped = new Map<string, T[]>();
  const loose: T[] = [];
  for (const p of src) {
    if (p.stampId) { const g = stamped.get(p.stampId); if (g) g.push(p); else stamped.set(p.stampId, [p]); }
    else loose.push(p);
  }
  for (const g of stamped.values()) groups.push(g);
  // Union loose pieces into connected structures (union-find over bounds-touch,
  // candidate pairs narrowed by a spatial hash of tolerance-expanded footprints).
  if (loose.length) {
    const bounds = loose.map((p) => pieceBounds(p));
    const parent = loose.map((_, i) => i);
    const find = (i: number): number => { let r = i; while (parent[r] !== r) r = parent[r]; while (parent[i] !== r) { const n = parent[i]; parent[i] = r; i = n; } return r; };
    const tol = PLACED_TUNING.touchToleranceMeters;
    const cellMeters = 4; // ≥ the 3m module pitch, same scale as the piece grid
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < loose.length; i += 1) {
      const b = bounds[i];
      const ix0 = Math.floor((b.minX - tol) / cellMeters);
      const ix1 = Math.floor((b.maxX + tol) / cellMeters);
      const iz0 = Math.floor((b.minZ - tol) / cellMeters);
      const iz1 = Math.floor((b.maxZ + tol) / cellMeters);
      for (let ix = ix0; ix <= ix1; ix += 1) {
        for (let iz = iz0; iz <= iz1; iz += 1) {
          const key = `${ix},${iz}`;
          const cell = buckets.get(key);
          if (cell) cell.push(i); else buckets.set(key, [i]);
        }
      }
    }
    for (const cell of buckets.values()) {
      for (let a = 0; a < cell.length; a += 1) {
        for (let b = a + 1; b < cell.length; b += 1) {
          const i = cell[a];
          const j = cell[b];
          if (find(i) === find(j)) continue;
          if (boundsTouch(bounds[i], bounds[j], tol)) parent[find(i)] = find(j);
        }
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
    // ONLY lift UP onto the terrain, never push a group DOWN. A ground building under a
    // painted hill (its base below the new terrain) rises onto it; a piece authored on an
    // UPPER FLOOR (its base above terrain → negative offset) must NOT be dropped to the
    // ground — that's the "place on floor 2 and it falls to the bottom" bug. A whole
    // building's upper floors still ride up because the offset is keyed on the GROUND
    // floor (the group's min y), so the lift is positive and the upper pieces come along.
    if (offset <= 1e-6) { for (const p of g) out.push(p); }
    else for (const p of g) out.push({ ...p, y: p.y + offset });
  }
  return restPropsOnSupport(out, terrainAt);
}

// req_0771/req_0776: EVERY prop rests on the solid surface beneath it — the same
// rule whether it's a barrel on the ground or a computer on a desk. After the
// terrain lift, each prop drops onto the HIGHEST solid piece-top under its anchor
// (a desk/floor/another prop), else the terrain. ONE rule, run by BOTH lift paths
// (the iso editor's liftBuildingsToTerrain AND the play/compiled liftPropsToTerrain)
// so a thing set on a desk sits on the desk in the editor, in /test, and in the
// bake — no more a prop that rests in one view and floats in another. Wall-hung
// props (signs) keep their authored height. A small upward grace snaps a prop
// nudged just into a surface up onto it; surfaces ABOVE the prop are never grabbed.
const PROP_REST_SNAP_UP_METERS = 0.35;
// How far a prop will DROP to find the surface it belongs on (a desktop item
// floating above its desk). Kept under one storey so an intentionally elevated
// prop (REQ-0582) is never yanked down onto a low piece far beneath it.
const PROP_REST_DROP_REACH_METERS = 1.2;
function isRestableProp(piece: PlacedBuildPiece): boolean {
  const def = placedPieceDef(piece);
  if (def.kind !== 'prop' || def.propKind === undefined) return false;
  return propKindDefinition(def.propKind).mount !== 'wall';
}
function restPropsOnSupport<T extends PlacedBuildPiece>(
  pieces: readonly T[],
  terrainAt: (x: number, z: number) => number | undefined,
): T[] {
  if (!pieces.some(isRestableProp)) return pieces as T[];
  // Spatial hash of SUPPORT bounds (every solid piece, props included — a desk
  // holds a computer) by XZ cell, so each prop only tests nearby supports. Tagged
  // with the piece id to skip a prop resting on its OWN bounds.
  const cellMeters = 4;
  type Support = { id: string; bounds: PieceBounds };
  const buckets = new Map<string, Support[]>();
  for (const q of pieces) {
    // A support is anything with a solid top to rest on: every structural piece
    // (floor/wall/roof/ramp/stairs) plus SOLID props (a desk) — but not a
    // walk-through prop (a bush), so a prop never perches on foliage.
    if (placedPieceDef(q).kind === 'prop' && !placedPieceTags(q).collision) continue;
    const support: Support = { id: q.id, bounds: pieceBounds(q) };
    const b = support.bounds;
    const ix0 = Math.floor(b.minX / cellMeters), ix1 = Math.floor(b.maxX / cellMeters);
    const iz0 = Math.floor(b.minZ / cellMeters), iz1 = Math.floor(b.maxZ / cellMeters);
    for (let ix = ix0; ix <= ix1; ix += 1) {
      for (let iz = iz0; iz <= iz1; iz += 1) {
        const key = `${ix},${iz}`;
        const cell = buckets.get(key);
        if (cell) cell.push(support); else buckets.set(key, [support]);
      }
    }
  }
  return pieces.map((piece) => {
    if (!isRestableProp(piece)) return piece;
    let supportTop = -Infinity;
    // A solid piece under the prop's anchor holds it up: drop the prop onto the
    // HIGHEST such top within reach (a desk under a floating computer). The reach
    // band keeps an INTENTIONALLY elevated prop (REQ-0582) from falling onto a
    // distant low piece far below it — only a surface near the prop catches it.
    const cell = buckets.get(`${Math.floor(piece.x / cellMeters)},${Math.floor(piece.z / cellMeters)}`);
    if (cell) {
      for (const { id, bounds: qb } of cell) {
        if (id === piece.id) continue; // never rest a prop on itself
        if (piece.x < qb.minX || piece.x > qb.maxX || piece.z < qb.minZ || piece.z > qb.maxZ) continue;
        if (qb.topY > piece.y + PROP_REST_SNAP_UP_METERS) continue; // not a surface above the prop
        if (qb.topY < piece.y - PROP_REST_DROP_REACH_METERS) continue; // too far below to be its surface
        if (qb.topY > supportTop) supportTop = qb.topY;
      }
    }
    // Terrain only lifts a BURIED prop up onto the ground; it never pulls an
    // elevated prop down (REQ-0582: a prop placed high stays high unless a real
    // surface is under it).
    const ty = terrainAt(piece.x, piece.z);
    if (Number.isFinite(ty) && ty! > piece.y && ty! > supportTop) supportTop = ty!;
    if (!Number.isFinite(supportTop) || Math.abs(supportTop - piece.y) < 1e-6) return piece;
    return { ...piece, y: supportTop };
  });
}

// Build-catalog props are free/surface objects, not structural pads: each rests on
// the solid surface beneath it — terrain OR a desk/floor/another prop under its
// anchor — so a hydrant on the ground, a barrel on a floor, and a computer on a
// desk all sit right (req_0776). This is the play/compiled lane; it shares the ONE
// resting rule (restPropsOnSupport) with the editor's liftBuildingsToTerrain so a
// prop never rests in one view and floats in another. Walls/floors/buildings keep
// their authored y (only props rest); wall-hung props keep their height.
export function liftPropsToTerrain<T extends PlacedBuildPiece>(
  pieces: readonly T[],
  terrainAt: (x: number, z: number) => number | undefined,
): T[] {
  return restPropsOnSupport(pieces, terrainAt);
}

/** The authored placement for a catalog row at a position (REQ-0647). Wall
 *  types that ARE a cutout (defaultEdit — Doorway Wall, Window Wall) carry
 *  their edit on the placement, so every placement site (F2 crosshair, iso
 *  click, iso drag-paint) cuts the same opening without copying the rule. */
export function placementFor(
  def: BuildPieceDef,
  at: { x: number; y: number; z: number; yawDegrees: number },
): Omit<PlacedBuildPiece, 'id'> {
  return {
    pieceId: def.id,
    x: at.x,
    y: at.y,
    z: at.z,
    yawDegrees: at.yawDegrees,
    ...(def.defaultEdit !== undefined ? { edit: def.defaultEdit } : {}),
  };
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
