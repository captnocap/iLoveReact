// Bind the semantic Fart Racer world to the active append-only tile and flora
// legends. The data compiler names KINDS; only this file turns a name into a
// catalog index, so a legend that grows never silently repaints the world.
import {
  packFartRacerBaselinePainting,
  type FartRacerBaselinePaintingStream,
  type FartRacerLegend,
} from '../data/fartRacerBaseline';
import { TERRAIN_FLORA_KINDS, TERRAIN_TILE_KINDS } from '../data/fartRacerTerrain';
import { FLORA_KIND_DEFINITIONS } from '../world/floraKinds';
import { TILE_KINDS } from '../world/tileKinds';

function resolveTiles(): readonly number[] {
  return TERRAIN_TILE_KINDS.map((kind) => {
    const index = TILE_KINDS.indexOf(kind);
    if (index < 0) throw new Error(`Fart Racer world requires missing tile kind '${kind}'`);
    return index;
  });
}

function resolveFlora(kinds: readonly string[]): readonly number[] {
  return kinds.map((kind) => {
    const index = FLORA_KIND_DEFINITIONS.findIndex((row) => row.kind === kind);
    if (index < 0) throw new Error(`Fart Racer world requires missing flora kind '${kind}'`);
    return index;
  });
}

export function compileFartRacerBaselinePainting(): FartRacerBaselinePaintingStream {
  const legend: FartRacerLegend = {
    tiles: resolveTiles(),
    grass: resolveFlora(TERRAIN_FLORA_KINDS.grass),
    tree: resolveFlora(TERRAIN_FLORA_KINDS.tree),
    bush: resolveFlora(TERRAIN_FLORA_KINDS.bush),
  };
  return packFartRacerBaselinePainting(legend);
}
