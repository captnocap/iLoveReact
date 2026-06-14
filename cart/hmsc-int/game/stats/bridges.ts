// game/stats/bridges.ts — keep stats SEPARABLE, bridge with thin maps.
//
// GUIDING_LIGHT: coupling is the rank that costs. The stat model owns its own
// vocab (PantsId/BackpackId, notoriety as a plain 0..100 scalar) and never
// imports the perception/figure systems' internals. These bridges are the only
// seam: they translate between the stat shape and the systems that already exist
// (the heat/notoriety wanted source, the figure's OutfitDocument), so wanted and
// outfit have ONE source of truth instead of a divergent second copy.

import type { OutfitDocument } from '../figure/outfit';
import type { BottomsId, ClothingId } from '../figure/shapes';
import { wantedStars, type OutfitLoadout, type PantsId, type BackpackId } from './stats';

// ── wanted ← notoriety (the live heat scalar / GAME_PERCEPTION blend) ──────────

/** The wanted level for a notoriety value (0..100). The caller passes the live
 *  source — `player.heat` today, GAME_PERCEPTION.computeNotoriety once the Case
 *  is wired — and stats does the 6-star quantization. One bridge, one truth. */
export function wantedFromNotoriety(notoriety: number): number {
  return wantedStars(notoriety);
}

// ── outfit ↔ figure OutfitDocument ────────────────────────────────────────────

// The figure renders from an OutfitDocument (top/bottoms/print/accessories); the
// stat loadout is the five gameplay slots. bottoms IS the pants axis (same ids),
// top IS the shirt; head/backpack/shoes are accessory-borne until the figure
// grows first-class slots — read from accessory ids by prefix so an authored
// 'backpack' accessory drives carry capacity.

const BACKPACK_FROM_ACCESSORY: Record<string, BackpackId> = {
  satchel: 'satchel',
  backpack: 'backpack',
  suitcase: 'suitcase',
};

function backpackFromAccessories(accessories: string[]): BackpackId {
  for (const a of accessories) {
    const hit = BACKPACK_FROM_ACCESSORY[a];
    if (hit) return hit;
  }
  return 'none';
}

/** Build the gameplay loadout from a figure outfit document. */
export function loadoutFromDocument(doc: OutfitDocument): OutfitLoadout {
  return {
    head: 'none',
    shirt: doc.top,
    pants: doc.bottoms as PantsId, // BottomsId ⊂ PantsId by construction
    backpack: backpackFromAccessories(doc.accessories as string[]),
    shoes: 'sneakers',
  };
}

/** Patch a figure outfit document from the gameplay loadout (the slots the
 *  figure can render today: shirt→top, pants→bottoms). Other slots pass through
 *  the existing document untouched. */
export function documentFromLoadout(loadout: OutfitLoadout, base: OutfitDocument): OutfitDocument {
  return {
    ...base,
    top: loadout.shirt as ClothingId,
    bottoms: loadout.pants as BottomsId,
  };
}
