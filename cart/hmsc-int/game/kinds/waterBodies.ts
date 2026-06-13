// game/kinds/waterBodies — the preset bodies of water the editor's WATER catalog
// drops (the terrain twin of the prop/tile tables). A placed body is a THIN
// placement (cat 'water', kind = a preset id); its footprint, shape, surface
// level, and swatch all re-resolve from THIS table by kind — nothing per-instance
// is stored, exactly like a prop's footprint. So "make a body of water" is: pick a
// preset, drop it; variety (size/shape/depth) is data here, a new entry not new
// wiring. 1 tile = 1 m; surfaceY is the water surface height in metres (the depth
// over flat ground — dig the bed under it for a deeper body, world/water derives
// the depth).

import type { WaterBodyShape } from '../world/water';

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
// under the ground plane up to surfaceY. ONE source for the editor mesh and the
// compiled bake, so both fill the same column. (Bottom is the ground plane, not a
// per-cell bed sample — a body dropped on flat ground fills 0→surfaceY and covers
// the player; this is the visible body, while world/water derives wade depth.)
export function waterBodyVolume(surfaceY: number): { height: number; centerY: number } {
  const bottom = -WATER_LOOK.floorTuckMeters;
  const height = Math.max(0.05, surfaceY - bottom);
  return { height, centerY: bottom + height / 2 };
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
