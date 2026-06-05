// game/figure/body.ts — .body, the whole-character document (.hed/.sqi
// conventions): one JSON file carrying everything a figure IS — per-part
// sculpts + dragged outlines, the head's face layers, body shape, wardrobe,
// held item, pose. This is the V2-AMENDED authoring artifact: documents/seeds
// in, compiled population out (the bake consumes these; the game never
// re-evaluates them per frame).
//
// Captured fresh from cart/head_lab/parts.ts's document section (untouched).

import type { HedLayer } from './hed';
import {
  LEGACY_PART_IDS, PART_IDS, defaultProfile,
  type BodyPoseId, type BodyShapeId, type BottomsId, type ClothingAccessoryId, type ClothingId, type ClothingSkinId, type PartId,
} from './shapes';

export type BodyDocument = {
  kind: 'body';
  version: 1;
  skin: string;
  amount: number;
  headScaleY: number;
  bodyShape?: BodyShapeId;
  clothing?: ClothingId;
  bottoms?: BottomsId;
  clothingSkin?: ClothingSkinId;
  clothingAccessories?: ClothingAccessoryId[];
  heldItem?: string;
  bodyPose?: BodyPoseId;
  /** per part: quantized signed sculpt bytes (−127..127) + feature layers
   *  (the head's face lives in parts.head.layers) + the dragged outline
   *  (PROFILE_N radius samples; absent = the part's preset default). */
  parts: Record<PartId, { sculpt: number[]; layers: HedLayer[]; profile?: number[] }>;
  metadata?: { title?: string; createdAt?: number };
};

export function buildBody(args: {
  skin: string;
  amount: number;
  headScaleY: number;
  /** signed floats −1..1 per part (live edit grids); quantized to bytes here */
  sculpts: Record<PartId, number[]>;
  /** dragged outlines per part (PROFILE_N samples) */
  profiles: Record<PartId, number[]>;
  headLayers: HedLayer[];
  bodyShape?: BodyShapeId;
  clothing?: ClothingId;
  bottoms?: BottomsId;
  clothingSkin?: ClothingSkinId;
  clothingAccessories?: ClothingAccessoryId[];
  heldItem?: string;
  bodyPose?: BodyPoseId;
  title?: string;
}): BodyDocument {
  const parts = {} as BodyDocument['parts'];
  for (const id of PART_IDS) {
    parts[id] = {
      sculpt: (args.sculpts[id] ?? []).map((v) => Math.max(-127, Math.min(127, Math.round(v * 127)))),
      layers: id === 'head' ? args.headLayers : [],
      profile: id === 'head' ? undefined : (args.profiles[id] ?? defaultProfile(id)).slice(),
    };
  }
  return {
    kind: 'body',
    version: 1,
    skin: args.skin,
    amount: args.amount,
    headScaleY: args.headScaleY,
    bodyShape: args.bodyShape,
    clothing: args.clothing,
    bottoms: args.bottoms,
    clothingSkin: args.clothingSkin,
    clothingAccessories: args.clothingAccessories,
    heldItem: args.heldItem,
    bodyPose: args.bodyPose,
    parts,
    metadata: { title: args.title, createdAt: Date.now() },
  };
}

export function parseBody(text: string): BodyDocument | null {
  let doc: any;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || doc.kind !== 'body' || doc.version !== 1) return null;
  if (typeof doc.skin !== 'string' || !doc.parts) return null;
  // validate against the legacy part set: documents written before the finger
  // part stay valid forever (schema evolution by addition — the V20 rule)
  for (const id of LEGACY_PART_IDS) {
    const part = doc.parts[id];
    if (!part || !Array.isArray(part.sculpt) || !Array.isArray(part.layers)) return null;
  }
  return doc as BodyDocument;
}

export function serializeBody(doc: BodyDocument): string {
  return JSON.stringify(doc);
}
