import type { TileKind } from '../design';

export const HMSC_TILE_TEXTURE_KEYS = {
  water: 'hmsc.tile.water',
  residential: 'hmsc.tile.residential',
  downtown: 'hmsc.tile.downtown',
  mixed: 'hmsc.tile.mixed',
  road: 'hmsc.tile.road',
  asphalt: 'hmsc.tile.asphalt',
  sidewalk: 'hmsc.tile.sidewalk',
  mud: 'hmsc.tile.mud',
  sand: 'hmsc.tile.sand',
  wall: 'hmsc.tile.wall',
  door: 'hmsc.tile.door',
  marker: 'hmsc.tile.marker',
} satisfies Record<TileKind, string>;
