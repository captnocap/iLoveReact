import type { TileKind } from '../design';

export const HMSC_TILE_TEXTURE_KEYS = {
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
} satisfies Record<TileKind, string>;
