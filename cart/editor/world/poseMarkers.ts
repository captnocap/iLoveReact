// world/poseMarkers.ts — the camera→figure diagnostic marker vocabulary.
//
// The camera pane colors raw COCO landmarks by region. The model pane uses
// these same region ids on the ACTUAL posed bone origins, carried in the two
// reserved floats of the player-skin bone table. A zero means normal play:
// marker nodes are not even constructed outside Globals → Animation.
import { normalizeBoneName } from '../../../runtime/skeleton/rigs';

export const POSE_MARKER_KIND = Object.freeze({
  none: 0,
  face: 1,
  upper: 2,
  leg: 3,
} as const);

export type PoseMarkerKind = typeof POSE_MARKER_KIND[keyof typeof POSE_MARKER_KIND];

/** Map the model's real part/bone vocabulary onto the COCO overlay regions.
 *  The model has one driven head part rather than five separately-driven face
 *  landmarks, and uses `foot_*` as the nearest driven ankle endpoint. */
export function poseMarkerKindForBone(name: string): PoseMarkerKind {
  const bone = normalizeBoneName(name);
  if (bone === 'head' || bone === 'nose' || bone.startsWith('eye_') || bone.startsWith('ear_')) {
    return POSE_MARKER_KIND.face;
  }
  if (bone.startsWith('shoulder_') || bone.startsWith('elbow_') || bone.startsWith('wrist_')) {
    return POSE_MARKER_KIND.upper;
  }
  if (bone.startsWith('hip_') || bone.startsWith('knee_') || bone.startsWith('ankle_') || bone.startsWith('foot_')) {
    return POSE_MARKER_KIND.leg;
  }
  return POSE_MARKER_KIND.none;
}
