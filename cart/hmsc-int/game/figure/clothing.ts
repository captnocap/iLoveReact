// game/figure/clothing.ts — bones → garment primitives.
//
// Clothing is BONES-DRIVEN like everything else (the V1 seam): garment boxes/
// cones/cylinders ride bone positions and wear bone rotations, so pants track
// walk strides and kneels, and a ragdoll keeps its outfit. Leg pieces lerp
// along the ACTUAL joint chain (hip→knee→ankle); the thigh tube rides past
// the hip UP UNDER the seat box (the recorded "legs not with the groin" gap).
// Palettes are data in shapes.ts (P2) — this file is placement only.

import { lerp3, span3, darkenHex, type V3 } from './math';
import {
  BODY_SHAPES, BOTTOMS, CLOTHING, DEFAULT_BOTTOMS, clothingSkinTextureKey,
  type BodyPoseId, type BodyShapeId, type BottomsId, type ClothingAccessoryId, type ClothingId, type ClothingSkinId,
} from './shapes';
import { buildSkeleton, offsetBone, type Bones, type RigTimelineAction } from './skeleton';

/** One garment primitive — what the render/bake layers consume. */
export type ClothingInstance = {
  geometry: 'box' | 'sphere' | 'cone' | 'cylinder';
  params?: any;
  position: V3;
  rotation?: V3;
  scale?: number | V3;
  color: string;
  opacity?: number;
  textureKey?: string;
};

export function buildClothing(
  style: ClothingId,
  shapeId: BodyShapeId = 'neutral',
  pose: BodyPoseId = 'stand',
  phase = 0,
  actions: RigTimelineAction[] = [],
  clothingSkin: ClothingSkinId = 'plain',
  accessories: ClothingAccessoryId[] = [],
  bottoms: BottomsId = DEFAULT_BOTTOMS[style],
  bonesOverride?: Bones,
): ClothingInstance[] {
  const s = BODY_SHAPES[shapeId];
  const c = CLOTHING[style];
  const bones = bonesOverride ?? buildSkeleton(shapeId, pose, phase, actions);
  const clothes: ClothingInstance[] = [];
  const box = (
    position: V3,
    scale: V3,
    color: string,
    rotation: V3 = [0, 0, 0],
    opacity = 1,
    textureKey?: string,
  ): ClothingInstance => ({
    geometry: 'box',
    params: textureKey ? { width: 1, height: 1, depth: 1, texturedFaces: ['front', 'back'] as any } : { width: 1, height: 1, depth: 1 },
    position,
    rotation,
    scale,
    color,
    opacity,
    textureKey,
  });
  const sphere = (position: V3, scale: V3, color: string, rotation: V3 = [0, 0, 0], opacity = 1): ClothingInstance =>
    ({ geometry: 'sphere', params: { radius: 1, segments: 16, rings: 10 }, position, rotation, scale, color, opacity });
  const cone = (position: V3, scale: V3, color: string, rotation: V3 = [0, 0, 0], opacity = 1): ClothingInstance =>
    ({ geometry: 'cone', params: { radius: 1, height: 1, segments: 24 }, position, rotation, scale, color, opacity });
  const cylinder = (position: V3, scale: V3, color: string, rotation: V3 = [0, 0, 0], opacity = 1): ClothingInstance =>
    ({ geometry: 'cylinder', params: { radius: 1, height: 1, segments: 20 }, position, rotation, scale, color, opacity });

  const torsoWidth = 0.54 * s.torsoWide * (style === 'armor' ? 1.16 : style === 'hoodie' ? 1.12 : 1);
  const torsoHeight = 0.58 * s.torsoLong;
  const torsoDepth = 0.38 * s.torsoWide * (style === 'hoodie' ? 1.14 : 1.02);
  const limbW = 0.19 * s.limbThick;
  const sleeveColor = style === 'suit' ? c.secondary : c.primary;

  if (style !== 'underwear') {
    clothes.push(box(
      offsetBone(bones.torso, 0, 0.02 * s.height, -0.025),
      [torsoWidth, torsoHeight, torsoDepth],
      c.primary,
      bones.torso.rotation,
      1,
    ));
    if (clothingSkin !== 'plain' && style !== 'armor' && style !== 'dress') {
      clothes.push(box(
        offsetBone(bones.torso, 0, 0.04 * s.height, -0.225),
        [0.32 * s.torsoWide, 0.26 * s.torsoLong, 0.018],
        '#ffffff',
        bones.torso.rotation,
        1,
        clothingSkinTextureKey(clothingSkin),
      ));
    }
  }

  if (style === 'tee' || style === 'hoodie' || style === 'suit' || style === 'armor') {
    const capColor = style === 'armor' ? c.accent : sleeveColor;
    const sleeveBulk = style === 'hoodie' ? 1.22 : style === 'armor' ? 1.12 : 1;
    clothes.push(
      sphere(bones.lShoulder.position, [0.105 * s.limbThick, 0.075 * s.limbThick, 0.105 * s.limbThick], capColor, bones.lShoulder.rotation, 1),
      sphere(bones.rShoulder.position, [0.105 * s.limbThick, 0.075 * s.limbThick, 0.105 * s.limbThick], capColor, bones.rShoulder.rotation, 1),
      box(bones.lUpperArm.position, [limbW * sleeveBulk, bones.lUpperArm.scale * 2.02, limbW * sleeveBulk], sleeveColor, bones.lUpperArm.rotation, 1),
      box(bones.rUpperArm.position, [limbW * sleeveBulk, bones.rUpperArm.scale * 2.02, limbW * sleeveBulk], sleeveColor, bones.rUpperArm.rotation, 1),
    );
  }

  if (style === 'hoodie') {
    clothes.push(box(
      offsetBone(bones.torso, 0, -0.12 * s.height, -0.215),
      [0.22 * s.torsoWide, 0.08, 0.035],
      c.secondary,
      bones.torso.rotation,
      1,
    ));
  }

  if (style === 'dress') {
    clothes.push(
      box(offsetBone(bones.pelvis, 0, 0.08 * s.height, -0.01), [0.48 * s.hip, 0.09 * s.torsoLong, 0.31 * s.hip], c.secondary, bones.pelvis.rotation, 1),
      // knee-length A-line with a hem trim ring at the bottom edge
      cone(offsetBone(bones.pelvis, 0, -0.12 * s.height, 0), [0.56 * s.hip, 0.44 * s.torsoLong, 0.43 * s.hip], c.secondary, bones.pelvis.rotation, 1),
      cylinder(offsetBone(bones.pelvis, 0, -0.33 * s.height, 0), [0.57 * s.hip, 0.025, 0.44 * s.hip], c.accent, bones.pelvis.rotation, 1),
      box(offsetBone(bones.torso, 0, 0.19 * s.height, -0.215), [0.18 * s.torsoWide, 0.04, 0.025], c.accent, bones.torso.rotation, 1),
    );
  }

  if (style === 'armor') {
    clothes.push(
      box(offsetBone(bones.torso, 0, 0.16 * s.height, -0.215), [0.54 * s.shoulder, 0.12, 0.035], c.accent, bones.torso.rotation, 1),
      box(offsetBone(bones.torso, 0, -0.08 * s.height, -0.215), [0.46 * s.torsoWide, 0.1, 0.035], c.accent, bones.torso.rotation, 1),
    );
  }

  if (style === 'suit') {
    clothes.push(
      box(offsetBone(bones.torso, 0, 0.18 * s.height, -0.215), [0.12, 0.16, 0.028], c.accent, bones.torso.rotation, 1),
      box(offsetBone(bones.torso, 0, 0.015 * s.height, -0.22), [0.07, 0.2, 0.025], '#991b1b', bones.torso.rotation, 1),
    );
  }

  // ── bottoms — a real garment layer, chosen independently of the top ────────
  const b = BOTTOMS[bottoms];
  const longPants = bottoms === 'jeans' || bottoms === 'slacks';
  const matchTop = (style === 'suit' || style === 'armor') && longPants;
  const bMain = matchTop ? c.secondary : b.primary;
  const bTrim = matchTop ? darkenHex(c.secondary, 0.55) : b.secondary;
  const underDress = style === 'dress';
  const paintedUnderwear = style === 'underwear';
  const legJoints = (side: -1 | 1) => side < 0
    ? { hip: bones.lHip, knee: bones.lKnee, foot: bones.lFoot, thigh: bones.lThigh, shin: bones.lShin }
    : { hip: bones.rHip, knee: bones.rKnee, foot: bones.rFoot, thigh: bones.rThigh, shin: bones.rShin };
  // a garment tube over t0..t1 of a leg segment, wearing that bone's rotation.
  // t0 goes NEGATIVE to ride past the hip joint up under the seat box; `inX`
  // tucks the tube toward the crotch.
  const legPiece = (side: -1 | 1, seg: 'thigh' | 'shin', t0: number, t1: number, w: number, color: string, inX = 0): ClothingInstance => {
    const j = legJoints(side);
    const [p, q] = seg === 'thigh' ? [j.hip.position, j.knee.position] : [j.knee.position, j.foot.position];
    const ctr = lerp3(p, q, (t0 + t1) / 2);
    ctr[0] -= side * inX;
    // depth ≈ width: the leg pipe is round, so slimmer tubes would let thick
    // thighs (builder/heavy) poke through front/back
    return box(ctr, [w, span3(p, q) * (t1 - t0), w * 0.92], color, (seg === 'thigh' ? j.thigh : j.shin).rotation, 1);
  };
  const thighTuck = 0.02 * s.hip;
  // every thigh tube starts above the hip, under the seat, so seat and tube
  // always overlap; the crotch box spans both and bridges between the legs
  const THIGH_TOP = -0.35;
  // garment depth (z): the body is only ~±0.11 deep at the hips — wrap, don't jut
  const seatZ = 0.26 * s.hip;

  // female underwear is its own garment, not shrunken male boxes: a low-rise
  // panty (no leg stubs, angled hip cuts)
  const feminineBody = shapeId === 'female';
  const panties = bottoms === 'briefs' && feminineBody;

  if (!underDress && !paintedUnderwear && panties) {
    const pr = bones.pelvis.rotation;
    clothes.push(
      // low-rise seat + slim crotch — no leg stubs, the cut ends at the hip
      box(offsetBone(bones.pelvis, 0, 0.045 * s.height, -0.004), [0.5 * s.hip, 0.12 * s.torsoLong, seatZ - 0.012], bMain, pr, 1),
      box(offsetBone(bones.pelvis, 0, -0.055 * s.height, -0.004), [0.14 * s.hip, 0.17 * s.torsoLong, 0.16 * s.hip], bMain, pr, 1),
      // angled hip cuts — the V silhouette from waist edge down toward the crotch
      box(offsetBone(bones.pelvis, -0.2 * s.hip, -0.005 * s.height, -0.004), [0.2 * s.hip, 0.075, seatZ - 0.02], bMain, [pr[0], pr[1], pr[2] - 26], 1),
      box(offsetBone(bones.pelvis, 0.2 * s.hip, -0.005 * s.height, -0.004), [0.2 * s.hip, 0.075, seatZ - 0.02], bMain, [pr[0], pr[1], pr[2] + 26], 1),
      // thin elastic band at the top edge
      box(offsetBone(bones.pelvis, 0, 0.105 * s.height, -0.004), [0.51 * s.hip, 0.024, seatZ - 0.004], bTrim, pr, 1),
    );
  }

  if (!underDress && !paintedUnderwear && !panties) {
    // seat + crotch — the hip wrap every bottom shares
    const seatRise = bottoms === 'briefs' ? 0.07 : 0.1;
    const seatH = bottoms === 'briefs' ? 0.2 : 0.17;
    clothes.push(
      box(offsetBone(bones.pelvis, 0, seatRise * s.height, -0.004), [0.56 * s.hip, seatH * s.torsoLong, seatZ], bMain, bones.pelvis.rotation, 1),
      box(offsetBone(bones.pelvis, 0, -0.05 * s.height, -0.004), [0.16 * s.hip, 0.2 * s.torsoLong, 0.19 * s.hip], bMain, bones.pelvis.rotation, 1),
    );
    if (bottoms === 'briefs') {
      // elastic band at the brief's top edge — tighty-whitey register
      clothes.push(box(offsetBone(bones.pelvis, 0, 0.165 * s.height, -0.004), [0.565 * s.hip, 0.03, seatZ + 0.01], bTrim, bones.pelvis.rotation, 1));
    } else {
      clothes.push(box(offsetBone(bones.pelvis, 0, 0.15 * s.height, -0.004), [0.57 * s.hip, 0.035, seatZ + 0.012], bTrim, bones.pelvis.rotation, 1));
    }
    if (longPants) {
      // belt + buckle peeking under the shirt hem
      clothes.push(
        box(offsetBone(bones.pelvis, 0, 0.125 * s.height, -0.004), [0.575 * s.hip, 0.028, seatZ + 0.02], '#3a2a18', bones.pelvis.rotation, 1),
        box(offsetBone(bones.pelvis, 0, 0.125 * s.height, -0.004 - seatZ / 2 - 0.012), [0.045, 0.04, 0.016], '#c9a13b', bones.pelvis.rotation, 1),
      );
    }
    if (bottoms === 'skirt') {
      // knee-length A-line + hem trim; rides the pelvis so it follows kneels
      clothes.push(
        cone(offsetBone(bones.pelvis, 0, -0.16 * s.height, 0), [0.52 * s.hip, 0.42 * s.torsoLong, 0.34 * s.hip], bMain, bones.pelvis.rotation, 1),
        cylinder(offsetBone(bones.pelvis, 0, -0.36 * s.height, 0), [0.53 * s.hip, 0.025, 0.35 * s.hip], bTrim, bones.pelvis.rotation, 1),
      );
    }
  }

  // legs — under a dress only long pants would show, so skip the rest there
  if (!paintedUnderwear && (!underDress || longPants || bottoms === 'shorts')) {
    for (const side of [-1, 1] as const) {
      if (bottoms === 'briefs') {
        // panties end at the hip — male briefs get the short leg stubs
        if (!panties) clothes.push(legPiece(side, 'thigh', THIGH_TOP, 0.36, 0.33 * s.limbThick, bMain, thighTuck));
      } else if (bottoms === 'shorts') {
        clothes.push(
          legPiece(side, 'thigh', THIGH_TOP, 0.52, 0.345 * s.limbThick, bMain, thighTuck),
          legPiece(side, 'thigh', 0.52, 0.66, 0.36 * s.limbThick, bTrim, thighTuck),
        );
      } else if (longPants) {
        const w = (bottoms === 'jeans' ? 0.3 : 0.285) * s.limbThick;
        const j = legJoints(side);
        clothes.push(
          legPiece(side, 'thigh', THIGH_TOP, 1.03, w, bMain, thighTuck),
          // knee patch bridges the thigh/shin tubes when the leg bends
          box(j.knee.position, [w * 0.98, 0.085, w * 0.92], bMain, j.shin.rotation, 1),
          legPiece(side, 'shin', 0.02, bottoms === 'jeans' ? 0.78 : 0.94, w * 0.88, bMain),
        );
        if (bottoms === 'jeans') {
          // rolled cuff in the faded accent
          clothes.push(legPiece(side, 'shin', 0.78, 0.92, w * 0.95, matchTop ? bTrim : b.accent));
        }
        if (style === 'armor') {
          clothes.push(sphere(j.knee.position, [0.1 * s.limbThick, 0.085 * s.limbThick, 0.1 * s.limbThick], c.accent, j.shin.rotation, 1));
        }
      }
    }
  }

  if (style !== 'underwear') {
    const shoe = style === 'dress' ? '#171717' : style === 'armor' ? c.secondary : darkenHex(c.secondary, 0.55);
    clothes.push(
      box(offsetBone(bones.lFoot, 0, 0.01, -0.03), [0.2 * s.foot, 0.07 * s.foot, 0.24 * s.foot], shoe, bones.lFoot.rotation, 1),
      box(offsetBone(bones.rFoot, 0, 0.01, -0.03), [0.2 * s.foot, 0.07 * s.foot, 0.24 * s.foot], shoe, bones.rFoot.rotation, 1),
      box(offsetBone(bones.lFoot, 0, 0.018, -0.12), [0.18 * s.foot, 0.06 * s.foot, 0.14 * s.foot], shoe, bones.lFoot.rotation, 1),
      box(offsetBone(bones.rFoot, 0, 0.018, -0.12), [0.18 * s.foot, 0.06 * s.foot, 0.14 * s.foot], shoe, bones.rFoot.rotation, 1),
    );
  }

  if (accessories.includes('shades')) {
    clothes.push(
      box(offsetBone(bones.head, -0.07 * s.head, 0.035 * s.height, -0.23 * s.head), [0.075 * s.head, 0.038 * s.head, 0.018], '#05070b', bones.head.rotation, 1),
      box(offsetBone(bones.head, 0.07 * s.head, 0.035 * s.height, -0.23 * s.head), [0.075 * s.head, 0.038 * s.head, 0.018], '#05070b', bones.head.rotation, 1),
      box(offsetBone(bones.head, 0, 0.035 * s.height, -0.238 * s.head), [0.055 * s.head, 0.012 * s.head, 0.014], '#05070b', bones.head.rotation, 1),
    );
  }

  if (accessories.includes('cap')) {
    clothes.push(
      sphere(offsetBone(bones.head, 0, 0.19 * s.height, 0), [0.22 * s.head, 0.075 * s.head, 0.2 * s.head], '#111827', bones.head.rotation, 1),
      box(offsetBone(bones.head, 0, 0.135 * s.height, -0.205 * s.head), [0.22 * s.head, 0.028 * s.head, 0.11 * s.head], '#111827', bones.head.rotation, 1),
    );
  }

  if (accessories.includes('beanie')) {
    clothes.push(
      sphere(offsetBone(bones.head, 0, 0.18 * s.height, 0), [0.225 * s.head, 0.105 * s.head, 0.215 * s.head], '#7c2d12', bones.head.rotation, 1),
      cylinder(offsetBone(bones.head, 0, 0.105 * s.height, 0), [0.19 * s.head, 0.035 * s.head, 0.19 * s.head], '#431407', bones.head.rotation, 1),
    );
  }

  if (accessories.includes('backpack')) {
    clothes.push(
      box(offsetBone(bones.torso, 0, 0.02 * s.height, 0.29 * s.torsoWide), [0.34 * s.torsoWide, 0.48 * s.torsoLong, 0.13 * s.torsoWide], '#334155', bones.torso.rotation, 1),
      box(offsetBone(bones.torso, -0.17 * s.torsoWide, 0.06 * s.height, 0.18 * s.torsoWide), [0.035, 0.46 * s.torsoLong, 0.035], '#111827', bones.torso.rotation, 1),
      box(offsetBone(bones.torso, 0.17 * s.torsoWide, 0.06 * s.height, 0.18 * s.torsoWide), [0.035, 0.46 * s.torsoLong, 0.035], '#111827', bones.torso.rotation, 1),
    );
  }

  return clothes;
}
