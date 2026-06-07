// editors/workbench/clothing/live.ts — the GARMENT store's LIVE singleton
// (CLOTHSOURCE-0606; the buildings/live.ts split: store.ts stays
// P4-bundleable, this module touches the editor singletons + the React-side
// texture registry).
//
// Wiring: the source opens its OWN V20 session on the clothing-variants
// channel ('/workbench' route id) — saving a material variant is ONE
// `garmentVariantSaved` commit; error captured (the census store-unavailable
// convention; the roster still lists the garment tables when the store is
// down — saves just don't land). Materials come from THE texture registry
// (game/textures): allTextures for the picker, textureById for the existence
// gate — a variant IS a material assignment, by construction.

import { editorChannel } from '../../store';
import { editorSessions, type RouteSession } from '../../sessions';
import { clothingVariantsStream, type ClothingVariantsEvent, type ClothingVariantsState } from '../../../game/figure/clothingVariants';
import { allTextures, textureById } from '../../../game/textures/registry';
import { paintBenchStore } from '../paint/live';
import { createClothingStore, type ClothingStore } from './store';

let live: ClothingStore | null = null;

export function clothingWorkbenchStore(): ClothingStore {
  if (live) return live;
  let session: RouteSession<ClothingVariantsEvent> | null = null;
  let variants: (() => ClothingVariantsState | null) = () => null;
  let error: string | null = null;
  try {
    const channel = editorChannel(clothingVariantsStream);
    session = editorSessions().open('/workbench', channel) as RouteSession<ClothingVariantsEvent>;
    variants = () => {
      try { return channel.state(); } catch { return null; }
    };
  } catch (e: any) {
    error = String(e?.message ?? e);
  }
  live = createClothingStore({
    variants,
    session,
    error,
    validMaterial: (id: string) => textureById(id) !== undefined,
    materials: () => allTextures().map((t) => ({ id: t.id, label: t.label })),
    // CLOTHFLIP-0607 — "brings me to the painter": THE shared bench, opened
    // on the garment-design target (its save routes back to this stream)
    openDesigner: (garmentId: string, designId: string | null) => {
      paintBenchStore().open({ kind: 'garment-design', garmentId, designId });
    },
  });
  return live;
}
