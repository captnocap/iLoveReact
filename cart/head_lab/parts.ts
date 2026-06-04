// Body parts — the user's decomposition: a head egg, a tall+wide torso
// barrel, ONE limb pipe (placed eight times: upper/fore arms AND thighs/
// shins — "use the pipes for the legs"), and wide-but-flat blocks for hands
// and feet. Every part is the SAME sculptable Globe surface wearing a
// different silhouette profile, so the unwrap painter, the depth brush, the
// .hed layers, and the animation machinery work identically on all of them.
//
// ASSEMBLY is the figure-view layout: where each part instance sits on a
// standing body (~1.9 units tall, ground at y=0). Mirrored limbs reuse the
// same part doc — sculpt the pipe once, both arms and both legs follow.

import type { HedLayer } from './hed';

export type PartId = 'head' | 'torso' | 'pipe' | 'hand' | 'foot' | 'finger';
export const PART_IDS: PartId[] = ['head', 'torso', 'pipe', 'hand', 'foot', 'finger'];
const LEGACY_PART_IDS: PartId[] = ['head', 'torso', 'pipe', 'hand', 'foot'];

export type PartPreset = {
  label: string;
  /** silhouette: lerped radius multipliers along v (see Globe.profile). */
  profile?: number[];
  scaleX?: number;
  scaleY: number;
  scaleZ?: number;
};

// scaleY values are each part's EFFECTIVE length: Globe profiles thin the
// radial silhouette only (lathe semantics), so length comes from scaleY alone
// and a dragged/generated/clothing-shrunk profile can never shorten a part —
// that was how wrists used to detach from forearms. These numbers are the old
// scaleY × the old profile's length damping, so nothing visibly resized.
export const PART_PRESETS: Record<PartId, PartPreset> = {
  head: { label: 'head', scaleY: 1.2 },
  // taller and wider than the egg: shoulders → chest → waist → hips
  torso: { label: 'torso', scaleY: 1.14, scaleZ: 0.62, profile: [0.72, 1.0, 0.94, 0.88, 0.6] },
  // the limb pipe: a long SLIM segment (narrow in x/z, full length in y —
  // arms and legs are not the michelin man), slightly waisted, rounded ends
  // so two of them visually connect at an elbow/knee without a seam gap
  pipe: { label: 'pipe', scaleY: 1.37, scaleX: 0.42, scaleZ: 0.42, profile: [0.45, 0.85, 0.8, 0.85, 0.45] },
  // compact palm pad; fingers carry the readable hand length, not this blob.
  hand: { label: 'hand', scaleX: 0.62, scaleY: 0.5, scaleZ: 0.42, profile: [0.5, 0.92, 0.76] },
  // foot is a compact base; shoe overlays provide the readable front volume.
  foot: { label: 'foot', scaleY: 0.35, scaleX: 0.66, scaleZ: 1.02, profile: [0.62, 0.92, 0.78] },
  // digits are just tiny limb pipes with a less bulbous silhouette. They are
  // still paintable/editable parts, so one finger sculpt fans across both hands.
  finger: { label: 'finger', scaleY: 0.79, scaleX: 0.34, scaleZ: 0.28, profile: [0.54, 0.92, 0.8, 0.5] },
};

// Editable outline resolution: each part's silhouette is PROFILE_N radius
// samples top→bottom, dragged in the lab's outline editor. The presets above
// are only the DEFAULTS — resampled to this grid on init/reset.
export const PROFILE_N = 16;

export function defaultProfile(id: PartId): number[] {
  const src = PART_PRESETS[id].profile ?? [1];
  const out: number[] = [];
  for (let i = 0; i < PROFILE_N; i++) {
    if (src.length === 1) { out.push(src[0]); continue; }
    const t = (i / (PROFILE_N - 1)) * (src.length - 1);
    const j = Math.min(src.length - 2, Math.floor(t));
    out.push(src[j] + (src[j + 1] - src[j]) * (t - j));
  }
  return out;
}

export type BodyInstance = {
  part: PartId;
  bone?: BoneId;
  position: [number, number, number];
  scale: number;
  /** degrees [rx, ry, rz] — small rz tilts hang the limbs naturally. */
  rotation?: [number, number, number];
  /** lateral (x/z) thickness multiplier on top of `scale` — proportions:
   *  the same pipe sculpt renders slimmer as a forearm than as a thigh. */
  thickness?: number;
};

export type BodyShapeId = 'neutral' | 'female' | 'male' | 'tall' | 'short' | 'heavy' | 'skinny' | 'bodybuilder';
export type ClothingId = 'underwear' | 'tee' | 'hoodie' | 'dress' | 'armor' | 'suit';
export type BottomsId = 'briefs' | 'shorts' | 'jeans' | 'slacks' | 'skirt';
export type ClothingSkinId = 'plain' | 'designer' | 'stupid' | 'fourtwenty' | 'debug';
export type ClothingAccessoryId = 'shades' | 'cap' | 'beanie' | 'backpack';
export type BodyPoseId = 'stand' | 'walk' | 'kneel' | 'flex' | 'wave';
export type BoneId =
  | 'torso' | 'head' | 'pelvis' | 'lHip' | 'rHip'
  | 'lShoulder' | 'rShoulder' | 'lUpperArm' | 'rUpperArm' | 'lElbow' | 'rElbow' | 'lForearm' | 'rForearm' | 'lWrist' | 'rWrist' | 'lHand' | 'rHand'
  | 'lThigh' | 'rThigh' | 'lKnee' | 'rKnee' | 'lShin' | 'rShin' | 'lFoot' | 'rFoot';

export const BODY_POSES: Record<BodyPoseId, { label: string }> = {
  stand: { label: 'stand' },
  walk: { label: 'walk' },
  kneel: { label: 'kneel' },
  flex: { label: 'flex' },
  wave: { label: 'wave' },
};

export const BODY_SHAPES: Record<BodyShapeId, {
  label: string;
  height: number;
  shoulder: number;
  hip: number;
  torsoWide: number;
  torsoLong: number;
  limbLong: number;
  limbThick: number;
  head: number;
  hand: number;
  foot: number;
  /** knee/foot x as a multiple of the hip joint x (default 1.08). Wide hips
   *  + a sub-1 stance = the femur angle: legs converge toward the knees. */
  stance?: number;
}> = {
  neutral: { label: 'neutral', height: 1, shoulder: 1, hip: 1, torsoWide: 1, torsoLong: 1, limbLong: 1, limbThick: 1, head: 1, hand: 1, foot: 1 },
  female: { label: 'female', height: 0.98, shoulder: 0.9, hip: 1.16, torsoWide: 0.92, torsoLong: 1.02, limbLong: 1, limbThick: 0.92, head: 1.02, hand: 0.94, foot: 0.92, stance: 0.82 },
  male: { label: 'male', height: 1.03, shoulder: 1.18, hip: 0.98, torsoWide: 1.1, torsoLong: 1.03, limbLong: 1.02, limbThick: 1.12, head: 1, hand: 1.06, foot: 1.06 },
  tall: { label: 'tall', height: 1.16, shoulder: 1.04, hip: 1, torsoWide: 0.96, torsoLong: 1.08, limbLong: 1.18, limbThick: 0.94, head: 0.94, hand: 1, foot: 1.05 },
  short: { label: 'short', height: 0.86, shoulder: 1.03, hip: 1.04, torsoWide: 1.04, torsoLong: 0.92, limbLong: 0.84, limbThick: 1.04, head: 1.12, hand: 0.96, foot: 0.96 },
  heavy: { label: 'heavy', height: 0.98, shoulder: 1.2, hip: 1.22, torsoWide: 1.28, torsoLong: 1, limbLong: 0.96, limbThick: 1.22, head: 1.04, hand: 1.08, foot: 1.1 },
  skinny: { label: 'skinny', height: 1.04, shoulder: 0.88, hip: 0.88, torsoWide: 0.78, torsoLong: 1.04, limbLong: 1.06, limbThick: 0.72, head: 1.01, hand: 0.92, foot: 0.94 },
  bodybuilder: { label: 'builder', height: 1.05, shoulder: 1.34, hip: 1.02, torsoWide: 1.22, torsoLong: 1.02, limbLong: 1.02, limbThick: 1.42, head: 0.96, hand: 1.12, foot: 1.08 },
};

export const CLOTHING: Record<ClothingId, { label: string; primary: string; secondary: string; accent: string }> = {
  underwear: { label: 'underwear', primary: '#e8e2d8', secondary: '#d7cfc4', accent: '#f2ede7' },
  tee: { label: 'tee', primary: '#3457d5', secondary: '#243b93', accent: '#f2f6ff' },
  hoodie: { label: 'hoodie', primary: '#334155', secondary: '#1f2937', accent: '#94a3b8' },
  dress: { label: 'dress', primary: '#b83280', secondary: '#7e245d', accent: '#f9a8d4' },
  armor: { label: 'armor', primary: '#64748b', secondary: '#334155', accent: '#cbd5e1' },
  suit: { label: 'suit', primary: '#171717', secondary: '#2f2f35', accent: '#f8fafc' },
};

// The bottoms layer is its own garment choice, independent of the top.
// `accent` is the cuff/hem trim (e.g. jeans' rolled cuff reads lighter).
export const BOTTOMS: Record<BottomsId, { label: string; primary: string; secondary: string; accent: string }> = {
  briefs: { label: 'briefs', primary: '#e8e2d8', secondary: '#d7cfc4', accent: '#f2ede7' },
  shorts: { label: 'shorts', primary: '#8a7a5f', secondary: '#6e6049', accent: '#a4937a' },
  jeans: { label: 'jeans', primary: '#3a5a8c', secondary: '#2c4368', accent: '#7d97bd' },
  slacks: { label: 'slacks', primary: '#26262e', secondary: '#1b1b22', accent: '#3a3a46' },
  skirt: { label: 'skirt', primary: '#8c3358', secondary: '#6b2543', accent: '#a85a7c' },
};

// Picking a top snaps bottoms to a coherent default; the user overrides after.
export const DEFAULT_BOTTOMS: Record<ClothingId, BottomsId> = {
  underwear: 'briefs',
  tee: 'jeans',
  hoodie: 'jeans',
  dress: 'briefs', // the dress IS the bottom — briefs stay hidden under it
  armor: 'slacks',
  suit: 'slacks',
};

export const CLOTHING_SKINS: Record<ClothingSkinId, { label: string }> = {
  plain: { label: 'plain' },
  designer: { label: 'designer' },
  stupid: { label: 'i am with stupid' },
  fourtwenty: { label: '4:20 somewhere' },
  debug: { label: 'debug tee' },
};

export const CLOTHING_ACCESSORIES: Record<ClothingAccessoryId, { label: string }> = {
  shades: { label: 'shades' },
  cap: { label: 'cap' },
  beanie: { label: 'beanie' },
  backpack: { label: 'backpack' },
};

export function clothingSkinTextureKey(skin: ClothingSkinId): string {
  return `headlab.clothing.${skin}`;
}

export type SkeletonBone = {
  id: BoneId;
  parent?: BoneId;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  thickness: number;
  hitbox: [number, number, number];
};

export type BodyHitbox = {
  id: BoneId;
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
};

export type BodyAnchorId =
  | 'head'
  | 'face'
  | 'face_grab'
  | 'eyes'
  | 'mouth'
  | 'neck'
  | 'left_palm'
  | 'right_palm'
  | 'left_grab_origin'
  | 'right_grab_origin';

export type BodyAnchor = {
  id: BodyAnchorId;
  bone: BoneId;
  role: 'target' | 'origin' | 'look' | 'socket';
  position: [number, number, number];
  rotation: [number, number, number];
  radius: number;
  priority: number;
  accepts: string[];
};

export type BodyRigFrame = {
  bones: Record<BoneId, SkeletonBone>;
  assembly: BodyInstance[];
  clothing: ClothingInstance[];
  anatomy: BodyInstance[];
  hitboxes: BodyHitbox[];
  anchors: BodyAnchor[];
};

export type RigTimelineAction = {
  target: string;
  action: string;
  phase: number;
  weight: number;
  args?: string[];
};

type RigFamily = 'arm' | 'hand' | 'wrist' | 'fist' | 'finger' | 'leg' | 'foot' | 'head' | 'torso' | 'body';

const FAMILY_PLURAL: Record<RigFamily, string> = {
  arm: 'arms',
  hand: 'hands',
  wrist: 'wrists',
  fist: 'fists',
  finger: 'fingers',
  leg: 'legs',
  foot: 'feet',
  head: 'head',
  torso: 'torso',
  body: 'body',
};

function targetMatches(target: string, family: RigFamily, side?: -1 | 1): boolean {
  if (family === 'head' || family === 'torso' || family === 'body') {
    return target === family;
  }
  const plural = FAMILY_PLURAL[family];
  if (target === `both_${plural}` || target === family || target === plural) return true;
  if (!side) return false;
  return side < 0 ? target === `left_${family}` : target === `right_${family}`;
}

function actionWeight(actions: RigTimelineAction[] | undefined, family: RigFamily, action: string, side?: -1 | 1): number {
  if (!actions) return 0;
  let out = 0;
  for (const a of actions) {
    if (a.action !== action) continue;
    if (!targetMatches(a.target, family, side)) continue;
    out += a.weight;
  }
  return Math.max(0, Math.min(1, out));
}

function actionPhase(actions: RigTimelineAction[] | undefined, family: RigFamily, action: string, side?: -1 | 1): number {
  if (!actions) return 0;
  let out = 0;
  for (const a of actions) {
    if (a.action !== action) continue;
    if (!targetMatches(a.target, family, side)) continue;
    out = Math.max(out, a.phase);
  }
  return Math.max(0, Math.min(1, out));
}

function actionOsc(actions: RigTimelineAction[] | undefined, family: RigFamily, action: string, side: -1 | 1 | undefined, cycles: number): number {
  if (!actions) return 0;
  let out = 0;
  for (const a of actions) {
    if (a.action !== action) continue;
    if (!targetMatches(a.target, family, side)) continue;
    out += a.weight * Math.sin(a.phase * Math.PI * 2 * cycles);
  }
  return Math.max(-1, Math.min(1, out));
}

export function buildSkeleton(shapeId: BodyShapeId = 'neutral', pose: BodyPoseId = 'stand', phase = 0, actions: RigTimelineAction[] = []): Record<BoneId, SkeletonBone> {
  const s = BODY_SHAPES[shapeId];
  const y = (v: number) => v * s.height;
  const step = Math.sin(phase * Math.PI * 2);
  const flex = pose === 'flex';
  const wave = pose === 'wave';
  const walk = pose === 'walk';
  const kneel = pose === 'kneel';

  const crouch = Math.max(actionPhase(actions, 'body', 'crouch'), actionPhase(actions, 'torso', 'crouch'));
  const sit = Math.max(actionPhase(actions, 'body', 'sit'), actionPhase(actions, 'torso', 'sit'));
  const lay = Math.max(actionPhase(actions, 'body', 'lay'), actionPhase(actions, 'torso', 'lay'));
  const bodyBounce = actionOsc(actions, 'body', 'bounce_loop', undefined, 2);
  const postureDrop = crouch * y(0.26) + sit * y(0.44) + lay * y(0.72);
  const torsoY = (kneel ? y(1.1) : y(1.3)) - postureDrop + bodyBounce * y(0.025);
  // shoulders tuck IN and DOWN onto the torso egg's slope (0.35/+0.22 left
  // them floating off the naked torso); the deltoid socket bridges the rest
  const shoulderX = 0.3 * s.shoulder * s.torsoWide;
  const hipX = 0.17 * s.hip;
  const handX = 0.5 * s.shoulder;
  const armTopY = kneel ? y(1.15) : y(1.36), armLowY = kneel ? y(0.73) : y(0.88), handY = kneel ? y(0.48) : y(0.57);
  const footY = kneel ? y(0.075) : y(0.07);
  const armLen = s.limbLong;
  const legLen = s.limbLong;
  const armSwing = walk ? step * 20 : 0;
  const legSwing = walk ? step * 18 : 0;
  const strideZ = walk ? step * 0.14 * s.limbLong : 0;
  const strideLift = walk ? Math.max(0, step) * 0.045 * s.height : 0;
  const counterStrideZ = -strideZ;
  const counterLift = walk ? Math.max(0, -step) * 0.045 * s.height : 0;
  const waveLift = wave ? 58 + Math.sin(phase * Math.PI * 4) * 8 : 0;
  const headY = (kneel ? y(1.62) : y(1.8)) - postureDrop + lay * y(0.16);
  const mid = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const segmentEnd = (start: [number, number, number], len: number, rzDeg: number, z = 0): [number, number, number] => {
    const r = rzDeg * Math.PI / 180;
    return [start[0] + Math.sin(r) * len, start[1] - Math.cos(r) * len, start[2] + z];
  };
  const pitchBetween = (top: [number, number, number], bottom: [number, number, number]) =>
    Math.atan2(top[2] - bottom[2], top[1] - bottom[1]) * 180 / Math.PI;
  const leftKick = actionWeight(actions, 'leg', 'kick', -1);
  const rightKick = actionWeight(actions, 'leg', 'kick', 1);
  const leftStomp = actionOsc(actions, 'leg', 'stomp_loop', -1, 2);
  const rightStomp = actionOsc(actions, 'leg', 'stomp_loop', 1, 2);
  const leftFootTap = actionOsc(actions, 'foot', 'tap_loop', -1, 4);
  const rightFootTap = actionOsc(actions, 'foot', 'tap_loop', 1, 4);
  const pelvisPos: [number, number, number] = kneel
    ? [0, y(0.82) - crouch * y(0.12), 0.2 + sit * 0.08]
    : [walk ? step * 0.025 * s.hip : 0, y(0.9) - crouch * y(0.18) - sit * y(0.34) - lay * y(0.62), (walk ? Math.cos(phase * Math.PI * 2) * 0.018 : 0) + sit * 0.18 + lay * 0.38];
  const pelvisRot: [number, number, number] = kneel
    ? [16, 0, 0]
    : [walk ? step * 3 : 0, lay * 74, walk ? step * 5 : 0];
  const leftHipPos: [number, number, number] = kneel ? [pelvisPos[0] - hipX, y(0.66), 0.18] : [pelvisPos[0] - hipX, y(0.82) - crouch * y(0.16) - sit * y(0.28) - lay * y(0.45), pelvisPos[2] + strideZ * 0.12];
  const rightHipPos: [number, number, number] = kneel ? [pelvisPos[0] + hipX, y(0.66), 0.18] : [pelvisPos[0] + hipX, y(0.82) - crouch * y(0.16) - sit * y(0.28) - lay * y(0.45), pelvisPos[2] + counterStrideZ * 0.12];
  // stance: knee/foot x relative to the hip joint — wide-hip shapes (female)
  // converge below the hip instead of dropping straight down (femur angle)
  const stance = s.stance ?? 1.08;
  const leftFootPos: [number, number, number] = kneel ? [leftHipPos[0] * 0.98, footY, 0.285] : [leftHipPos[0] * (stance + sit * 0.28), footY + strideLift * 0.45 + leftKick * y(0.22) + Math.max(0, leftStomp) * y(0.04), -0.055 + strideZ * 1.1 - leftKick * 0.42 + sit * 0.26 + lay * 0.42];
  const rightFootPos: [number, number, number] = kneel ? [rightHipPos[0] * 0.98, footY, 0.285] : [rightHipPos[0] * (stance + sit * 0.28), footY + counterLift * 0.45 + rightKick * y(0.22) + Math.max(0, rightStomp) * y(0.04), -0.055 + counterStrideZ * 1.1 - rightKick * 0.42 + sit * 0.26 + lay * 0.42];
  const leftKneePos: [number, number, number] = kneel ? [leftHipPos[0] * 1.08, y(0.19), 0.08] : [leftHipPos[0] * stance, y(0.44) + strideLift * 0.65 - crouch * y(0.1) - sit * y(0.12) + leftKick * y(0.12), leftHipPos[2] + strideZ * 0.78 - Math.max(0, -step) * 0.035 - leftKick * 0.18 + sit * 0.12 + lay * 0.32];
  const rightKneePos: [number, number, number] = kneel ? [rightHipPos[0] * 1.08, y(0.19), 0.08] : [rightHipPos[0] * stance, y(0.44) + counterLift * 0.65 - crouch * y(0.1) - sit * y(0.12) + rightKick * y(0.12), rightHipPos[2] + counterStrideZ * 0.78 - Math.max(0, step) * 0.035 - rightKick * 0.18 + sit * 0.12 + lay * 0.32];
  const leftThighPos = mid(leftHipPos, leftKneePos);
  const rightThighPos = mid(rightHipPos, rightKneePos);
  const leftShinPos = mid(leftKneePos, leftFootPos);
  const rightShinPos = mid(rightKneePos, rightFootPos);
  const leftThighRot: [number, number, number] = [kneel ? 42 : pitchBetween(leftHipPos, leftKneePos), 0, -3];
  const rightThighRot: [number, number, number] = [kneel ? 42 : pitchBetween(rightHipPos, rightKneePos), 0, 3];
  const leftShinRot: [number, number, number] = [kneel ? 88 : pitchBetween(leftKneePos, leftFootPos), 0, walk ? -1 : 0];
  const rightShinRot: [number, number, number] = [kneel ? 88 : pitchBetween(rightKneePos, rightFootPos), 0, walk ? 1 : 0];
  const leftFootRot: [number, number, number] = kneel ? [6, 0, 0] : [(walk ? -4 - legSwing * 0.08 : 0) - leftKick * 18 + leftFootTap * 16, 0, 0];
  const rightFootRot: [number, number, number] = kneel ? [6, 0, 0] : [(walk ? -4 + legSwing * 0.08 : 0) - rightKick * 18 + rightFootTap * 16, 0, 0];
  const leftLift = actionWeight(actions, 'arm', 'lift_and_bend', -1);
  const rightLift = actionWeight(actions, 'arm', 'lift_and_bend', 1);
  const leftShake = actionWeight(actions, 'arm', 'shake_in_air', -1);
  const rightShake = actionWeight(actions, 'arm', 'shake_in_air', 1);
  const leftShakeWave = actionOsc(actions, 'arm', 'shake_in_air', -1, 4);
  const rightShakeWave = actionOsc(actions, 'arm', 'shake_in_air', 1, 4);
  const leftPoint = Math.max(actionWeight(actions, 'arm', 'point', -1), actionWeight(actions, 'hand', 'point', -1));
  const rightPoint = Math.max(actionWeight(actions, 'arm', 'point', 1), actionWeight(actions, 'hand', 'point', 1));
  const leftPunch = actionWeight(actions, 'arm', 'punch', -1);
  const rightPunch = actionWeight(actions, 'arm', 'punch', 1);
  const leftGuard = actionWeight(actions, 'arm', 'guard', -1);
  const rightGuard = actionWeight(actions, 'arm', 'guard', 1);
  const leftReach = actionPhase(actions, 'arm', 'reach', -1);
  const rightReach = actionPhase(actions, 'arm', 'reach', 1);
  const leftSalute = actionWeight(actions, 'arm', 'salute', -1);
  const rightSalute = actionWeight(actions, 'arm', 'salute', 1);
  const leftCross = actionWeight(actions, 'arm', 'cross', -1);
  const rightCross = actionWeight(actions, 'arm', 'cross', 1);
  const leftWaveLoop = actionOsc(actions, 'arm', 'wave_loop', -1, 3);
  const rightWaveLoop = actionOsc(actions, 'arm', 'wave_loop', 1, 3);
  const leftSwingLoop = actionOsc(actions, 'arm', 'swing_loop', -1, 2);
  const rightSwingLoop = actionOsc(actions, 'arm', 'swing_loop', 1, 2);
  const leftWristFlick = actionOsc(actions, 'wrist', 'flick_loop', -1, 4) + actionOsc(actions, 'wrist', 'wrist_flick_loop', -1, 4);
  const rightWristFlick = actionOsc(actions, 'wrist', 'flick_loop', 1, 4) + actionOsc(actions, 'wrist', 'wrist_flick_loop', 1, 4);
  const leftWristRoll = actionOsc(actions, 'wrist', 'roll_loop', -1, 3) + actionOsc(actions, 'wrist', 'wrist_roll_loop', -1, 3);
  const rightWristRoll = actionOsc(actions, 'wrist', 'roll_loop', 1, 3) + actionOsc(actions, 'wrist', 'wrist_roll_loop', 1, 3);
  const leftWristSnap = actionWeight(actions, 'wrist', 'snap', -1);
  const rightWristSnap = actionWeight(actions, 'wrist', 'snap', 1);
  const lArmLiftZ = -leftLift * 58 - leftShake * 68 - leftPoint * 66 - leftPunch * 78 - leftGuard * 42 - leftReach * 46 - leftSalute * 88 + leftCross * 18 + leftShakeWave * 13 + leftWaveLoop * 15 + leftSwingLoop * 18;
  const rArmLiftZ = rightLift * 58 + rightShake * 68 + rightPoint * 66 + rightPunch * 78 + rightGuard * 42 + rightReach * 46 + rightSalute * 88 - rightCross * 18 + rightShakeWave * 13 + rightWaveLoop * 15 + rightSwingLoop * 18;
  const lForeBendZ = -leftLift * 62 - leftShake * 82 - leftPoint * 74 - leftPunch * 86 - leftGuard * 108 - leftReach * 34 - leftSalute * 116 + leftCross * 52 + leftShakeWave * 18 + leftWaveLoop * 28;
  const rForeBendZ = rightLift * 62 + rightShake * 82 + rightPoint * 74 + rightPunch * 86 + rightGuard * 108 + rightReach * 34 + rightSalute * 116 - rightCross * 52 + rightShakeWave * 18 + rightWaveLoop * 28;
  const lWristShake = leftShakeWave * 22 + leftWristFlick * 26 + leftWristRoll * 16 - leftWristSnap * 42;
  const rWristShake = rightShakeWave * 22 + rightWristFlick * 26 + rightWristRoll * 16 + rightWristSnap * 42;
  const leftForward = -leftPoint * 0.12 - leftPunch * 0.42 - leftReach * 0.28 - leftGuard * 0.08;
  const rightForward = -rightPoint * 0.12 - rightPunch * 0.42 - rightReach * 0.28 - rightGuard * 0.08;
  const leftUpperArmRot: [number, number, number] = [0, 0, (flex ? -62 : wave ? -waveLift : -5 - armSwing) + lArmLiftZ];
  const rightUpperArmRot: [number, number, number] = [0, 0, (flex ? 62 : 5 + armSwing) + rArmLiftZ];
  const leftForearmRot: [number, number, number] = [0, 0, (flex ? -116 : wave ? -84 : -8 - armSwing * 0.8) + lForeBendZ];
  const rightForearmRot: [number, number, number] = [0, 0, (flex ? 116 : 8 + armSwing * 0.8) + rForeBendZ];
  const leftHandRot: [number, number, number] = [0, 0, (flex ? -116 : wave ? -84 : -10 - armSwing * 0.5) + lForeBendZ + lWristShake];
  const rightHandRot: [number, number, number] = [0, 0, (flex ? 116 : 10 + armSwing * 0.5) + rForeBendZ + rWristShake];
  const leftShoulderPos: [number, number, number] = [-shoulderX, armTopY + 0.16 * armLen, 0];
  const rightShoulderPos: [number, number, number] = [shoulderX, armTopY + 0.16 * armLen, 0];
  // segment lengths: human-ish — fingertips land mid-thigh, not below the knee
  const leftElbowPos = segmentEnd(leftShoulderPos, 0.4 * armLen, leftUpperArmRot[2], leftForward * 0.32);
  const rightElbowPos = segmentEnd(rightShoulderPos, 0.4 * armLen, rightUpperArmRot[2], rightForward * 0.32);
  const leftWristJoint = segmentEnd(leftElbowPos, 0.33 * armLen, leftForearmRot[2], leftForward * 0.48);
  const rightWristJoint = segmentEnd(rightElbowPos, 0.33 * armLen, rightForearmRot[2], rightForward * 0.48);
  const leftHandPos = segmentEnd(leftWristJoint, 0.12 * s.hand, leftHandRot[2], leftForward * 0.2);
  const rightHandPos = segmentEnd(rightWristJoint, 0.12 * s.hand, rightHandRot[2], rightForward * 0.2);
  const leftUpperArmPos = mid(leftShoulderPos, leftElbowPos);
  const rightUpperArmPos = mid(rightShoulderPos, rightElbowPos);
  const leftForearmPos = mid(leftElbowPos, leftWristJoint);
  const rightForearmPos = mid(rightElbowPos, rightWristJoint);
  const leftWristPos = mid(leftWristJoint, leftHandPos);
  const rightWristPos = mid(rightWristJoint, rightHandPos);
  const headNod = actionOsc(actions, 'head', 'nod_loop', undefined, 2);
  const headShake = actionOsc(actions, 'head', 'shake_loop', undefined, 2);
  const torsoTwist = actionOsc(actions, 'torso', 'twist_loop', undefined, 2);

  const bone = (
    id: BoneId,
    parent: BoneId | undefined,
    position: [number, number, number],
    rotation: [number, number, number],
    scale: number,
    thickness: number,
    hitbox: [number, number, number],
  ): SkeletonBone => ({ id, parent, position, rotation, scale, thickness, hitbox });

  return {
    torso: bone('torso', undefined, [0, torsoY, kneel ? 0.11 : lay * 0.34], [(kneel ? 4 : 0) + lay * 72, 0, (flex ? 0 : step * 1.5) + torsoTwist * 8], 0.3 * s.torsoLong, s.torsoWide, [0.44 * s.torsoWide, 0.92 * s.torsoLong, 0.32 * s.torsoWide]),
    head: bone('head', 'torso', [0, headY, kneel ? 0.08 : lay * 0.42], [(kneel ? 8 : 0) + lay * 72 + headNod * 12, step * 3 + headShake * 18, 0], 0.21 * s.head, 1, [0.32 * s.head, 0.42 * s.head, 0.32 * s.head]),
    pelvis: bone('pelvis', 'torso', pelvisPos, pelvisRot, 0.16 * s.torsoLong, s.hip, [0.36 * s.hip, 0.2, 0.28 * s.hip]),
    lHip: bone('lHip', 'pelvis', leftHipPos, pelvisRot, 0.075 * s.hip, 1.15 * s.hip, [0.12 * s.hip, 0.12, 0.12 * s.hip]),
    rHip: bone('rHip', 'pelvis', rightHipPos, pelvisRot, 0.075 * s.hip, 1.15 * s.hip, [0.12 * s.hip, 0.12, 0.12 * s.hip]),
    lShoulder: bone('lShoulder', 'torso', leftShoulderPos, leftUpperArmRot, 0.072 * s.limbThick, 1.25 * s.limbThick, [0.12 * s.limbThick, 0.12 * s.limbThick, 0.12 * s.limbThick]),
    rShoulder: bone('rShoulder', 'torso', rightShoulderPos, rightUpperArmRot, 0.072 * s.limbThick, 1.25 * s.limbThick, [0.12 * s.limbThick, 0.12 * s.limbThick, 0.12 * s.limbThick]),
    lUpperArm: bone('lUpperArm', 'torso', leftUpperArmPos, leftUpperArmRot, 0.165 * armLen, 0.98 * s.limbThick, [0.14 * s.limbThick, 0.36 * armLen, 0.14 * s.limbThick]),
    rUpperArm: bone('rUpperArm', 'torso', rightUpperArmPos, rightUpperArmRot, 0.165 * armLen, 0.98 * s.limbThick, [0.14 * s.limbThick, 0.36 * armLen, 0.14 * s.limbThick]),
    lElbow: bone('lElbow', 'lUpperArm', leftElbowPos, leftForearmRot, 0.064 * s.limbThick, 1.25 * s.limbThick, [0.12 * s.limbThick, 0.12 * s.limbThick, 0.12 * s.limbThick]),
    rElbow: bone('rElbow', 'rUpperArm', rightElbowPos, rightForearmRot, 0.064 * s.limbThick, 1.25 * s.limbThick, [0.12 * s.limbThick, 0.12 * s.limbThick, 0.12 * s.limbThick]),
    lForearm: bone('lForearm', 'lElbow', leftForearmPos, leftForearmRot, 0.145 * armLen, 0.82 * s.limbThick, [0.12 * s.limbThick, 0.3 * armLen, 0.12 * s.limbThick]),
    rForearm: bone('rForearm', 'rElbow', rightForearmPos, rightForearmRot, 0.145 * armLen, 0.82 * s.limbThick, [0.12 * s.limbThick, 0.3 * armLen, 0.12 * s.limbThick]),
    lWrist: bone('lWrist', 'lForearm', leftWristPos, leftHandRot, 0.048 * s.hand, 1.35 * s.limbThick, [0.08, 0.1, 0.08]),
    rWrist: bone('rWrist', 'rForearm', rightWristPos, rightHandRot, 0.048 * s.hand, 1.35 * s.limbThick, [0.08, 0.1, 0.08]),
    lHand: bone('lHand', 'lWrist', leftHandPos, leftHandRot, 0.112 * s.hand, 1, [0.14 * s.hand, 0.16 * s.hand, 0.1 * s.hand]),
    rHand: bone('rHand', 'rWrist', rightHandPos, rightHandRot, 0.112 * s.hand, 1, [0.14 * s.hand, 0.16 * s.hand, 0.1 * s.hand]),
    lThigh: bone('lThigh', 'lHip', leftThighPos, leftThighRot, 0.21 * legLen, 1.3 * s.limbThick, [0.18 * s.limbThick, 0.45 * legLen, 0.18 * s.limbThick]),
    rThigh: bone('rThigh', 'rHip', rightThighPos, rightThighRot, 0.21 * legLen, 1.3 * s.limbThick, [0.18 * s.limbThick, 0.45 * legLen, 0.18 * s.limbThick]),
    lKnee: bone('lKnee', 'lThigh', leftKneePos, leftThighRot, 0.072 * s.limbThick, 1.2 * s.limbThick, [0.14 * s.limbThick, 0.14 * s.limbThick, 0.14 * s.limbThick]),
    rKnee: bone('rKnee', 'rThigh', rightKneePos, rightThighRot, 0.072 * s.limbThick, 1.2 * s.limbThick, [0.14 * s.limbThick, 0.14 * s.limbThick, 0.14 * s.limbThick]),
    lShin: bone('lShin', 'lKnee', leftShinPos, leftShinRot, 0.19 * legLen, s.limbThick, [0.14 * s.limbThick, 0.4 * legLen, 0.14 * s.limbThick]),
    rShin: bone('rShin', 'rKnee', rightShinPos, rightShinRot, 0.19 * legLen, s.limbThick, [0.14 * s.limbThick, 0.4 * legLen, 0.14 * s.limbThick]),
    lFoot: bone('lFoot', 'lShin', leftFootPos, leftFootRot, 0.118 * s.foot, 1, [0.18 * s.foot, 0.08 * s.foot, 0.28 * s.foot]),
    rFoot: bone('rFoot', 'rShin', rightFootPos, rightFootRot, 0.118 * s.foot, 1, [0.18 * s.foot, 0.08 * s.foot, 0.28 * s.foot]),
  };
}

// Standing figure, ground at y=0, ~2.2 units tall. Parts are radius-1 globes,
// so a part's half-extents ≈ scale × (profile·scaleX/Y/Z) — sized here so
// limbs sit CLEAR of the torso (arms out at the sides, legs spread a touch)
// instead of nesting inside it like a matryoshka. Pipes still kiss at the
// elbows/knees on purpose — the rounded profile ends read as the joint.
// Proportions follow the body, not the part: thighs are the thickest limb,
// shins middle, upper arms slimmer, forearms slimmest. One pipe sculpt
// serves all of them — `thickness` does the anatomy.
function assemblyFromSkeleton(s: typeof BODY_SHAPES.neutral, bones: Record<BoneId, SkeletonBone>, actions: RigTimelineAction[] = []): BodyInstance[] {
  const inst = (boneId: BoneId, part: PartId): BodyInstance => {
    const b = bones[boneId];
    return { part, bone: boneId, position: b.position, rotation: b.rotation, scale: b.scale, thickness: b.thickness };
  };

  return [
  inst('torso', 'torso'),
  inst('head', 'head'),
  // arms: slim pipes chained shoulder → elbow → hand, hanging close to the
  // torso with a gentle outward drift toward the hands
  inst('lUpperArm', 'pipe'),
  inst('rUpperArm', 'pipe'),
  inst('lForearm', 'pipe'),
  inst('rForearm', 'pipe'),
  inst('lWrist', 'pipe'),
  inst('rWrist', 'pipe'),
  inst('lHand', 'hand'),
  inst('rHand', 'hand'),
  // real digits layered over the palm blob: four fingers across the front
  // edge and an angled thumb on the inner side of each hand.
  ...fingerFan(bones.lHand, -1, s, actions),
  ...fingerFan(bones.rHand, 1, s, actions),
  // legs: thigh + shin pipes with a slight stance, feet pointing forward
  inst('lThigh', 'pipe'),
  inst('rThigh', 'pipe'),
  inst('lShin', 'pipe'),
  inst('rShin', 'pipe'),
  inst('lFoot', 'foot'),
  inst('rFoot', 'foot'),
  ];
}

export function buildAssembly(shapeId: BodyShapeId = 'neutral', pose: BodyPoseId = 'stand', phase = 0, actions: RigTimelineAction[] = []): BodyInstance[] {
  const s = BODY_SHAPES[shapeId];
  const bones = buildSkeleton(shapeId, pose, phase, actions);
  return assemblyFromSkeleton(s, bones, actions);
}

function anatomyFromSkeleton(s: typeof BODY_SHAPES.neutral, shapeId: BodyShapeId, bones: Record<BoneId, SkeletonBone>): BodyInstance[] {
  const y = (v: number) => v * s.height;
  const out: BodyInstance[] = [
    shoulderSocket(-1, s, bones),
    shoulderSocket(1, s, bones),
    elbowSocket(-1, s, bones),
    elbowSocket(1, s, bones),
    pelvisSocket(s, bones),
    hipSocket(-1, s, bones),
    hipSocket(1, s, bones),
    kneeSocket(-1, s, bones),
    kneeSocket(1, s, bones),
  ];
  const bulky = shapeId === 'bodybuilder';

  if (bulky) {
    out.push(
      // pecs hang OFF THE TORSO BONE (stand-pose torso center is y(1.3), z 0),
      // not at absolute body coords — absolute positions strand them at the
      // origin when the bones are world-space (ragdoll / offset figures)
      { part: 'hand', bone: 'torso', position: offsetBone(bones.torso, -0.11 * s.torsoWide, y(0.13), -0.17), scale: 0.082, rotation: [10, 0, -8], thickness: 1.25 },
      { part: 'hand', bone: 'torso', position: offsetBone(bones.torso, 0.11 * s.torsoWide, y(0.13), -0.17), scale: 0.082, rotation: [10, 0, 8], thickness: 1.25 },
      { part: 'pipe', bone: 'lUpperArm', position: offsetBone(bones.lUpperArm, -0.01, 0.02, -0.055), scale: 0.075, rotation: bones.lUpperArm.rotation, thickness: 1.55 },
      { part: 'pipe', bone: 'rUpperArm', position: offsetBone(bones.rUpperArm, 0.01, 0.02, -0.055), scale: 0.075, rotation: bones.rUpperArm.rotation, thickness: 1.55 },
      { part: 'pipe', bone: 'lThigh', position: offsetBone(bones.lThigh, -0.01, 0.0, -0.02), scale: 0.09, rotation: bones.lThigh.rotation, thickness: 1.45 },
      { part: 'pipe', bone: 'rThigh', position: offsetBone(bones.rThigh, 0.01, 0.0, -0.02), scale: 0.09, rotation: bones.rThigh.rotation, thickness: 1.45 },
    );
  }

  if (shapeId === 'heavy') {
    // belly rides the torso bone too (same world-space rule as the pecs)
    out.push(
      { part: 'hand', bone: 'torso', position: offsetBone(bones.torso, 0, -y(0.17), -0.19), scale: 0.12, rotation: [10, 0, 0], thickness: 1.45 },
    );
  }

  return out;
}

export function buildAnatomy(shapeId: BodyShapeId = 'neutral', pose: BodyPoseId = 'stand', phase = 0, actions: RigTimelineAction[] = []): BodyInstance[] {
  const s = BODY_SHAPES[shapeId];
  const bones = buildSkeleton(shapeId, pose, phase, actions);
  return anatomyFromSkeleton(s, shapeId, bones);
}

function hitboxesFromSkeleton(bones: Record<BoneId, SkeletonBone>): BodyHitbox[] {
  return (Object.keys(bones) as BoneId[]).map((id) => ({
    id,
    position: bones[id].position,
    rotation: bones[id].rotation,
    size: bones[id].hitbox,
  }));
}

export function buildHitboxes(shapeId: BodyShapeId = 'neutral', pose: BodyPoseId = 'stand', phase = 0, actions: RigTimelineAction[] = []): BodyHitbox[] {
  const bones = buildSkeleton(shapeId, pose, phase, actions);
  return hitboxesFromSkeleton(bones);
}

function anchorsFromSkeleton(s: typeof BODY_SHAPES.neutral, bones: Record<BoneId, SkeletonBone>): BodyAnchor[] {
  const anchor = (
    id: BodyAnchorId,
    bone: BoneId,
    role: BodyAnchor['role'],
    position: [number, number, number],
    radius: number,
    priority: number,
    accepts: string[],
    rotation = bones[bone].rotation,
  ): BodyAnchor => ({ id, bone, role, position, rotation, radius, priority, accepts });

  return [
    anchor('head', 'head', 'target', bones.head.position, 0.18 * s.head, 80, ['look_at', 'hit', 'grab', 'inspect']),
    anchor('face', 'head', 'target', offsetBone(bones.head, 0, 0.0, -0.21 * s.head), 0.145 * s.head, 100, ['look_at', 'grab', 'punch', 'kiss', 'inspect']),
    anchor('face_grab', 'head', 'target', offsetBone(bones.head, 0, -0.03 * s.height, -0.245 * s.head), 0.12 * s.head, 120, ['grab_face', 'cover_mouth', 'shove']),
    anchor('eyes', 'head', 'look', offsetBone(bones.head, 0, 0.07 * s.height, -0.23 * s.head), 0.07 * s.head, 110, ['look_at', 'aim']),
    anchor('mouth', 'head', 'target', offsetBone(bones.head, 0, -0.045 * s.height, -0.235 * s.head), 0.055 * s.head, 105, ['cover_mouth', 'feed', 'talk_to']),
    anchor('neck', 'torso', 'socket', offsetBone(bones.torso, 0, 0.43 * s.torsoLong, -0.02), 0.09 * s.head, 75, ['choke', 'collar', 'attach']),
    anchor('left_palm', 'lHand', 'socket', offsetBone(bones.lHand, 0, -0.02 * s.height, -0.055), 0.065 * s.hand, 70, ['hold', 'touch', 'grab']),
    anchor('right_palm', 'rHand', 'socket', offsetBone(bones.rHand, 0, -0.02 * s.height, -0.055), 0.065 * s.hand, 70, ['hold', 'touch', 'grab']),
    anchor('left_grab_origin', 'lHand', 'origin', offsetBone(bones.lHand, 0, -0.02 * s.height, -0.09), 0.08 * s.hand, 85, ['grab_face', 'grab_item', 'punch']),
    anchor('right_grab_origin', 'rHand', 'origin', offsetBone(bones.rHand, 0, -0.02 * s.height, -0.09), 0.08 * s.hand, 85, ['grab_face', 'grab_item', 'punch']),
  ];
}

export function buildRigAnchors(shapeId: BodyShapeId = 'neutral', pose: BodyPoseId = 'stand', phase = 0, actions: RigTimelineAction[] = []): BodyAnchor[] {
  const s = BODY_SHAPES[shapeId];
  const bones = buildSkeleton(shapeId, pose, phase, actions);
  return anchorsFromSkeleton(s, bones);
}

function offsetBone(bone: SkeletonBone, dx: number, dy: number, dz: number): [number, number, number] {
  return [bone.position[0] + dx, bone.position[1] + dy, bone.position[2] + dz];
}

// Deltoid ball: pulled slightly INWARD off the joint so it always bridges
// the torso surface and the arm top — the naked figure's shoulders must read
// attached without a shirt box doing the hiding. Sized by shoulder breadth
// (wider builds open a wider torso→arm gap to span).
function shoulderSocket(side: -1 | 1, s: typeof BODY_SHAPES.neutral, bones: Record<BoneId, SkeletonBone>): BodyInstance {
  const shoulder = side < 0 ? bones.lShoulder : bones.rShoulder;
  const torso = bones.torso;
  return {
    part: 'hand',
    bone: side < 0 ? 'lShoulder' : 'rShoulder',
    // tucked 12% toward the TORSO, not toward world x=0 — bones may be
    // world-space now (ragdoll / offset figures), and scaling the absolute
    // coordinate sent these floating away from any body off the origin
    // (the ragdoll_lab "phantom shoulders").
    position: [
      shoulder.position[0] + (torso.position[0] - shoulder.position[0]) * 0.12,
      shoulder.position[1] - 0.012,
      shoulder.position[2],
    ],
    scale: 0.105 * Math.max(0.9, (s.shoulder + s.limbThick) / 2),
    rotation: shoulder.rotation,
    thickness: 1.7,
  };
}

function elbowSocket(side: -1 | 1, s: typeof BODY_SHAPES.neutral, bones: Record<BoneId, SkeletonBone>): BodyInstance {
  const elbow = side < 0 ? bones.lElbow : bones.rElbow;
  return {
    part: 'hand',
    bone: side < 0 ? 'lElbow' : 'rElbow',
    position: elbow.position,
    scale: 0.068 * Math.max(0.9, s.limbThick),
    rotation: elbow.rotation,
    thickness: 1.35,
  };
}

function pelvisSocket(s: typeof BODY_SHAPES.neutral, bones: Record<BoneId, SkeletonBone>): BodyInstance {
  return {
    part: 'torso',
    bone: 'pelvis',
    position: bones.pelvis.position,
    scale: bones.pelvis.scale * 1.18,
    rotation: bones.pelvis.rotation,
    thickness: s.hip * 1.18,
  };
}

function hipSocket(side: -1 | 1, s: typeof BODY_SHAPES.neutral, bones: Record<BoneId, SkeletonBone>): BodyInstance {
  const hip = side < 0 ? bones.lHip : bones.rHip;
  return {
    part: 'hand',
    bone: side < 0 ? 'lHip' : 'rHip',
    position: hip.position,
    scale: 0.076 * Math.max(0.92, s.hip),
    rotation: hip.rotation,
    thickness: 1.38,
  };
}

function kneeSocket(side: -1 | 1, s: typeof BODY_SHAPES.neutral, bones: Record<BoneId, SkeletonBone>): BodyInstance {
  const knee = side < 0 ? bones.lKnee : bones.rKnee;
  return {
    part: 'hand',
    bone: side < 0 ? 'lKnee' : 'rKnee',
    position: knee.position,
    scale: 0.07 * Math.max(0.9, s.limbThick),
    rotation: knee.rotation,
    thickness: 1.36,
  };
}

// Fingers hang OFF THE PALM: every offset is relative to the hand bone's
// center and the palm block's actual half-extents, so finger roots sit
// INSIDE the palm and the fan stays within its width. (The old fan hung from
// body-height offsets — fingers floated below and wider than the palm.)
function fingerFan(hand: SkeletonBone, side: -1 | 1, s: typeof BODY_SHAPES.neutral, actions: RigTimelineAction[] = []): BodyInstance[] {
  const [cx, cy, cz] = hand.position;
  // palm half-height: hand part scale 0.112 × preset scaleY 0.5
  const palmHalfY = 0.056 * s.hand;
  const out: BodyInstance[] = [];
  const clench = Math.max(actionWeight(actions, 'fist', 'clench', side), actionWeight(actions, 'hand', 'grip', side));
  const open = actionWeight(actions, 'hand', 'open', side);
  const point = Math.max(actionWeight(actions, 'finger', 'point', side), actionWeight(actions, 'hand', 'point', side));
  const middle = actionWeight(actions, 'finger', 'middle', side);
  const pinch = Math.max(actionWeight(actions, 'finger', 'pinch', side), actionWeight(actions, 'hand', 'pinch', side));
  const wiggle = actionOsc(actions, 'finger', 'wiggle_loop', side, 5);
  const crawl = actionOsc(actions, 'finger', 'crawl_loop', side, 3);
  const jazz = actionOsc(actions, 'hand', 'jazz_loop', side, 4);
  const thumbUp = Math.max(actionWeight(actions, 'finger', 'thumbs_up', side), actionWeight(actions, 'hand', 'thumbs_up', side));
  const baseClench = Math.max(0, Math.min(1, clench + point * 0.72 + middle * 0.72 + pinch * 0.5 - open * 0.7));
  for (let i = 0; i < 4; i++) {
    const isIndex = i === 1;
    const isMiddle = i === 2;
    const extend = Math.max(isIndex ? point : 0, isMiddle ? middle : 0, open * 0.65);
    const curl = Math.max(0, Math.min(1, baseClench * (1 - extend * 0.9) + pinch * (isIndex || isMiddle ? 0.3 : 0.9)));
    const live = wiggle * (i % 2 === 0 ? 1 : -1) + crawl * Math.sin((i / 4) * Math.PI * 2) + jazz * (0.5 + i * 0.16);
    // tight fan: ±0.051 keeps all four roots within the palm's ~0.064 half-width
    const off = (i - 1.5) * 0.034 * s.hand;
    const scale = (i === 1 || i === 2 ? 0.078 : 0.068) * s.hand * (1 - curl * 0.22 + extend * 0.2);
    const halfLen = 0.79 * scale; // finger preset scaleY × instance scale
    out.push({
      part: 'finger',
      position: [
        cx + off * (1 - curl * 0.35),
        // root buried in the palm: center sits palmHalf + 55% of the finger below
        cy - palmHalfY - halfLen * 0.55 + curl * 0.05 * s.hand - extend * 0.014 * s.height + live * 0.006,
        cz - 0.03 + curl * 0.03 - extend * 0.02,
      ],
      scale,
      rotation: [14 + curl * 78 - extend * 18 + live * 9, 0, side * ((i - 1.5) * 3 + curl * 12 + live * 8)],
      thickness: i === 1 || i === 2 ? 1.12 : 1.0,
    });
  }
  // thumb hugs the palm's inner edge, rooted at its upper corner
  out.push({
    part: 'finger',
    position: [
      cx - side * (0.068 - baseClench * 0.02) * s.hand,
      cy - (0.022 - baseClench * 0.036 + thumbUp * 0.055) * s.height,
      cz - 0.025 + baseClench * 0.025,
    ],
    scale: 0.058 * s.hand * (1 - baseClench * 0.16 + thumbUp * 0.08),
    rotation: [12 + baseClench * 55 - thumbUp * 30, 0, -side * (58 - baseClench * 30 + thumbUp * 78)],
    thickness: 1.25,
  });
  return out;
}

export type ClothingInstance = {
  geometry: 'box' | 'sphere' | 'cone' | 'cylinder';
  params?: any;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
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
  bonesOverride?: Record<BoneId, SkeletonBone>,
): ClothingInstance[] {
  const s = BODY_SHAPES[shapeId];
  const c = CLOTHING[style];
  const bones = bonesOverride ?? buildSkeleton(shapeId, pose, phase, actions);
  const clothes: ClothingInstance[] = [];
  const box = (
    position: [number, number, number],
    scale: [number, number, number],
    color: string,
    rotation: [number, number, number] = [0, 0, 0],
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
  const sphere = (
    position: [number, number, number],
    scale: [number, number, number],
    color: string,
    rotation: [number, number, number] = [0, 0, 0],
    opacity = 1,
  ): ClothingInstance => ({
    geometry: 'sphere',
    params: { radius: 1, segments: 16, rings: 10 },
    position,
    rotation,
    scale,
    color,
    opacity,
  });
  const cone = (
    position: [number, number, number],
    scale: [number, number, number],
    color: string,
    rotation: [number, number, number] = [0, 0, 0],
    opacity = 1,
  ): ClothingInstance => ({
    geometry: 'cone',
    params: { radius: 1, height: 1, segments: 24 },
    position,
    rotation,
    scale,
    color,
    opacity,
  });
  const cylinder = (
    position: [number, number, number],
    scale: [number, number, number],
    color: string,
    rotation: [number, number, number] = [0, 0, 0],
    opacity = 1,
  ): ClothingInstance => ({
    geometry: 'cylinder',
    params: { radius: 1, height: 1, segments: 20 },
    position,
    rotation,
    scale,
    color,
    opacity,
  });

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

  // ── bottoms — a real garment layer, chosen independently of the top.
  // Leg pieces are placed by lerping along the ACTUAL joint chain (hip→knee→
  // ankle) and wearing the leg bones' rotations, so pants track walk strides
  // and kneels instead of hovering at stand-pose heights. Suit/armor tops
  // tint long pants to match the jacket.
  const b = BOTTOMS[bottoms];
  const longPants = bottoms === 'jeans' || bottoms === 'slacks';
  const matchTop = (style === 'suit' || style === 'armor') && longPants;
  const bMain = matchTop ? c.secondary : b.primary;
  const bTrim = matchTop ? darkShoe(c.secondary) : b.secondary;
  const underDress = style === 'dress';
  const lerp3 = (p: [number, number, number], q: [number, number, number], t: number): [number, number, number] =>
    [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const span3 = (p: [number, number, number], q: [number, number, number]) =>
    Math.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2);
  const legJoints = (side: -1 | 1) => side < 0
    ? { hip: bones.lHip, knee: bones.lKnee, foot: bones.lFoot, thigh: bones.lThigh, shin: bones.lShin }
    : { hip: bones.rHip, knee: bones.rKnee, foot: bones.rFoot, thigh: bones.rThigh, shin: bones.rShin };
  // a garment tube over t0..t1 of a leg segment, wearing that bone's rotation.
  // t0 goes NEGATIVE to ride past the hip joint UP UNDER the seat box — the
  // thigh tube must overlap the seat or a skin band shows at the groin (the
  // "legs not with the groin" gap). `inX` tucks the tube toward the crotch.
  const legPiece = (side: -1 | 1, seg: 'thigh' | 'shin', t0: number, t1: number, w: number, color: string, inX = 0): ClothingInstance => {
    const j = legJoints(side);
    const [p, q] = seg === 'thigh' ? [j.hip.position, j.knee.position] : [j.knee.position, j.foot.position];
    const ctr = lerp3(p, q, (t0 + t1) / 2);
    ctr[0] -= side * inX;
    // depth ≈ width: the leg pipe is round (z radius = x radius), so slimmer
    // tubes would let thick thighs (builder/heavy) poke through front/back
    return box(ctr, [w, span3(p, q) * (t1 - t0), w * 0.92], color, (seg === 'thigh' ? j.thigh : j.shin).rotation, 1);
  };
  const thighTuck = 0.02 * s.hip;
  // every thigh tube starts at -0.35 (above the hip, under the seat) so the
  // seat (bottom ≈ pelvis−0.07h) and the tube (top ≈ hip+0.13·span) always
  // overlap; the crotch box spans both and bridges between the legs.
  const THIGH_TOP = -0.35;
  // garment depth (z): the body is only ~±0.11 deep at the hips — bottoms
  // sized off s.hip in z read as a sandwich board from the side. Wrap, don't jut.
  const seatZ = 0.26 * s.hip;

  // female underwear is its own garment, not shrunken male boxes: a low-rise
  // panty (no leg stubs, angled hip cuts) and — when shirtless — a bra.
  const feminineBody = shapeId === 'female';
  const panties = bottoms === 'briefs' && feminineBody;

  if (style === 'underwear' && feminineBody) {
    const pr = bones.torso.rotation;
    clothes.push(
      // band wraps the ribcage (the naked torso wears no profile shrink, so
      // the band must be wider/deeper than the bare chest surface)
      box(offsetBone(bones.torso, 0, 0.105 * s.height, -0.01), [0.6 * s.torsoWide, 0.055, 0.38 * s.torsoWide], bMain, pr, 1),
      // cups riding the chest bulge
      sphere(offsetBone(bones.torso, -0.115 * s.torsoWide, 0.125 * s.height, -0.16), [0.07 * s.torsoWide, 0.055, 0.055], bMain, pr, 1),
      sphere(offsetBone(bones.torso, 0.115 * s.torsoWide, 0.125 * s.height, -0.16), [0.07 * s.torsoWide, 0.055, 0.055], bMain, pr, 1),
      // straps up over the shoulder slope
      box(offsetBone(bones.torso, -0.115 * s.torsoWide, 0.21 * s.height, -0.1), [0.022, 0.16 * s.torsoLong, 0.02], bTrim, pr, 1),
      box(offsetBone(bones.torso, 0.115 * s.torsoWide, 0.21 * s.height, -0.1), [0.022, 0.16 * s.torsoLong, 0.02], bTrim, pr, 1),
    );
  }

  if (!underDress && panties) {
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

  if (!underDress && !panties) {
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
  if (!underDress || longPants || bottoms === 'shorts') {
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

  if (style !== 'underwear' || bottoms !== 'briefs') {
    const shoe = style === 'dress' ? '#171717' : style === 'armor' ? c.secondary : style === 'underwear' ? darkShoe(bMain) : darkShoe(c.secondary);
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

export function buildRigFrame(
  shapeId: BodyShapeId = 'neutral',
  pose: BodyPoseId = 'stand',
  phase = 0,
  actions: RigTimelineAction[] = [],
  clothing: ClothingId = 'tee',
  clothingSkin: ClothingSkinId = 'plain',
  accessories: ClothingAccessoryId[] = [],
  bottoms: BottomsId = DEFAULT_BOTTOMS[clothing],
): BodyRigFrame {
  const s = BODY_SHAPES[shapeId];
  const bones = buildSkeleton(shapeId, pose, phase, actions);
  return {
    bones,
    assembly: assemblyFromSkeleton(s, bones, actions),
    clothing: buildClothing(clothing, shapeId, pose, phase, actions, clothingSkin, accessories, bottoms, bones),
    anatomy: anatomyFromSkeleton(s, shapeId, bones),
    hitboxes: hitboxesFromSkeleton(bones),
    anchors: anchorsFromSkeleton(s, bones),
  };
}

// The physics seam: a full rig frame from a CUSTOM bones record instead of an
// authored pose — every downstream layer (parts assembly, joint sockets,
// clothing, hitboxes, anchors) is already bones-driven, so a ragdoll solver
// (see ragdoll.ts) only has to produce bone positions/rotations and the whole
// dressed figure follows. `pose`/`phase` never enter: the bones ARE the pose.
export function buildRigFrameFromBones(
  bones: Record<BoneId, SkeletonBone>,
  shapeId: BodyShapeId = 'neutral',
  clothing: ClothingId = 'tee',
  clothingSkin: ClothingSkinId = 'plain',
  accessories: ClothingAccessoryId[] = [],
  bottoms: BottomsId = DEFAULT_BOTTOMS[clothing],
  actions: RigTimelineAction[] = [],
): BodyRigFrame {
  const s = BODY_SHAPES[shapeId];
  return {
    bones,
    assembly: assemblyFromSkeleton(s, bones, actions),
    clothing: buildClothing(clothing, shapeId, 'stand', 0, actions, clothingSkin, accessories, bottoms, bones),
    anatomy: anatomyFromSkeleton(s, shapeId, bones),
    hitboxes: hitboxesFromSkeleton(bones),
    anchors: anchorsFromSkeleton(s, bones),
  };
}

function darkShoe(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#1f2937';
  const c = (i: number) => Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * 0.55).toString(16).padStart(2, '0');
  return `#${c(0)}${c(1)}${c(2)}`;
}

export const ASSEMBLY: BodyInstance[] = buildAssembly('neutral');

// ── .body documents — a whole character, sqi/hed conventions ────────────────

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
  /** signed floats −1..1 per part (the lab's live grids). */
  sculpts: Record<PartId, number[]>;
  /** dragged outlines per part (PROFILE_N samples). */
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
  for (const id of LEGACY_PART_IDS) {
    const part = doc.parts[id];
    if (!part || !Array.isArray(part.sculpt) || !Array.isArray(part.layers)) return null;
  }
  return doc as BodyDocument;
}

export function serializeBody(doc: BodyDocument): string {
  return JSON.stringify(doc);
}
