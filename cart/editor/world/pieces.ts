// world/pieces.ts — the editor's OWN placed-piece model (req_2486: the last
// hmsc-int cross-import dies). This is deliberately the MINIMAL vocabulary the
// editor's world surface actually exercises today — grid-snapped plates placed
// live — not a clone of the hmsc build brain (which is welded to the 435-file
// prop-recipe science project and dies with its cart).
//
// The heavy placement math already lives HOST-SIDE (framework/game/build.zig,
// req_2349 — placementFor/validatePlacement/raycastPieces); the editor calls it
// through runtime/game/build.ts. What this file keeps JS-side is presentation
// glue only: the placed-piece TYPE, the live-overlay row packing (the
// world_loader 12-float unit-box row), and placement snap/validation. The piece
// sizes/colors/labels now come from buildCatalog.ts (a mirror of the host
// BUILD_CATALOG, all 36 pieces), which upgrades to a host readback once the
// `__game_build_catalog_rows` door lands — so the old 2-entry PIECE_LOOKS is gone.

import { buildCatalogIndex, validateBuildPlacement } from '@reactjit/runtime/game/build';
import { catalogRowFor, rowHex, type BuildKind } from './buildCatalog';
import { primarySlotRole } from './pieceSlots';
import { pieceVisualShapes } from './pieceShapes';
import { authoredPieceFor, isAuthoredPiece, type PlaceableKind } from './authoredRegistry';
import { authoredMeshBounds, type MeshBounds } from './authoredMesh';
import { assetById } from '../data/catalog';
import { METERS_PER_LEVEL } from './isoStage';

/** The base kind of any placeable: an authored piece's affinity (or 'prop'), or
 *  a catalog row's kind. Drives snap mode + storey rules for all placeables. */
export function pieceKindOf(pieceId: string): PlaceableKind | undefined {
  const authored = authoredPieceFor(pieceId);
  if (authored) return authored.kind;
  return catalogRowFor(pieceId)?.kind;
}

// A material bound into a piece's slot (req_2563 Phase 4). Two shapes, matching
// the mapPaint material binding vocabulary: a content-browser asset by id, or a
// shader-recipe binding ({ fn, variant }, like TileMaterialBinding). Resolution
// reads whichever is present; absent slot ⇒ the piece's kind default.
export type MaterialRef = { assetId: string } | { fn: string; variant: number };

export type PlacedPiece = {
  id: string;
  pieceId: string;
  x: number;
  y: number;
  z: number;
  yawDegrees: number;
  // The storey ACTIVE when the piece was placed (req_2676) — recorded explicitly
  // because y now carries the painted-terrain base too: a Ground placement on a
  // 6m mesa has y=6 but is still storey 0, and deriving the storey from y hid it
  // until the user climbed the floor control. Absent on pre-terrain saves ⇒
  // pieceFloorOf falls back to the y-derived storey (flat pieces: identical).
  floor?: number;
  // Per-instance material slots keyed by slot role (see pieceSlots.ts) — the
  // focus panel writes these; the live overlay reflects the primary slot's tint.
  slots?: Record<string, MaterialRef>;
  // Per-instance property overrides (friction/walkable/opacity/… as num|bool),
  // the folded-in hmsc-int override editor. Absent key ⇒ the kind default.
  overrides?: Record<string, number | boolean>;
};

export type ArmedPiece = { pieceId: string } | null;

export type PieceLook = { w: number; h: number; d: number; rgb: [number, number, number]; label: string; opacity?: number };

/** The size/tint/label a placed piece draws with — an authored piece's mesh
 *  bounds, a catalog row (all 36 pieces), or null for an id in neither. */
export function pieceLook(pieceId: string): PieceLook | null {
  const authored = authoredPieceFor(pieceId);
  if (authored) {
    const b = authoredMeshBounds(authored.modelId, authored.pkgId);
    if (!b) return null;
    return { w: b.maxX - b.minX, h: b.maxY - b.minY, d: b.maxZ - b.minZ, rgb: hexToRgb(authored.hex), label: authored.label };
  }
  const row = catalogRowFor(pieceId);
  if (!row) return null;
  return { w: row.w, h: row.h, d: row.d, rgb: row.rgb, label: row.label, opacity: row.opacity };
}

/** Ray-pick the AUTHORED placements. The host raycast (__game_build_raycast)
 *  indexes only the static catalog, so `model:` pieces never reach it — they
 *  hit-test here instead, a slab test against each placement's yaw-rotated mesh
 *  AABB. Click-time only, a handful of boxes — not a per-frame path. Returns the
 *  nearest hit with its ray distance so the caller can merge with the host pick. */
export function pickAuthoredPlacement(
  ray: { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } },
  pieces: readonly PlacedPiece[],
  maxDistance: number,
): { piece: PlacedPiece; t: number } | null {
  let best: { piece: PlacedPiece; t: number } | null = null;
  for (const piece of pieces) {
    const authored = authoredPieceFor(piece.pieceId);
    if (!authored) continue;
    const b = authoredMeshBounds(authored.modelId, authored.pkgId);
    if (!b) continue;
    // Ray → piece-local frame: translate to the placement point, un-rotate the
    // yaw (inverse of the boxSegments local→world rotation).
    const a = (-piece.yawDegrees * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const ox = ray.origin.x - piece.x;
    const oy = ray.origin.y - piece.y;
    const oz = ray.origin.z - piece.z;
    const localOrigin = { x: ox * ca - oz * sa, y: oy, z: ox * sa + oz * ca };
    const localDir = { x: ray.dir.x * ca - ray.dir.z * sa, y: ray.dir.y, z: ray.dir.x * sa + ray.dir.z * ca };
    const t = rayAabbEntry(localOrigin, localDir, b, maxDistance);
    if (t !== null && (!best || t < best.t)) best = { piece, t };
  }
  return best;
}

/** Slab-test a ray against an AABB; the entry distance along the ray, or null. */
function rayAabbEntry(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  b: MeshBounds,
  maxDistance: number,
): number | null {
  let tNear = 0;
  let tFar = maxDistance;
  const slabs: [number, number, number, number][] = [
    [origin.x, dir.x, b.minX, b.maxX],
    [origin.y, dir.y, b.minY, b.maxY],
    [origin.z, dir.z, b.minZ, b.maxZ],
  ];
  for (const [o, d, lo, hi] of slabs) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
    if (t0 > tNear) tNear = t0;
    if (t1 < tFar) tFar = t1;
    if (tNear > tFar) return null;
  }
  return tNear;
}

/** The grid module placements snap to (the catalog's 3m piece module). */
export const PIECE_MODULE_METERS = 3;

/** Snap a ground point to the module grid: the CENTER of the 3m cell under it. */
export function snapToModule(v: number): number {
  return Math.floor(v / PIECE_MODULE_METERS) * PIECE_MODULE_METERS + PIECE_MODULE_METERS / 2;
}

// Kinds that snap to a cell EDGE (host BuildSnapMode.edge, kindSnapDefault in
// framework/game/build.zig) — they sit ON the boundary between two cells, along
// it, NOT centred in a cell. A wall is a thin 3m plane; centre-snapping it (the
// old plate-only path) drops it through the middle of a floor tile, bisecting it
// (req_2569). Everything else centre-snaps like a plate.
const EDGE_SNAP_KINDS = new Set(['wall', 'corner', 'arch', 'fence', 'railing']);

/** Snap a click to the nearest cell EDGE and return the edge-piece placement:
 *  the point ON that edge (centred along it) + the yaw that lays the piece along
 *  the edge. A wall's default footprint (width along local X, thin along Z) is
 *  yaw 0 for a horizontal edge (constant z) and yaw 90 for a vertical one. */
function snapToEdge(wx: number, wz: number): { x: number; z: number; yaw: number } {
  const M = PIECE_MODULE_METERS;
  const cellX = Math.floor(wx / M);
  const cellZ = Math.floor(wz / M);
  const fx = wx - cellX * M; // 0..M within the cell
  const fz = wz - cellZ * M;
  const cx = cellX * M + M / 2;
  const cz = cellZ * M + M / 2;
  const west = fx, east = M - fx, north = fz, south = M - fz;
  const nearest = Math.min(west, east, north, south);
  if (nearest === west) return { x: cellX * M, z: cz, yaw: 90 };
  if (nearest === east) return { x: cellX * M + M, z: cz, yaw: 90 };
  if (nearest === north) return { x: cx, z: cellZ * M, yaw: 0 };
  return { x: cx, z: cellZ * M + M, yaw: 0 };
}

/** Resolve a click into a placement for the armed piece on the active storey.
 *  Honours the piece's snap mode: edge-snap kinds (walls, fences, …) land on the
 *  nearest CELL EDGE, oriented along it; plates centre-snap. Returns null when
 *  the HOST validator rejects (validateBuildPlacement, framework/game/build.zig).
 *  `floor` is the active storey INDEX (the action bar's floor control) — recorded
 *  on the piece so the cutaway never re-derives it from y (req_2676). `terrainY`
 *  is the painted-terrain surface under the cursor (req_2666 — the
 *  __compiled_world_ground_hit door): the piece bases at terrainY + floor×3m, so
 *  a Ground placement sits ON a sculpted hill and Floor 1 is the hill + 3m.
 *  Omitted (no door / off-map) it is 0 — flat behavior, y = the storey exactly.
 *  `lift` (req_2751) is the prop-only scroll-wheel height: metres ABOVE the
 *  terrain/storey base the prop hangs (a wall picture is ground-based geometry
 *  + a 1.5m lift, never a floating mesh). Grid pieces ignore it — their
 *  verticality is storeys. */
export function resolvePlacement(pieceId: string, wx: number, wz: number, floor: number, terrainY = 0, lift = 0): PlacedPiece | null {
  const catalogIndex = buildCatalogIndex(pieceId);
  const kind = pieceKindOf(pieceId);
  const levelY = floor > 0 ? floor * METERS_PER_LEVEL : 0;
  const y = terrainY + levelY;
  // Props FREE-place (req_2712): they land exactly under the cursor, grounded on
  // the terrain/storey — a bench is not a 3m plate. No host validate either (the
  // build validator indexes only the catalog grid pieces).
  if (kind === 'prop') {
    return { id: '', pieceId, x: wx, y: y + lift, z: wz, yawDegrees: 0, floor };
  }
  const edge = kind ? EDGE_SNAP_KINDS.has(kind) : false;
  const { x, z, yaw } = edge ? snapToEdge(wx, wz) : { x: snapToModule(wx), z: snapToModule(wz), yaw: 0 };
  if (catalogIndex >= 0) {
    const v = validateBuildPlacement(catalogIndex, x, y, z, yaw);
    if (!v.valid) return null;
  }
  return { id: '', pieceId, x, y, z, yawDegrees: yaw, floor };
}

/** The biggest single drag-run (req_2747): 20×20 cells of floor. A drag past
 *  this truncates LOUDLY (console + the run just stops growing) rather than
 *  silently stamping thousands of pieces from one wild gesture. */
export const RUN_PLACEMENT_CAP = 400;

/** Whether a placeable participates in a drag run. This is a semantic-kind
 *  capability: exported build pieces inherit it from their wall/floor/etc.
 *  affinity exactly like catalog pieces; only free-placing props stay single. */
export function supportsRunPlacement(pieceId: string): boolean {
  const kind = pieceKindOf(pieceId);
  return kind !== undefined && kind !== 'prop';
}

/** Resolve a click→drag RUN into every placement it stamps (req_2747 — the
 *  reintroduced drag-place): edge kinds (walls, fences, railings, …) lay a
 *  straight run of edge pieces along the DOMINANT drag axis, on the grid line
 *  nearest the anchor; plates fill the whole cell rect between anchor and
 *  cursor. Exported build pieces follow their semantic affinity; props stay
 *  single-placement at the cursor because a bench is not a tiling. Every cell
 *  resolves through resolvePlacement, so the run gets the same snap, host
 *  validation, and storey/terrain basing as a single click; validator-rejected
 *  cells drop out of the run. The whole run is LEVEL at the ANCHOR's terrain
 *  height — a dragged wall or floor plate is flat by construction, it does not
 *  stairstep over terrain bumps mid-run. */
export function resolveRunPlacements(pieceId: string, ax: number, az: number, bx: number, bz: number, floor: number, terrainY = 0): PlacedPiece[] {
  const kind = pieceKindOf(pieceId);
  if (!supportsRunPlacement(pieceId)) {
    const single = resolvePlacement(pieceId, bx, bz, floor, terrainY);
    return single ? [single] : [];
  }
  const M = PIECE_MODULE_METERS;
  const points: Array<{ x: number; z: number }> = [];
  if (kind && EDGE_SNAP_KINDS.has(kind)) {
    if (Math.abs(bx - ax) >= Math.abs(bz - az)) {
      // Run along X: every piece rides the horizontal grid line nearest the
      // anchor (fed as the exact line z, which snapToEdge resolves back to it).
      const zLine = Math.round(az / M) * M;
      const c0 = Math.floor(Math.min(ax, bx) / M);
      const c1 = Math.floor(Math.max(ax, bx) / M);
      for (let c = c0; c <= c1; c++) points.push({ x: c * M + M / 2, z: zLine });
    } else {
      const xLine = Math.round(ax / M) * M;
      const c0 = Math.floor(Math.min(az, bz) / M);
      const c1 = Math.floor(Math.max(az, bz) / M);
      for (let c = c0; c <= c1; c++) points.push({ x: xLine, z: c * M + M / 2 });
    }
  } else {
    const cx0 = Math.floor(Math.min(ax, bx) / M);
    const cx1 = Math.floor(Math.max(ax, bx) / M);
    const cz0 = Math.floor(Math.min(az, bz) / M);
    const cz1 = Math.floor(Math.max(az, bz) / M);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) points.push({ x: cx * M + M / 2, z: cz * M + M / 2 });
    }
  }
  if (points.length > RUN_PLACEMENT_CAP) {
    console.warn(`[place] run TRUNCATED: ${points.length} cells > cap ${RUN_PLACEMENT_CAP} — only the first ${RUN_PLACEMENT_CAP} stamp`);
    points.length = RUN_PLACEMENT_CAP;
  }
  const out: PlacedPiece[] = [];
  for (const pt of points) {
    const placed = resolvePlacement(pieceId, pt.x, pt.z, floor, terrainY);
    if (placed) out.push(placed);
  }
  return out;
}

/** The placement SLOT a piece occupies — its footprint identity (req_2583). Two
 *  pieces with the same slot key fight for the same space, so a new placement
 *  REPLACES the old one there (place a window wall over a wall → the wall is
 *  gone, not double-rendered). Edge pieces key on cell edge + orientation; plates
 *  on the cell centre. Different classes (a wall vs the floor under it) never
 *  collide — their keys differ. Quantised so float jitter still matches. */
export function placementSlotKey(piece: PlacedPiece): string {
  const kind = pieceKindOf(piece.pieceId);
  const edge = kind ? EDGE_SNAP_KINDS.has(kind) : false;
  const q = (n: number): number => Math.round(n * 100) / 100;
  // Props free-place, so they never contest a grid cell: their slot is their own
  // exact spot (two drops on the same centimetre replace; anywhere else stacks a
  // NEW prop — a table and six chairs share a cell on purpose).
  if (kind === 'prop') return `prop:${q(piece.x)},${q(piece.y)},${q(piece.z)}`;
  return edge
    ? `edge:${q(piece.x)},${q(piece.y)},${q(piece.z)},${Math.round(piece.yawDegrees)}`
    : `grid:${q(piece.x)},${q(piece.y)},${q(piece.z)}`;
}

/** The storey a placed piece belongs to. The RECORDED floor index wins (req_2676
 *  — y also carries the painted-terrain base now, so a Ground piece on a 6m mesa
 *  is storey 0, not 2); pre-terrain saves have no record and derive from y, which
 *  for flat placements IS their storey — bit-identical filtering, no regression. */
export function pieceFloorOf(piece: PlacedPiece): number {
  return piece.floor ?? Math.round(piece.y / METERS_PER_LEVEL);
}

/** A wall-kind piece — a catalog wall id or an authored piece with wall affinity. */
export function isWallPiece(pieceId: string): boolean {
  return pieceId.startsWith('wall.') || pieceKindOf(pieceId) === 'wall';
}

/** Sims-style storey cutaway (req_2567): everything ABOVE the active floor is
 *  hidden so the storey you're editing is never buried under its own building,
 *  and `wallsDown` additionally hides the ACTIVE floor's walls (interior /
 *  prop-placement view). Floors below always show — they're the context. */
export function visibleStoreyPieces(pieces: readonly PlacedPiece[], floor: number, wallsDown: boolean): PlacedPiece[] {
  return pieces.filter((piece) => {
    const storey = pieceFloorOf(piece);
    if (storey > floor) return false;
    if (wallsDown && storey === floor && isWallPiece(piece.pieceId)) return false;
    return true;
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 6 ? h : 'aaaaaa', 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The base colour a placed piece's solid faces draw with: its PRIMARY material
 *  slot's assigned material colour (req_2563 Phase 4) when set, else the catalog
 *  look. Stage B replaces this flat colour with real textures via skin boxes. */
export function pieceBaseHex(piece: PlacedPiece): string {
  const role = primarySlotRole(piece.pieceId);
  const ref = role ? piece.slots?.[role] : undefined;
  if (ref && 'assetId' in ref) return assetById(ref.assetId).color;
  const row = catalogRowFor(piece.pieceId);
  return row ? rowHex(row) : '#aaaaaa';
}

/** Pack placed pieces into the world_loader live-overlay rows — 12 floats each
 *  (cx,cy,cz, 0,yawDeg,0, sx,sy,sz, r,g,b) (LIVEHOST req_1798). Each piece is
 *  DECOMPOSED into its real shapes (req_2575): a window wall emits jamb/sill/
 *  header + pane boxes, a doorway a leaf, a roof its ramps — so the overlay shows
 *  actual geometry, not one flat box. Ramps approximate as their bounding box in
 *  this live path (the stride-12 overlay has no shape id); real slopes bake in. */
export function pieceInstanceRows(pieces: readonly PlacedPiece[]): Float32Array {
  const rows: number[] = [];
  for (const piece of pieces) {
    if (isAuthoredPiece(piece.pieceId)) continue; // authored meshes render via the mesh-prop path
    const shapes = pieceVisualShapes(piece, pieceBaseHex(piece));
    if (!shapes.length) {
      console.warn(`[world] no shapes for piece '${piece.pieceId}' — not rendered live`);
      continue;
    }
    for (const shape of shapes) {
      if (shape.kind === 'box') {
        const b = shape.box;
        const rgb = hexToRgb(b.color);
        rows.push(b.cx, b.cy, b.cz, 0, b.yawDegrees, 0, b.sx, b.sy, b.sz, rgb[0], rgb[1], rgb[2]);
      } else {
        const r = shape.ramp;
        const rgb = hexToRgb(r.color);
        // Bounding-box approximation for the live overlay (base at r.y, rises to height).
        rows.push(r.x, r.y + r.height / 2, r.z, 0, r.yawDegrees, 0, r.width, Math.max(r.height, r.slabThickness), r.depth, rgb[0], rgb[1], rgb[2]);
      }
    }
  }
  return new Float32Array(rows);
}
