// editors/items/bake.ts — voxel blockout → sculptable Globe (ITEMSCULPT-0606).
//
// The parameterization decision, made honest: the /voxels blockout becomes a
// GLOBE-WRAP — every 48×24 unwrap cell ray-marches the voxel occupancy from
// the blockout's centroid, and the hit distances bake into the SAME radial
// displacement field the character editor sculpts. The entire sculpt stack
// (grab-drag, depth paint, lattice, mirror, undo) then works on the imported
// shape unchanged, and "smooth out the blocky shape" is free — the Globe's
// bilinear sample + finite-difference normals ARE the smoothing; voxel steps
// arrive as soft bumps you flatten or soften.
//
// THE LIMIT, surfaced (not hidden): the wrap is star-shaped from the
// centroid. One distance per direction means concave overhangs, holes, and
// L-arm interiors flatten to their outer hull. For "bottles, bats, tools,
// most props" — the game-item ask — this covers it; faithful any-topology
// items would need a marching-cubes skin + a new pick parameterization
// (rejected for now: weeks of new surface area vs zero reuse).
//
// Pure math, headless-testable. Voxel units are METERS (the /voxels grid is
// the 1m³ authoring substrate), so a baked item is real-scale by construction
// — the V11 scale audit still owns the verdict (scaleStatus stays 'unaudited').

import type { GlobeParams } from '@reactjit/geometries';
import type { ItemDefinition } from '../../game/items';
import type { VoxelBlockoutDoc } from '../voxels/stream';
import { PAINT_EDITOR_TUNING } from '../characters/paintKit';

const GRID_W = PAINT_EDITOR_TUNING.grid.width;
const GRID_H = PAINT_EDITOR_TUNING.grid.height;
const PI = Math.PI;

export const ITEM_BAKE_TUNING = Object.freeze({
  /** ray-march step, meters (¼ voxel: fine enough that a face never skips) */
  stepMeters: 0.25,
  /** half a step rides on every hit — the march finds the LAST occupied
   *  sample, so the surface sits mid-step beyond it on average */
  hitBias: 0.125,
  /** amount = maxDeviation × this — sculpt headroom past the baked shape */
  amountHeadroom: 1.3,
  /** amount never drops below this fraction of the base radius (a perfect
   *  sphere bakes near-zero deviation; a dead amount would kill sculpting —
   *  hasGrid needs amount ≠ 0 and the drag axis length IS the amount) */
  amountMinFracOfRadius: 0.45,
  /** absolute amount floor, meters */
  amountMin: 0.12,
  /** a ray that hits nothing (centroid outside the occupancy on that side)
   *  sits at this fraction of the smallest hit — close to the core, honest
   *  about "there is nothing out there" without cratering to zero */
  missFrac: 0.35,
  /** the sculpt mesh LOD — segments match the grid so every lattice cell is
   *  a real quad (the characters head runs 40×20; one item affords more) */
  segments: 48,
  rings: 24,
});

/** A baked (or blank) sculptable item's Globe geometry. */
export type ItemGlobeBake = {
  /** base sphere radius, meters */
  radius: number;
  /** world meters at displace = ±1 */
  amount: number;
  /** signed −1..1 displacement, 48×24 row-major — THE one sculpt truth */
  grid: number[];
  /** how many unwrap cells saw the occupancy (the star-shape health report) */
  hits: number;
  misses: number;
};

export function emptyItemGrid(): number[] {
  return new Array(GRID_W * GRID_H).fill(0);
}

/**
 * Ray-march the blockout from its centroid along every unwrap direction.
 * Deterministic (fixed step, no randomness): the same blockout always bakes
 * the same field. Returns null for an empty blockout.
 *
 * Conventions pinned to the rest of the stack:
 *  - a block at integer (x,y,z) is a unit cube spanning ±0.5 on each axis
 *    (exactly how /voxels renders and picks them), so the cell containing a
 *    world point is Math.round per axis;
 *  - (u,v) → direction matches Globe.ts base(): theta = π·v from +Y,
 *    phi = π/2 − 2π·u, dir = [sinθ·cosφ, cosθ, sinθ·sinφ] — the baked field
 *    reads on the mesh exactly where the march looked.
 */
export function bakeBlockoutToGlobe(doc: VoxelBlockoutDoc | null): ItemGlobeBake | null {
  const blocks = doc?.blocks ?? [];
  if (blocks.length === 0) return null;
  const T = ITEM_BAKE_TUNING;

  const occupied = new Set(blocks.map((b) => `${b.x}:${b.y}:${b.z}`));
  let cx = 0, cy = 0, cz = 0;
  for (const b of blocks) { cx += b.x; cy += b.y; cz += b.z; }
  cx /= blocks.length; cy /= blocks.length; cz /= blocks.length;

  // march no farther than the farthest cube corner can sit
  let maxR = 0;
  for (const b of blocks) {
    const d = Math.hypot(b.x - cx, b.y - cy, b.z - cz);
    if (d > maxR) maxR = d;
  }
  maxR += Math.sqrt(3) / 2 + T.stepMeters;

  const r = new Array(GRID_W * GRID_H).fill(-1);
  let hits = 0;
  for (let gy = 0; gy < GRID_H; gy++) {
    const cv = (gy + 0.5) / GRID_H;
    const theta = PI * cv;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let gx = 0; gx < GRID_W; gx++) {
      const cu = (gx + 0.5) / GRID_W;
      const phi = PI / 2 - 2 * PI * cu;
      const dx = st * Math.cos(phi), dy = ct, dz = st * Math.sin(phi);
      // LAST occupied sample = the outer hull (interior gaps don't truncate)
      let last = -1;
      for (let s = 0; s <= maxR; s += T.stepMeters) {
        const px = Math.round(cx + dx * s);
        const py = Math.round(cy + dy * s);
        const pz = Math.round(cz + dz * s);
        if (occupied.has(`${px}:${py}:${pz}`)) last = s;
      }
      if (last >= 0) {
        r[gy * GRID_W + gx] = last + T.hitBias;
        hits++;
      }
    }
  }

  // unhit directions hug the core (see ITEM_BAKE_TUNING.missFrac)
  const misses = r.length - hits;
  let minHit = Infinity;
  for (const v of r) if (v >= 0 && v < minHit) minHit = v;
  const missR = Math.max(minHit * ITEM_BAKE_TUNING.missFrac, 0.1);
  for (let i = 0; i < r.length; i++) if (r[i] < 0) r[i] = missR;

  // base radius = the mean extent; amount covers the deviation with headroom
  let sum = 0;
  for (const v of r) sum += v;
  const radius = sum / r.length;
  let dev = 0;
  for (const v of r) dev = Math.max(dev, Math.abs(v - radius));
  const amount = Math.max(dev * T.amountHeadroom, radius * T.amountMinFracOfRadius, T.amountMin);
  const grid = r.map((v) => Math.max(-1, Math.min(1, (v - radius) / amount)));
  return { radius, amount, grid, hits, misses };
}

// ── the sculpted item's working shape (the /items draft + its Globe params) ──

export const ITEM_DRAFT_DEFAULTS = Object.freeze({
  /** the blank canvas: a small sphere you can sculpt from scratch */
  radius: 0.35,
  amount: 0.2,
  color: '#cbd5df',
  /** the editor's item color palette */
  colors: ['#cbd5df', '#d8b56a', '#9ca3af', '#b45757', '#5b8c5a', '#4fc3df', '#3a261b', '#20242c'],
});

/** The PREVIEW/render Globe params for a sculpted item — unit-sphere base
 *  (no profile, uniform scale) so displacement is purely radial and the bake
 *  inversion above is exact. The grab kit, the lattice shell, and the bake
 *  all read geometry through these. */
export function itemGlobeParams(item: { radius: number; amount: number; grid: number[] }): GlobeParams {
  const T = ITEM_BAKE_TUNING;
  return {
    radius: item.radius,
    segments: T.segments,
    rings: T.rings,
    displace: item.grid,
    dCols: GRID_W,
    dRows: GRID_H,
    amount: item.amount,
  };
}

// ── registry door (V11): a sculpted item AS an ItemDefinition ────────────────

/** A saved sculpted item, shaped for game/items consumers (held/dropped
 *  rendering). One part, geometry 'globe', real meters — heldScale 1 (the
 *  gallery scale table exists for the unaudited oversized models; a sculpted
 *  item is authored at world scale). scaleStatus stays 'unaudited': V11's
 *  mandatory scale audit is the user's verdict, not the tool's. */
export function sculptedItemDefinition(
  id: string,
  doc: { name: string; radius: number; amount: number; grid: number[]; color: string },
): ItemDefinition {
  return {
    id,
    label: doc.name,
    tone: doc.color,
    note: 'sculpted in /items from a voxel blockout',
    scaleStatus: 'unaudited',
    heldScale: 1,
    parts: [{
      geometry: 'globe',
      params: itemGlobeParams(doc) as Record<string, unknown>,
      material: doc.color,
      position: [0, 0, 0],
    }],
  };
}
