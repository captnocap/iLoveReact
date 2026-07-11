// Editor-owned texture ids shared with the Zig tile renderer.
import type { TileKind } from '../design';

export const EDITOR_TILE_TEXTURE_KEYS = {
  water: 'hmsc.tile.water',
  road: 'hmsc.tile.road',
  asphalt: 'hmsc.tile.asphalt',
  sidewalk: 'hmsc.tile.sidewalk',
  mud: 'hmsc.tile.mud',
  sand: 'hmsc.tile.sand',
  wall: 'hmsc.tile.wall',
  door: 'hmsc.tile.door',
  bush: 'hmsc.tile.bush',
  marker: 'hmsc.tile.marker',
  spawn: 'hmsc.tile.spawn',
  save: 'hmsc.tile.save',
  // lane/junction tiles share the road surface texture — the directional
  // marking is paint-layer territory, not a separate base material
  laneNorth: 'hmsc.tile.road',
  laneSouth: 'hmsc.tile.road',
  laneEast: 'hmsc.tile.road',
  laneWest: 'hmsc.tile.road',
  junction: 'hmsc.tile.road',
  crosswalk: 'hmsc.tile.road',
  median: 'hmsc.tile.road',
  grass: 'hmsc.tile.grass',
  grassDry: 'hmsc.tile.grass',
  parking: 'hmsc.tile.parking',
  vehicleSpawn: 'hmsc.tile.vehicleSpawn',
  // shares the parking base — the stall direction is shader paint, not a
  // separate base material (like the lanes sharing the road texture)
  parkingCross: 'hmsc.tile.parking',
} satisfies Record<TileKind, string>;
