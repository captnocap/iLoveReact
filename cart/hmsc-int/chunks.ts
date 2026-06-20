// chunks.ts — the multi-chunk world grid for the editor.
//
// The world is a SPARSE grid of 120x120-tile chunks (matching hmsc's CHUNK_TILES).
// The seed is chunk (0,0) = address a0, the column-min / row-min corner. Chunks
// grow into any IN-BOUNDS, UNOCCUPIED neighbour slot — so "where can I expand?" is
// just: which of my four neighbours sit inside the a-zzz / 0-999 address window and
// are not already a chunk. The seed therefore opens only right + bottom (left/top
// are out of bounds); once you grow out, a chunk can open back toward the a column
// or any other empty in-bounds slot — growth follows the open space, not a fixed
// direction.
//
// Each chunk owns its own tile / height / zone buffers. Zone DEFS (name/colour/
// flags) are shared world-wide (a zone can span chunks); only the per-cell zone
// membership lives per chunk.

import { columnIndex } from './address';
import { makeHeightField, type HeightField } from './heightData';
import { makeTileMap, type TileMap } from './tileData';
import { makeFloraMap, type FloraMap } from './floraData';
import { makeZoneMap, type ZoneMap } from './zoneData';

export const CHUNK_TILES = 120;

// World extent in CHUNK units, derived from the a-zzz / 0-999 cell address window.
// columnIndex('zzz') = 18277 → 152 chunk-columns; row 999 → 8 chunk-rows.
export const MAX_CHUNK_COL = Math.floor((columnIndex('zzz') ?? 18277) / CHUNK_TILES);
export const MAX_CHUNK_ROW = Math.floor(999 / CHUNK_TILES);

export type ChunkKey = string;
export const chunkKey = (cx: number, cz: number): ChunkKey => `${cx},${cz}`;

export interface Chunk {
  cx: number;
  cz: number;
  tiles: TileMap;
  height: HeightField;
  // Painted WATER depth. Same grid as `height`; a sample with z > 0 is WET.
  // The water layer fills negative terrain to surface 0, so depth is -height at
  // paint time. 0 = dry. Terrain height remains the bed.
  water: HeightField;
  // What GROWS on each cell — grass blades / palms / bushes (FLORADECOUPLE-0619).
  // A SEPARATE channel from `tiles` so a population layers over ANY ground surface
  // (beach grass = sand tile + grass flora). -1 = nothing grows. See floraData.ts.
  flora: FloraMap;
  zones: ZoneMap;
}

export function makeChunk(cx: number, cz: number): Chunk {
  return {
    cx,
    cz,
    tiles: makeTileMap(CHUNK_TILES, CHUNK_TILES),
    height: makeHeightField(CHUNK_TILES, CHUNK_TILES),
    water: makeHeightField(CHUNK_TILES, CHUNK_TILES),
    flora: makeFloraMap(CHUNK_TILES, CHUNK_TILES),
    zones: makeZoneMap(CHUNK_TILES, CHUNK_TILES),
  };
}

// A slot is addressable iff it is inside the a-zzz / 0-999 window.
export const inBounds = (cx: number, cz: number): boolean =>
  cx >= 0 && cz >= 0 && cx <= MAX_CHUNK_COL && cz <= MAX_CHUNK_ROW;

type Side = [number, number];
const SIDES: Side[] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// The in-bounds, unoccupied neighbour slots of a chunk — i.e. every side a "+"
// belongs on. occupied() is asked against the WHOLE registry so a side facing an
// existing (even unfocused) chunk is correctly closed.
export function openNeighbors(
  occupied: (cx: number, cz: number) => boolean,
  cx: number,
  cz: number,
): { cx: number; cz: number }[] {
  const out: { cx: number; cz: number }[] = [];
  for (const [dx, dz] of SIDES) {
    const nx = cx + dx;
    const nz = cz + dz;
    if (inBounds(nx, nz) && !occupied(nx, nz)) out.push({ cx: nx, cz: nz });
  }
  return out;
}
