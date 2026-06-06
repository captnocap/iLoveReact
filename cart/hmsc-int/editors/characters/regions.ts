// editors/characters/regions.ts — parametric region sculpting: named anatomy
// regions per part, each a slider in the UI; a region's value stamps a smooth
// elliptical raise/carve into the part's 48×24 sculpt grid.
//
// Behavior reference: cart/head_lab/index.tsx SHAPE_REGIONS + stampGrid +
// applyRegionValues (read, never imported). Pure functions of (grid, values)
// — headless-testable; the route bakes region values INTO the grid at save
// time (the document carries the composited sculpt, the regions are an edit
// affordance, not a document concept).

import { HED_GRID_H, HED_GRID_W } from '../../game/figure/hed';
import type { PartId } from '../../game/figure/shapes';

export type ShapeRegion = {
  id: string;
  label: string;
  /** ellipse center + radii in unwrap UV (0..1) */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** stamp a twin mirrored across the front meridian (u = 0.5) */
  mirror?: boolean;
};

/** P2 data: the named anatomy regions each part's sliders edit. */
export const SHAPE_REGIONS: Record<PartId, ShapeRegion[]> = {
  head: [
    { id: 'brow', label: 'brow ridge', cx: 0.5, cy: 0.38, rx: 0.22, ry: 0.07 },
    { id: 'eyes', label: 'eye sockets', cx: 0.43, cy: 0.45, rx: 0.07, ry: 0.08, mirror: true },
    { id: 'nose', label: 'nose', cx: 0.5, cy: 0.53, rx: 0.055, ry: 0.12 },
    { id: 'cheeks', label: 'cheeks', cx: 0.39, cy: 0.57, rx: 0.09, ry: 0.1, mirror: true },
    { id: 'mouth', label: 'mouth area', cx: 0.5, cy: 0.68, rx: 0.12, ry: 0.07 },
    { id: 'chin', label: 'chin', cx: 0.5, cy: 0.78, rx: 0.14, ry: 0.08 },
  ],
  torso: [
    { id: 'chest', label: 'chest', cx: 0.42, cy: 0.33, rx: 0.1, ry: 0.12, mirror: true },
    { id: 'belly', label: 'belly', cx: 0.5, cy: 0.55, rx: 0.15, ry: 0.18 },
    { id: 'waist', label: 'waist carve', cx: 0.5, cy: 0.66, rx: 0.2, ry: 0.08 },
    { id: 'hips', label: 'hips', cx: 0.38, cy: 0.76, rx: 0.12, ry: 0.12, mirror: true },
  ],
  // PELVISMESH-0606: the pelvis sculpts its own unwrap now — hip/seat/crotch
  // anatomy instead of the torso's chest-led set
  pelvis: [
    { id: 'hips', label: 'hip flare', cx: 0.38, cy: 0.42, rx: 0.13, ry: 0.14, mirror: true },
    { id: 'seat', label: 'seat', cx: 0.5, cy: 0.55, rx: 0.16, ry: 0.15 },
    { id: 'crotch', label: 'crotch carve', cx: 0.5, cy: 0.78, rx: 0.14, ry: 0.1 },
  ],
  pipe: [
    { id: 'upper', label: 'upper mass', cx: 0.5, cy: 0.28, rx: 0.34, ry: 0.14 },
    { id: 'middle', label: 'middle taper', cx: 0.5, cy: 0.52, rx: 0.28, ry: 0.12 },
    { id: 'lower', label: 'lower mass', cx: 0.5, cy: 0.76, rx: 0.34, ry: 0.14 },
  ],
  hand: [
    { id: 'palm', label: 'palm pad', cx: 0.5, cy: 0.52, rx: 0.2, ry: 0.22 },
    { id: 'knuckles', label: 'knuckles', cx: 0.39, cy: 0.3, rx: 0.08, ry: 0.08, mirror: true },
    { id: 'wrist', label: 'wrist', cx: 0.5, cy: 0.82, rx: 0.2, ry: 0.07 },
  ],
  foot: [
    { id: 'toe', label: 'toe box', cx: 0.5, cy: 0.74, rx: 0.24, ry: 0.11 },
    { id: 'arch', label: 'arch', cx: 0.5, cy: 0.52, rx: 0.2, ry: 0.11 },
    { id: 'heel', label: 'heel', cx: 0.5, cy: 0.28, rx: 0.22, ry: 0.11 },
  ],
  finger: [
    { id: 'tip', label: 'tip', cx: 0.5, cy: 0.18, rx: 0.42, ry: 0.08 },
    { id: 'middle', label: 'middle joint', cx: 0.5, cy: 0.48, rx: 0.42, ry: 0.07 },
    { id: 'base', label: 'base joint', cx: 0.5, cy: 0.76, rx: 0.42, ry: 0.08 },
  ],
};

export const REGION_TUNING = Object.freeze({
  /** |value| below this is treated as zero (slider dead zone) */
  epsilon: 0.001,
  /** quadratic falloff power applied twice: depth · falloff² */
  falloffSquared: true,
  /** a mirror twin only stamps when the region is off-center by more than this */
  mirrorMinOffset: 0.001,
  /** stamped grids stay inside the signed displacement range */
  clamp: { min: -1, max: 1 },
});

/** Per-part region slider values, −1 (carve) .. 1 (raise). */
export type RegionValues = Record<string, number>;

/** Stamp one smooth elliptical raise/carve into a 48×24 grid (in place). */
export function stampGrid(grid: number[], cx: number, cy: number, rx: number, ry: number, depth: number, mirror = false): void {
  for (let y = 0; y < HED_GRID_H; y++) {
    const v = ((y + 0.5) / HED_GRID_H - cy) / ry;
    for (let x = 0; x < HED_GRID_W; x++) {
      const u = ((x + 0.5) / HED_GRID_W - cx) / rx;
      const falloff = 1 - u * u - v * v;
      if (falloff <= 0) continue;
      const i = y * HED_GRID_W + x;
      grid[i] = Math.max(REGION_TUNING.clamp.min, Math.min(REGION_TUNING.clamp.max, grid[i] + depth * falloff * falloff));
    }
  }
  if (mirror && Math.abs(cx - 0.5) > REGION_TUNING.mirrorMinOffset) {
    stampGrid(grid, 1 - cx, cy, rx, ry, depth, false);
  }
}

/** A part's base sculpt grid with its region slider values stamped on top.
 *  Returns the base UNCHANGED (same reference) when every value is zero. */
export function applyRegionValues(part: PartId, base: number[], values: RegionValues | undefined): number[] {
  const regions = SHAPE_REGIONS[part];
  if (!values || regions.every((r) => Math.abs(values[r.id] ?? 0) < REGION_TUNING.epsilon)) return base;
  const next = base.slice();
  for (const region of regions) {
    const value = values[region.id] ?? 0;
    if (Math.abs(value) < REGION_TUNING.epsilon) continue;
    stampGrid(next, region.cx, region.cy, region.rx, region.ry, value, region.mirror);
  }
  return next;
}

/** A stable signature of slider values — rides in dyn keys so the preview
 *  mesh regenerates exactly when a region changes. */
export function regionSignature(values: RegionValues | undefined): string {
  if (!values) return 'r0';
  const keys = Object.keys(values).sort();
  if (keys.length === 0) return 'r0';
  return keys.map((k) => `${k}:${(values[k] ?? 0).toFixed(2)}`).join(',');
}
