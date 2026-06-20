// floraData.ts — the FLORA layer's data (FLORADECOUPLE-0619, req_1473/1479). Flora
// is what GROWS on a cell — grass blades, palms, bushes — held in its OWN per-cell
// channel, SEPARATE from the ground `tiles` channel. The whole point: a population
// must combine with ANY ground surface. Beach grass = sand GROUND + grass FLORA; if
// grass and sand both lived in the tile channel they could never coexist.
//
// Twin of tileData.ts/zoneData.ts: one flora-kind index per 1m cell, -1 = none. The
// compiled population builders (render3d/grassPopulation + palmPopulation) read this
// channel (field.flora) and scatter the matching instances; the ground formula keeps
// reading `tiles` for the surface colour/material underneath.

import { hexToRgb01 } from './world/placeables';

// Every population kind, in a STABLE order (the chunk flora grids reference this by
// index, and mapStore persists a floraLegend of NAMES so the order can evolve). The
// names match the population specs' density-level maps (GRASS_KIND_LEVEL /
// PALM_KIND_DENSITY / BUSH_KIND_LEVEL) so those specs need no key changes.
export type FloraKind =
  | 'grassSparse'
  | 'grassMed'
  | 'grassLush'
  | 'grassDry'
  | 'palmSparse'
  | 'palmMed'
  | 'palmDense'
  | 'bush';

export type FloraKindDefinition = {
  kind: FloraKind;
  /** painter palette label */
  label: string;
  /** authoring swatch / overlay tint (distinct from ground tile colours) */
  color: string;
};

// Ordered definitions — index order IS the wire format (mapStore floraLegend keeps it
// portable). Swatch greens for grass, palm greens, a deep bush green; the painter
// overlay tints each flora cell by this so you read the populations over the ground.
export const FLORA_KIND_DEFINITIONS: Record<FloraKind, FloraKindDefinition> = {
  grassSparse: { kind: 'grassSparse', label: 'Grass (Sparse)', color: '#6f9a52' },
  grassMed: { kind: 'grassMed', label: 'Grass', color: '#4f8a34' },
  grassLush: { kind: 'grassLush', label: 'Grass (Lush)', color: '#2f6b28' },
  grassDry: { kind: 'grassDry', label: 'Dry Grass', color: '#9a8f4a' },
  palmSparse: { kind: 'palmSparse', label: 'Palm (Sparse)', color: '#3f7a4a' },
  palmMed: { kind: 'palmMed', label: 'Palm Grove', color: '#2f6b3a' },
  palmDense: { kind: 'palmDense', label: 'Palm (Dense)', color: '#1f5230' },
  bush: { kind: 'bush', label: 'Bush', color: '#356326' },
};

export const FLORA_KINDS = Object.keys(FLORA_KIND_DEFINITIONS) as FloraKind[];

export function floraKindDefinition(kind: FloraKind): FloraKindDefinition {
  return FLORA_KIND_DEFINITIONS[kind];
}

export function floraKindIndex(kind: string): number {
  return FLORA_KINDS.indexOf(kind as FloraKind);
}

// Linear-ish RGB per flora kind, FLORA_KINDS order — shipped in the painter overlay
// Effect buffer so the shader maps a cell's flora index → tint with no JS per cell.
export const FLORA_PALETTE: [number, number, number][] = FLORA_KINDS.map((k) => hexToRgb01(FLORA_KIND_DEFINITIONS[k].color));

export interface FloraMap {
  cols: number;     // tiles across (x)
  rows: number;     // tiles down (y)
  idx: Int16Array;  // cols*rows flora-kind indices, -1 = none
}

export function makeFloraMap(tilesX: number, tilesY: number): FloraMap {
  const idx = new Int16Array(tilesX * tilesY);
  idx.fill(-1);
  return { cols: tilesX, rows: tilesY, idx };
}

export function clearFloraMap(m: FloraMap): void {
  m.idx.fill(-1);
}

// Paint one cell with a flora-kind index (-1 clears). O(1).
export function paintFlora(m: FloraMap, cx: number, cy: number, kindIndex: number): void {
  if (cx < 0 || cy < 0 || cx >= m.cols || cy >= m.rows) return;
  m.idx[cy * m.cols + cx] = kindIndex;
}

// Encode for the bake/overlay: [cols, rows, kindCount, ...cells]. Unlike tiles, flora
// ships no palette (the populations carry their own colour) — just the cell indices,
// which the bake resolves to FLORA_KINDS names for the population builders.
export function encodeFloraMap(m: FloraMap): number[] {
  const out: number[] = [m.cols, m.rows, FLORA_KINDS.length];
  for (let i = 0; i < m.idx.length; i++) out.push(m.idx[i]);
  return out;
}
