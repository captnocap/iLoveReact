// objectPreview.ts — build a one-object mini-world + Focus for a (cat, kind), via
// the editor's real mutators. Shared by the Objects tab's live preview and by the
// cart's top-left "in focus" panel (so a selected placement inspects correctly).

import { emptyEditorWorld, placeBuilding, placeWorldProp, fillTiles } from './editorWorld';
import { buildingKindDefinition } from '../hmsc/world/buildingKinds';
import type { Building, GameState, TileKind, WorldProp } from '../hmsc/design';
import type { Focus } from './PropertiesPanel';

// 'embedded' is the wall/door/bush profile group — built exactly like a tile
// (a slab + tile focus) so it inspects through the same path; it just lives in a
// separate tree group because it isn't freely paintable.
export type ObjCat = 'building' | 'prop' | 'tile' | 'embedded';

export interface ObjectWorld {
  world: GameState;
  focus: Focus | null;
  building?: Building;
  prop?: WorldProp;
}

export function buildObjectWorld(cat: ObjCat, kind: string): ObjectWorld {
  const base = emptyEditorWorld();
  if (cat === 'tile' || cat === 'embedded') {
    return { world: fillTiles(base, { kind: kind as TileKind, x: -5, z: -5, width: 10, depth: 10 }), focus: { kind: 'tile', tile: kind as TileKind } };
  }
  if (cat === 'building') {
    const def = buildingKindDefinition(kind as Parameters<typeof buildingKindDefinition>[0]);
    const w = def.defaultWidthTiles;
    const d = def.defaultDepthTiles;
    const r = placeBuilding(base, { kind: kind as Parameters<typeof buildingKindDefinition>[0], x: -Math.floor(w / 2), z: -Math.floor(d / 2), force: true });
    return r.ok ? { world: r.state, focus: { kind: 'building', id: r.building.id }, building: r.building } : { world: base, focus: null };
  }
  const { state, prop } = placeWorldProp(base, { kind: kind as WorldProp['kind'], x: 0, z: 0 });
  return { world: state, focus: { kind: 'prop', id: prop.id }, prop };
}
