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
