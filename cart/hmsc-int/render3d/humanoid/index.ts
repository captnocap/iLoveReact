// The shared HMSC humanoid. One skeleton, one renderer, one hitbox — the player
// and every NPC are the same body recolored, and their hit volumes are derived
// from the same joints as their mesh. Import from here.

export { drivePose } from './pose';
export type { HumanoidPose } from './pose';
export { solveHumanoid } from './skeleton';
export type { HumanoidRig, HitCapsule, DamageZone, MaterialSlot, RigPart, Vec3Tuple, GeometryDef } from './skeleton';
export { Figure } from './Figure';
export { PLAYER_PALETTE, NPC_PALETTES, npcPalette, npcPaletteIndex } from './palette';
export type { HumanoidPalette } from './palette';
export { HumanoidFaceCaptures, npcFaceKey, PLAYER_FACE_KEY, FACE_FEATURES } from './face';
export type { FaceFeatures } from './face';
export { ZONE_DAMAGE, raycastHumanoid, raycastHumanoids } from './hitbox';
export type { HumanoidHit } from './hitbox';
