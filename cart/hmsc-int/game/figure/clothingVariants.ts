// game/figure/clothingVariants — the V20 per-concern stream for USER-SAVED
// garment variants (CLOTHSOURCE-0606, dispatch req_0187: "the same item
// across many materials").
//
// A variant is data, not a fork of the placement math: {garment, material} —
// the material is a textureId into THE texture registry (game/textures), the
// one-source-of-truth materials rule (the BUILDSKIN law, worn here too). The
// built-in CLOTHING_SKINS prints are SEEDS generated from shapes.ts, never
// stored; this stream holds only what the user authored. The materializer is
// a dumb upsert keyed (garmentId, variantId); unknown event kinds are future
// additions by contract — old logs stay valid forever (V20).

import type { StreamDef } from '../../data';
import type { PaintedOverlay } from '../painted';

export type SavedGarmentVariant = {
  /** stable within the garment — `mat:<textureId>` (one variant per
   *  material) or a minted `dsn-…` design id */
  id: string;
  label: string;
  /** a MATERIAL variant: a textureId resolving in THE texture registry */
  textureId?: string;
  /** a DESIGN variant (CLOTHFLIP-0607): the painter's baked overlay — the
   *  same PaintedOverlay shape model paint saves (one bake truth). Carries
   *  its own re-editable paintDoc, so designs reopen in the bench. */
  overlay?: PaintedOverlay;
};

export type ClothingVariantsState = {
  /** user-saved variants by garment id (`top:tee`, …), save order */
  variants: Record<string, SavedGarmentVariant[]>;
};

export type ClothingVariantsEvent =
  | { kind: 'garmentVariantSaved'; garmentId: string; variant: SavedGarmentVariant }
  | { kind: 'garmentVariantRemoved'; garmentId: string; variantId: string };

export const clothingVariantsStream: StreamDef<ClothingVariantsState, ClothingVariantsEvent> = Object.freeze({
  name: 'clothing-variants',
  initial: (): ClothingVariantsState => ({ variants: {} }),
  apply: (state: ClothingVariantsState, event: ClothingVariantsEvent): ClothingVariantsState => {
    switch (event?.kind) {
      case 'garmentVariantSaved': {
        const list = state.variants[event.garmentId] ?? [];
        const i = list.findIndex((v) => v.id === event.variant.id);
        const next = i >= 0 ? list.map((v, j) => (j === i ? event.variant : v)) : [...list, event.variant];
        return { variants: { ...state.variants, [event.garmentId]: next } };
      }
      case 'garmentVariantRemoved': {
        const list = state.variants[event.garmentId];
        if (!list || !list.some((v) => v.id === event.variantId)) return state;
        return { variants: { ...state.variants, [event.garmentId]: list.filter((v) => v.id !== event.variantId) } };
      }
      default:
        // Unknown kinds are future additions — old materializers skip them.
        return state;
    }
  },
});
