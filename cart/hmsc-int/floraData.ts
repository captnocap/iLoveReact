// floraData.ts — the FLORA layer's data (FLORADECOUPLE-0619, req_1473/1479). Flora
// is what GROWS on a cell — grass blades, palms, bushes — held in its OWN per-cell
// channel, SEPARATE from the ground `tiles` channel. The whole point: a population
// must combine with ANY ground surface. Beach grass = sand GROUND + grass FLORA; if
// grass and sand both lived in the tile channel they could never coexist.
//
// Twin of tileData.ts/zoneData.ts, but with explicit population lanes: grass, trees,
// and bushes can all occupy the same 1m cell. A density variant replaces only its
// lane, not the whole flora cell. The compiled population builders
// (render3d/grassPopulation + palmPopulation) read this channel (field.flora) and
// scatter the matching instances; the ground formula keeps reading `tiles` for the
// surface colour/material underneath.

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

export type FloraLayer = 'grass' | 'tree' | 'bush';
export const FLORA_LAYERS: readonly FloraLayer[] = ['grass', 'tree', 'bush'];
export const FLORA_LAYER_COUNT = FLORA_LAYERS.length;

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
  palmSparse: { kind: 'palmSparse', label: 'Palm Tree (Sparse)', color: '#3f7a4a' },
  palmMed: { kind: 'palmMed', label: 'Palm Trees', color: '#2f6b3a' },
  palmDense: { kind: 'palmDense', label: 'Palm Tree (Dense)', color: '#1f5230' },
  bush: { kind: 'bush', label: 'Bush', color: '#356326' },
};

export const FLORA_KINDS = Object.keys(FLORA_KIND_DEFINITIONS) as FloraKind[];

export const FLORA_KIND_LAYER: Readonly<Record<FloraKind, FloraLayer>> = {
  grassSparse: 'grass',
  grassMed: 'grass',
  grassLush: 'grass',
  grassDry: 'grass',
  palmSparse: 'tree',
  palmMed: 'tree',
  palmDense: 'tree',
  bush: 'bush',
};

export function floraKindDefinition(kind: FloraKind): FloraKindDefinition {
  return FLORA_KIND_DEFINITIONS[kind];
}

export function floraKindIndex(kind: string): number {
  return FLORA_KINDS.indexOf(kind as FloraKind);
}

export function floraLayerForKindIndex(kindIndex: number): FloraLayer | null {
  const kind = FLORA_KINDS[kindIndex];
  return kind ? FLORA_KIND_LAYER[kind] : null;
}

// Linear-ish RGB per flora kind, FLORA_KINDS order — shipped in the painter overlay
// Effect buffer so the shader maps a cell's flora index → tint with no JS per cell.
export const FLORA_PALETTE: [number, number, number][] = FLORA_KINDS.map((k) => hexToRgb01(FLORA_KIND_DEFINITIONS[k].color));

export interface FloraMap {
  cols: number;                              // tiles across (x)
  rows: number;                              // tiles down (y)
  layers: Record<FloraLayer, Int16Array>;    // each lane is cols*rows, -1 = none
}

export function makeFloraMap(tilesX: number, tilesY: number): FloraMap {
  const makeLayer = () => {
    const idx = new Int16Array(tilesX * tilesY);
    idx.fill(-1);
    return idx;
  };
  return {
    cols: tilesX,
    rows: tilesY,
    layers: { grass: makeLayer(), tree: makeLayer(), bush: makeLayer() },
  };
}

export function clearFloraMap(m: FloraMap): void {
  for (const layer of FLORA_LAYERS) m.layers[layer].fill(-1);
}

// Paint one cell with a flora-kind index. The kind chooses its lane; -1 clears the
// provided lane, or every lane when omitted. O(1).
export function paintFlora(m: FloraMap, cx: number, cy: number, kindIndex: number, clearLayer?: FloraLayer): void {
  if (cx < 0 || cy < 0 || cx >= m.cols || cy >= m.rows) return;
  const cell = cy * m.cols + cx;
  if (kindIndex < 0) {
    if (clearLayer) m.layers[clearLayer][cell] = -1;
    else for (const layer of FLORA_LAYERS) m.layers[layer][cell] = -1;
    return;
  }
  const layer = floraLayerForKindIndex(kindIndex);
  if (!layer) return;
  m.layers[layer][cell] = kindIndex;
}

export function floraMapHasAny(m: FloraMap): boolean {
  for (const layer of FLORA_LAYERS) {
    const idx = m.layers[layer];
    for (let i = 0; i < idx.length; i++) if (idx[i] >= 0) return true;
  }
  return false;
}

function pushLayerCells(out: number[], m: FloraMap): void {
  for (const layer of FLORA_LAYERS) {
    const idx = m.layers[layer];
    for (let i = 0; i < idx.length; i++) out.push(idx[i]);
  }
}

// Encode for the bake: [cols, rows, kindCount, layerCount, ...layerCells]. Unlike
// tiles, flora ships no palette (the populations carry their own colour) — just the
// cell indices, which the bake resolves to FLORA_KINDS names for the population
// builders. Layer cells are ordered by FLORA_LAYERS.
export function encodeFloraMap(m: FloraMap): number[] {
  const out: number[] = [m.cols, m.rows, FLORA_KINDS.length, FLORA_LAYER_COUNT];
  pushLayerCells(out, m);
  return out;
}

// Encode the flora section for the combined painter view: [cols, rows, floraCount,
// layerCount, flora rgb..., layerCells...]. This mirrors encodeZoneSection so the
// shader can tint flora cells by the authoring swatch without hardcoding the palette
// in WGSL.
export function encodeFloraSection(m: FloraMap): number[] {
  const out: number[] = [m.cols, m.rows, FLORA_KINDS.length, FLORA_LAYER_COUNT];
  for (const c of FLORA_PALETTE) out.push(c[0], c[1], c[2]);
  pushLayerCells(out, m);
  return out;
}
