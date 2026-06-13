// game/kinds/waterBodies — the preset bodies of water the editor's WATER catalog
// drops (the terrain twin of the prop/tile tables). A placed body is a THIN
// placement (cat 'water', kind = a preset id); its footprint, shape, surface
// level, and swatch all re-resolve from THIS table by kind — nothing per-instance
// is stored, exactly like a prop's footprint. So "make a body of water" is: pick a
// preset, drop it; variety (size/shape/depth) is data here, a new entry not new
// wiring. 1 tile = 1 m; surfaceY is the water surface height in metres (the depth
// over flat ground — dig the bed under it for a deeper body, world/water derives
// the depth).

import type { WaterBodyShape, WaterField } from '../world/water';

// The ONE water look, shared by the editor preview render (render3d/WaterBody)
// and the compiled-game bake (compile/worldGeometry) so water is identical in
// /test and the no-V8 game. Water renders as a translucent VOLUME (not a surface
// film) filling from the ground plane up to surfaceY — that's what reads as a
// body of water with depth: wade in and the blue surrounds you up to the surface.
// opacity < 1 routes it through the transparent pass (the path glass uses).
export const WATER_LOOK = {
  color: '#2f7fa8',
  opacity: 0.6,
  // How far below the ground plane (y=0) the volume tucks, so the waterline meets
  // the bed with no shoreline gap/z-fight.
  floorTuckMeters: 0.3,
} as const;

// The render volume for a body whose surface stands at surfaceY: a slab from just
// under the ground plane up to surfaceY. Used by the COMPILED bake (a static
// translucent slab instance). The editor render uses the wavy heightfield below.
export function waterBodyVolume(surfaceY: number): { height: number; centerY: number } {
  const bottom = -WATER_LOOK.floorTuckMeters;
  const height = Math.max(0.05, surfaceY - bottom);
  return { height, centerY: bottom + height / 2 };
}

// A gentle travelling surface wave (the ripple the editor render animates). Pure
// numbers — amplitude in metres, length in metres, speed in wave-cycles/second.
export const WATER_WAVE = { amplitude: 0.25, length: 4, speed: 0.32, dirX: 1, dirZ: 0.55 } as const;

const TAU = Math.PI * 2;

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

// The FLAT (still, t=0, no ripple) cols×rows height grid for a body: the surface
// level INSIDE the footprint, dropped to the basin floor `base` OUTSIDE it, so a
// 'disc' rounds off via the heightfield's own skirt at the ellipse edge. ~1 vertex
// per 2.5 m, capped. This is the still surface the wave rides on — the compiled
// game ships THIS grid + the wave params and applies the ripple host-side (its own
// clock); the editor adds the ripple per tick (waterHeightGrid below).
export function waterFlatHeights(
  shape: WaterBodyShape, width: number, depth: number, surfaceY: number,
): { cols: number; rows: number; heights: number[]; base: number } {
  const base = -WATER_LOOK.floorTuckMeters;
  const cols = clampInt(width / 2.5 + 1, 6, 24);
  const rows = clampInt(depth / 2.5 + 1, 6, 24);
  const rx = width / 2;
  const rz = depth / 2;
  const heights = new Array<number>(cols * rows);
  for (let j = 0; j < rows; j += 1) {
    const lz = -rz + (rows > 1 ? (j / (rows - 1)) * depth : 0);
    for (let i = 0; i < cols; i += 1) {
      const lx = -rx + (cols > 1 ? (i / (cols - 1)) * width : 0);
      const inside = shape !== 'disc' || (rx > 0 && rz > 0 && (lx / rx) ** 2 + (lz / rz) ** 2 <= 1);
      heights[j * cols + i] = inside ? surfaceY : base;
    }
  }
  return { cols, rows, heights, base };
}

/** Add the travelling ripple to a flat grid at time `t` (seconds) — the editor's
 *  animated surface. Outside-footprint cells (at `base`) stay flat. */
export function waterHeightGrid(
  shape: WaterBodyShape, width: number, depth: number, surfaceY: number, t: number,
): { cols: number; rows: number; heights: number[]; base: number } {
  const flat = waterFlatHeights(shape, width, depth, surfaceY);
  const { cols, rows, base } = flat;
  const rx = width / 2;
  const rz = depth / 2;
  const w = WATER_WAVE;
  const dlen = Math.hypot(w.dirX, w.dirZ) || 1;
  const ux = w.dirX / dlen;
  const uz = w.dirZ / dlen;
  for (let j = 0; j < rows; j += 1) {
    const lz = -rz + (rows > 1 ? (j / (rows - 1)) * depth : 0);
    for (let i = 0; i < cols; i += 1) {
      if (flat.heights[j * cols + i] <= base) continue; // outside the footprint
      const lx = -rx + (cols > 1 ? (i / (cols - 1)) * width : 0);
      flat.heights[j * cols + i] += Math.sin(((lx * ux + lz * uz) / w.length + t * w.speed) * TAU) * w.amplitude;
    }
  }
  return flat;
}

/** Ripple a PAINTED water field (the terrain water brush) at time `t`: wet cells
 *  (surface above the basin floor `base`) get the travelling wave; dry cells (at
 *  base, hidden under the terrain) stay put. Returns the heightfield grid the
 *  editor render bakes, same shape as waterHeightGrid so WaterBodyMesh treats
 *  painted + parametric bodies alike. The skirt fills down to the field's base. */
export function rippleWaterField(field: WaterField, t: number): { cols: number; rows: number; heights: number[]; base: number } {
  const { cols, rows, cell, heights: src, base } = field;
  const wetAbove = base + 0.25;
  const w = WATER_WAVE;
  const dlen = Math.hypot(w.dirX, w.dirZ) || 1;
  const ux = w.dirX / dlen;
  const uz = w.dirZ / dlen;
  const rx = ((cols - 1) * cell) / 2;
  const rz = ((rows - 1) * cell) / 2;
  const heights = new Array<number>(src.length);
  for (let j = 0; j < rows; j += 1) {
    const lz = -rz + j * cell;
    for (let i = 0; i < cols; i += 1) {
      const idx = j * cols + i;
      const h = src[idx]!;
      if (h <= wetAbove) { heights[idx] = h; continue; }
      const lx = -rx + i * cell;
      heights[idx] = h + Math.sin(((lx * ux + lz * uz) / w.length + t * w.speed) * TAU) * w.amplitude;
    }
  }
  return { cols, rows, heights, base };
}

export type WaterBodyPreset = {
  label: string;
  shape: WaterBodyShape;
  footW: number;
  footD: number;
  surfaceY: number;
  /** Top-down 2D swatch. */
  color: string;
};

export const WATER_BODY_PRESETS: Record<string, WaterBodyPreset> = {
  pondSmall: { label: 'Small Pond', shape: 'disc', footW: 10, footD: 10, surfaceY: 1.0, color: '#52a0cc' },
  pond: { label: 'Pond', shape: 'disc', footW: 18, footD: 14, surfaceY: 1.5, color: '#3f8fbf' },
  lake: { label: 'Lake', shape: 'disc', footW: 44, footD: 32, surfaceY: 2.5, color: '#2f7fa8' },
  pool: { label: 'Pool', shape: 'rect', footW: 12, footD: 8, surfaceY: 1.5, color: '#48b6d6' },
  canal: { label: 'Canal', shape: 'rect', footW: 8, footD: 40, surfaceY: 1.8, color: '#3f8fbf' },
};

export const WATER_BODY_PRESET_IDS = Object.keys(WATER_BODY_PRESETS);

export function waterBodyPreset(kind: string): WaterBodyPreset | undefined {
  return WATER_BODY_PRESETS[kind];
}
