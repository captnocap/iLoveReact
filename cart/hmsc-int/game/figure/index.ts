// game/figure/ — GAME_FIGURE: the character kit (V2/V2-AMENDED/V1). THE DOOR.
//
// Captured 2026-06-05 from the cart/head_lab kit (behavior reference,
// untouched — see CAPTURE.md). The shape:
//
//   shapes.ts    the P2 data layer (parts/presets/body shapes/garments/LODs)
//   skeleton.ts  25-bone FK + bone-record helpers (place/offset/blend)
//   assembly.ts  bones → parts, sockets, finger fans
//   clothing.ts  bones → garments
//   rig.ts       the dressed frame + hit volumes + RULED damage zones +
//                semantic anchors; buildRigFrameFromBones is the V1 seam
//   hed.ts       .hed face documents: depth+paint one-shape law, animations,
//                seeded generateFace (the variety stays, V2-AMENDED)
//   body.ts      .body whole-character documents
//   ragdoll.ts   the V1 CONTRACT (seam + tuning data) — deliberately no solver
//   bake.ts      THE BAKE ENTRY: documents/seeds in, host-shaped figures out
//   render.tsx   the EDITOR/LAB PREVIEW path (Scene3D meshes + captures).
//                Deliberately NOT exported here: the door stays React-free so
//                headless consumers (compile/verify) carry zero JSX. Editors
//                and labs import '@game/figure/render' directly.
//
// Per-frame rig evaluation is preview-only; the game path is the bake (V2-
// AMENDED). The ragdoll solver is the physics lane's host feature (V1).

export {
  PART_IDS, PART_PRESETS, PART_LOD, PROFILE_N, defaultProfile,
  BODY_SHAPES, BODY_POSES, CLOTHING, BOTTOMS, DEFAULT_BOTTOMS, CLOTHING_SKINS, CLOTHING_ACCESSORIES,
  clothingSkinTextureKey,
} from './shapes';
export type {
  PartId, PartPreset, BodyShape, BodyShapeId, BodyPoseId,
  ClothingId, BottomsId, ClothingSkinId, ClothingAccessoryId, GarmentPalette,
} from './shapes';

export {
  buildSkeleton, offsetBones, placeBones, blendBones, offsetBone,
  actionWeight, actionPhase, actionOsc,
} from './skeleton';
export type { BoneId, Bones, SkeletonBone, RigTimelineAction } from './skeleton';

export { buildAssembly, buildAnatomy, assemblyFromSkeleton, anatomyFromSkeleton, fingerFan } from './assembly';
export type { BodyInstance } from './assembly';

export { buildClothing } from './clothing';
export type { ClothingInstance } from './clothing';

export {
  buildRigFrame, buildRigFrameFromBones, buildHitboxes, buildRigAnchors,
  hitboxesFromSkeleton, anchorsFromSkeleton,
  DAMAGE_ZONES, DAMAGE_ZONE_BY_BONE, damageZoneForBone,
} from './rig';
export type { BodyRigFrame, BodyHitbox, BodyAnchor, BodyAnchorId, DamageZoneId } from './rig';

export {
  HED_GRID_W, HED_GRID_H, HED_TEX_W, HED_TEX_H, HED_ANIM_FRAMES, FACE_GEN_PALETTES,
  buildHed, parseHed, serializeHed, hedDepthGrid, animateHed, generateFace, mulberry32,
} from './hed';
export type { HedDocument, HedLayer, HedShape, HedAnimation, FaceStyle } from './hed';

export { buildBody, parseBody, serializeBody } from './body';
export type { BodyDocument } from './body';

export {
  JOINT_IDS, JOINT_SEED_BONE, RAGDOLL_TUNING,
  ragdollHostReady, seedJointsFromBones, jointsToBones, restLengths,
} from './ragdoll';
export type { JointId, RagdollJoints, RagdollConstraint } from './ragdoll';

export { bakeFigure, bakeFigureFromSeed, bakeBodyDocument, bakePopulation, partGlobeParams } from './bake';
export type { BakedFigure, BakedPart, BakedTexture, BakeWardrobe } from './bake';

export { charactersStream } from './stream';
export type { CharactersEvent, CharactersStreamState } from './stream';

import {
  BODY_POSES, BODY_SHAPES, BOTTOMS, CLOTHING, CLOTHING_ACCESSORIES, CLOTHING_SKINS,
  PART_LOD, PART_PRESETS, defaultProfile,
} from './shapes';
import { blendBones, buildSkeleton, offsetBones, placeBones } from './skeleton';
import { buildRigFrame, buildRigFrameFromBones, DAMAGE_ZONES, damageZoneForBone } from './rig';
import { animateHed, generateFace, hedDepthGrid, parseHed, serializeHed } from './hed';
import { buildBody, parseBody, serializeBody } from './body';
import { JOINT_IDS, RAGDOLL_TUNING, jointsToBones, ragdollHostReady, seedJointsFromBones } from './ragdoll';
import { bakeBodyDocument, bakeFigure, bakeFigureFromSeed, bakePopulation } from './bake';
import { charactersStream } from './stream';

export const GAME_FIGURE = Object.freeze({
  // the skeleton + posing
  buildSkeleton,
  placeBones,
  offsetBones,
  blendBones,
  // the dressed figure
  buildRigFrame,
  fromBones: buildRigFrameFromBones,
  // ruled combat vocabulary
  damageZones: DAMAGE_ZONES,
  damageZoneForBone,
  // documents + generation (the authoring artifacts the bake consumes)
  generateFace,
  animateHed,
  hedDepthGrid,
  parseHed,
  serializeHed,
  buildBody,
  parseBody,
  serializeBody,
  // THE BAKE ENTRY (V2-AMENDED: the game path)
  bake: bakeFigure,
  bakeBody: bakeBodyDocument,
  bakeFromSeed: bakeFigureFromSeed,
  bakePopulation,
  // the V20 concern (like world/missions/vehicles): authored characters
  stream: charactersStream,
  // the V1 ragdoll contract (solver = host feature, physics lane)
  ragdoll: Object.freeze({
    hostReady: ragdollHostReady,
    joints: JOINT_IDS,
    tuning: RAGDOLL_TUNING,
    seedJointsFromBones,
    jointsToBones,
  }),
  // the data tables (P2 — what the tuning surface edits)
  tables: Object.freeze({
    parts: PART_PRESETS,
    lods: PART_LOD,
    shapes: BODY_SHAPES,
    poses: BODY_POSES,
    clothing: CLOTHING,
    bottoms: BOTTOMS,
    clothingSkins: CLOTHING_SKINS,
    accessories: CLOTHING_ACCESSORIES,
  }),
  defaultProfile,
});
