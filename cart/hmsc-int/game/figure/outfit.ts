// game/figure/outfit.ts — CLOTHING AS ATTACHMENTS (CLOTHSPLIT-0606, USER
// RULING req_0040): "clothing should effectively be a prop that is seperate
// but tightly related, not entirely coupled."
//
// The outfit is the wardrobe ATTACHMENT SET: its own document, attached TO a
// body (one optional channel on the .body file, like paint) — never
// interleaved with the body's mesh truth (sculpts/profiles/regions). The
// prop analogy holds end to end: like a held item, an outfit names WHAT is
// worn; placement follows the RIG — attachOutfit() builds garment instances
// against an existing bones record (the V1 bones-in seam), exactly how a
// ragdoll keeps its clothes. Bottoms ride the pelvis bone (PELVISMESH-0606's
// part), tops the torso/arm chain, accessories the head/torso — the bone
// anchoring lives in clothing.ts placement code, unchanged by this split.
//
// V20, deterministic: documents saved before the split carry the wardrobe as
// four loose body fields (clothing/bottoms/clothingSkin/clothingAccessories)
// — outfitOf() maps them (including the DEFAULT_BOTTOMS coupling a missing
// bottoms always meant) so old saves dress exactly as they always did. New
// saves write the one `outfit` channel; the legacy fields stay readable
// forever.

import {
  CLOTHING, BOTTOMS, CLOTHING_SKINS, CLOTHING_ACCESSORIES, DEFAULT_BOTTOMS,
  type BodyPoseId, type BodyShapeId, type BottomsId, type ClothingAccessoryId, type ClothingId, type ClothingSkinId,
} from './shapes';
import { buildClothing, type ClothingInstance } from './clothing';
import type { Bones, RigTimelineAction } from './skeleton';

/** The wardrobe attachment set — what a figure WEARS, as one document. */
export type OutfitDocument = {
  kind: 'outfit';
  version: 1;
  /** the top garment ('underwear' is the minimal wardrobe) */
  top: ClothingId;
  bottoms: BottomsId;
  /** the clothing print (tee/hoodie artwork) */
  print: ClothingSkinId;
  accessories: ClothingAccessoryId[];
};

/** The default dress — what an unspecified wardrobe always meant. */
export function defaultOutfit(): OutfitDocument {
  return { kind: 'outfit', version: 1, top: 'tee', bottoms: DEFAULT_BOTTOMS.tee, print: 'plain', accessories: [] };
}

export function buildOutfit(args: {
  top?: ClothingId;
  bottoms?: BottomsId;
  print?: ClothingSkinId;
  accessories?: ClothingAccessoryId[];
}): OutfitDocument {
  const top = args.top ?? 'tee';
  return {
    kind: 'outfit',
    version: 1,
    top,
    // a missing bottoms ALWAYS meant the top's coherent default — the same
    // coupling the editor applies when picking a top
    bottoms: args.bottoms ?? DEFAULT_BOTTOMS[top],
    print: args.print ?? 'plain',
    accessories: (args.accessories ?? []).slice(),
  };
}

/** Tolerant outfit validation: a torn outfit degrades to null (the caller
 *  falls back to legacy fields/defaults), never to a rejected body. */
export function validateOutfit(value: unknown): OutfitDocument | null {
  const o = value as OutfitDocument;
  if (!o || o.kind !== 'outfit' || o.version !== 1) return null;
  if (!(o.top in CLOTHING) || !(o.bottoms in BOTTOMS) || !(o.print in CLOTHING_SKINS)) return null;
  if (!Array.isArray(o.accessories)) return null;
  const accessories = o.accessories.filter((a): a is ClothingAccessoryId => typeof a === 'string' && a in CLOTHING_ACCESSORIES);
  return { kind: 'outfit', version: 1, top: o.top, bottoms: o.bottoms, print: o.print, accessories };
}

/** What a body WEARS — the one read door. Narrow on purpose (structural over
 *  the wardrobe channels only, no body import): the new `outfit` channel
 *  wins; pre-split documents map their four legacy fields deterministically
 *  (the DEFAULT_BOTTOMS coupling preserved); a bare document wears the
 *  default dress, exactly as it always rendered. */
export function outfitOf(doc: {
  outfit?: OutfitDocument;
  clothing?: ClothingId;
  bottoms?: BottomsId;
  clothingSkin?: ClothingSkinId;
  clothingAccessories?: ClothingAccessoryId[];
}): OutfitDocument {
  const attached = doc.outfit ? validateOutfit(doc.outfit) : null;
  if (attached) return attached;
  return buildOutfit({
    top: doc.clothing,
    bottoms: doc.bottoms,
    print: doc.clothingSkin,
    accessories: doc.clothingAccessories,
  });
}

/** Dress an EXISTING rig: garment instances built against the bones record
 *  (the prop model — the body leads, attachments follow; hand the same bones
 *  a ragdoll produced and the outfit follows it). Placement code is
 *  clothing.ts's, unchanged: bottoms anchor the pelvis bone, tops the
 *  torso/arm chain, shoes the feet, accessories the head/torso. */
export function attachOutfit(
  bones: Bones,
  outfit: OutfitDocument,
  shapeId: BodyShapeId = 'neutral',
  pose: BodyPoseId = 'stand',
  phase = 0,
  actions: RigTimelineAction[] = [],
): ClothingInstance[] {
  return buildClothing(outfit.top, shapeId, pose, phase, actions, outfit.print, outfit.accessories, outfit.bottoms, bones);
}
