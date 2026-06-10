// tileData.ts — the painted tile map (the 'paint' layer's data), built for scale.
//
// One tile-kind index per 1m cell, edited in place; rendered as ONE Effect quad
// reading a storage buffer (same architecture as the heightfield). The place layer
// renders the same map READ-ONLY as the ground under object placements.

import { TILE_KINDS, tileKindDefinition } from './world/tileKinds';
import { hexToRgb01 } from './world/placeables';
import type { TileKind } from './design';

// Linear-ish RGB for every tile kind, indexed by TILE_KINDS order — shipped in
// the Effect buffer so the shader maps a cell's index → colour with no JS per cell.
export const TILE_PALETTE: [number, number, number][] = TILE_KINDS.map((k) => hexToRgb01(tileKindDefinition(k).render.color));

export function tileKindIndex(kind: string): number {
  return TILE_KINDS.indexOf(kind as TileKind);
}

export interface TileMap {
  cols: number;     // tiles across (x)
  rows: number;     // tiles down (y)
  idx: Int16Array;  // cols*rows tile-kind indices, -1 = empty
}

export function makeTileMap(tilesX: number, tilesY: number): TileMap {
  const idx = new Int16Array(tilesX * tilesY);
  idx.fill(-1);
  return { cols: tilesX, rows: tilesY, idx };
}

export function clearTileMap(m: TileMap): void {
  m.idx.fill(-1);
}

// Paint a single cell with a tile-kind index (-1 erases). O(1).
export function paintTile(m: TileMap, cx: number, cy: number, kindIndex: number): void {
  if (cx < 0 || cy < 0 || cx >= m.cols || cy >= m.rows) return;
  m.idx[cy * m.cols + cx] = kindIndex;
}

// Encode for the Effect storage buffer: [cols, rows, paletteCount, palette rgb...,
// cells...]. Matches TILE_FIELD_WGSL's D[] layout.
export function encodeTileMap(m: TileMap): number[] {
  const out: number[] = [m.cols, m.rows, TILE_PALETTE.length];
  for (const c of TILE_PALETTE) out.push(c[0], c[1], c[2]);
  for (let i = 0; i < m.idx.length; i++) out.push(m.idx[i]);
  return out;
}
