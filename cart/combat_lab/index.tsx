// combat_lab — player vs bot line-of-sight + weapon damage/shooting.
//
// THE FIGURES are head_lab's dressed models (parts.ts buildSkeleton →
// buildRigFrameFromBones), the same rigs pathing_lab and ragdoll_lab ride.
// Their per-bone hitboxes (BodyRigFrame.hitboxes — oriented boxes that track
// the pose) are the damage surface; a killed body hands itself to the
// head_lab verlet ragdoll and stays where it crumples.
//
// THE AIMING is hmsc's real over-the-shoulder system, lifted verbatim from
// gameplay/HmscGameplayRig + gameplay/camera + render3d/GameWorld3D: click to
// focus mouse-look (host __mouse_capture + __mouse_delta), HOLD RIGHT MOUSE
// to aim — the camera shifts onto the shoulder (aimShoulderShiftMeters), the
// crosshair appears at screen center, and LEFT MOUSE fires along the render
// camera's exact screen-center axis — what's under the crosshair is what
// gets hit. Esc releases the mouse.
//
// THE SHOT RULES are hmsc's two paths, joined the way the game joins them:
//   1. GEOMETRIC (player → bot): the crosshair ray vs every bot's bone
//      hitboxes, cut short by world cover. The struck bone maps to a damage
//      zone and its hmsc ZONE_DAMAGE multiplier — a headshot is a headshot
//      because the ray pierced the head box, never a dice roll.
//   2. PROBABILISTIC (bot → player): npc/systems/chance.ts ground truth —
//      hitChance(range, coverFraction, crouched, skill) → rollHit → rollZone
//      → zoneDamage off kinds.ts weaponDamage. No ray is ever cast at the
//      player's body; tracers are theater drawn after the dice.
//
// And the producer chance.ts is missing in the game, built here so hmsc can
// lift it: coverFractionOf() rays from the shooter's eye to sample points on
// the target's OWN bones vs the world AABBs — the blocked fraction IS the
// coverFraction. Samples ride the skeleton, so crouching (C — the rig's kneel
// pose + body-crouch action) genuinely pulls your head under a chest-high
// crate. Watch EXPOSURE fall and the bots' hit chance with it.
//
// Cover tiers, sized against the REAL figure (standing head ~1.8–2.0, full
// crouch head ~1.36): walls 2.7 block everything; crates 1.7 hide a crouched
// body completely and a standing body up to the shoulders; barriers 0.95 eat
// legs/hips only. The rendered boxes ARE the tested AABBs.
//
// THE PERCEPTION is Hitman-style, no wallhacks, driven by the kind registry
// (kinds.ts NpcPerceptionProfile) and the tile registry (tileKinds npc.noise):
//   - VISION is a forward FoV cone (drawn on the ground, colored by state) at
//     a per-kind range, gated by the cover sampler. Suspicion fills with
//     exposure × proximity / reactionSeconds — a glimpse of a crouched player
//     at range takes seconds; point-blank in the open is near-instant.
//   - HEARING is omnidirectional. Footsteps carry by movement mode (run 16m,
//     walk 8m, crouch 3.5m) × the tile's authored noise underfoot (mud 0.25 …
//     road 0.7) × the listener's acuity. Gunshots carry 40m. Every noise
//     draws its true ring — you SEE how loud you just were.
//   - STATES: calm → spooked (freeze, face it) → alert (investigate) →
//     hostile (fighters) / panic (unarmed). Awareness escalates UPWARD by
//     kind: civilians/paramedics run to NOTIFY an officer (handing him your
//     last reported position), thugs shout to nearby gang, the paramedic
//     TENDS downed bodies once the shooting stops. Hostiles hunt your last
//     CONFIRMED position — break line of sight and they lose you.
//
// Try: click scene to focus mouse · Esc releases · RMB hold = aim ·
//      LMB = fire (while aiming) · WASD move · SHIFT run · C crouch ·
//      1/2/3 weapon · V LoS rays · B hitboxes · H heal · P pause · R reset
//
// Pure TSX — no rebuild needed.
// Ship: ./scripts/ship combat_lab      Dev: ./scripts/dev combat_lab

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Row, Pressable, Text, Scene3D } from '@reactjit/runtime/primitives';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import * as Geometry from '@reactjit/geometries';

// head_lab figures — models, per-bone hitboxes, ragdoll. Same stack as
// pathing_lab/ragdoll_lab.
import {
  buildSkeleton, buildRigFrameFromBones,
  type BoneId, type SkeletonBone, type BodyRigFrame, type BodyHitbox,
  type BodyShapeId, type ClothingId, type ClothingSkinId, type ClothingAccessoryId, type BottomsId,
  type RigTimelineAction,
} from '../head_lab/parts';
import {
  createRagdoll, stepRagdoll, ragdollImpulse, ragdollMaxMotion, bonesFromRagdoll,
  placeBones, blendBones,
  type JointId, type Ragdoll, type V3,
} from '../head_lab/ragdoll';
import { generateFace, hedDepthGrid } from '../head_lab/hed';
import { buildPartRender, CharacterCaptures, FigureMeshes, type PartRender } from '../head_lab/figureRender';

// hmsc's combat math + camera — the systems under test, from the game itself.
import { hitChance, rollHit, rollZone } from '../hmsc/npc/systems/chance';
import { zoneDamage } from '../hmsc/npc/systems/damage';
import { npcKindDefinition } from '../hmsc/npc/kinds';
import { ZONE_DAMAGE } from '../hmsc/render3d/humanoid/hitbox';
import type { DamageZone } from '../hmsc/render3d/humanoid/skeleton';
import type { NpcKind } from '../hmsc/design';
import { HMSC_GAMEPLAY_CAMERA, clampCameraValue, angleDeltaDegrees } from '../hmsc/gameplay/camera';
import { TILE_KIND_DEFINITIONS, type TileKind } from '../hmsc/world/tileKinds';

const BG = '#0b1018';
const INK = '#e8eef8';
const DIM = '#7f93b1';
const GOOD = '#34d399';
const WARN = '#f59e0b';
const BAD = '#ef4444';
const CYAN = '#67e8f9';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const ARENA_HALF = 16.5;

const PLAYER_MAX_HP = 100;
const WALK_SPEED = 2.6;
const RUN_SPEED = 5.4;
const CROUCH_SPEED = 1.4;
const ENGAGE_ADVANCE_DIST = 20; // hostile bots close to this range before holding
const EXPOSURE_TO_FIRE = 0.12; // below this the bot can't justify a shot

// Shooter skill feeding chance.ts (0 hopeless .. 1 marksman). kinds.ts doesn't
// carry skill yet — when it graduates there, delete this table and read the def.
const SHOOTER_SKILL: Record<NpcKind, number> = { civilian: 0, paramedic: 0, thug: 0.42, police: 0.68 };
const FIRE_COOLDOWN: Record<NpcKind, number> = { civilian: 0, paramedic: 0, thug: 1.3, police: 0.95 };

// ── the floor: real hmsc tiles, and they're loud ─────────────────────────────
// Each ground patch is an actual tileKind; its `npc.noise` (authored in
// world/tileKinds) scales how far your footsteps carry. Sneak the mud, not
// the road. The patch you SEE is the noise factor you GET — same definition
// drives both the render color and the hearing math.

type FloorZone = { x0: number; z0: number; x1: number; z1: number; kind: TileKind };

const FLOOR_BASE: TileKind = 'sidewalk';
const FLOOR_ZONES: FloorZone[] = [
  { x0: -ARENA_HALF, z0: -1, x1: ARENA_HALF, z1: 2.4, kind: 'road' },      // loud strip across the middle
  { x0: -ARENA_HALF, z0: 3.6, x1: -8, z1: 14.5, kind: 'mud' },             // the quiet approach
  { x0: 5.5, z0: 9.5, x1: 14.5, z1: ARENA_HALF, kind: 'sand' },
  { x0: 7.5, z0: -ARENA_HALF, x1: ARENA_HALF, z1: -9, kind: 'asphalt' },
];

function floorKindAt(x: number, z: number): TileKind {
  for (const zone of FLOOR_ZONES) {
    if (x >= zone.x0 && x <= zone.x1 && z >= zone.z0 && z <= zone.z1) return zone.kind;
  }
  return FLOOR_BASE;
}

function tileNoiseAt(x: number, z: number): number {
  return TILE_KIND_DEFINITIONS[floorKindAt(x, z)].npc.noise;
}

// How far movement carries before the tile factor: a sprint is heard across
// half the arena on loud ground, a crouch-walk barely beyond arm's reach.
const MOVE_NOISE = {
  run: { radiusMeters: 16, salience: 0.5, stepSeconds: 0.32 },
  walk: { radiusMeters: 8, salience: 0.3, stepSeconds: 0.5 },
  crouch: { radiusMeters: 3.5, salience: 0.18, stepSeconds: 0.65 },
};
const GUNSHOT_NOISE = { radiusMeters: 40, salience: 1 };

// Player weapons — geometric-path parameters. Damage runs through the SAME
// ZONE_DAMAGE multipliers the game uses, picked by the struck bone's zone.
type WeaponId = 'pistol' | 'smg' | 'rifle';
const WEAPON_IDS: WeaponId[] = ['pistol', 'smg', 'rifle'];
const WEAPONS: Record<WeaponId, { label: string; damage: number; cooldownSeconds: number; rangeMeters: number; tracer: string }> = {
  pistol: { label: 'PISTOL', damage: 26, cooldownSeconds: 0.34, rangeMeters: 45, tracer: '#ffd966' },
  smg: { label: 'SMG', damage: 13, cooldownSeconds: 0.11, rangeMeters: 30, tracer: '#67e8f9' },
  rifle: { label: 'RIFLE', damage: 48, cooldownSeconds: 0.95, rangeMeters: 90, tracer: '#f0abfc' },
};

// ── tiny vector kit ──────────────────────────────────────────────────────────

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (v: V3): number => Math.hypot(v[0], v[1], v[2]);
const norm3 = (v: V3): V3 => {
  const l = len3(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
// head_lab figures face -Z at yaw 0 and placeBones takes heading+180, so a
// body moving/looking along d faces it with heading:
const headingOf = (dx: number, dz: number) => Math.atan2(dx, dz) * DEG;

// ── the cast: head_lab characters ────────────────────────────────────────────
// One face/outfit per actor — generateFace seeds the hed document, then
// buildPartRender bakes part params + texture keys; CharacterCaptures mounts
// the offscreen face/skin bakes. Kind stats still come from hmsc kinds.ts.

type ActorDef = {
  id: string;
  kind: NpcKind | 'player';
  seed: number;
  style: 'masculine' | 'feminine';
  shape: BodyShapeId;
  top: ClothingId;
  clothSkin: ClothingSkinId;
  acc: ClothingAccessoryId[];
  bottoms: BottomsId;
};

const ACTOR_DEFS: ActorDef[] = [
  { id: 'you', kind: 'player', seed: 7, style: 'masculine', shape: 'neutral', top: 'hoodie', clothSkin: 'designer', acc: [], bottoms: 'jeans' },
  { id: 'thug-1', kind: 'thug', seed: 11, style: 'masculine', shape: 'heavy', top: 'tee', clothSkin: 'stupid', acc: ['beanie'], bottoms: 'shorts' },
  { id: 'thug-2', kind: 'thug', seed: 23, style: 'masculine', shape: 'skinny', top: 'hoodie', clothSkin: 'fourtwenty', acc: ['shades'], bottoms: 'jeans' },
  { id: 'police-1', kind: 'police', seed: 31, style: 'masculine', shape: 'tall', top: 'suit', clothSkin: 'plain', acc: ['cap'], bottoms: 'slacks' },
  { id: 'civ-1', kind: 'civilian', seed: 42, style: 'feminine', shape: 'female', top: 'dress', clothSkin: 'plain', acc: [], bottoms: 'skirt' },
  { id: 'medic-1', kind: 'paramedic', seed: 57, style: 'masculine', shape: 'male', top: 'tee', clothSkin: 'plain', acc: ['cap'], bottoms: 'slacks' },
];

const defOf = (id: string): ActorDef => ACTOR_DEFS.find((d) => d.id === id)!;

// Full crouch = the rig's kneel pose + the skeleton's own body-crouch action
// (postureDrop). Head comes down to ~1.36 — genuinely under a 1.7 crate.
const CROUCH_ACTION: RigTimelineAction[] = [{ target: 'body', action: 'crouch', phase: 1, weight: 1 }];

// ── the world: axis-aligned cover boxes ──────────────────────────────────────
// Three tiers sized against the real figure. `h` is the load-bearing number:
// 2.7 walls beat a standing head (~2.0), 1.7 crates beat a crouched head
// (~1.36, kneel+crouch) but leave a standing head/shoulders out, 0.95
// barriers only eat leg/pelvis samples. The rendered box IS the tested AABB.

type Obstacle = { id: string; x: number; z: number; w: number; d: number; h: number; tier: 'wall' | 'crate' | 'barrier' };

const OBSTACLES: Obstacle[] = [
  { id: 'wall-a', x: -6.5, z: -1.5, w: 8, d: 0.6, h: 2.7, tier: 'wall' },
  { id: 'wall-b', x: 6, z: -7.5, w: 0.6, d: 7, h: 2.7, tier: 'wall' },
  { id: 'wall-c', x: 11.5, z: -4.4, w: 5.4, d: 0.6, h: 2.7, tier: 'wall' },
  { id: 'crate-a', x: -2, z: 3.5, w: 1.7, d: 1.7, h: 1.7, tier: 'crate' },
  { id: 'crate-b', x: 7.5, z: 2.5, w: 1.7, d: 1.7, h: 1.7, tier: 'crate' },
  { id: 'crate-c', x: -10.5, z: 8.5, w: 1.7, d: 1.7, h: 1.7, tier: 'crate' },
  { id: 'crate-d', x: 2.5, z: -4.5, w: 1.7, d: 1.7, h: 1.7, tier: 'crate' },
  { id: 'bar-a', x: -3.5, z: 10.5, w: 5, d: 0.5, h: 0.95, tier: 'barrier' },
  { id: 'bar-b', x: 10.5, z: 9, w: 0.5, d: 5, h: 0.95, tier: 'barrier' },
  { id: 'bar-c', x: -12.5, z: -8.5, w: 0.5, d: 6, h: 0.95, tier: 'barrier' },
];

const TIER_COLOR: Record<Obstacle['tier'], string> = { wall: '#3b4a63', crate: '#7a5a36', barrier: '#4a5560' };

// Ray vs one obstacle AABB (slab test). Returns the entry t along `dir` within
// (0, maxT), or null. Origins inside a box count as blocked at t≈0 — if your
// eye is in the crate, you can't see out of it.
function rayObstacle(origin: V3, dir: V3, ob: Obstacle, maxT: number): number | null {
  let tmin = 0;
  let tmax = maxT;
  const lo = [ob.x - ob.w / 2, 0, ob.z - ob.d / 2];
  const hi = [ob.x + ob.w / 2, ob.h, ob.z + ob.d / 2];
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < lo[axis] || o > hi[axis]) return null;
      continue;
    }
    let t1 = (lo[axis] - o) / d;
    let t2 = (hi[axis] - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin < maxT ? Math.max(tmin, 0) : null;
}

// Nearest cover hit along a ray, or Infinity. The geometric path runs this
// BEFORE the hitbox test: cover closer than the body means the crate took the
// bullet.
function nearestCoverT(origin: V3, dir: V3, maxT: number): number {
  let best = Infinity;
  for (const ob of OBSTACLES) {
    const t = rayObstacle(origin, dir, ob, maxT);
    if (t !== null && t < best) best = t;
  }
  return best;
}

// Eye → point segment: t of the first cover hit (for drawing the cut ray), or
// null when the sample is visible.
function segmentCoverT(a: V3, b: V3): number | null {
  const d = sub(b, a);
  const dist = len3(d);
  if (dist < 1e-4) return null;
  const t = nearestCoverT(a, norm3(d), dist - 0.02);
  return Number.isFinite(t) ? t : null;
}

// ── per-bone hitbox raycast — the geometric path's damage surface ────────────
// BodyHitbox is an ORIENTED box (host rotation order Ry·Rx·Rz, same frame the
// boxes render in). The ray transforms into each box's local frame and slab-
// tests against ±size/2; the nearest pierced box wins and its bone maps to an
// hmsc damage zone.

function rotY(v: V3, deg: number): V3 {
  const c = Math.cos(deg * RAD); const s = Math.sin(deg * RAD);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
function rotX(v: V3, deg: number): V3 {
  const c = Math.cos(deg * RAD); const s = Math.sin(deg * RAD);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}
function rotZ(v: V3, deg: number): V3 {
  const c = Math.cos(deg * RAD); const s = Math.sin(deg * RAD);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}
// inverse of world = Ry(Rx(Rz(local))): peel yaw, then pitch, then roll
function invRotate(v: V3, r: V3): V3 {
  return rotZ(rotX(rotY(v, -r[1]), -r[0]), -r[2]);
}

// Which hmsc damage zone a bone belongs to (ragdoll_lab's region map, renamed
// to hmsc's zone vocabulary so ZONE_DAMAGE/rollZone speak one language).
const ARM_MARKS = ['Shoulder', 'UpperArm', 'Elbow', 'Forearm', 'Wrist', 'Hand'];
function boneZone(b: BoneId): DamageZone {
  if (b === 'head') return 'head';
  if (b === 'torso' || b === 'pelvis' || b === 'lHip' || b === 'rHip') return 'torso';
  const side = b.startsWith('l') ? 'L' : 'R';
  return ARM_MARKS.some((m) => b.includes(m)) ? (`arm${side}` as DamageZone) : (`leg${side}` as DamageZone);
}

type FigureHit = { bone: BoneId; zone: DamageZone; t: number; point: V3 };

function rayHitboxT(origin: V3, dir: V3, hb: BodyHitbox, maxT: number): number | null {
  const o = invRotate(sub(origin, hb.position as V3), hb.rotation as V3);
  const d = invRotate(dir, hb.rotation as V3);
  let tmin = 0.02;
  let tmax = maxT;
  for (let axis = 0; axis < 3; axis++) {
    const half = hb.size[axis] / 2;
    if (Math.abs(d[axis]) < 1e-9) {
      if (o[axis] < -half || o[axis] > half) return null;
      continue;
    }
    let t1 = (-half - o[axis]) / d[axis];
    let t2 = (half - o[axis]) / d[axis];
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin < maxT ? tmin : null;
}

function raycastFigure(hitboxes: BodyHitbox[], origin: V3, dir: V3, maxT: number): FigureHit | null {
  let best: FigureHit | null = null;
  for (const hb of hitboxes) {
    const t = rayHitboxT(origin, dir, hb, maxT);
    if (t === null) continue;
    if (best === null || t < best.t) {
      best = {
        bone: hb.id,
        zone: boneZone(hb.id),
        t,
        point: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t],
      };
    }
  }
  return best;
}

// One ray, many bodies: the front-most pierced bone across all of them takes
// the shot — a bot can absorb a bullet meant for the one behind it.
function raycastFigures(list: Array<{ id: string; hitboxes: BodyHitbox[] }>, origin: V3, dir: V3, maxT: number): { id: string; hit: FigureHit } | null {
  let winner: { id: string; hit: FigureHit } | null = null;
  for (const entry of list) {
    const hit = raycastFigure(entry.hitboxes, origin, dir, maxT);
    if (hit === null) continue;
    if (winner === null || hit.t < winner.hit.t) winner = { id: entry.id, hit };
  }
  return winner;
}

// ── coverFraction — the producer chance.ts is missing ───────────────────────
// Sample points spread over the target's OWN bones: head (double-weighted —
// it's the part that peeks over cover), shoulders, torso, pelvis, thighs, a
// shin. Blocked/total is the coverFraction chance.ts wants. Riding the bones
// (not fixed heights) is the whole trick — a crouched skeleton's samples come
// down with it.

type CoverSample = { p: V3; clear: boolean; blockedT: number | null };

const SAMPLE_BONES: Array<{ bone: BoneId; lift: number }> = [
  { bone: 'head', lift: 0.12 },
  { bone: 'head', lift: 0 },
  { bone: 'lShoulder', lift: 0 },
  { bone: 'rShoulder', lift: 0 },
  { bone: 'torso', lift: 0 },
  { bone: 'pelvis', lift: 0 },
  { bone: 'lThigh', lift: 0 },
  { bone: 'rThigh', lift: 0 },
  { bone: 'lShin', lift: 0 },
];

function bonesSamplePoints(bones: Record<BoneId, SkeletonBone>): V3[] {
  return SAMPLE_BONES.map(({ bone, lift }) => {
    const p = bones[bone].position;
    return [p[0], p[1] + lift, p[2]] as V3;
  });
}

function coverFractionOf(eye: V3, targetBones: Record<BoneId, SkeletonBone>): { fraction: number; samples: CoverSample[] } {
  const samples: CoverSample[] = bonesSamplePoints(targetBones).map((p) => {
    const blockedT = segmentCoverT(eye, p);
    return { p, clear: blockedT === null, blockedT };
  });
  const blocked = samples.filter((s) => !s.clear).length;
  return { fraction: samples.length === 0 ? 0 : blocked / samples.length, samples };
}

const eyeOf = (bones: Record<BoneId, SkeletonBone>): V3 => {
  const h = bones.head.position;
  return [h[0], h[1] + 0.06, h[2]];
};

// ── ragdoll death — head_lab's verlet skeleton owns a killed body ───────────
// The live pose seeds the particles, the killing shot kicks the struck bone's
// joints along the bullet line, and the body crumples where it stood. Same
// BONE_JOINTS map ragdoll_lab uses.

const BONE_JOINTS: Record<BoneId, JointId[]> = {
  torso: ['chest'], head: ['head'], pelvis: ['pelvis'],
  lHip: ['lHip'], rHip: ['rHip'],
  lShoulder: ['lShoulder'], rShoulder: ['rShoulder'],
  lUpperArm: ['lShoulder', 'lElbow'], rUpperArm: ['rShoulder', 'rElbow'],
  lElbow: ['lElbow'], rElbow: ['rElbow'],
  lForearm: ['lElbow', 'lHand'], rForearm: ['rElbow', 'rHand'],
  lWrist: ['lHand'], rWrist: ['rHand'],
  lHand: ['lHand'], rHand: ['rHand'],
  lThigh: ['lHip', 'lKnee'], rThigh: ['rHip', 'rKnee'],
  lKnee: ['lKnee'], rKnee: ['rKnee'],
  lShin: ['lKnee', 'lFoot'], rShin: ['rKnee', 'rFoot'],
  lFoot: ['lFoot'], rFoot: ['rFoot'],
};

function ragdollFromShot(bones: Record<BoneId, SkeletonBone>, struckBone: BoneId | null, dir: V3, damage: number): Ragdoll {
  const r = createRagdoll(bones);
  const power = 2.2 + damage * 0.09;
  if (struckBone) {
    for (const j of BONE_JOINTS[struckBone]) {
      ragdollImpulse(r, j, [dir[0] * power, 1.1 + power * 0.12, dir[2] * power]);
    }
  }
  // a general shove so the body crumples along the bullet line, not in place
  ragdollImpulse(r, 'chest', [dir[0] * power * 0.45, 0.5, dir[2] * power * 0.45]);
  ragdollImpulse(r, 'pelvis', [dir[0] * power * 0.3, 0.2, dir[2] * power * 0.3]);
  return r;
}

const SETTLE_MOTION = 0.0025;
const SETTLE_TICKS = 55;

// ── hmsc's over-the-shoulder camera (GameWorld3D math, verbatim) ─────────────

function shoulderCamera(px: number, pz: number, yawDegrees: number, pitchRadians: number, aiming: boolean) {
  const yawRadians = yawDegrees * RAD;
  const right: V3 = [-Math.cos(yawRadians), 0, Math.sin(yawRadians)];
  const shift = aiming ? HMSC_GAMEPLAY_CAMERA.aimShoulderShiftMeters : 0;
  const position: V3 = [
    px - Math.sin(yawRadians) * HMSC_GAMEPLAY_CAMERA.distanceMeters + right[0] * shift,
    HMSC_GAMEPLAY_CAMERA.heightMeters,
    pz - Math.cos(yawRadians) * HMSC_GAMEPLAY_CAMERA.distanceMeters + right[2] * shift,
  ];
  const target: V3 = [
    px + right[0] * shift * HMSC_GAMEPLAY_CAMERA.aimTargetShiftRatio,
    HMSC_GAMEPLAY_CAMERA.targetHeightMeters - pitchRadians * HMSC_GAMEPLAY_CAMERA.pitchTargetMetersPerRadian,
    pz + right[2] * shift * HMSC_GAMEPLAY_CAMERA.aimTargetShiftRatio,
  ];
  const fov = aiming ? HMSC_GAMEPLAY_CAMERA.aimFovDegrees : HMSC_GAMEPLAY_CAMERA.fovDegrees;
  return { position, target, fov };
}

// NOTE: AimLabScene's aimForward(yaw,pitch) formula is deliberately NOT used
// here. The crosshair sits at the render camera's screen center, and that
// camera's view axis (target − position) includes the pitch-driven target
// drop plus the 35% shoulder-target shift — aimForward diverges from it by
// meters at combat range, which made every shot whiff. The fire ray is the
// camera axis itself (see playerFire).

// host mouse bindings (same readers as HmscGameplayRig)
function readHostNumber(name: string, fallback = 0): number {
  const host: any = globalThis;
  const fn = host[name];
  if (typeof fn !== 'function') return fallback;
  const value = Number(fn());
  return Number.isFinite(value) ? value : fallback;
}
function readHostMouseDelta(): { dx: number; dy: number } {
  const host: any = globalThis;
  const fn = host.__mouse_delta;
  if (typeof fn !== 'function') return { dx: 0, dy: 0 };
  const value = fn();
  const dx = Number(value?.dx ?? 0);
  const dy = Number(value?.dy ?? 0);
  return { dx: Number.isFinite(dx) ? dx : 0, dy: Number.isFinite(dy) ? dy : 0 };
}
function setHostMouseCapture(enabled: boolean): void {
  const host: any = globalThis;
  if (typeof host.__mouse_capture === 'function') host.__mouse_capture(enabled ? 1 : 0);
}

// hmsc's aim crosshair, verbatim from HmscGameplayRig.
function AimCrosshair(props: { aiming: boolean }) {
  if (!props.aiming) return null;
  const size = 42;
  const line = 12;
  const color = '#f8fafc';
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
      <Box style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Box style={{ position: 'absolute', left: 0, top: size / 2 - 1, width: line, height: 2, backgroundColor: '#020617' }} />
        <Box style={{ position: 'absolute', right: 0, top: size / 2 - 1, width: line, height: 2, backgroundColor: '#020617' }} />
        <Box style={{ position: 'absolute', top: 0, left: size / 2 - 1, width: 2, height: line, backgroundColor: '#020617' }} />
        <Box style={{ position: 'absolute', bottom: 0, left: size / 2 - 1, width: 2, height: line, backgroundColor: '#020617' }} />
        <Box style={{ position: 'absolute', left: 1, top: size / 2 - 1, width: line - 2, height: 2, backgroundColor: color }} />
        <Box style={{ position: 'absolute', right: 1, top: size / 2 - 1, width: line - 2, height: 2, backgroundColor: color }} />
        <Box style={{ position: 'absolute', top: 1, left: size / 2 - 1, width: 2, height: line - 2, backgroundColor: color }} />
        <Box style={{ position: 'absolute', bottom: 1, left: size / 2 - 1, width: 2, height: line - 2, backgroundColor: color }} />
        <Box style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: color, backgroundColor: '#020617' }} />
      </Box>
    </Box>
  );
}

// ── sim state ────────────────────────────────────────────────────────────────

// Hitman-style awareness ladder. `calm` patrols; a stimulus (sight in the FoV
// cone, a heard noise) fills `suspicion`; thresholds climb spooked → alert →
// the kind's terminal state: fighters go `hostile`, the unarmed go `panic`
// and run to `notify` an officer (awareness escalates UPWARD by kind); a
// paramedic with no live threat goes to `tend` downed bodies.
type BotState = 'calm' | 'spooked' | 'alert' | 'hostile' | 'panic' | 'notify' | 'tend' | 'down';

type Bot = {
  id: string;
  kind: NpcKind;
  pos: V3;
  heading: number;
  hp: number;
  mode: BotState;
  patrol: V3[];
  wpIndex: number;
  // awareness
  suspicion: number; // 0..1
  stimulus: V3 | null; // where to look / investigate (a sound, a glimpse, a report)
  lastKnown: V3 | null; // last CONFIRMED player position (vision or a notify) — never live-tracked
  stateUntil: number; // dwell timer (spooked pause, alert look-around, panic cooldown)
  seeing: boolean; // player currently in cone + range + exposed (drives the V rays)
  fireCooldown: number;
  gait: number;
  moving: boolean;
  running: boolean;
  tending: boolean; // kneeling at a body right now (pose)
  ragdoll: Ragdoll | null;
  settleTicks: number;
  settled: boolean;
  lastHitAt: number;
  lastHitBone: BoneId | null;
  // HUD readouts, refreshed every tick
  exposure: number; // how much of the PLAYER this bot can see (0 when out of cone)
  chance: number; // chance.ts ground truth for its next shot
  exposedToPlayer: number; // how much of THIS BOT the player's eye can see
  rangeMeters: number;
};

type Tracer = { id: number; a: V3; b: V3; color: string; bornAt: number };
type Spark = { id: number; p: V3; color: string; bornAt: number };
type NoiseEvent = { id: number; p: V3; radiusMeters: number; salience: number; kind: 'step' | 'shot'; bornAt: number; processed: boolean };

type Sim = {
  t: number;
  // tick heartbeat — the debug strip renders it, so a dead loop is visible as
  // a frozen number instead of a silent mystery
  frame: number;
  player: {
    pos: V3; heading: number; hp: number;
    crouch01: number; crouched: boolean;
    gait: number; moving: boolean; running: boolean;
    stepClock: number; // accumulates while moving; each rollover emits a footstep noise
    fireCooldown: number; weapon: WeaponId;
    lastFireAt: number; lastHurtAt: number;
    ragdoll: Ragdoll | null; settleTicks: number; settled: boolean;
  };
  camYaw: number; // smoothed camera yaw/pitch — the hmsc rig's state
  camPitch: number;
  aiming: boolean;
  // The ONE resolved camera per tick — render, fire, and crosshair targeting
  // all read this. The fire ray is its exact screen-center axis (position →
  // target), so what sits under the crosshair is what gets hit. Deriving the
  // bullet from aimForward(yaw,pitch) instead was the original sin: that ray
  // diverges from the crosshair line by meters at combat range.
  cam: { position: V3; target: V3; fov: number };
  bots: Bot[];
  tracers: Tracer[];
  sparks: Spark[];
  noises: NoiseEvent[]; // transient stimulus events — heard the tick after birth, drawn ~0.6s
  log: string[];
  lastGunfireAt: number;
  targetId: string; // who the crosshair is on
  fxId: number;
};

function makeBot(id: string, patrol: V3[]): Bot {
  const def = defOf(id);
  return {
    id,
    kind: def.kind as NpcKind,
    pos: [...patrol[0]] as V3,
    heading: 0,
    hp: npcKindDefinition(def.kind as NpcKind).maxHealth,
    mode: 'calm',
    patrol, wpIndex: 0,
    suspicion: 0, stimulus: null, lastKnown: null, stateUntil: 0, seeing: false,
    fireCooldown: 1 + Math.random(),
    gait: Math.random(),
    moving: false, running: false, tending: false,
    ragdoll: null, settleTicks: 0, settled: false,
    lastHitAt: -9, lastHitBone: null,
    exposure: 0, chance: 0, exposedToPlayer: 0, rangeMeters: 0,
  };
}

function makeSim(): Sim {
  return {
    t: 0,
    frame: 0,
    player: {
      pos: [0, 0, 13], heading: 180, hp: PLAYER_MAX_HP,
      crouch01: 0, crouched: false,
      gait: 0, moving: false, running: false,
      stepClock: 0,
      fireCooldown: 0, weapon: 'pistol',
      lastFireAt: -9, lastHurtAt: -9,
      ragdoll: null, settleTicks: 0, settled: false,
    },
    camYaw: 180,
    camPitch: HMSC_GAMEPLAY_CAMERA.defaultPitchRadians,
    aiming: false,
    cam: shoulderCamera(0, 13, 180, HMSC_GAMEPLAY_CAMERA.defaultPitchRadians, false),
    bots: [
      makeBot('thug-1', [[-13, 0, -13], [-3, 0, -13], [-3, 0, -5], [-13, 0, -5]]),
      makeBot('thug-2', [[13, 0, -13], [13, 0, -1], [8.6, 0, -1], [8.6, 0, -12]]),
      makeBot('police-1', [[0, 0, -15], [-9, 0, -10], [0, 0, -7], [9, 0, -11]]),
      makeBot('civ-1', [[13, 0, 13], [13, 0, 5], [4, 0, 8], [4, 0, 14]]),
      makeBot('medic-1', [[15, 0, 5], [15, 0, -4], [11, 0, -4], [11, 0, 5]]),
    ],
    tracers: [], sparks: [], noises: [],
    log: [],
    lastGunfireAt: -9,
    targetId: '',
    fxId: 1,
  };
}

// 2D circle vs the obstacle footprints — body movement collision. ALL tiers
// block walking (you vault nothing); only sight cares about height.
function bodyCollides(x: number, z: number, radius: number): boolean {
  if (Math.abs(x) > ARENA_HALF || Math.abs(z) > ARENA_HALF) return true;
  for (const ob of OBSTACLES) {
    const cx = clamp(x, ob.x - ob.w / 2, ob.x + ob.w / 2);
    const cz = clamp(z, ob.z - ob.d / 2, ob.z + ob.d / 2);
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

// Step with axis-separated slide: blocked diagonals still let the open axis
// through, so bodies skim along walls instead of sticking to them.
function slideMove(pos: V3, vx: number, vz: number, dt: number, radius: number): void {
  const nx = pos[0] + vx * dt;
  if (!bodyCollides(nx, pos[2], radius)) pos[0] = nx;
  const nz = pos[2] + vz * dt;
  if (!bodyCollides(pos[0], nz, radius)) pos[2] = nz;
}

// ── small 3D scene helpers ───────────────────────────────────────────────────

// HARD RULE for anything sized per-frame: UNIT geometry params + a `scale`
// transform. The geometry intern cache (runtime/geometries/intern.ts) keeps
// every unique (id, params) FOREVER, JS-side and host-side — a continuous
// float in `params` (a tracer's length, a health bar's width) mints a fresh
// vertex buffer every frame and OOMs the heap in minutes. Module-const params
// = one intern entry, ever; the per-instance size rides the transform.
const UNIT_CYL = { radius: 1, height: 1, segments: 6 };
const UNIT_BOX = { width: 1, height: 1, depth: 1 };
const UNIT_SPHERE = { radius: 1, segments: 8, rings: 6 };
const UNIT_TORUS = { radius: 1, tube: 0.014, segments: 28, sides: 5 };

// A→B as a thin Y-axis cylinder (swing-around-X then yaw — the host frame).
function SegmentMesh(props: { a: V3; b: V3; radius: number; material: any }) {
  const [ax, ay, az] = props.a;
  const [bx, by, bz] = props.b;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-4) return null;
  const swing = Math.acos(clamp(-dy / length, -1, 1)) * DEG;
  const yaw = Math.atan2(-dx, -dz) * DEG;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Cylinder}
      params={UNIT_CYL}
      material={props.material}
      position={[(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]}
      rotation={[swing, yaw, 0]}
      scale={[props.radius, length, props.radius]}
    />
  );
}

// Health bar floating over a bot, yawed to face the camera.
function HealthBar(props: { x: number; y: number; z: number; frac: number; camPos: V3; hidden?: boolean; color?: string }) {
  const faceYaw = Math.atan2(props.camPos[0] - props.x, props.camPos[2] - props.z) * DEG;
  const w = 0.7;
  const fw = Math.max(0.02, w * props.frac);
  // left-anchor the fill: shift its center left by the missing half in the
  // bar's local X, rotated into world.
  const offset = -(w - fw) / 2;
  const c = Math.cos(faceYaw * RAD);
  const s = Math.sin(faceYaw * RAD);
  // `hidden` fades instead of unmounting — callers keep a fixed child shape
  return (
    <>
      <Scene3D.Mesh geometry={Geometry.Box} params={UNIT_BOX} material={{ color: '#0c1220', opacity: props.hidden ? 0 : 0.85 }} position={[props.x, props.y, props.z]} rotation={[0, faceYaw, 0]} scale={[w + 0.06, 0.1, 0.03]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={UNIT_BOX} material={{ color: props.color ?? hpColor(props.frac * 100), opacity: props.hidden ? 0 : 1 }} position={[props.x + offset * c + 0.02 * s, props.y, props.z - offset * s + 0.02 * c]} rotation={[0, faceYaw, 0]} scale={[fw, 0.07, 0.03]} />
    </>
  );
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => {
    const va = (pa >> sh) & 0xff;
    const vb = (pb >> sh) & 0xff;
    return Math.round(va + (vb - va) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
function hpColor(hp: number): string {
  const t = clamp(hp / 100, 0, 1);
  return t > 0.5 ? mixHex(WARN, GOOD, (t - 0.5) * 2) : mixHex(BAD, WARN, t * 2);
}

// ── HUD widgets ──────────────────────────────────────────────────────────────

function Chip(props: { label: string; active?: boolean; color?: string; onPress: () => void }) {
  const tint = props.color ?? '#35d0ff';
  return (
    <Pressable
      onPress={props.onPress}
      style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: props.active ? tint : '#22324a', backgroundColor: '#101a2a' }}
    >
      <Text fontSize={11} color={props.active ? tint : INK}>{props.label}</Text>
    </Pressable>
  );
}

function MeterRow(props: { label: string; frac: number; color: string; right?: string }) {
  return (
    <Col style={{ gap: 2 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text fontSize={10} color={DIM}>{props.label || ' '}</Text>
        {props.right ? <Text fontSize={10} color={props.color}>{props.right}</Text> : null}
      </Row>
      <Box style={{ width: '100%', height: 7, borderRadius: 3, backgroundColor: '#0c1220' }}>
        <Box style={{ width: `${Math.round(clamp(props.frac, 0, 1) * 100)}%`, height: '100%', borderRadius: 3, backgroundColor: props.color }} />
      </Box>
    </Col>
  );
}

// ── the lab ──────────────────────────────────────────────────────────────────

export default function CombatLab() {
  const simRef = useRef<Sim>(makeSim());
  const keysRef = useRef<Record<string, boolean>>({});
  const orbitlessPointerRef = useRef<{ x: number; y: number; ready: boolean }>({ x: 0, y: 0, ready: false });
  const cameraAimRef = useRef({ yawDegrees: 180, pitchRadians: HMSC_GAMEPLAY_CAMERA.defaultPitchRadians });

  // bones + rigs solved once per tick, shared by AI, raycasts, and render
  const bonesRef = useRef<Record<string, Record<BoneId, SkeletonBone>>>({});
  const rigsRef = useRef<Record<string, BodyRigFrame>>({});

  const [, setTick] = useState(0);
  const [mouseFocused, setMouseFocused] = useState(false);
  const [showRays, setShowRays] = useState(true);
  const [showHitboxes, setShowHitboxes] = useState(false);
  const [paused, setPaused] = useState(false);

  const mouseFocusedRef = useRef(false);
  const uiRef = useRef({ showRays, showHitboxes, paused });
  uiRef.current = { showRays, showHitboxes, paused };

  // one face/outfit bake per actor (pathing_lab's character pattern)
  const characters = useMemo(() => {
    const out: Record<string, { doc: any; parts: Record<string, PartRender> }> = {};
    for (const def of ACTOR_DEFS) {
      const doc = generateFace(def.seed, { style: def.style });
      out[def.id] = { doc, parts: buildPartRender(doc, hedDepthGrid(doc), 'combatlab', def.seed) as any };
    }
    return out;
  }, []);

  useEffect(() => {
    mouseFocusedRef.current = mouseFocused;
    setHostMouseCapture(mouseFocused);
    if (!mouseFocused) orbitlessPointerRef.current.ready = false;
    return () => setHostMouseCapture(false);
  }, [mouseFocused]);

  // ── helpers on the sim ref ─────────────────────────────────────────────────

  const pushLog = (line: string) => {
    const s = simRef.current;
    s.log = [line, ...s.log].slice(0, 9);
  };
  const addTracer = (a: V3, b: V3, color: string) => {
    const s = simRef.current;
    s.tracers.push({ id: s.fxId++, a, b, color, bornAt: s.t });
  };
  const addSpark = (p: V3, color: string) => {
    const s = simRef.current;
    s.sparks.push({ id: s.fxId++, p, color, bornAt: s.t });
  };
  // Drop a stimulus into the world. Bots hear it on their next perception
  // step; the render draws it as an expanding ring so YOU can see how far
  // your noise carried.
  const addNoise = (p: V3, radiusMeters: number, salience: number, kind: 'step' | 'shot') => {
    const s = simRef.current;
    s.noises.push({ id: s.fxId++, p: [...p] as V3, radiusMeters, salience, kind, bornAt: s.t, processed: false });
  };

  // Solve an actor's bones for the CURRENT state. Pose path builds the local
  // skeleton (walk gait, kneel pose while tending a body, kneel+crouch blend
  // for the player) and places it at pos/heading; a ragdolled body's
  // particles ARE the bones, already in world.
  const solveBots = (bot: Bot): Record<BoneId, SkeletonBone> => {
    if (bot.ragdoll) return bonesFromRagdoll(bot.ragdoll);
    const def = defOf(bot.id);
    const pose = bot.tending ? 'kneel' : bot.moving ? 'walk' : 'stand';
    const local = buildSkeleton(def.shape, pose, bot.gait % 1);
    return placeBones(local, bot.heading + 180, bot.pos[0], bot.pos[2]);
  };

  const solvePlayerBones = (): Record<BoneId, SkeletonBone> => {
    const s = simRef.current;
    const p = s.player;
    if (p.ragdoll) return bonesFromRagdoll(p.ragdoll);
    const def = defOf('you');
    let local = buildSkeleton(def.shape, p.moving ? 'walk' : 'stand', p.gait % 1);
    if (p.crouch01 > 0) {
      const ducked = buildSkeleton(def.shape, 'kneel', 0, CROUCH_ACTION);
      local = blendBones(local, ducked, p.crouch01);
    }
    return placeBones(local, p.heading + 180, p.pos[0], p.pos[2]);
  };

  const rigFor = (id: string, bones: Record<BoneId, SkeletonBone>): BodyRigFrame => {
    const def = defOf(id);
    return buildRigFrameFromBones(bones, def.shape, def.top, def.clothSkin, def.acc, def.bottoms);
  };

  // ── the player's shot: the GEOMETRIC path, along the crosshair ─────────────
  // Fires the game's aim ray: origin at the shoulder camera, forward from
  // camera yaw+pitch (AimLabScene's exact formula). Cover between the muzzle
  // line and the body eats the shot; otherwise the front-most pierced BONE BOX
  // across all bots takes it, and its zone multiplier scales the weapon.

  const playerFire = () => {
    const s = simRef.current;
    const p = s.player;
    if (p.hp <= 0 || p.fireCooldown > 0) return;
    const weapon = WEAPONS[p.weapon];

    // The bullet flies down the render camera's screen-center axis — the line
    // the crosshair IS. Never re-derive this from yaw/pitch (aimForward): that
    // ray diverges from the crosshair by meters at combat range and every
    // shot whiffs.
    const origin: V3 = [...s.cam.position] as V3;
    const dir = norm3(sub(s.cam.target, origin));
    // the camera sits ~6m behind the player — extend the test ray so weapon
    // range still reads from the body, not the lens
    const maxT = weapon.rangeMeters + HMSC_GAMEPLAY_CAMERA.distanceMeters;

    p.heading = s.camYaw;
    p.lastFireAt = s.t;
    p.fireCooldown = weapon.cooldownSeconds;
    s.lastGunfireAt = s.t;
    // a gunshot is the loudest stimulus there is — everyone processes it on
    // their next perception step (tile noise doesn't quiet a muzzle blast)
    addNoise(p.pos, GUNSHOT_NOISE.radiusMeters, GUNSHOT_NOISE.salience, 'shot');

    const targets = s.bots.filter((b) => b.mode !== 'down').map((b) => ({ id: b.id, hitboxes: rigsRef.current[b.id]?.hitboxes ?? [] }));
    const coverT = nearestCoverT(origin, dir, maxT);
    const pick = raycastFigures(targets, origin, dir, maxT);

    const playerBones = bonesRef.current.you;
    const muzzle: V3 = playerBones ? [...playerBones.rHand.position] as V3 : [p.pos[0], 1.3, p.pos[2]];

    if (pick && pick.hit.t < coverT) {
      const bot = s.bots.find((b) => b.id === pick.id)!;
      const mult = ZONE_DAMAGE[pick.hit.zone];
      const damage = Math.round(weapon.damage * mult);
      bot.hp = Math.max(0, bot.hp - damage);
      bot.lastHitAt = s.t;
      bot.lastHitBone = pick.hit.bone;
      // getting shot is total awareness: the victim KNOWS where it came from
      bot.lastKnown = [...p.pos] as V3;
      bot.stimulus = [...p.pos] as V3;
      bot.suspicion = 1;
      addTracer(muzzle, pick.hit.point, weapon.tracer);
      addSpark(pick.hit.point, '#ff6b6b');
      const died = bot.hp <= 0;
      if (died) {
        bot.mode = 'down';
        bot.ragdoll = ragdollFromShot(bonesRef.current[bot.id] ?? solveBots(bot), pick.hit.bone, dir, damage);
        bot.settled = false;
        bot.settleTicks = 0;
      } else {
        bot.mode = npcKindDefinition(bot.kind).canFight ? 'hostile' : 'panic';
      }
      pushLog(`YOU → ${bot.id} · ${pick.hit.bone} (${pick.hit.zone.toUpperCase()} ×${mult}) · −${damage}${died ? ' · DOWN' : ''}`);
    } else if (coverT <= maxT) {
      const impact: V3 = [origin[0] + dir[0] * coverT, origin[1] + dir[1] * coverT, origin[2] + dir[2] * coverT];
      addTracer(muzzle, impact, weapon.tracer);
      addSpark(impact, '#cbd5e1');
      pushLog(`YOU → cover · blocked`);
    } else {
      // clean miss — still observable: tracer into the distance + a log line
      const end: V3 = [origin[0] + dir[0] * maxT, origin[1] + dir[1] * maxT, origin[2] + dir[2] * maxT];
      addTracer(muzzle, end, weapon.tracer);
      pushLog(`YOU → miss`);
    }
  };

  // ── a bot's shot: the PROBABILISTIC path ───────────────────────────────────
  // No ray at the player's body, ever. coverFractionOf supplies the missing
  // input; chance.ts owns the odds; rollZone picks where a landed shot struck;
  // zoneDamage scales the kind's weaponDamage. The tracer is THEATER drawn
  // after the dice — geometry never decides this hit.

  const ZONE_IMPACT_BONE: Record<DamageZone, BoneId> = {
    head: 'head', torso: 'torso', armL: 'lForearm', armR: 'rForearm', legL: 'lShin', legR: 'rShin',
  };

  const botFire = (bot: Bot, coverFraction: number, range: number) => {
    const s = simRef.current;
    const p = s.player;
    const def = npcKindDefinition(bot.kind);
    const chance = hitChance({
      rangeMeters: range,
      coverFraction,
      targetCrouched: p.crouched,
      shooterSkill: SHOOTER_SKILL[bot.kind],
    });
    const landed = rollHit(chance);
    const pct = Math.round(chance * 100);
    const botBones = bonesRef.current[bot.id];
    const muzzle: V3 = botBones ? [...botBones.rHand.position] as V3 : [bot.pos[0], 1.3, bot.pos[2]];
    s.lastGunfireAt = s.t;
    // return fire is a stimulus too — civilians panic off a cop's shots
    addNoise(bot.pos, GUNSHOT_NOISE.radiusMeters, GUNSHOT_NOISE.salience, 'shot');

    if (landed) {
      const zone = rollZone();
      const damage = Math.round(zoneDamage(def.weaponDamage, zone));
      p.hp = Math.max(0, p.hp - damage);
      p.lastHurtAt = s.t;
      const playerBones = bonesRef.current.you;
      const impactBone = ZONE_IMPACT_BONE[zone];
      const impact: V3 = playerBones ? [...playerBones[impactBone].position] as V3 : [p.pos[0], 1.2, p.pos[2]];
      addTracer(muzzle, impact, '#ff8c66');
      addSpark(impact, BAD);
      if (p.hp <= 0 && !p.ragdoll) {
        const dir = norm3([p.pos[0] - bot.pos[0], 0, p.pos[2] - bot.pos[2]]);
        p.ragdoll = ragdollFromShot(playerBones ?? solvePlayerBones(), impactBone, dir, damage);
        p.settled = false;
        p.settleTicks = 0;
      }
      pushLog(`${bot.id} → YOU · ${pct}% · HIT ${zone} −${damage}${p.hp <= 0 ? ' · WASTED' : ''}`);
    } else {
      // a miss whizzes past: offset perpendicular to the firing line
      const dir = norm3([p.pos[0] - muzzle[0], 0, p.pos[2] - muzzle[2]]);
      const side = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.9);
      const past: V3 = [
        p.pos[0] - dir[2] * side + dir[0] * 4,
        0.4 + Math.random() * 1.6,
        p.pos[2] + dir[0] * side + dir[2] * 4,
      ];
      addTracer(muzzle, past, '#94a3b8');
      pushLog(`${bot.id} → YOU · ${pct}% · miss`);
    }
  };

  const heal = () => {
    const s = simRef.current;
    s.player.hp = PLAYER_MAX_HP;
    s.player.ragdoll = null;
    s.player.settled = false;
    pushLog('healed — 100 hp');
  };
  const resetAll = () => {
    simRef.current = makeSim();
    cameraAimRef.current = { yawDegrees: 180, pitchRadians: HMSC_GAMEPLAY_CAMERA.defaultPitchRadians };
    bonesRef.current = {};
    rigsRef.current = {};
  };

  // ── input ──────────────────────────────────────────────────────────────────

  // shift arrives as a raw SDL keycode, not 'shift' — track it by code and by
  // the modifier flag every other key event carries.
  const SHIFT_KEYS = ['sdl:1073742049', 'sdl:1073742053']; // LSHIFT, RSHIFT

  useEffect(() => {
    const offDown = busOn('__keydown', (event: any) => {
      const key = String(event?.key ?? '').toLowerCase();
      keysRef.current[key] = true;
      if (SHIFT_KEYS.includes(key)) keysRef.current.shift = true;
      else keysRef.current.shift = !!event?.shiftKey;
      const s = simRef.current;
      if (key === 'escape') setMouseFocused(false);
      else if (key === 'c') s.player.crouched = !s.player.crouched;
      else if (key === 'h') heal();
      else if (key === 'r') resetAll();
      else if (key === 'v') setShowRays((v) => !v);
      else if (key === 'b') setShowHitboxes((v) => !v);
      else if (key === 'p') setPaused((v) => !v);
      else if (key === '1' || key === '2' || key === '3') s.player.weapon = WEAPON_IDS[Number(key) - 1];
    });
    const offUp = busOn('__keyup', (event: any) => {
      const key = String(event?.key ?? '').toLowerCase();
      keysRef.current[key] = false;
      if (SHIFT_KEYS.includes(key)) keysRef.current.shift = false;
    });
    return () => { offDown(); offUp(); };
  }, []);

  // ── the loop ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const host: any = globalThis;
    const schedule = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : (fn: any) => setTimeout(fn, 16);
    const cancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : clearTimeout;
    let handle: any = 0;
    let lastNow = host.performance?.now?.() ?? Date.now();

    const step = () => {
      const now = host.performance?.now?.() ?? Date.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      const s = simRef.current;
      const ui = uiRef.current;
      const p = s.player;
      s.frame += 1;

      // ── hmsc mouse-look camera, even while paused (you can still look) ────
      // Relative deltas while the host has the mouse; unlike the game we do
      // NOT track the unfocused absolute pointer — the lab has HUD panels to
      // mouse over, and the game has no side panels to protect.
      s.aiming = readHostNumber('getMouseRightDown', 0) > 0 && mouseFocusedRef.current;
      if (mouseFocusedRef.current) {
        const { dx, dy } = readHostMouseDelta();
        if (Math.abs(dx) < HMSC_GAMEPLAY_CAMERA.maxMouseDeltaPixels && Math.abs(dy) < HMSC_GAMEPLAY_CAMERA.maxMouseDeltaPixels) {
          cameraAimRef.current.yawDegrees -= dx * HMSC_GAMEPLAY_CAMERA.yawRadiansPerPixel * DEG;
          cameraAimRef.current.pitchRadians = clampCameraValue(
            cameraAimRef.current.pitchRadians + dy * HMSC_GAMEPLAY_CAMERA.pitchRadiansPerPixel,
            HMSC_GAMEPLAY_CAMERA.minPitchRadians,
            HMSC_GAMEPLAY_CAMERA.maxPitchRadians,
          );
        }
      }
      const smoothing = 1 - Math.exp(-HMSC_GAMEPLAY_CAMERA.smoothingPerSecond * dt);
      s.camYaw += angleDeltaDegrees(s.camYaw, cameraAimRef.current.yawDegrees) * smoothing;
      s.camPitch += (cameraAimRef.current.pitchRadians - s.camPitch) * smoothing;

      // ── resolve THE camera — render, fire, and targeting all read s.cam ──
      // hmsc shoulder follow (the ragdoll's pelvis once dead), clamped forward
      // along its own axis when cover sits between the body and the lens.
      {
        const followPos: V3 = p.ragdoll ? (bonesRef.current.you?.pelvis.position ?? p.pos) : p.pos;
        const cam = shoulderCamera(followPos[0], followPos[2], s.camYaw, s.camPitch, s.aiming);
        const pivot: V3 = [followPos[0], HMSC_GAMEPLAY_CAMERA.targetHeightMeters, followPos[2]];
        const toCam = sub(cam.position, pivot);
        const segLen = len3(toCam);
        const tHit = nearestCoverT(pivot, norm3(toCam), segLen);
        if (Number.isFinite(tHit)) {
          const frac = Math.max(0.18, (tHit - 0.15) / segLen);
          cam.position = [pivot[0] + toCam[0] * frac, pivot[1] + toCam[1] * frac, pivot[2] + toCam[2] * frac];
        }
        s.cam = cam;
      }

      if (!ui.paused) {
        s.t += dt;

        // ── fire: LEFT mouse while aiming (hold = autofire, cooldown gates) ──
        const leftDown = readHostNumber('getMouseDown', 0) > 0;
        if (leftDown && s.aiming && p.hp > 0 && p.fireCooldown <= 0) playerFire();
        p.fireCooldown = Math.max(0, p.fireCooldown - dt);

        // ── player movement: camera-relative WASD (usePlayerDrive's basis) ──
        const yawR = s.camYaw * RAD;
        const fwd: V3 = [Math.sin(yawR), 0, Math.cos(yawR)];
        const right: V3 = [-Math.cos(yawR), 0, Math.sin(yawR)];
        const keys = keysRef.current;
        let ix = 0;
        let iz = 0;
        if (p.hp > 0) {
          if (keys.w) { ix += fwd[0]; iz += fwd[2]; }
          if (keys.s) { ix -= fwd[0]; iz -= fwd[2]; }
          if (keys.d) { ix += right[0]; iz += right[2]; }
          if (keys.a) { ix -= right[0]; iz -= right[2]; }
        }
        const moving = ix !== 0 || iz !== 0;
        p.running = moving && !!keys.shift && !p.crouched;
        p.moving = moving;
        if (moving) {
          const il = Math.hypot(ix, iz);
          const speed = p.crouched ? CROUCH_SPEED : p.running ? RUN_SPEED : WALK_SPEED;
          slideMove(p.pos, (ix / il) * speed, (iz / il) * speed, dt, 0.32);
          p.gait += dt * (p.running ? 2.4 : 1.5);
          // footsteps: cadence by movement mode, carry by the tile underfoot —
          // a sprint across the road is heard arena-wide, a crouch through the
          // mud barely past arm's reach
          const moveNoise = p.crouched ? MOVE_NOISE.crouch : p.running ? MOVE_NOISE.run : MOVE_NOISE.walk;
          p.stepClock += dt;
          if (p.stepClock >= moveNoise.stepSeconds) {
            p.stepClock = 0;
            addNoise(p.pos, moveNoise.radiusMeters * tileNoiseAt(p.pos[0], p.pos[2]), moveNoise.salience, 'step');
          }
        } else {
          p.stepClock = 0;
        }
        // aiming squares the body to the camera; otherwise face the move
        if (s.aiming || s.t - p.lastFireAt < 0.4) p.heading = s.camYaw;
        else if (moving) p.heading = headingOf(ix, iz);
        p.crouch01 = clamp(p.crouch01 + (p.crouched ? dt : -dt) / 0.18, 0, 1);

        // ── player bones/rig (or ragdoll once dead) ─────────────────────────
        if (p.ragdoll && !p.settled) {
          stepRagdoll(p.ragdoll, dt, ARENA_HALF);
          if (ragdollMaxMotion(p.ragdoll) < SETTLE_MOTION) {
            p.settleTicks += 1;
            if (p.settleTicks > SETTLE_TICKS) p.settled = true;
          } else {
            p.settleTicks = 0;
          }
        }
        if (!p.ragdoll || !p.settled) {
          bonesRef.current.you = solvePlayerBones();
          rigsRef.current.you = rigFor('you', bonesRef.current.you);
        }
        const playerBones = bonesRef.current.you;
        const playerEye = eyeOf(playerBones);
        const playerAlive = p.hp > 0;

        // ── bot AI: perceive → escalate → act ───────────────────────────────
        // Stimuli born before this tick are heard by every bot below, then
        // marked spent (mid-loop gunshots wait one frame so every bot hears
        // them exactly once).
        const freshNoises = s.noises.filter((noise) => !noise.processed);

        for (const bot of s.bots) {
          const def = npcKindDefinition(bot.kind);
          if (bot.mode === 'down') {
            bot.moving = false;
            if (bot.ragdoll && !bot.settled) {
              stepRagdoll(bot.ragdoll, dt, ARENA_HALF);
              if (ragdollMaxMotion(bot.ragdoll) < SETTLE_MOTION) {
                bot.settleTicks += 1;
                if (bot.settleTicks > SETTLE_TICKS) bot.settled = true;
              } else {
                bot.settleTicks = 0;
              }
              bonesRef.current[bot.id] = solveBots(bot);
              rigsRef.current[bot.id] = rigFor(bot.id, bonesRef.current[bot.id]);
            }
            continue;
          }

          const toPlayer = sub(p.pos, bot.pos);
          const range = Math.hypot(toPlayer[0], toPlayer[2]);
          bot.rangeMeters = range;
          const botBones = bonesRef.current[bot.id];
          const botEye: V3 = botBones ? eyeOf(botBones) : [bot.pos[0], 1.85, bot.pos[2]];
          bot.exposedToPlayer = botBones ? 1 - coverFractionOf(playerEye, botBones).fraction : 0;

          // ── PERCEIVE (kinds.ts perception profile) ──────────────────────
          const prof = def.perception;
          // vision: a forward FoV cone — no more eyes in the back of the head
          const facing: V3 = [Math.sin(bot.heading * RAD), 0, Math.cos(bot.heading * RAD)];
          const coneCos = Math.cos((prof.visionFovDegrees / 2) * RAD);
          const towardCos = range > 1e-4 ? (facing[0] * toPlayer[0] + facing[2] * toPlayer[2]) / range : 1;
          const inCone = playerAlive && range < prof.visionRangeMeters && towardCos >= coneCos;
          let cover: { fraction: number } | null = null;
          let exposure = 0;
          if (inCone) {
            cover = coverFractionOf(botEye, playerBones);
            exposure = 1 - cover.fraction;
          }
          bot.exposure = exposure;
          bot.seeing = inCone && exposure > 0.1;
          let stimulated = false;
          if (bot.seeing) {
            // suspicion fills faster the closer and more exposed you are;
            // reactionSeconds is the kind's point-blank fully-exposed baseline
            const proximity = 1.15 - 0.75 * (range / prof.visionRangeMeters);
            bot.suspicion = clamp(bot.suspicion + (exposure * proximity / prof.reactionSeconds) * dt, 0, 1);
            bot.stimulus = [...p.pos] as V3;
            stimulated = true;
            if (bot.suspicion >= 1) bot.lastKnown = [...p.pos] as V3;
          }
          // hearing: omnidirectional; how far a noise carries × this kind's acuity
          for (const noise of freshNoises) {
            const d = Math.hypot(noise.p[0] - bot.pos[0], noise.p[2] - bot.pos[2]);
            if (d > noise.radiusMeters * prof.hearingAcuity) continue;
            bot.stimulus = [...noise.p] as V3;
            stimulated = true;
            if (noise.kind === 'shot') {
              bot.suspicion = 1;
              if (def.canFight) {
                // fighters triangulate the shot and go straight to combat
                bot.lastKnown = [...noise.p] as V3;
                if (bot.mode !== 'hostile') pushLog(`${bot.id} heard gunfire — HOSTILE`);
                bot.mode = 'hostile';
              } else if (bot.mode !== 'panic' && bot.mode !== 'notify') {
                bot.mode = 'panic';
                bot.stateUntil = s.t + 8;
                pushLog(`${bot.id} heard gunfire — panics`);
              }
            } else {
              bot.suspicion = clamp(bot.suspicion + noise.salience, 0, 1);
            }
          }
          if (!stimulated) bot.suspicion = Math.max(0, bot.suspicion - dt * 0.12);

          bot.chance = bot.seeing && def.canFight && cover
            ? hitChance({ rangeMeters: range, coverFraction: cover.fraction, targetCrouched: p.crouched, shooterSkill: SHOOTER_SKILL[bot.kind] })
            : 0;

          // ── ESCALATE: thresholds climb the ladder, terminal state by kind ──
          if (bot.mode === 'calm' && bot.suspicion >= 0.33) {
            bot.mode = 'spooked';
            bot.stateUntil = s.t + 1.4;
            pushLog(`${bot.id} spooked`);
          }
          if (bot.mode === 'spooked') {
            if (bot.suspicion >= 0.66) {
              bot.mode = 'alert';
              bot.stateUntil = s.t + 2.5;
              pushLog(`${bot.id} alert — investigating`);
            } else if (s.t > bot.stateUntil && bot.suspicion < 0.3) {
              bot.mode = 'calm';
            }
          }
          if (bot.mode === 'alert') {
            if (bot.suspicion >= 1) {
              if (def.canFight) {
                bot.mode = 'hostile';
                bot.lastKnown = bot.lastKnown ?? (bot.stimulus ? [...bot.stimulus] as V3 : null);
                pushLog(`${bot.id} HOSTILE`);
                // gang shares: a thug going loud shouts to nearby gang members
                if (bot.kind === 'thug') {
                  for (const ally of s.bots) {
                    if (ally === bot || ally.kind !== 'thug' || ally.mode === 'down' || ally.mode === 'hostile') continue;
                    if (Math.hypot(ally.pos[0] - bot.pos[0], ally.pos[2] - bot.pos[2]) < 14) {
                      ally.suspicion = 1;
                      ally.mode = 'hostile';
                      ally.lastKnown = bot.lastKnown ? [...bot.lastKnown] as V3 : ally.lastKnown;
                      pushLog(`${bot.id} shouts — ${ally.id} HOSTILE`);
                    }
                  }
                }
              } else {
                bot.mode = 'panic';
                bot.stateUntil = s.t + 8;
                pushLog(`${bot.id} panics`);
              }
            } else if (bot.suspicion < 0.2 && s.t > bot.stateUntil) {
              bot.mode = 'calm';
            }
          }

          // ── ACT ──────────────────────────────────────────────────────────
          let vx = 0;
          let vz = 0;
          let speed = def.walkSpeedMetersPerSecond;
          bot.running = false;
          bot.tending = false;
          let faceMove = true; // heading follows velocity unless the state aims it

          if (bot.mode === 'spooked') {
            // freeze and face the stimulus — the Hitman "huh?"
            if (bot.stimulus) bot.heading = headingOf(bot.stimulus[0] - bot.pos[0], bot.stimulus[2] - bot.pos[2]);
            faceMove = false;
          } else if (bot.mode === 'alert') {
            // walk to the stimulus and look around
            const target = bot.stimulus ?? bot.patrol[bot.wpIndex];
            const d = sub(target, bot.pos);
            const dl = Math.hypot(d[0], d[2]);
            if (dl > 0.8) {
              vx = d[0] / dl; vz = d[2] / dl;
            } else {
              bot.stateUntil = Math.max(bot.stateUntil, s.t + 1.2); // dwell, scan
            }
          } else if (bot.mode === 'hostile') {
            if (bot.seeing) {
              bot.lastKnown = [...p.pos] as V3;
              bot.heading = headingOf(toPlayer[0], toPlayer[2]);
              faceMove = false;
              if (range > ENGAGE_ADVANCE_DIST) {
                const ahead = norm3([toPlayer[0], 0, toPlayer[2]]);
                vx = ahead[0]; vz = ahead[2];
                speed = def.runSpeedMetersPerSecond;
                bot.running = true;
              }
              bot.fireCooldown -= dt;
              if (bot.fireCooldown <= 0 && exposure >= EXPOSURE_TO_FIRE && cover) {
                botFire(bot, cover.fraction, range);
                bot.fireCooldown = FIRE_COOLDOWN[bot.kind] * (0.85 + Math.random() * 0.4);
              }
            } else if (bot.lastKnown) {
              // hunt the last CONFIRMED position — never live-tracked
              const d = sub(bot.lastKnown, bot.pos);
              const dl = Math.hypot(d[0], d[2]);
              if (dl < 0.8 || !playerAlive) {
                bot.lastKnown = null;
                bot.mode = 'alert';
                bot.suspicion = 0.6;
                bot.stateUntil = s.t + 3;
                pushLog(`${bot.id} lost the trail`);
              } else {
                vx = d[0] / dl; vz = d[2] / dl;
                speed = def.runSpeedMetersPerSecond;
                bot.running = true;
              }
            } else if (!playerAlive) {
              bot.mode = 'calm';
              bot.suspicion = 0;
            } else {
              bot.mode = 'alert';
              bot.suspicion = 0.6;
              bot.stateUntil = s.t + 3;
            }
          } else if (bot.mode === 'panic' || bot.mode === 'notify') {
            // awareness escalates UPWARD: run to the nearest officer, report,
            // then just get away from the trouble
            const officer = s.bots.find((o) => o.kind === 'police' && o.mode !== 'down');
            const report = bot.lastKnown ?? bot.stimulus;
            if (bot.mode !== 'notify' && officer && report && playerAlive) bot.mode = 'notify';
            if (bot.mode === 'notify' && officer && report) {
              const d = sub(officer.pos, bot.pos);
              const dl = Math.hypot(d[0], d[2]);
              if (dl < 2.4) {
                officer.suspicion = 1;
                officer.mode = 'hostile';
                officer.lastKnown = [...report] as V3;
                pushLog(`${bot.id} notifies ${officer.id} — HOSTILE`);
                bot.mode = 'panic';
                bot.stimulus = null;
                bot.lastKnown = null;
                bot.stateUntil = s.t + 8;
              } else {
                vx = d[0] / dl; vz = d[2] / dl;
                speed = def.runSpeedMetersPerSecond;
                bot.running = true;
              }
            } else {
              const from = report ?? p.pos;
              const away = norm3([bot.pos[0] - from[0], 0, bot.pos[2] - from[2]]);
              vx = away[0]; vz = away[2];
              speed = def.runSpeedMetersPerSecond;
              bot.running = true;
              if (s.t > bot.stateUntil && bot.suspicion < 0.25) bot.mode = 'calm';
            }
          } else if (bot.mode === 'tend') {
            // paramedic duty: kneel at the nearest downed body
            let body: Bot | null = null;
            let bodyPos: V3 | null = null;
            let best = Infinity;
            for (const other of s.bots) {
              if (other.mode !== 'down') continue;
              const op = bonesRef.current[other.id]?.pelvis.position ?? other.pos;
              const dl = Math.hypot(op[0] - bot.pos[0], op[2] - bot.pos[2]);
              if (dl < best) { best = dl; body = other; bodyPos = op as V3; }
            }
            if (!body || !bodyPos) {
              bot.mode = 'calm';
            } else if (best > 1.4) {
              const d = sub(bodyPos, bot.pos);
              vx = d[0] / best; vz = d[2] / best;
            } else {
              bot.tending = true;
              bot.heading = headingOf(bodyPos[0] - bot.pos[0], bodyPos[2] - bot.pos[2]);
              faceMove = false;
            }
          } else {
            // calm: walk the patrol
            const wp = bot.patrol[bot.wpIndex];
            const d = sub(wp, bot.pos);
            const dl = Math.hypot(d[0], d[2]);
            if (dl < 0.5) {
              bot.wpIndex = (bot.wpIndex + 1) % bot.patrol.length;
            } else {
              vx = d[0] / dl; vz = d[2] / dl;
            }
            // a paramedic with bodies on the ground and no recent gunfire goes to work
            if (bot.kind === 'paramedic' && s.t - s.lastGunfireAt > 5 && s.bots.some((b) => b.mode === 'down')) {
              bot.mode = 'tend';
              pushLog(`${bot.id} responding to the downed`);
            }
          }

          bot.moving = vx !== 0 || vz !== 0;
          if (bot.moving) {
            slideMove(bot.pos, vx * speed, vz * speed, dt, 0.32);
            if (faceMove) bot.heading = headingOf(vx, vz);
            bot.gait += dt * (bot.running ? 2.4 : 1.5);
          }

          bonesRef.current[bot.id] = solveBots(bot);
          rigsRef.current[bot.id] = rigFor(bot.id, bonesRef.current[bot.id]);
        }

        // stimuli everyone just heard are spent
        for (const noise of freshNoises) noise.processed = true;

        // bodies don't stack: cheap pairwise pushout (live bodies only)
        const bodies: Array<{ pos: V3 }> = [
          ...(playerAlive ? [p] : []),
          ...s.bots.filter((b) => b.mode !== 'down'),
        ];
        for (let i = 0; i < bodies.length; i++) {
          for (let j = i + 1; j < bodies.length; j++) {
            const a = bodies[i].pos;
            const b = bodies[j].pos;
            const dx = b[0] - a[0];
            const dz = b[2] - a[2];
            const d2 = dx * dx + dz * dz;
            if (d2 > 1e-6 && d2 < 0.64) {
              const d = Math.sqrt(d2);
              const push = (0.8 - d) / 2;
              a[0] -= (dx / d) * push; a[2] -= (dz / d) * push;
              b[0] += (dx / d) * push; b[2] += (dz / d) * push;
            }
          }
        }

        // crosshair target: the exact ray a shot would take (HUD highlight)
        if (s.aiming) {
          const origin: V3 = [...s.cam.position] as V3;
          const dir = norm3(sub(s.cam.target, origin));
          const targets = s.bots.filter((b) => b.mode !== 'down').map((b) => ({ id: b.id, hitboxes: rigsRef.current[b.id]?.hitboxes ?? [] }));
          const coverT = nearestCoverT(origin, dir, 120);
          const pick = raycastFigures(targets, origin, dir, 120);
          s.targetId = pick && pick.hit.t < coverT ? pick.id : '';
        } else {
          s.targetId = '';
        }

        // fx decay (noises live a little longer so the ring animation reads)
        s.tracers = s.tracers.filter((tr) => s.t - tr.bornAt < 0.18);
        s.sparks = s.sparks.filter((sp) => s.t - sp.bornAt < 0.28);
        s.noises = s.noises.filter((noise) => s.t - noise.bornAt < 0.6);
      }

    };

    // One bad frame must not silently kill the loop: a thrown exception used
    // to end the rAF chain — camera/aim/bots freeze with zero output (console
    // .log never reaches the dev terminal; console.error does). Catch, scream
    // to stderr, keep ticking.
    const tick = () => {
      try {
        step();
      } catch (err: any) {
        console.error(`[combat_lab] tick #${simRef.current.frame} error: ${String(err?.message ?? err)}`, String(err?.stack ?? ''));
      }
      setTick((t) => t + 1);
      handle = schedule(tick);
    };

    handle = schedule(tick);
    return () => cancel(handle);
  }, []);

  // ── per-frame render derivation ────────────────────────────────────────────

  const s = simRef.current;
  const p = s.player;
  const weapon = WEAPONS[p.weapon];

  // bones/rigs come from the tick; first frame builds them lazily
  if (!bonesRef.current.you) {
    bonesRef.current.you = solvePlayerBones();
    rigsRef.current.you = rigFor('you', bonesRef.current.you);
  }
  for (const bot of s.bots) {
    if (!bonesRef.current[bot.id]) {
      bonesRef.current[bot.id] = solveBots(bot);
      rigsRef.current[bot.id] = rigFor(bot.id, bonesRef.current[bot.id]);
    }
  }
  const playerBones = bonesRef.current.you;

  // the ONE camera, resolved by the tick — render what the bullet sees
  const cam = s.cam;

  const maxExposure = Math.max(0, ...s.bots.filter((b) => b.mode !== 'down' && npcKindDefinition(b.kind).canFight).map((b) => b.exposure));
  const wasted = p.hp <= 0;
  const hurtFlash = clamp(1 - (s.t - p.lastHurtAt) / 0.3, 0, 1);

  // Awareness state → color, everywhere (cones, suspicion bars, HUD labels).
  const STATE_COLOR: Record<BotState, string> = {
    calm: '#566a85', spooked: WARN, alert: '#fb923c', hostile: BAD,
    panic: '#e879f9', notify: '#e879f9', tend: GOOD, down: '#475569',
  };

  // Scene fx, ONE keyed list rendered last (the reconciler's variable-array
  // rule): FoV cones, LoS rays (only while a bot actually SEES you — no more
  // wallhack readout), hitboxes, noise rings, tracers, sparks.
  type Fx =
    | { key: string; kind: 'seg'; a: V3; b: V3; radius: number; material: any }
    | { key: string; kind: 'spark'; p: V3; scale: number; material: any }
    | { key: string; kind: 'box'; p: V3; r: V3; size: [number, number, number]; material: any }
    | { key: string; kind: 'ring'; p: V3; radius: number; material: any };
  const fx: Fx[] = [];

  // FoV cones on the ground — directional vision made visible. Drawn at a
  // readable length (capped), colored by awareness state.
  for (const bot of s.bots) {
    if (bot.mode === 'down') continue;
    const prof = npcKindDefinition(bot.kind).perception;
    const len = Math.min(prof.visionRangeMeters, 9);
    const half = prof.visionFovDegrees / 2;
    const color = { color: STATE_COLOR[bot.mode], opacity: bot.mode === 'calm' ? 0.22 : 0.45 };
    const apex: V3 = [bot.pos[0], 0.04, bot.pos[2]];
    const edge = (deg: number): V3 => [
      bot.pos[0] + Math.sin((bot.heading + deg) * RAD) * len,
      0.04,
      bot.pos[2] + Math.cos((bot.heading + deg) * RAD) * len,
    ];
    const arc = [-half, -half / 2, 0, half / 2, half].map(edge);
    fx.push({ key: `cone-${bot.id}-l`, kind: 'seg', a: apex, b: arc[0], radius: 0.014, material: color });
    fx.push({ key: `cone-${bot.id}-r`, kind: 'seg', a: apex, b: arc[4], radius: 0.014, material: color });
    for (let i = 0; i < 4; i++) {
      fx.push({ key: `cone-${bot.id}-a${i}`, kind: 'seg', a: arc[i], b: arc[i + 1], radius: 0.014, material: color });
    }
  }

  // Noise rings — every footstep/gunshot expands to exactly the radius it
  // could be heard at (before per-listener acuity). See your own loudness.
  for (const noise of s.noises) {
    const age = clamp((s.t - noise.bornAt) / 0.55, 0, 1);
    fx.push({
      key: `noise-${noise.id}`, kind: 'ring',
      p: [noise.p[0], 0.05, noise.p[2]],
      radius: Math.max(0.05, noise.radiusMeters * age),
      material: { color: noise.kind === 'shot' ? '#ffd966' : '#94a3b8', opacity: (1 - age) * (noise.kind === 'shot' ? 0.55 : 0.4) },
    });
  }

  // LoS rays: only while a fighter is actively seeing you — green samples
  // count against your cover, red ones died in it.
  if (showRays) {
    for (const bot of s.bots) {
      if (!bot.seeing || bot.mode === 'down') continue;
      const botBones = bonesRef.current[bot.id];
      if (!botBones) continue;
      const botEye = eyeOf(botBones);
      const cover = coverFractionOf(botEye, playerBones);
      cover.samples.forEach((sample, i) => {
        if (sample.clear) {
          fx.push({ key: `ray-${bot.id}-${i}`, kind: 'seg', a: botEye, b: sample.p, radius: 0.011, material: { color: GOOD, opacity: 0.4 } });
        } else {
          const d = norm3(sub(sample.p, botEye));
          const cut: V3 = [botEye[0] + d[0] * sample.blockedT!, botEye[1] + d[1] * sample.blockedT!, botEye[2] + d[2] * sample.blockedT!];
          fx.push({ key: `ray-${bot.id}-${i}`, kind: 'seg', a: botEye, b: cut, radius: 0.011, material: { color: BAD, opacity: 0.33 } });
        }
      });
    }
  }
  if (showHitboxes) {
    for (const bot of s.bots) {
      const rig = rigsRef.current[bot.id];
      if (!rig) continue;
      for (const hb of rig.hitboxes) {
        const flash = s.t - bot.lastHitAt < 0.18 && hb.id === bot.lastHitBone;
        fx.push({ key: `hb-${bot.id}-${hb.id}`, kind: 'box', p: hb.position as V3, r: hb.rotation as V3, size: hb.size, material: { color: flash ? '#ffffff' : '#38bdf8', opacity: flash ? 0.85 : 0.22 } });
      }
    }
    for (const hb of rigsRef.current.you?.hitboxes ?? []) {
      fx.push({ key: `hb-you-${hb.id}`, kind: 'box', p: hb.position as V3, r: hb.rotation as V3, size: hb.size, material: { color: CYAN, opacity: 0.16 } });
    }
  }
  for (const tr of s.tracers) {
    fx.push({ key: `tr-${tr.id}`, kind: 'seg', a: tr.a, b: tr.b, radius: 0.022, material: { color: tr.color, opacity: 0.9 } });
  }
  for (const sp of s.sparks) {
    const age = (s.t - sp.bornAt) / 0.28;
    fx.push({ key: `sp-${sp.id}`, kind: 'spark', p: sp.p, scale: 0.16 * (1 - age) + 0.03, material: { color: sp.color, opacity: 1 - age } });
  }

  const fighters = s.bots.filter((b) => npcKindDefinition(b.kind).canFight);
  const downCount = fighters.filter((b) => b.mode === 'down').length;

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      {/* ── left: the lab readout ── */}
      <Col style={{ width: 312, padding: 14, gap: 9 }}>
        <Text fontSize={15} color={INK} style={{ fontWeight: 900 }}>COMBAT LAB</Text>
        <Text fontSize={11} color={DIM}>
          {wasted ? 'WASTED — press r' : `geometric out · probabilistic in · ${downCount}/${fighters.length} fighters down`}
        </Text>

        <MeterRow label="YOUR HP" frac={p.hp / PLAYER_MAX_HP} color={hpColor(p.hp)} right={`${p.hp}`} />
        <MeterRow
          label={`EXPOSURE (what the bots can see of you${p.crouched ? ' · crouched' : ''})`}
          frac={maxExposure}
          color={maxExposure > 0.6 ? BAD : maxExposure > 0.25 ? WARN : GOOD}
          right={`${Math.round(maxExposure * 100)}%`}
        />

        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          {WEAPON_IDS.map((id) => (
            <Chip key={id} label={`${WEAPONS[id].label} (${WEAPON_IDS.indexOf(id) + 1})`} active={p.weapon === id} color={WEAPONS[id].tracer} onPress={() => { simRef.current.player.weapon = id; }} />
          ))}
        </Row>
        <Text fontSize={10} color={DIM}>{`${weapon.label}: ${weapon.damage} dmg · ${weapon.rangeMeters}m · ${(1 / weapon.cooldownSeconds).toFixed(1)} rps · head ×${ZONE_DAMAGE.head}`}</Text>

        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Chip label="crouch (c)" active={p.crouched} color={CYAN} onPress={() => { simRef.current.player.crouched = !simRef.current.player.crouched; }} />
          <Chip label="LoS rays (v)" active={showRays} color={GOOD} onPress={() => setShowRays((v) => !v)} />
          <Chip label="hitboxes (b)" active={showHitboxes} color="#38bdf8" onPress={() => setShowHitboxes((v) => !v)} />
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Chip label="heal (h)" color={GOOD} onPress={heal} />
          <Chip label={paused ? 'resume (p)' : 'pause (p)'} active={paused} color={WARN} onPress={() => setPaused((v) => !v)} />
          <Chip label="reset (r)" onPress={resetAll} />
        </Row>

        <Box style={{ height: 4 }} />
        <Text fontSize={11} color={DIM} style={{ fontWeight: 800 }}>BOTS — perception from kinds.ts, odds from chance.ts</Text>
        <Col style={{ gap: 7 }}>
          {s.bots.map((bot) => {
            const def = npcKindDefinition(bot.kind);
            const prof = def.perception;
            const down = bot.mode === 'down';
            return (
              <Col key={bot.id} style={{ gap: 3, padding: 7, borderRadius: 6, borderWidth: 1, borderColor: s.targetId === bot.id ? CYAN : '#1a2638', backgroundColor: '#0d1524' }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text fontSize={11} color={down ? DIM : INK} style={{ fontWeight: 800 }}>{`${bot.id} · ${def.label.toLowerCase()}`}</Text>
                  <Text fontSize={10} color={STATE_COLOR[bot.mode]} style={{ fontWeight: 800 }}>{bot.mode.toUpperCase()}</Text>
                </Row>
                <MeterRow label="" frac={bot.hp / def.maxHealth} color={hpColor((bot.hp / def.maxHealth) * 100)} right={`${bot.hp}/${def.maxHealth}`} />
                {down ? null : (
                  <Text fontSize={10} color={DIM}>
                    {bot.seeing
                      ? `SEES YOU ${Math.round(bot.exposure * 100)}%${def.canFight ? ` → would hit ${Math.round(bot.chance * 100)}%` : ''} · suspicion ${Math.round(bot.suspicion * 100)}%`
                      : `suspicion ${Math.round(bot.suspicion * 100)}% · eyes ${prof.visionRangeMeters}m/${prof.visionFovDegrees}° · ears ×${prof.hearingAcuity} · ${bot.rangeMeters.toFixed(0)}m away`}
                  </Text>
                )}
              </Col>
            );
          })}
        </Col>

        <Box style={{ height: 4 }} />
        <Text fontSize={11} color={DIM} style={{ fontWeight: 800 }}>GROUND — tileKinds noise underfoot</Text>
        <Text fontSize={10} color={DIM}>
          {[FLOOR_BASE, ...FLOOR_ZONES.map((zone) => zone.kind)]
            .filter((kind, i, arr) => arr.indexOf(kind) === i)
            .map((kind) => `${TILE_KIND_DEFINITIONS[kind].label.toLowerCase()} ×${TILE_KIND_DEFINITIONS[kind].npc.noise}`)
            .join(' · ')}
        </Text>
        <Text fontSize={10} color={DIM}>{`you're on: ${TILE_KIND_DEFINITIONS[floorKindAt(p.pos[0], p.pos[2])].label.toLowerCase()} (×${tileNoiseAt(p.pos[0], p.pos[2])}) · ${p.crouched ? 'crouch' : 'walk'} carries ${Math.round((p.crouched ? MOVE_NOISE.crouch : MOVE_NOISE.walk).radiusMeters * tileNoiseAt(p.pos[0], p.pos[2]))}m · run ${Math.round(MOVE_NOISE.run.radiusMeters * tileNoiseAt(p.pos[0], p.pos[2]))}m`}</Text>

        <Box style={{ height: 4 }} />
        <Text fontSize={11} color={DIM} style={{ fontWeight: 800 }}>SHOTS</Text>
        <Col style={{ gap: 2 }}>
          {s.log.length === 0 ? (
            <Text fontSize={10} color={DIM}>no shots yet — hold RMB, click LMB</Text>
          ) : (
            s.log.map((line, i) => (
              <Text key={`${i}.${line}`} fontSize={10} color={i === 0 ? INK : DIM}>{line}</Text>
            ))
          )}
        </Col>
      </Col>

      {/* ── right: the arena ── */}
      <Pressable
        onMouseDown={() => setMouseFocused(true)}
        style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#101725">
          <Scene3D.Camera position={cam.position} target={cam.target} fov={cam.fov} />
          <Scene3D.Fog enabled={false} />
          <Scene3D.Skybox zenith="#16243d" horizon="#3d4f6e" ground="#0c0f15" sunDir={[0.45, 0.5, 0.3]} sunColor="#ffe7b0" haze={0.25} cloud={0.18} night={0} />
          <Scene3D.AmbientLight color="#9aa8c4" intensity={0.55} />
          <Scene3D.DirectionalLight direction={[0.45, 0.85, 0.3]} color="#fff2d8" intensity={0.9} />

          {/* ground: the base tile + zone patches — REAL hmsc tileKinds, the
              same definitions whose npc.noise scales your footsteps. The
              color you see comes from each kind's render profile. */}
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: ARENA_HALF * 2 + 3, height: 0.08, depth: ARENA_HALF * 2 + 3 }} material={TILE_KIND_DEFINITIONS[FLOOR_BASE].render.color} position={[0, -0.04, 0]} />
          {FLOOR_ZONES.map((zone) => (
            <Scene3D.Mesh
              key={`floor-${zone.kind}-${zone.x0}-${zone.z0}`}
              geometry={Geometry.Box}
              params={{ width: zone.x1 - zone.x0, height: 0.03, depth: zone.z1 - zone.z0 }}
              material={TILE_KIND_DEFINITIONS[zone.kind].render.color}
              position={[(zone.x0 + zone.x1) / 2, 0.012, (zone.z0 + zone.z1) / 2]}
            />
          ))}

          {/* cover — the very AABBs the rays test */}
          {OBSTACLES.map((ob) => (
            <Scene3D.Mesh key={ob.id} geometry={Geometry.Box} params={{ width: ob.w, height: ob.h, depth: ob.d }} material={TIER_COLOR[ob.tier]} position={[ob.x, ob.h / 2, ob.z]} />
          ))}

          {/* bots — head_lab dressed figures; a down body is its ragdoll.
              FIXED-SHAPE fragments: the bar/ring stay MOUNTED when a bot dies
              and hide via opacity — removing them shifts the Scene3D's
              flattened child list mid-stream, the reconciler sibling-shift
              class this repo has burned on before. */}
          {s.bots.map((bot) => {
            const rig = rigsRef.current[bot.id];
            const bones = bonesRef.current[bot.id];
            if (!rig || !bones) return <Fragment key={bot.id} />;
            const def = npcKindDefinition(bot.kind);
            const down = bot.mode === 'down';
            return (
              <Fragment key={bot.id}>
                <FigureMeshes rig={rig} parts={characters[bot.id].parts as any} />
                <HealthBar x={bones.head.position[0]} y={bones.head.position[1] + 0.62} z={bones.head.position[2]} frac={bot.hp / def.maxHealth} camPos={cam.position} hidden={down} />
                {/* suspicion meter under the health bar, state-colored */}
                <HealthBar x={bones.head.position[0]} y={bones.head.position[1] + 0.47} z={bones.head.position[2]} frac={bot.suspicion} camPos={cam.position} hidden={down || bot.suspicion < 0.02} color={STATE_COLOR[bot.mode]} />
                <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.42, tube: 0.02, segments: 24, sides: 6 }} material={{ color: s.targetId === bot.id ? CYAN : STATE_COLOR[bot.mode], opacity: down ? 0 : 1 }} position={[bot.pos[0], 0.05, bot.pos[2]]} />
              </Fragment>
            );
          })}

          {/* the player — ring stays mounted for the same fixed-shape reason */}
          <FigureMeshes rig={rigsRef.current.you} parts={characters.you.parts as any} />
          <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.42, tube: 0.02, segments: 24, sides: 6 }} material={{ color: '#18e0d8', opacity: wasted ? 0 : 1 }} position={[p.pos[0], 0.05, p.pos[2]]} />

          {/* ALL variable-length fx in one keyed list, last child */}
          {fx.map((item) =>
            item.kind === 'seg' ? (
              <SegmentMesh key={item.key} a={item.a} b={item.b} radius={item.radius} material={item.material} />
            ) : item.kind === 'box' ? (
              <Scene3D.Mesh key={item.key} geometry={Geometry.Box} params={UNIT_BOX} material={item.material} position={item.p} rotation={item.r} scale={item.size} />
            ) : item.kind === 'ring' ? (
              <Scene3D.Mesh key={item.key} geometry={Geometry.Torus} params={UNIT_TORUS} material={item.material} position={item.p} scale={[item.radius, 1, item.radius]} />
            ) : (
              <Scene3D.Mesh key={item.key} geometry={Geometry.Sphere} params={UNIT_SPHERE} material={item.material} position={item.p} scale={[item.scale, item.scale, item.scale]} />
            ),
          )}
        </Scene3D>

        {/* hmsc's aim crosshair — screen center, only while aiming */}
        <AimCrosshair aiming={s.aiming} />

        {/* hurt flash — 8-digit hex; rgba() isn't in the style parser */}
        {hurtFlash > 0 ? (
          <Box style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: `#ef4444${Math.round(hurtFlash * 0.28 * 255).toString(16).padStart(2, '0')}` }} />
        ) : null}
        {wasted ? (
          <Box style={{ position: 'absolute', left: 0, right: 0, top: 60, alignItems: 'center' }}>
            <Text fontSize={44} color={BAD} style={{ fontWeight: 900 }}>WASTED</Text>
            <Text fontSize={12} color={DIM}>r to reset · h to cheat death</Text>
          </Box>
        ) : null}

        {!mouseFocused ? (
          <Box style={{ position: 'absolute', left: 14, bottom: 40, paddingLeft: 10, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#020617cc' }}>
            <Text fontSize={11} color="#cbd5e1">click to focus mouse look — Esc releases</Text>
          </Box>
        ) : null}
        <Box style={{ position: 'absolute', left: 14, bottom: 14 }}>
          <Text fontSize={11} color={DIM}>rmb aim · lmb fire · wasd move · shift run · c crouch · 1/2/3 weapon · v rays · b hitboxes</Text>
        </Box>
        {/* debug strip — the raw truth, layer by layer: a frozen t = the tick
            loop died (check the dev terminal for [combat_lab] tick errors);
            rmb 1 with no AIM = focus lost; AIM with no crosshair = paint bug. */}
        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <Text fontSize={10} color={s.aiming ? CYAN : DIM}>
            {`t${s.frame} · ${mouseFocused ? 'focus' : 'UNFOCUSED'} · rmb ${readHostNumber('getMouseRightDown', 0)} · lmb ${readHostNumber('getMouseDown', 0)} · ${s.aiming ? 'AIM' : 'idle'}`}
          </Text>
        </Box>
      </Pressable>

      {/* offscreen: every actor's face + skin bakes */}
      {ACTOR_DEFS.map((def) => (
        <CharacterCaptures
          key={`cap-${def.id}`}
          headTexKey={characters[def.id].parts.head.texKey}
          skinTexKey={characters[def.id].parts.torso.texKey}
          skin={characters[def.id].doc.skin}
          layers={characters[def.id].doc.layers}
        />
      ))}
    </Row>
  );
}
