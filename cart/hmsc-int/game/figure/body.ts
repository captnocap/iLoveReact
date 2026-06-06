// game/figure/body.ts — .body, the whole-character document (.hed/.sqi
// conventions): one JSON file carrying everything a figure IS — per-part
// sculpts + dragged outlines, the head's face layers, body shape, wardrobe,
// held item, pose. This is the V2-AMENDED authoring artifact: documents/seeds
// in, compiled population out (the bake consumes these; the game never
// re-evaluates them per frame).
//
// Captured fresh from cart/head_lab/parts.ts's document section (untouched).

import type { HedLayer } from './hed';
import { validatePaintedOverlay, type PaintedOverlay } from '../painted';
import {
  LEGACY_PART_IDS, PAINT_TARGET_IDS, PART_IDS, defaultProfile,
  type BodyPoseId, type BodyShapeId, type BottomsId, type ClothingAccessoryId, type ClothingId, type ClothingSkinId, type PaintTargetId, type PartId,
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
  /** MODELPAINT-0605 (additive — pre-paint documents stay valid forever):
   *  pixel-painted color overlays, authored in /cutout, keyed by PAINT
   *  TARGET — a part (the all-instances surface, the original vocabulary)
   *  or one limb segment (LIMBPAINT: "left upper arm, lower arm, upper leg,
   *  lower leg"; segment wins, part is the fallback). Composited in the
   *  unwrap stack where the photo sits — UNDER the face's shape layers,
   *  OVER the skin. Color only; depth never rides this channel. */
  paint?: Partial<Record<PaintTargetId, PaintedOverlay>>;
  metadata?: { title?: string; createdAt?: number };
};

/** PELVISMESH-0606, the V20 fallback: documents saved before the pelvis was
 *  a real part carry no `parts.pelvis` — back then the pelvis WORE the torso
 *  (the whole torso globe scaled down onto the pelvis bone), so the
 *  deterministic mapping is a COPY of the torso's sculpt + profile. Old saves
 *  render exactly as they always did; the copy diverges the moment the user
 *  sculpts the pelvis. Pure; returns the SAME reference when the document
 *  already carries a pelvis (new saves are untouched). */
export function partsWithPelvisFallback(parts: BodyDocument['parts']): BodyDocument['parts'] {
  if (parts.pelvis) return parts;
  const torso = parts.torso;
  return {
    ...parts,
    pelvis: {
      sculpt: (torso?.sculpt ?? []).slice(),
      layers: [],
      profile: torso?.profile ? torso.profile.slice() : defaultProfile('pelvis'),
    },
  };
}

/** Set/replace/remove one target's painted overlay — pure, additive (the
 *  /cutout save path; everything else on the document is untouched). */
export function applyBodyPaint(doc: BodyDocument, target: PaintTargetId, overlay: PaintedOverlay | null): BodyDocument {
  const paint: Partial<Record<PaintTargetId, PaintedOverlay>> = { ...(doc.paint ?? {}) };
  if (overlay) paint[target] = overlay;
  else delete paint[target];
  if (Object.keys(paint).length === 0) {
    const { paint: _gone, ...rest } = doc;
    return rest as BodyDocument;
  }
  return { ...doc, paint };
}

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
  // painted overlays (MODELPAINT-0605): keep only the valid ones — a torn
  // overlay degrades to unpainted, never to a rejected document.
  if (doc.paint != null) {
    if (typeof doc.paint !== 'object') {
      delete doc.paint;
    } else {
      const paint: Record<string, unknown> = {};
      for (const id of PAINT_TARGET_IDS) {
        const overlay = validatePaintedOverlay(doc.paint[id]);
        if (overlay) paint[id] = overlay;
      }
      if (Object.keys(paint).length > 0) doc.paint = paint;
      else delete doc.paint;
    }
  }
  // PELVISMESH-0606: pre-split documents gain the deterministic pelvis copy
  // at the parse door (stream consumers normalize at their own read sites —
  // draftFromDocument, bakeBodyDocument, the cutout preview).
  doc.parts = partsWithPelvisFallback(doc.parts);
  return doc as BodyDocument;
}

export function serializeBody(doc: BodyDocument): string {
  return JSON.stringify(doc);
}
