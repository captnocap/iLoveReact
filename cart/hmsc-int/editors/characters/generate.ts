// editors/characters/generate.ts — seeded whole-character generation ("the
// variety of life is the right shape", V2-AMENDED: the generators stay).
//
// One seed → one complete deterministic draft: face, body shape, dragged
// outlines warped per shape, body sculpt grids, wardrobe, held item. The
// route's "generate" button mints a seed and calls generateCharacterDraft;
// the same seed always reproduces the same character (the bake-preserves-
// variety contract). Behavior reference: cart/head_lab/index.tsx
// generateCharacter/generatedProfile(s)/generatedBodyGrids/
// fitProfilesUnderClothing (read, never imported). PRNG: the kit's
// mulberry32 — one PRNG in the system.
//
// P2: every behavior number lives in GENERATE_TUNING.

import { generateFace, mulberry32, type FaceStyle } from '../../game/figure/hed';
import {
  BODY_SHAPES, CLOTHING, CLOTHING_ACCESSORIES, CLOTHING_SKINS, PART_IDS, PROFILE_N, defaultProfile,
  type BodyShapeId, type BottomsId, type ClothingAccessoryId, type ClothingId, type ClothingSkinId, type PartId,
} from '../../game/figure/shapes';
import { ITEM_IDS } from '../../game/items';
import { emptyDraft, emptyGrid, type CharacterDraft } from './draft';
import { stampGrid } from './regions';

export const GENERATE_TUNING = Object.freeze({
  profile: {
    /** per-sample random wobble around the preset silhouette */
    wobble: 0.1,
    /** silhouette samples stay inside this radial band */
    clamp: { min: 0.06, max: 1.35 },
    /** torso: how strongly shoulder/hip multipliers bow the outline */
    shoulderBow: 0.24,
    hipBow: 0.24,
  },
  /** thin the body so garments cover it; pipes NEVER shrink (sleeves/pant
   *  tubes are already wider — the detached-wrist lesson's neighbor) */
  clothingFit: { torso: 0.9, torsoDress: 0.88, foot: 0.86 },
  grids: {
    /** muscle-tone stamp scale per body shape */
    tone: { heavy: 0.75, skinny: 0.5, default: 0.62 },
    /** per-cell random grain after the stamps */
    grain: 0.025,
    /** generated grids stay inside this band (gentler than hand sculpt) */
    clamp: 0.72,
  },
  wardrobe: {
    /** chance underwear stays in the clothing pool */
    underwearChance: 0.25,
    /** chance per accessory; at most two */
    accessoryChance: 0.28,
    maxAccessories: 2,
    /** chance the character holds an item at all */
    heldItemChance: 0.45,
    /** items too big/odd to generate into a hand */
    heldItemExclude: ['vehicle', 'tv', 'sailboat'],
    /** chance a non-dress masculine roll still gets a feminine face */
    feminineFaceChance: 0.25,
  },
  knobs: {
    /** depth-amount warp per shape + clamp */
    amountScale: { heavy: 1.08, skinny: 0.92, default: 1 },
    amountClamp: { min: 0.22, max: 0.58 },
    /** skull stretch random band + clamp */
    scaleJitter: { base: 0.96, span: 0.08 },
    scaleClamp: { min: 0.9, max: 1.55 },
  },
});

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function bell(t: number, center: number, width: number): number {
  const d = (t - center) / width;
  return Math.exp(-d * d);
}

function pick<T>(rand: () => number, values: readonly T[]): T {
  return values[Math.min(values.length - 1, Math.floor(rand() * values.length))];
}

/** One part's generated silhouette: the preset outline warped by the body
 *  shape's multipliers plus a small wobble. */
export function generatedProfile(id: PartId, shapeId: BodyShapeId, rand: () => number): number[] {
  const shape = BODY_SHAPES[shapeId];
  const T = GENERATE_TUNING.profile;
  const base = defaultProfile(id);
  return base.map((v, i) => {
    const t = i / (PROFILE_N - 1);
    let factor = 1 + (rand() - 0.5) * T.wobble;
    if (id === 'torso') {
      factor *= shape.torsoWide;
      factor *= 1
        + (shape.shoulder - 1) * T.shoulderBow * bell(t, 0.2, 0.2)
        + (shape.hip - 1) * T.hipBow * bell(t, 0.78, 0.22);
      if (shapeId === 'female') factor *= 1 - 0.08 * bell(t, 0.52, 0.18) + 0.08 * bell(t, 0.7, 0.2);
      if (shapeId === 'heavy') factor *= 1 + 0.16 * bell(t, 0.5, 0.35);
      if (shapeId === 'skinny') factor *= 0.92 + 0.08 * Math.abs(t - 0.5);
    } else if (id === 'pipe') {
      factor *= shape.limbThick * (0.94 + 0.08 * bell(t, 0.34, 0.24) + 0.05 * bell(t, 0.72, 0.2));
    } else if (id === 'hand' || id === 'finger') {
      factor *= shape.hand;
      if (id === 'finger') factor *= 1.12 + 0.06 * bell(t, 0.38, 0.24);
    } else if (id === 'foot') {
      factor *= shape.foot;
    }
    return clamp(v * factor, T.clamp.min, T.clamp.max);
  });
}

/** Thin the body so the garment boxes cover it (never the pipes). */
export function fitProfilesUnderClothing(profiles: Record<PartId, number[]>, clothing: ClothingId): Record<PartId, number[]> {
  if (clothing === 'underwear') return profiles;
  const F = GENERATE_TUNING.clothingFit;
  const shrink: Partial<Record<PartId, number>> = {
    torso: clothing === 'dress' ? F.torsoDress : F.torso,
    foot: F.foot,
  };
  const out = { ...profiles };
  for (const id of Object.keys(shrink) as PartId[]) {
    const k = shrink[id] ?? 1;
    out[id] = profiles[id].map((v) => clamp(v * k, 0.05, GENERATE_TUNING.profile.clamp.max));
  }
  return out;
}

/** Generated body-detail grids: muscle/fat stamps per shape + grain. */
export function generatedBodyGrids(shapeId: BodyShapeId, rand: () => number): Record<PartId, number[]> {
  const G = GENERATE_TUNING.grids;
  const grids = Object.fromEntries(PART_IDS.map((id) => [id, emptyGrid()])) as Record<PartId, number[]>;
  const shape = BODY_SHAPES[shapeId];
  const tone = shapeId === 'heavy' ? G.tone.heavy : shapeId === 'skinny' ? G.tone.skinny : G.tone.default;

  stampGrid(grids.torso, 0.43, 0.32, 0.08, 0.11, 0.12 * tone, true);
  stampGrid(grids.torso, 0.5, 0.48, 0.13, 0.08, -0.08);
  stampGrid(grids.torso, 0.5, 0.62, 0.1, 0.16, shapeId === 'heavy' ? 0.16 : -0.03);
  stampGrid(grids.torso, 0.38, 0.74, 0.1, 0.1, 0.07 * shape.hip, true);
  if (shapeId === 'female') {
    stampGrid(grids.torso, 0.42, 0.34, 0.08, 0.1, 0.1, true);
    stampGrid(grids.torso, 0.5, 0.54, 0.13, 0.09, -0.07);
    stampGrid(grids.torso, 0.08, 0.73, 0.07, 0.1, 0.13);
    stampGrid(grids.torso, 0.92, 0.73, 0.07, 0.1, 0.13);
    stampGrid(grids.torso, 0.5, 0.68, 0.14, 0.1, -0.04);
  }
  if (shapeId === 'bodybuilder') {
    stampGrid(grids.torso, 0.4, 0.32, 0.09, 0.09, 0.16, true);
    stampGrid(grids.torso, 0.5, 0.5, 0.1, 0.16, -0.1);
    stampGrid(grids.torso, 0.08, 0.72, 0.06, 0.08, 0.07);
    stampGrid(grids.torso, 0.92, 0.72, 0.06, 0.08, 0.07);
  }
  if (shapeId === 'heavy') {
    stampGrid(grids.torso, 0.07, 0.72, 0.08, 0.11, 0.12);
    stampGrid(grids.torso, 0.93, 0.72, 0.08, 0.11, 0.12);
  }

  stampGrid(grids.pipe, 0.5, 0.28, 0.22, 0.12, 0.13 * tone);
  stampGrid(grids.pipe, 0.5, 0.56, 0.18, 0.09, -0.06);
  stampGrid(grids.pipe, 0.5, 0.78, 0.2, 0.11, 0.1 * tone);
  stampGrid(grids.pipe, 0.5, 0.08, 0.52, 0.025, -0.05);
  stampGrid(grids.pipe, 0.5, 0.92, 0.52, 0.025, -0.05);

  stampGrid(grids.hand, 0.5, 0.5, 0.16, 0.18, 0.15);
  stampGrid(grids.hand, 0.36, 0.28, 0.07, 0.07, 0.08, true);
  stampGrid(grids.finger, 0.5, 0.3, 0.46, 0.035, 0.08);
  stampGrid(grids.finger, 0.5, 0.62, 0.46, 0.035, 0.07);

  stampGrid(grids.foot, 0.5, 0.5, 0.18, 0.15, 0.1);
  stampGrid(grids.foot, 0.5, 0.75, 0.2, 0.08, -0.07);

  for (const id of PART_IDS) {
    for (let i = 0; i < grids[id].length; i++) {
      grids[id][i] = clamp(grids[id][i] + (rand() - 0.5) * G.grain, -G.clamp, G.clamp);
    }
  }
  return grids;
}

/** One seed → one complete character draft, deterministically. */
export function generateCharacterDraft(seed: number): CharacterDraft {
  const rand = mulberry32(seed >>> 0);
  const W = GENERATE_TUNING.wardrobe;
  const K = GENERATE_TUNING.knobs;

  const shapes = Object.keys(BODY_SHAPES) as BodyShapeId[];
  const clothes = (Object.keys(CLOTHING) as ClothingId[]).filter((id) => id !== 'underwear' || rand() < W.underwearChance);
  const clothingSkins = Object.keys(CLOTHING_SKINS) as ClothingSkinId[];
  const allAccessories = Object.keys(CLOTHING_ACCESSORIES) as ClothingAccessoryId[];
  const itemPool = ITEM_IDS.filter((id) => !W.heldItemExclude.includes(id));

  let shape = pick(rand, shapes);
  const clothing = pick(rand, clothes.length > 0 ? clothes : (Object.keys(CLOTHING) as ClothingId[]));
  const clothingSkin: ClothingSkinId = clothing === 'tee' || clothing === 'hoodie' ? pick(rand, clothingSkins) : 'plain';
  const accessories = allAccessories.filter(() => rand() < W.accessoryChance).slice(0, W.maxAccessories);
  const heldItem = rand() < W.heldItemChance ? pick(rand, itemPool) : 'none';
  if (accessories.includes('cap') && accessories.includes('beanie')) accessories.splice(accessories.indexOf('beanie'), 1);
  if (clothing === 'dress') shape = 'female';
  const faceStyle: FaceStyle = shape === 'female' || clothing === 'dress' ? 'feminine' : rand() < W.feminineFaceChance ? 'feminine' : 'masculine';

  const bottomsPool: BottomsId[] = clothing === 'dress'
    ? ['briefs']
    : clothing === 'underwear'
      ? ['briefs', 'briefs', 'shorts']
      : clothing === 'suit' || clothing === 'armor'
        ? ['slacks', 'slacks', 'jeans']
        : faceStyle === 'feminine'
          ? ['jeans', 'shorts', 'skirt', 'skirt']
          : ['jeans', 'jeans', 'shorts', 'slacks'];
  const bottoms = pick(rand, bottomsPool);

  const face = generateFace(seed, { style: faceStyle });
  const profiles = fitProfilesUnderClothing(
    Object.fromEntries(PART_IDS.map((id) => [id, generatedProfile(id, shape, rand)])) as Record<PartId, number[]>,
    clothing,
  );
  const grids = generatedBodyGrids(shape, rand);
  grids.head = face.sculpt.map((b) => b / 127);

  return {
    ...emptyDraft(),
    skin: face.skin,
    amount: clamp(
      face.amount * (shape === 'heavy' ? K.amountScale.heavy : shape === 'skinny' ? K.amountScale.skinny : K.amountScale.default),
      K.amountClamp.min, K.amountClamp.max,
    ),
    headScaleY: clamp(
      face.scaleY * BODY_SHAPES[shape].head * (K.scaleJitter.base + rand() * K.scaleJitter.span),
      K.scaleClamp.min, K.scaleClamp.max,
    ),
    grids,
    profiles,
    face: { ...face, sculpt: emptyGrid().map(() => 0) },
    bodyShape: shape,
    clothing,
    bottoms,
    clothingSkin,
    accessories,
    heldItem,
    bodyPose: shape === 'bodybuilder' ? 'flex' : 'stand',
  };
}
