// model/playerStarter.ts — the PLAYER / NPC starter model (req_2761/req_2762).
//
// File → New Mesh → Player / NPC Model seeds a full humanoid as a MULTI-PART
// mesh document: one editable part per body region, each NAMED AFTER ITS BONE
// in the body formation (runtime/skeleton rigs.ts bodyRigBones — the skeleton
// object model). The default silhouettes use captured radial-profile lathes
// (profile shapes control RADIUS ONLY, never length)
// evaluated at the neutral stand pose, so the default body IS the old player
// model — now as ordinary editable mesh parts. Adjust any part in the editor,
// save/export whole; the package manifest carries the skeleton (formation +
// per-bone mesh assignments) forward as the rig truth (req_2718 pattern).
//
// The profile tables and stand-pose joint positions below are editor-owned data
// re-based onto the bodyRigBones vocabulary. Ground is y=0; the figure stands
// ~2.05 m tall facing -Z (the figure-stack convention).

import { sphere, translateVerts, rotateVerts, mergeMesh, type EditMesh, type V3 } from './editMesh';
import type { ModelPart } from '../data/types';
import { bodyRigBones, defineSkeleton, type Skeleton, type MeshAssignment } from '../../../runtime/skeleton';

// ── silhouette profiles (radius multipliers, top → bottom) ─────────────────────
// TORSO/PIPE/HAND/FOOT are the figure stack's PART_PRESETS profiles verbatim.
// BARREL and SEAT are new bridges for the chest/abdomen/butt split — the old
// stack covered that span with one torso egg + a pelvis copy; the starter gives
// each region its own part so each is adjustable alone.
const TORSO_PROFILE = [0.72, 1.0, 0.94, 0.88, 0.6];
const PIPE_PROFILE = [0.45, 0.85, 0.8, 0.85, 0.45];
const HAND_PROFILE = [0.5, 0.92, 0.76];
const FOOT_PROFILE = [0.38, 0.5, 0.66, 0.85, 1.0, 1.0];
const FINGER_PROFILE = [0.54, 0.92, 0.8, 0.5];
const BARREL_PROFILE = [0.85, 1.0, 1.0, 0.95, 0.8];
const SEAT_PROFILE = [0.7, 1.0, 1.0, 0.92, 0.62];

// Mannequin skin tones — three alternating shades so adjacent outliner rows and
// neighboring body regions read apart at a glance.
const SKIN = '#d9b08c';
const SKIN_DIM = '#c9a07c';
const SKIN_JOINT = '#b98f6e';

const DEG = Math.PI / 180;

/** One starter part: a profile lathe placed at its stand-pose center. Rows are
 *  authored for the LEFT side (negative x); `side` pairs mirror to the right. */
type StarterRow = {
  /** bodyRigBones bone id (unpaired) or pair stem (`hand` → hand_left/right). */
  bone: string;
  side?: boolean;
  center: V3;
  /** Half-extents [rx, ry, rz]; ry is the length axis (profiles never touch it). */
  radii: V3;
  profile?: number[];
  segments: number;
  /** Whole-part lean, degrees — Z lean mirrors with the side, X lean doesn't. */
  tiltZ?: number;
  tiltX?: number;
  /** Toe lean: shifts rings toward -Z (forward) as the lathe descends (feet). */
  leanZ?: number;
  color: string;
};

// Stand-pose placement, captured from buildSkeleton('neutral','stand') — bone
// centers/joints evaluated by hand at phase 0 with no actions.
const STARTER_ROWS: StarterRow[] = [
  { bone: 'head', center: [0, 1.8, 0], radii: [0.21, 0.25, 0.21], segments: 16, color: SKIN },
  { bone: 'chest', center: [0, 1.38, 0], radii: [0.3, 0.26, 0.19], profile: TORSO_PROFILE, segments: 14, color: SKIN_DIM },
  { bone: 'abdomen', center: [0, 1.06, 0], radii: [0.26, 0.2, 0.175], profile: BARREL_PROFILE, segments: 14, color: SKIN },
  { bone: 'butt', center: [0, 0.88, 0], radii: [0.25, 0.19, 0.2], profile: SEAT_PROFILE, segments: 12, color: SKIN_DIM },
  { bone: 'shoulder', side: true, center: [-0.3, 1.52, 0], radii: [0.1, 0.1, 0.1], segments: 8, color: SKIN_JOINT },
  { bone: 'upper_arm', side: true, center: [-0.3244, 1.3215, 0], radii: [0.069, 0.226, 0.069], profile: PIPE_PROFILE, segments: 10, tiltZ: -7, color: SKIN },
  { bone: 'elbow', side: true, center: [-0.3487, 1.123, 0], radii: [0.08, 0.08, 0.08], segments: 8, color: SKIN_JOINT },
  { bone: 'lower_arm', side: true, center: [-0.3745, 0.96, 0], radii: [0.05, 0.199, 0.05], profile: PIPE_PROFILE, segments: 10, tiltZ: -9, color: SKIN },
  { bone: 'wrist', side: true, center: [-0.4097, 0.738, 0], radii: [0.065, 0.065, 0.065], segments: 8, color: SKIN_JOINT },
  { bone: 'hand', side: true, center: [-0.419, 0.6785, 0], radii: [0.069, 0.056, 0.047], profile: HAND_PROFILE, segments: 10, tiltZ: -9, color: SKIN_DIM },
  { bone: 'hip', side: true, center: [-0.17, 0.82, 0], radii: [0.09, 0.09, 0.09], segments: 8, color: SKIN_JOINT },
  { bone: 'upper_leg', side: true, center: [-0.1768, 0.63, 0], radii: [0.115, 0.288, 0.115], profile: PIPE_PROFILE, segments: 12, tiltZ: -3, color: SKIN },
  { bone: 'knee', side: true, center: [-0.1836, 0.44, 0], radii: [0.086, 0.086, 0.086], segments: 8, color: SKIN_JOINT },
  { bone: 'lower_leg', side: true, center: [-0.1836, 0.255, -0.0275], radii: [0.08, 0.26, 0.08], profile: PIPE_PROFILE, segments: 12, tiltX: 8.45, color: SKIN },
  { bone: 'foot', side: true, center: [-0.1836, 0.075, -0.09], radii: [0.065, 0.073, 0.171], profile: FOOT_PROFILE, segments: 10, leanZ: -0.5, color: SKIN_DIM },
];

/** Linear sample of a profile table at t ∈ [0,1] (0 = top ring) — the Globe's
 *  profile semantics: multiplies ring RADIUS only, never the length axis. */
function sampleProfile(profile: number[], t: number): number {
  if (profile.length === 0) return 1;
  if (profile.length === 1) return profile[0]!;
  const f = Math.max(0, Math.min(1, t)) * (profile.length - 1);
  const i = Math.min(profile.length - 2, Math.floor(f));
  const frac = f - i;
  return profile[i]! * (1 - frac) + profile[i + 1]! * frac;
}

function allVerts(m: EditMesh): number[] {
  return m.verts.map((_, i) => i);
}

/** The lathe core: a unit UV sphere reshaped by a radial profile (multiplies
 *  ring RADIUS only) and squashed to half-extents. Origin-centered, unrotated. */
function profiledLathe(radii: V3, profile: number[] | undefined, segments: number, leanZ = 0): EditMesh {
  const [rx, ry, rz] = radii;
  const m = sphere(1, segments);
  const verts = m.verts.map(([x, y, z]): V3 => {
    const t = (1 - y) / 2; // 0 at the top pole → 1 at the bottom
    const p = profile ? sampleProfile(profile, t) : 1;
    return [x * p * rx, y * ry, z * p * rz + (leanZ ? leanZ * t * rz : 0)];
  });
  return { ...m, verts };
}

/** Build one starter part's EditMesh: the profile lathe leaned and placed at
 *  its stand-pose center. */
function latheMesh(row: StarterRow, mirrored: boolean): EditMesh {
  let m = profiledLathe(row.radii, row.profile, row.segments, row.leanZ ?? 0);
  const tiltZ = row.tiltZ ? (mirrored ? -row.tiltZ : row.tiltZ) : 0;
  if (tiltZ) m = rotateVerts(m, allVerts(m), [0, 0, 0], 2, tiltZ * DEG);
  if (row.tiltX) m = rotateVerts(m, allVerts(m), [0, 0, 0], 0, row.tiltX * DEG);
  const cx = mirrored ? -row.center[0] : row.center[0];
  return translateVerts(m, allVerts(m), [cx, row.center[1], row.center[2]]);
}

// ── the finger fans (req_2768) ─────────────────────────────────────────────────
// The old model's hands had real digits — 4 fingers + a thumb hanging off each
// palm (fingerFan, game/figure/assembly.ts), articulated enough to fly the bird
// (the 'middle' finger action). The starter bakes that fan at REST into one
// `fingers_<side>` part per hand — the vocabulary's fingers bone — so the digits
// are there to sculpt and the bone is there to animate. Numbers are the fan's
// rest evaluation: digit roots buried in the palm (center palmHalf + 55% of the
// finger below), index/middle thicker, thumb on the inner edge swung 58° out.
type Digit = { off: V3; scale: number; thickness: number; rotX: number; rotZ: number };

const PALM_HALF_Y = 0.056; // hand part scale 0.112 × preset scaleY 0.5

/** The rest-pose fan, authored for the LEFT hand (thumb toward +x = inboard). */
function restDigits(): Digit[] {
  const out: Digit[] = [];
  for (let i = 0; i < 4; i += 1) {
    const mid = i === 1 || i === 2;
    const scale = mid ? 0.078 : 0.068;
    const halfLen = 0.79 * scale;
    out.push({
      off: [(i - 1.5) * 0.034, -PALM_HALF_Y - halfLen * 0.55, -0.03],
      scale,
      thickness: mid ? 1.12 : 1.0,
      rotX: 14,
      rotZ: -(i - 1.5) * 3,
    });
  }
  out.push({ off: [0.068, -0.022, -0.025], scale: 0.058, thickness: 1.25, rotX: 12, rotZ: 58 });
  return out;
}

/** One hand's digits merged into a single fingers part, riding the hand's lean
 *  and placed below its palm. */
function fingersMesh(hand: StarterRow, mirrored: boolean): EditMesh {
  let fan: EditMesh | null = null;
  for (const d of restDigits()) {
    const radii: V3 = [d.scale * 0.34 * d.thickness, d.scale * 0.79, d.scale * 0.28 * d.thickness];
    let m = profiledLathe(radii, FINGER_PROFILE, 6);
    m = rotateVerts(m, allVerts(m), [0, 0, 0], 0, d.rotX * DEG);
    const rotZ = mirrored ? -d.rotZ : d.rotZ;
    if (rotZ) m = rotateVerts(m, allVerts(m), [0, 0, 0], 2, rotZ * DEG);
    m = translateVerts(m, allVerts(m), [mirrored ? -d.off[0] : d.off[0], d.off[1], d.off[2]]);
    fan = fan ? mergeMesh(fan, m, [0, 0, 0]) : m;
  }
  const tiltZ = hand.tiltZ ? (mirrored ? -hand.tiltZ : hand.tiltZ) : 0;
  let m = tiltZ ? rotateVerts(fan!, allVerts(fan!), [0, 0, 0], 2, tiltZ * DEG) : fan!;
  const cx = mirrored ? -hand.center[0] : hand.center[0];
  return translateVerts(m, allVerts(m), [cx, hand.center[1], hand.center[2]]);
}

/** Every meshed bone id in outliner order (paired rows expand left, right). */
function starterBoneIds(): { bone: string; row: StarterRow; mirrored: boolean }[] {
  const out: { bone: string; row: StarterRow; mirrored: boolean }[] = [];
  for (const row of STARTER_ROWS) {
    if (!row.side) { out.push({ bone: row.bone, row, mirrored: false }); continue; }
    out.push({ bone: `${row.bone}_left`, row, mirrored: false });
    out.push({ bone: `${row.bone}_right`, row, mirrored: true });
  }
  return out;
}

/** The starter outliner: one ModelPart per meshed body bone, named by bone id.
 *  Each hand's finger fan follows it as a `fingers_<side>` part. Face-detail
 *  bones (eyes/nose/mouth/hair/…) and toes stay unmeshed — sculpt and paint
 *  territory, but they EXIST in the skeleton for later rigging. */
export function playerStarterParts(): ModelPart[] {
  const parts: ModelPart[] = [];
  for (const { bone, row, mirrored } of starterBoneIds()) {
    parts.push({
      id: `part:player:${bone}`,
      name: bone,
      mesh: latheMesh(row, mirrored),
      visible: true,
      color: row.color,
    });
    if (row.bone === 'hand') {
      const fingers = mirrored ? 'fingers_right' : 'fingers_left';
      parts.push({
        id: `part:player:${fingers}`,
        name: fingers,
        mesh: fingersMesh(row, mirrored),
        visible: true,
        color: SKIN,
      });
    }
  }
  return parts;
}

// ── the skeleton the package carries (rig truth) ───────────────────────────────

// World-space rest anchors for bones without a STARTER_ROWS row — the face
// features sit on the -Z hemisphere (the figure faces -Z), back/breast on the
// chest surface, the finger fans at their merged-part center below the palms,
// toe stubs just past the feet. Meshed row bones anchor at their part center.
const EXTRA_BONE_WORLD: Record<string, V3> = {
  body: [0, 0.9, 0],
  crotch: [0, 0.8, 0],
  breast: [0, 1.44, -0.17],
  back: [0, 1.4, 0.17],
  hair: [0, 1.92, 0],
  nose: [0, 1.8, -0.21],
  mouth: [0, 1.74, -0.18],
  lips: [0, 1.74, -0.19],
  teeth: [0, 1.74, -0.17],
  eye_left: [-0.08, 1.84, -0.18],
  eye_right: [0.08, 1.84, -0.18],
  fingers_left: [-0.43, 0.59, -0.028],
  fingers_right: [0.43, 0.59, -0.028],
  toes_left: [-0.1836, 0.04, -0.24],
  toes_right: [0.1836, 0.04, -0.24],
};

/** The full body formation with stand-pose rest transforms stamped (each bone's
 *  pos is parent-relative), plus per-bone mesh assignments for the meshed parts.
 *  This is what the manifest stores — the same Skeleton the host validates
 *  through bones_loader (formation + carried data, no thing-type anywhere). */
export function playerStarterSkeleton(modelId: string): Skeleton {
  const world = new Map<string, V3>(Object.entries(EXTRA_BONE_WORLD));
  for (const { bone, row, mirrored } of starterBoneIds()) {
    world.set(bone, [mirrored ? -row.center[0] : row.center[0], row.center[1], row.center[2]]);
  }
  const bones = bodyRigBones().map((bone) => {
    const at = world.get(bone.id);
    const parentAt = bone.parent ? world.get(bone.parent) : undefined;
    if (!at) return bone;
    const base: V3 = parentAt ?? [0, 0, 0];
    return { ...bone, transform: { pos: [at[0] - base[0], at[1] - base[1], at[2] - base[2]] as V3 } };
  });
  // One assignment per OUTLINER part (rows + the finger fans) — the part name
  // IS the bone id, so the parts list is the assignment list.
  const items: MeshAssignment[] = [];
  for (const { bone, row } of starterBoneIds()) {
    items.push({ boneId: bone, geometryKey: bone });
    if (row.bone === 'hand') {
      const fingers = bone === 'hand_left' ? 'fingers_left' : 'fingers_right';
      items.push({ boneId: fingers, geometryKey: fingers });
    }
  }
  return defineSkeleton(modelId, bones, { meshes: { kind: 'perBone', items } });
}
