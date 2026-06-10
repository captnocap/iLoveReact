// game/build/microGrid — the FLOOR 3×3 micro-grid (MICROGRID-0610, user-ruled
// req_0518): a floor piece IS exactly 3×3 tiles (PLATE_SIZE 3m×3m, 1 tile=1m),
// so every floor carries a 3×3 grid of paintable TILE KINDS. The nav substrate
// stays uniform 1m cells whether ground or lifted: ground cells come from the
// paint layer, floor cells come from here — "a floor is a tile someone placed".
//
// Cell semantics:
//   • null / absent  — the floor's DEFAULT surface, derived from its catalog
//     material (the table below). A bare floor is fully walkable.
//   • a TileKind     — an authored override: 'bush' under a planter, a lane
//     kind on a road deck (bridges = floors painted with road tiles), or any
//     other gameplay surface. Game meaning comes from the ONE kind registry —
//     no second vocabulary.
//
// Prop blocking is NOT stored here: a dresser on a floor blocks its footprint
// cells by DERIVATION (the nav bake reads the prop's collider — see
// game/world/navGrid). Authored cells are for intent the world's objects can't
// derive; occupancy follows the objects so moving the dresser frees the cells.

import { catalogEntry, type BuildMaterial } from './catalog';
import type { PlacedBuildPiece } from './placed';
import type { TileKind } from '../kinds';

export const FLOOR_GRID = 3;
export const FLOOR_CELL_COUNT = FLOOR_GRID * FLOOR_GRID;

/** One stored micro-cell: an authored kind, or null = the material default. */
export type FloorCell = TileKind | null;

// What a bare floor's surface paths as, by catalog material (P2: the table is
// the data — per-material kinds land here when the kind registry grows them;
// today every buildable plate walks like poured concrete).
export const FLOOR_DEFAULT_CELL_KIND: Record<BuildMaterial, TileKind> = {
  concrete: 'sidewalk',
  brick: 'sidewalk',
  stucco: 'sidewalk',
  wood: 'sidewalk',
  metal: 'sidewalk',
  glass: 'sidewalk',
  chainlink: 'sidewalk',
};

/** Kinds that carry a micro-grid: walkable plates. (Ramps/stairs are sloped
 *  links — their surface stays uniform; roofs join when roof-walking lands.) */
export function carriesMicroGrid(pieceKind: string): boolean {
  return pieceKind === 'floor';
}

/** The piece's effective 3×3 cells: authored overrides over the material
 *  default. Always FLOOR_CELL_COUNT entries, row-major in piece-local space
 *  (ix east before rotation, iz south before rotation). */
export function resolveFloorCells(piece: PlacedBuildPiece): TileKind[] {
  const def = catalogEntry(piece.pieceId);
  const fallback = FLOOR_DEFAULT_CELL_KIND[def.material];
  const out: TileKind[] = new Array(FLOOR_CELL_COUNT);
  for (let i = 0; i < FLOOR_CELL_COUNT; i++) out[i] = piece.cells?.[i] ?? fallback;
  return out;
}

/** Pure cell write: returns a fresh 9-entry array with one cell set (null
 *  clears back to the material default). The editor's cell painter goes
 *  through here so stored arrays never mutate in place. */
export function setFloorCell(cells: readonly FloorCell[] | undefined, ix: number, iz: number, kind: FloorCell): FloorCell[] {
  const out: FloorCell[] = new Array(FLOOR_CELL_COUNT).fill(null);
  for (let i = 0; i < FLOOR_CELL_COUNT; i++) out[i] = cells?.[i] ?? null;
  if (ix >= 0 && ix < FLOOR_GRID && iz >= 0 && iz < FLOOR_GRID) out[iz * FLOOR_GRID + ix] = kind;
  return out;
}

export type FloorCellRect = {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  kind: TileKind;
};

/** The 9 micro-cells as WORLD rects (meters), honoring the piece's quarter-turn
 *  rotation (grid-snap pieces author in 90° steps; free yaw quantizes to the
 *  nearest quarter — same simplification as the collider band frames). */
export function floorCellRects(piece: PlacedBuildPiece): FloorCellRect[] {
  const def = catalogEntry(piece.pieceId);
  const kinds = resolveFloorCells(piece);
  const w = def.size.widthMeters;
  const d = def.size.depthMeters;
  const cw = w / FLOOR_GRID;
  const cd = d / FLOOR_GRID;
  const q = ((Math.round(piece.yawDegrees / 90) % 4) + 4) % 4;
  const out: FloorCellRect[] = [];
  for (let iz = 0; iz < FLOOR_GRID; iz++) {
    for (let ix = 0; ix < FLOOR_GRID; ix++) {
      const lx = (ix + 0.5) * cw - w / 2;
      const lz = (iz + 0.5) * cd - d / 2;
      // quarter-turn about +Y: (x,z) -> (-z,x) per turn (matches transform
      // rotate's screen-space direction with +z south).
      const rx = q === 0 ? lx : q === 1 ? -lz : q === 2 ? -lx : lz;
      const rz = q === 0 ? lz : q === 1 ? lx : q === 2 ? -lz : -lx;
      const hw = (q % 2 === 0 ? cw : cd) / 2;
      const hd = (q % 2 === 0 ? cd : cw) / 2;
      out.push({
        minX: piece.x + rx - hw,
        maxX: piece.x + rx + hw,
        minZ: piece.z + rz - hd,
        maxZ: piece.z + rz + hd,
        kind: kinds[iz * FLOOR_GRID + ix]!,
      });
    }
  }
  return out;
}
