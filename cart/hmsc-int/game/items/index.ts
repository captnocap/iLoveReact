// game/items — THE DOOR (P3). The items registry + model definitions (V11),
// captured 2026-06-05 from cart/game_item_gallery (the untouched behavior
// reference). Consumers import from HERE (or receive GAME_ITEMS via
// game/index.ts); they never reach into the family files.
//
// The models are PART TABLES (P2 data, no React/JSX in this door — a renderer
// or the bake maps parts → Scene3D.Mesh rows). V11 stands: every item is
// scaleStatus 'unaudited' until the mandatory scale audit (the editors/items
// workbench — the EDITORS wave) reworks it against the 1-tile=1m contract;
// approxItemBoundsMeters is that audit's starting data. physics_lab's catalog
// folds in AFTER REVIEW (not yet ruled folded — see CAPTURE.md).

export {
  ITEM_DEFINITIONS,
  ITEM_GEOMETRIES,
  ITEM_GEOMETRY_DEFAULTS,
  ITEM_IDS,
  ITEM_TEXTURE_KEYS,
  approxItemBoundsMeters,
  approxPartSizeMeters,
  isItemId,
  itemDefinition,
  itemNamesForConsole,
} from './items';
export type { ItemBounds, ItemDefinition, ItemGeometryName, ItemPart, ItemScaleStatus } from './items';

export {
  ITEM_CUSTOM_GEOMETRIES,
  generateBlade,
  generateBoatHull,
  generateSail,
  generateSurfboard,
} from './geometries';
export type { BladeParams, BoatHullParams, SailParams, SurfboardParams, V3 } from './geometries';

import {
  ITEM_DEFINITIONS as DEFINITIONS,
  ITEM_GEOMETRIES as GEOMETRIES,
  ITEM_IDS as IDS,
  ITEM_TEXTURE_KEYS as TEXTURE_KEYS,
  approxItemBoundsMeters as boundsOf,
  isItemId as isId,
  itemDefinition as get,
  itemNamesForConsole as namesForConsole,
} from './items';

// The V14/V17 ground-floor handle: `import { GAME_ITEMS } from '@game'`.
export const GAME_ITEMS = Object.freeze({
  definitions: DEFINITIONS,
  ids: IDS,
  geometries: GEOMETRIES,
  textureKeys: TEXTURE_KEYS,
  is: isId,
  get,
  bounds: boundsOf,
  namesForConsole,
});
