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
// A painted water grid (the terrain tool's water brush): per-cell surface level,
// centred on the body, `cell` metres apart. A cell ≤ 0 is dry. When present it
// overrides the parametric footprint (organic painted ponds, not just rect/disc).
export type WaterField = { cols: number; rows: number; cell: number; heights: number[]; base: number };

export type WaterBody = {
  id: string;
  label: string;
  shape: WaterBodyShape;
  x: number;
  z: number;
  width: number;
  depth: number;
  surfaceY: number;
  field?: WaterField;
  createdByCommand: string;
};

/** Bilinear sample of a painted water grid at body-local (lx,lz); off-grid = dry (-inf). */
function sampleWaterField(f: WaterField, lx: number, lz: number): number {
  const { cols, rows, cell, heights } = f;
  const fx = (lx + (cols - 1) * cell * 0.5) / cell;
  const fz = (lz + (rows - 1) * cell * 0.5) / cell;
  if (fx < 0 || fz < 0 || fx > cols - 1 || fz > rows - 1) return -Infinity;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const i1 = Math.min(i0 + 1, cols - 1);
  const j1 = Math.min(j0 + 1, rows - 1);
  const tx = fx - i0;
  const tz = fz - j0;
  const a = heights[j0 * cols + i0];
  const b = heights[j0 * cols + i1];
  const c = heights[j1 * cols + i0];
  const d = heights[j1 * cols + i1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/**
 * The water SURFACE level of a body at (x,z), or undefined where the body has no
 * water there. A painted body samples its grid (a cell well above the basin floor
 * `base` is wet — the surface can be ~0 for a flush pool, so the wet test is
 * relative to base, not to 0); a parametric body returns its surfaceY inside the
 * footprint (rect = the box, disc = the inscribed ellipse).
 */
export function waterSurfaceAt(b: WaterBody, x: number, z: number): number | undefined {
  if (b.field) {
    const s = sampleWaterField(b.field, x - (b.x + b.width / 2), z - (b.z + b.depth / 2));
    return s > b.field.base + 0.25 ? s : undefined;
  }
  if (x < b.x || x >= b.x + b.width || z < b.z || z >= b.z + b.depth) return undefined;
  if (b.shape === 'disc') {
    const rx = b.width / 2;
    const rz = b.depth / 2;
    if (rx <= 0 || rz <= 0) return undefined;
    const nx = (x - (b.x + rx)) / rx;
    const nz = (z - (b.z + rz)) / rz;
    if (nx * nx + nz * nz > 1) return undefined;
  }
  return b.surfaceY;
}

/** Is (x,z) covered by this body's water? */
export function waterBodyContains(b: WaterBody, x: number, z: number): boolean {
  return waterSurfaceAt(b, x, z) !== undefined;
}

/**
 * Derived water depth under (x,z): the factor product computed at lookup, never
 * stored. `bedTop` is the terrain ground top there (groundTopAt / landformGroundTopAt
 * / flat ground). 0 where the point has no water or the bed is at/above the surface.
 */
export function waterDepthAt(b: WaterBody, x: number, z: number, bedTop: number): number {
  const surface = waterSurfaceAt(b, x, z);
  return surface === undefined ? 0 : Math.max(0, surface - bedTop);
}

/** Submerged in THIS body: water covers (x,z) and the point is below its surface. */
export function submergedInWaterBody(b: WaterBody, x: number, z: number, worldY: number): boolean {
  const surface = waterSurfaceAt(b, x, z);
  return surface !== undefined && worldY < surface;
}

/** The water surface a body of water at (x,z) lifts to — highest over overlaps. undefined where dry. */
export function waterSurfaceTopAt(bodies: readonly WaterBody[] | undefined, x: number, z: number): number | undefined {
  let top: number | undefined;
  for (const b of bodies ?? []) {
    const surface = waterSurfaceAt(b, x, z);
    if (surface === undefined) continue;
    top = top == null ? surface : Math.max(top, surface);
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
