// placements.ts — object/building placements for the painter's 'place' layer.
//
// A placement is an instance of a building/prop kind dropped on the canvas: a
// position (canvas graph units = TILE_UNITS per metre), a rotation, and a lock.
// Footprint / colour / label are resolved from the SAME kind registries the rest
// of the editor uses, so a placement reads consistently with the preview + props.

import { buildingKindDefinition } from './world/buildingKinds';
import { propKindDefinition } from './game/kinds/props';
import { waterBodyPreset } from './game/kinds/waterBodies';
import { tileKindDefinition } from './world/tileKinds';
import type { Building, TileKind } from './design';
import { TILE_UNITS } from './heightData';
import { CHUNK_TILES } from './chunks';

// 'water' bodies are placements too (cat 'water', kind = a water preset id): they
// drop, snap, persist, and draw a footprint node exactly like a prop, and their
// footprint/level/shape re-resolve from game/kinds/waterBodies by kind.
export type PlaceCat = 'building' | 'prop' | 'marker' | 'water';

export interface Placement {
  id: string;
  cat: PlaceCat;
  kind: string;
  label: string;
  gx: number;        // canvas graph position (node CENTER)
  gy: number;
  rotation: number;  // degrees
  locked: boolean;
  footW: number;     // footprint width in tiles (1 tile = 1m)
  footD: number;     // footprint depth in tiles
  color: string;     // top-down swatch
  // Per-face (or whole-building) texture assignment for a building placement.
  // Carried here so it persists with the map and rides the compile to the game.
  // Omitted = the kind's default look. Same shape the game's Building.skin uses.
  skin?: Building['skin'];
  // Per-PART textures (render3d/parts.tsx) keyed by part id — the general texture
  // channel the click-to-pick inspector writes, for buildings AND props. Carried
  // through to the game's Building.partTextures / WorldProp.partTextures on compile.
  partTextures?: Record<string, string>;
  // For a 'marker' placement of kind 'save': the id of the 'spawn' marker it
  // respawns the player at (the manual save↔spawn link). Lowered to the spawn
  // cell's key on compile. Absent = unpaired (respawns at the save cell itself).
  spawnId?: string;
}

export interface Placeable { label: string; footW: number; footD: number; color: string; }

// Graph-center → the EXACT world-cell rect this placement occupies, plus the graph
// center of that snapped rect (what the canvas should draw). ONE function shared by
// the 2D node, the 3D preview, and the compile, so they can never disagree about
// which cells a placement covers.
//
// Why round(center − w/2) and not round(center) − floor(w/2): the old form put
// floor(w/2) tiles left and ceil(w/2) tiles right of the rounded center, so every
// ODD-width footprint sat half a tile right/south of the node the canvas drew —
// two buildings authored with equal edge margins compiled with a full tile of
// asymmetry between them. Rounding the min-corner directly keeps the box centered
// on the drawn node (exact when the node sits on the tile lattice an odd box can
// actually center on).
export function placementCellRect(
  p: Pick<Placement, 'gx' | 'gy' | 'footW' | 'footD'>,
): { minX: number; minZ: number; snapGx: number; snapGy: number } {
  const cx = p.gx / TILE_UNITS + CHUNK_TILES / 2; // graph units → world tiles
  const cz = p.gy / TILE_UNITS + CHUNK_TILES / 2;
  const minX = Math.round(cx - p.footW / 2);
  const minZ = Math.round(cz - p.footD / 2);
  return {
    minX,
    minZ,
    snapGx: (minX + p.footW / 2 - CHUNK_TILES / 2) * TILE_UNITS,
    snapGy: (minZ + p.footD / 2 - CHUNK_TILES / 2) * TILE_UNITS,
  };
}

// Footprint + swatch for a kind. Buildings use their facade colour + default
// footprint; props borrow their gameplay tile's colour and a square footprint.
export function resolvePlaceable(cat: PlaceCat, kind: string): Placeable {
  if (cat === 'building') {
    const def = buildingKindDefinition(kind as Parameters<typeof buildingKindDefinition>[0]);
    return { label: def.label, footW: def.defaultWidthTiles, footD: def.defaultDepthTiles, color: def.facadeColor };
  }
  if (cat === 'marker') {
    // A spawn/save marker is one cell: a 1×1 footprint wearing its tile colour.
    const def = tileKindDefinition(kind as TileKind);
    return { label: def.label, footW: 1, footD: 1, color: def.render.color };
  }
  if (cat === 'water') {
    const def = waterBodyPreset(kind);
    if (def) return { label: def.label, footW: def.footW, footD: def.footD, color: def.color };
    return { label: 'Water', footW: 12, footD: 8, color: '#3f8fbf' };
  }
  const def = propKindDefinition(kind as Parameters<typeof propKindDefinition>[0]);
  const footW = Math.max(1, Math.ceil(def.footprintWidthMeters ?? def.footprintRadiusMeters * 2));
  const footD = Math.max(1, Math.ceil(def.footprintDepthMeters ?? def.footprintRadiusMeters * 2));
  return { label: def.label, footW, footD, color: tileKindDefinition(def.tileKind).render.color };
}
