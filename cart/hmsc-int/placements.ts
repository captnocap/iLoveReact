// placements.ts — object/building placements for the painter's 'place' layer.
//
// A placement is an instance of a building/prop kind dropped on the canvas: a
// position (canvas graph units = TILE_UNITS per metre), a rotation, and a lock.
// Footprint / colour / label are resolved from the SAME kind registries the rest
// of the editor uses, so a placement reads consistently with the preview + props.

import { buildingKindDefinition } from '../hmsc/world/buildingKinds';
import { propKindDefinition } from '../hmsc/world/propKinds';
import { tileKindDefinition } from '../hmsc/world/tileKinds';

export type PlaceCat = 'building' | 'prop';

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
}

export interface Placeable { label: string; footW: number; footD: number; color: string; }

// Footprint + swatch for a kind. Buildings use their facade colour + default
// footprint; props borrow their gameplay tile's colour and a square footprint.
export function resolvePlaceable(cat: PlaceCat, kind: string): Placeable {
  if (cat === 'building') {
    const def = buildingKindDefinition(kind as Parameters<typeof buildingKindDefinition>[0]);
    return { label: def.label, footW: def.defaultWidthTiles, footD: def.defaultDepthTiles, color: def.facadeColor };
  }
  const def = propKindDefinition(kind as Parameters<typeof propKindDefinition>[0]);
  const span = Math.max(1, Math.round(def.footprintRadiusMeters * 2));
  return { label: def.label, footW: span, footD: span, color: tileKindDefinition(def.tileKind).render.color };
}
