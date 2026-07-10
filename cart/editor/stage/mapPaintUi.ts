import type { MapBrushGizmo, MapBrushProfile, MapBrushShape, MapTerrainTool } from '../../../runtime/game/map';
import type { MapPaintChannel } from './mapPaint';

export const CHANNELS: MapPaintChannel[] = ['terrain', 'tile', 'water', 'flora', 'zone', 'road'];
export const CHANNEL_META: Record<MapPaintChannel, { icon: string; label: string; tooltip: string }> = {
  terrain: { icon: 'Mountain', label: 'Terrain', tooltip: 'Terrain - sculpt the heightfield' },
  tile: { icon: 'Grid3x3', label: 'Tile', tooltip: 'Tile - paint ground tile kinds' },
  water: { icon: 'Waves', label: 'Water', tooltip: 'Water - carves its own bed into any terrain' },
  flora: { icon: 'Leaf', label: 'Flora', tooltip: 'Flora - plant trees, palms and grass' },
  zone: { icon: 'LandPlot', label: 'Zone', tooltip: 'Zone - paint named zone regions' },
  road: { icon: 'Route', label: 'Road', tooltip: 'Road - draft a centerline, commit lanes' },
};

export const TERRAIN_TOOLS: MapTerrainTool[] = ['brush', 'ramp', 'slope', 'smooth'];
export const TERRAIN_TOOL_META: Record<MapTerrainTool, { icon: string; label: string; tooltip: string }> = {
  brush: { icon: 'Brush', label: 'Brush', tooltip: 'Brush - stamp hills and basins' },
  ramp: { icon: 'TriangleRight', label: 'Ramp', tooltip: 'Ramp - a straight low-to-high ramp band' },
  slope: { icon: 'MoveUpRight', label: 'Slope', tooltip: 'Slope - grade the brushed area low-to-high' },
  smooth: { icon: 'Blend', label: 'Smooth', tooltip: 'Smooth - blend and average terrain heights' },
};

export const SHAPES: MapBrushShape[] = ['circle', 'square', 'diamond'];
export const PROFILES: MapBrushProfile[] = ['cone', 'flat', 'dome'];

export const GIZMOS: MapBrushGizmo[] = ['beam', 'decal', 'rings', 'profile', 'handles'];
export const GIZMO_META: Record<MapBrushGizmo, { icon: string; label: string; tooltip: string }> = {
  beam: { icon: 'Cuboid', label: 'Beam', tooltip: 'Hard beam brush - solid footprint' },
  decal: { icon: 'Disc3', label: 'Decal', tooltip: 'Projected decal brush - filled center with feathered edge' },
  rings: { icon: 'Target', label: 'Rings', tooltip: 'Ring brush - center and banded footprint' },
  profile: { icon: 'Cone', label: 'Prof', tooltip: 'Falloff profile brush - follows the selected profile' },
  handles: { icon: 'Crosshair', label: 'Handles', tooltip: 'Handle brush - center, axes and cardinal pads' },
};

export function cycle<T>(items: readonly T[], current: T): T {
  return items[(items.indexOf(current) + 1) % items.length]!;
}
