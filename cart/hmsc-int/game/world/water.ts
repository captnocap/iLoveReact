// game/world/water — bodies of water as FACTORS, not a depth grid (GUIDING_LIGHT:
// "keep the factors, throw away the product"). A body of water is the lowest-rank
// thing it can be: a footprint (an AABB the same min-corner + width/depth shape
// surface regions and placements use) plus ONE surface-level float. The DEPTH is
// never stored — it is the interaction of the level with the terrain bed,
// computed at lookup: depth(x,z) = surfaceY - groundTopAt(x,z). Dig the bed
// deeper (the height brush) and the same body gets deeper; raise it above the
// surface and an island pokes out. One float authored, the whole depth field
// derived.
//
// This generalizes the mountain's hard-coded crater lake (world/landforms
// mountainCraterLake) into something the editor's water tool authors anywhere.
// Both coexist and both read 'water' footing; the body is the authorable one.
//
// The player WADES — they walk the existing bed (flat ground or a heightfield
// landform), the 'water' tile's surface profile slows them, and the render shows
// the bed through a translucent surface. No collider is added: water is footing +
// a visible surface + derived depth, not a solid.

import type { TileKind } from '../kinds';
import type { Vec3 } from '../physics';

/** A footprint shape within the body's AABB. 'disc' = the inscribed ellipse. */
export type WaterBodyShape = 'rect' | 'disc';

/**
 * A body of water. Footprint is an axis-aligned box (min-corner + extent, 1 tile
 * = 1 m — the same frame as WorldSurfaceRegion/placements); `shape` decides
 * whether the whole box or its inscribed ellipse holds water. `surfaceY` is the
 * water surface height in metres — the single factor; depth is derived against
 * the terrain bed.
 */
export type WaterBody = {
  id: string;
  label: string;
  shape: WaterBodyShape;
  x: number;
  z: number;
  width: number;
  depth: number;
  surfaceY: number;
  createdByCommand: string;
};

/** Is (x,z) inside this body's footprint? Rect = the box; disc = the inscribed ellipse. */
export function waterBodyContains(b: WaterBody, x: number, z: number): boolean {
  if (x < b.x || x >= b.x + b.width || z < b.z || z >= b.z + b.depth) return false;
  if (b.shape === 'disc') {
    const rx = b.width / 2;
    const rz = b.depth / 2;
    if (rx <= 0 || rz <= 0) return false;
    const nx = (x - (b.x + rx)) / rx;
    const nz = (z - (b.z + rz)) / rz;
    return nx * nx + nz * nz <= 1;
  }
  return true;
}

/**
 * Derived water depth under (x,z): the factor product computed at lookup, never
 * stored. `bedTop` is the terrain ground top there (groundTopAt / landformGroundTopAt
 * / flat ground). 0 where the point is outside the body or the bed is at/above the
 * surface (an island, a shore).
 */
export function waterDepthAt(b: WaterBody, x: number, z: number, bedTop: number): number {
  if (!waterBodyContains(b, x, z)) return 0;
  return Math.max(0, b.surfaceY - bedTop);
}

/** Submerged in THIS body: inside the footprint and below the surface. */
export function submergedInWaterBody(b: WaterBody, x: number, z: number, worldY: number): boolean {
  return waterBodyContains(b, x, z) && worldY < b.surfaceY;
}

/** The water surface a body of water at (x,z) lifts to — highest over overlaps. undefined where dry. */
export function waterSurfaceTopAt(bodies: readonly WaterBody[] | undefined, x: number, z: number): number | undefined {
  let top: number | undefined;
  for (const b of bodies ?? []) {
    if (!waterBodyContains(b, x, z)) continue;
    top = top == null ? b.surfaceY : Math.max(top, b.surfaceY);
  }
  return top;
}

/**
 * 'water' footing when a body at `position` is submerged (the wade override —
 * you're IN the water, not on the bed; the host still walks the bed). The
 * world-layer peer of landformWaterKindAt (the crater-lake query).
 */
export function waterBodyKindAt(bodies: readonly WaterBody[] | undefined, position: Vec3): TileKind | undefined {
  for (const b of bodies ?? []) {
    if (submergedInWaterBody(b, position.x, position.z, position.y)) return 'water';
  }
  return undefined;
}
