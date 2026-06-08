// objectPreview.ts — build a one-object mini-world + Focus for a (cat, kind), via
// the editor's real mutators. Shared by the Objects tab's live preview and by the
// cart's top-left "in focus" panel (so a selected placement inspects correctly).

import { emptyEditorWorld, placeWorldProp, fillTiles } from './editorWorld';
import type { Building, GameState, TileKind, WorldProp } from '../hmsc/design';
import type { Focus } from './PropertiesPanel';

// 'embedded' is the wall/door/bush profile group — built exactly like a tile
// (a slab + tile focus) so it inspects through the same path; it just lives in a
// separate tree group because it isn't freely paintable.
export type ObjCat = 'prop' | 'tile' | 'embedded' | 'marker';

export interface ObjectWorld {
  world: GameState;
  focus: Focus | null;
  building?: Building;
  prop?: WorldProp;
}

export function buildObjectWorld(
  cat: ObjCat,
  kind: string,
  skin?: Building['skin'],
  partTextures?: Record<string, string>,
): ObjectWorld {
  void skin;
  const base = emptyEditorWorld();
  // Tiles, embedded profiles, and gameplay markers (spawn/save) all inspect as a
  // tile: a slab of the kind + a tile focus, through the same fillTiles path.
  if (cat === 'tile' || cat === 'embedded' || cat === 'marker') {
    return { world: fillTiles(base, { kind: kind as TileKind, x: -5, z: -5, width: 10, depth: 10 }), focus: { kind: 'tile', tile: kind as TileKind } };
  }
  const { state, prop } = placeWorldProp(base, { kind: kind as WorldProp['kind'], x: 0, z: 0, partTextures });
  return { world: state, focus: { kind: 'prop', id: prop.id }, prop };
}
