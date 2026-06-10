import type { PlacedCell, WorldSurfaceRegion } from '../design';
import { tileKindDefinition } from './tileKinds';

export const WORLD_SURFACE_REGION_MESH_SINK_METERS = 0.01;

export function placedCellTopMeters(placedCell: PlacedCell, cellSizeMeters: number): number {
  return placedCell.cell.y * cellSizeMeters + tileKindDefinition(placedCell.kind).render.heightMeters;
}

export function surfaceRegionTopMeters(region: WorldSurfaceRegion, cellSizeMeters: number): number {
  return region.y * cellSizeMeters + tileKindDefinition(region.kind).render.heightMeters - WORLD_SURFACE_REGION_MESH_SINK_METERS;
}
