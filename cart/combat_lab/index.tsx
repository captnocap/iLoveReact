// combat_lab — player vs bot line-of-sight + weapon damage, on hmsc's real combat stack.
//
// The capability under test: hmsc's TWO shot paths and the join between them.
//
//   1. GEOMETRIC (player → bot): the aim ray is tested against the same capsule
//      rigs the figures are drawn from (render3d/humanoid solveHumanoid →
//      raycastHumanoids), cut short by world cover. The pierced zone picks the
//      ZONE_DAMAGE multiplier — a headshot is a headshot because the ray went
//      through the head capsule, never a dice roll.
//   2. PROBABILISTIC (bot → player): npc/systems/chance.ts ground truth.
//      hitChance(range, coverFraction, crouched, skill) → rollHit → rollZone →
//      zoneDamage. No ray is ever cast at the player's body — exactly the
//      game's rule.
//
// And the piece hmsc does NOT have yet, built here so the game can lift it:
// chance.ts takes `coverFraction` as an input but nothing in the game produces
// it. coverFractionOf() below is that producer — rays from the shooter's eye to
// sample points spread over the target's OWN hit capsules, tested against world
// AABBs; the blocked fraction IS the coverFraction. Because samples ride the
// solved rig, crouching genuinely lowers them: duck behind a chest-high crate
// and your head sample drops below its top — watch your EXPOSURE % fall and
// the bots' hit chance with it.
//
// Cover comes in three honest tiers: full walls (block everything), chest-high
// crates (hide a crouched body completely, a standing torso partially), low
// barriers (legs only). The obstacle boxes the rays test are the very boxes
// rendered — see-it == it-blocks.
//
// Try: WASD move · SHIFT run · C crouch · click fire · F fire · 1/2/3 weapon
//      V LoS rays · B hit capsules · H heal · P pause · R reset · drag orbits
//
// Pure TSX — no rebuild needed.
// Ship: ./scripts/ship combat_lab      Dev: ./scripts/dev combat_lab

import { Fragment, useEffect, useRef, useState } from 'react';
import { Box, Col, Row, Pressable, Text, Scene3D } from '@reactjit/runtime/primitives';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import * as Geometry from '@reactjit/geometries';
import { OrbitCamera, Orbit, solveCamera, unprojectGround } from '@reactjit/cameras';

// hmsc's combat stack — the systems under test, imported from the game itself.
import { solveHumanoid, type HumanoidRig } from '../hmsc/render3d/humanoid/skeleton';
import { Figure } from '../hmsc/render3d/humanoid/Figure';
import { PLAYER_PALETTE, NPC_PALETTES } from '../hmsc/render3d/humanoid/palette';
import { drivePose, type HumanoidPose } from '../hmsc/render3d/humanoid/pose';
import { raycastHumanoids, ZONE_DAMAGE, type HumanoidHit } from '../hmsc/render3d/humanoid/hitbox';
import { hitChance, rollHit, rollZone } from '../hmsc/npc/systems/chance';
import { zoneDamage } from '../hmsc/npc/systems/damage';
import { npcKindDefinition } from '../hmsc/npc/kinds';
import type { NpcKind } from '../hmsc/design';
import type { DamageZone } from '../hmsc/render3d/humanoid/skeleton';

const BG = '#0b1018';
const INK = '#e8eef8';
const DIM = '#7f93b1';
const GOOD = '#34d399';
const WARN = '#f59e0b';
const BAD = '#ef4444';
const CYAN = '#67e8f9';

type V3 = [number, number, number];

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const ARENA_HALF = 16.5;

const PLAYER_MAX_HP = 100;
const WALK_SPEED = 2.6;
const RUN_SPEED = 5.4;
const CROUCH_SPEED = 1.4;
const SIGHT_RANGE = 34; // bots stop caring past this — hitChance is ~0 by 40m anyway
const ENGAGE_ADVANCE_DIST = 20; // engaging bots close to this range before holding
const EXPOSURE_TO_FIRE = 0.125; // below this the bot can't justify a shot (1/8 samples)

// Shooter skill feeding chance.ts (0 hopeless .. 1 marksman). kinds.ts doesn't
// carry skill yet — when it graduates there, delete this table and read the def.
const SHOOTER_SKILL: Record<NpcKind, number> = { civilian: 0, thug: 0.42, police: 0.68 };
const FIRE_COOLDOWN: Record<NpcKind, number> = { civilian: 0, thug: 1.3, police: 0.95 };

// Player weapons — geometric-path parameters. Damage runs through the SAME
// ZONE_DAMAGE multipliers the game uses (via HumanoidHit.damageMultiplier).
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
// hmsc figure yaw: the nose points -Z at yaw 0, so facing direction d → yaw:
const yawFacing = (dx: number, dz: number) => Math.atan2(-dx, -dz) * DEG;

// ── the world: axis-aligned cover boxes ──────────────────────────────────────
// Three tiers. `h` is the load-bearing number: 2.7 walls beat a standing head
// (~2.0), 1.45 crates beat a crouched head (~1.35) but not a standing one,
// 0.85 barriers only eat leg/hip samples. The rendered box IS the tested AABB.

type Obstacle = { id: string; x: number; z: number; w: number; d: number; h: number; tier: 'wall' | 'crate' | 'barrier' };

const OBSTACLES: Obstacle[] = [
  { id: 'wall-a', x: -6.5, z: -1.5, w: 8, d: 0.6, h: 2.7, tier: 'wall' },
  { id: 'wall-b', x: 6, z: -7.5, w: 0.6, d: 7, h: 2.7, tier: 'wall' },
  { id: 'wall-c', x: 11.5, z: -4.4, w: 5.4, d: 0.6, h: 2.7, tier: 'wall' },
  { id: 'crate-a', x: -2, z: 3.5, w: 1.7, d: 1.7, h: 1.45, tier: 'crate' },
  { id: 'crate-b', x: 7.5, z: 2.5, w: 1.7, d: 1.7, h: 1.45, tier: 'crate' },
  { id: 'crate-c', x: -10.5, z: 8.5, w: 1.7, d: 1.7, h: 1.45, tier: 'crate' },
  { id: 'crate-d', x: 2.5, z: -4.5, w: 1.7, d: 1.7, h: 1.45, tier: 'crate' },
  { id: 'bar-a', x: -3.5, z: 10.5, w: 5, d: 0.5, h: 0.85, tier: 'barrier' },
  { id: 'bar-b', x: 10.5, z: 9, w: 0.5, d: 5, h: 0.85, tier: 'barrier' },
  { id: 'bar-c', x: -12.5, z: -8.5, w: 0.5, d: 6, h: 0.85, tier: 'barrier' },
];

const TIER_COLOR: Record<Obstacle['tier'], string> = { wall: '#3b4a63', crate: '#7a5a36', barrier: '#4a5560' };

// Ray vs one obstacle AABB (slab test). Returns the entry t along `dir` within
// (eps, maxT), or null. Origins inside a box count as blocked at t≈0 — if your
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
// BEFORE the capsule test: cover closer than the body means the crate took the
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

// ── coverFraction — the producer chance.ts is missing ───────────────────────
// Sample points spread over the target's solved hit capsules: head top + mid,
// three down the torso, one per leg, hips. Equal weights; blocked/total is the
// coverFraction chance.ts wants. Riding rig.zones (not fixed heights) is the
// whole trick — a crouched rig's samples come down with it.

type CoverSample = { p: V3; clear: boolean; blockedT: number | null };

function capsulePoint(rig: HumanoidRig, zone: DamageZone, t: number): V3 | null {
  const cap = rig.zones.find((z) => z.zone === zone);
  if (!cap) return null;
  return [lerp(cap.a[0], cap.b[0], t), lerp(cap.a[1], cap.b[1], t), lerp(cap.a[2], cap.b[2], t)];
}

function rigSamplePoints(rig: HumanoidRig): V3[] {
  const picks: Array<[DamageZone, number]> = [
    ['head', 1], ['head', 0.5],
    ['torso', 0.15], ['torso', 0.5], ['torso', 0.85],
    ['torso', 1],
    ['legL', 0.45], ['legR', 0.45],
  ];
  const points: V3[] = [];
  for (const [zone, t] of picks) {
    const p = capsulePoint(rig, zone, t);
    if (p) points.push(p);
  }
  return points;
}

function coverFractionOf(eye: V3, targetRig: HumanoidRig): { fraction: number; samples: CoverSample[] } {
  const samples: CoverSample[] = rigSamplePoints(targetRig).map((p) => {
    const blockedT = segmentCoverT(eye, p);
    return { p, clear: blockedT === null, blockedT };
  });
  const blocked = samples.filter((s) => !s.clear).length;
  return { fraction: samples.length === 0 ? 0 : blocked / samples.length, samples };
}

// ── poses: crouch + down, blended over the shared gait ──────────────────────
// drivePose has no crouch/death; the lab synthesizes both as field blends so
// the SAME solveHumanoid produces the rig — which is what moves the hit
// capsules and therefore the cover samples. Numbers tuned so crouched feet
// stay near the ground and the crouched head sits ~1.35m (under a crate top).

const CROUCH: Partial<HumanoidPose> = {
  bodyY: -0.5, torsoLean: 16, headNod: -6,
  leftLeg: 55, rightLeg: 45, leftKnee: 118, rightKnee: 112,
  leftArm: 14, rightArm: -14, armLift: 4,
};
const DOWN: HumanoidPose = {
  rootPitch: 84, bodyY: 0.06, torsoLean: 0, headNod: -8,
  leftLeg: 2, rightLeg: -3, leftKnee: 6, rightKnee: 8,
  leftArm: 16, rightArm: -20, armLift: 2,
};

function blendPose(base: HumanoidPose, target: Partial<HumanoidPose>, t: number): HumanoidPose {
  if (t <= 0) return base;
  const out = { ...base };
  for (const key of Object.keys(target) as Array<keyof HumanoidPose>) {
    out[key] = lerp(base[key], target[key] as number, t);
  }
  return out;
}

function figurePose(anim: number, moving: boolean, running: boolean, crouch01: number, down01: number, aiming: boolean): HumanoidPose {
  let pose = drivePose(anim, moving, running);
  pose = blendPose(pose, CROUCH, crouch01);
  if (aiming) pose = { ...pose, rightArm: lerp(pose.rightArm, 88, 0.9), armLift: pose.armLift + 2 };
  if (down01 > 0) pose = blendPose(pose, DOWN, down01);
  return pose;
}

// ── sim state ────────────────────────────────────────────────────────────────

type BotMode = 'patrol' | 'engage' | 'hunt' | 'flee' | 'down';

type Bot = {
  id: string;
  kind: NpcKind;
  paletteIndex: number;
  pos: V3;
  yaw: number;
  hp: number;
  mode: BotMode;
  patrol: V3[];
  wpIndex: number;
  lastSeen: V3 | null;
  fireCooldown: number;
  anim: number;
  moving: boolean;
  running: boolean;
  downT: number; // 0..1 fall tween
  fleeUntil: number;
  lastHitAt: number;
  // HUD readouts, refreshed every tick
  exposure: number; // how much of the PLAYER this bot can see (1 - coverFraction)
  chance: number; // chance.ts ground truth for its next shot
  exposedToPlayer: number; // how much of THIS BOT the player's eye can see
  rangeMeters: number;
};

type Tracer = { id: number; a: V3; b: V3; color: string; bornAt: number };
type Spark = { id: number; p: V3; color: string; bornAt: number };

type Sim = {
  t: number;
  player: {
    pos: V3; yaw: number; hp: number;
    crouch01: number; crouched: boolean;
    anim: number; moving: boolean; running: boolean;
    fireCooldown: number; weapon: WeaponId;
    lastFireAt: number; lastHurtAt: number;
  };
  bots: Bot[];
  tracers: Tracer[];
  sparks: Spark[];
  log: string[];
  lastGunfireAt: number;
  aimPoint: V3;
  targetId: string;
  fxId: number;
  camTarget: V3;
};

function makeBot(id: string, kind: NpcKind, paletteIndex: number, patrol: V3[]): Bot {
  return {
    id, kind, paletteIndex,
    pos: [...patrol[0]] as V3,
    yaw: 0,
    hp: npcKindDefinition(kind).maxHealth,
    mode: 'patrol',
    patrol, wpIndex: 0,
    lastSeen: null,
    fireCooldown: 1 + Math.random(),
    anim: Math.random() * 10,
    moving: false, running: false,
    downT: 0, fleeUntil: 0, lastHitAt: -9,
    exposure: 0, chance: 0, exposedToPlayer: 0, rangeMeters: 0,
  };
}

function makeSim(): Sim {
  return {
    t: 0,
    player: {
      pos: [0, 0, 13], yaw: 0, hp: PLAYER_MAX_HP,
      crouch01: 0, crouched: false,
      anim: 0, moving: false, running: false,
      fireCooldown: 0, weapon: 'pistol',
      lastFireAt: -9, lastHurtAt: -9,
    },
    bots: [
      makeBot('thug-1', 'thug', 2, [[-13, 0, -13], [-3, 0, -13], [-3, 0, -5], [-13, 0, -5]]),
      makeBot('thug-2', 'thug', 1, [[13, 0, -13], [13, 0, -1], [8.6, 0, -1], [8.6, 0, -12]]),
      makeBot('police-1', 'police', 0, [[0, 0, -15], [-9, 0, -10], [0, 0, -7], [9, 0, -11]]),
      makeBot('civ-1', 'civilian', 3, [[13, 0, 13], [13, 0, 5], [4, 0, 8], [4, 0, 14]]),
    ],
    tracers: [], sparks: [],
    log: [],
    lastGunfireAt: -9,
    aimPoint: [0, 0, 0],
    targetId: '',
    fxId: 1,
    camTarget: [0, 1.1, 13],
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

// A→B as a thin Y-axis cylinder, using the skeleton's own rotation convention
// ([swing around X, then yaw] — the same frame limbPart renders with).
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
      params={{ radius: props.radius, height: length, segments: 6 }}
      material={props.material}
      position={[(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]}
      rotation={[swing, yaw, 0]}
    />
  );
}

// Health bar floating over a bot, yawed to face the camera.
function HealthBar(props: { x: number; y: number; z: number; frac: number; camPos: V3 }) {
  const faceYaw = Math.atan2(props.camPos[0] - props.x, props.camPos[2] - props.z) * DEG;
  const w = 0.7;
  const fw = Math.max(0.02, w * props.frac);
  // left-anchor the fill: shift its center left by the missing half in the
  // bar's local X, rotated into world.
  const offset = -(w - fw) / 2;
  const c = Math.cos(faceYaw * RAD);
  const s = Math.sin(faceYaw * RAD);
  return (
    <>
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: w + 0.06, height: 0.1, depth: 0.03 }} material={{ color: '#0c1220', opacity: 0.85 }} position={[props.x, props.y, props.z]} rotation={[0, faceYaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: fw, height: 0.07, depth: 0.03 }} material={hpColor(props.frac * 100)} position={[props.x + offset * c + 0.02 * s, props.y, props.z - offset * s + 0.02 * c]} rotation={[0, faceYaw, 0]} />
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
  const cursorRef = useRef({ x: 0, y: 0 });
  const sceneRect = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const orbitRef = useRef<{ x: number; y: number; moved: number } | null>(null);

  const [, setTick] = useState(0);
  const [yaw, setYaw] = useState(180);
  const [pitch, setPitch] = useState(34);
  const [dist, setDist] = useState(17);
  const [showRays, setShowRays] = useState(true);
  const [showCapsules, setShowCapsules] = useState(false);
  const [paused, setPaused] = useState(false);

  const camRef = useRef({ yaw, pitch, dist });
  camRef.current = { yaw, pitch, dist };
  const uiRef = useRef({ showRays, showCapsules, paused });
  uiRef.current = { showRays, showCapsules, paused };

  // ── world/log helpers living on the sim ref ────────────────────────────────

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

  // Solve the player's CURRENT rig — eye for outgoing shots, capsules/samples
  // for incoming LoS. One solver for render and combat, the hmsc invariant.
  const solvePlayerRig = (): HumanoidRig => {
    const s = simRef.current;
    const p = s.player;
    const pose = figurePose(p.anim, p.moving, p.running, p.crouch01, p.hp <= 0 ? 1 : 0, s.t - p.lastFireAt < 0.35);
    return solveHumanoid([p.pos[0], 0, p.pos[2]], p.yaw, pose);
  };

  const solveBotRig = (bot: Bot): HumanoidRig => {
    const pose = figurePose(bot.anim, bot.moving, bot.running, 0, bot.downT, false);
    return solveHumanoid([bot.pos[0], 0, bot.pos[2]], bot.yaw, pose);
  };

  // ── the player's shot: the GEOMETRIC path ──────────────────────────────────
  // Cursor → camera ray → what you're pointing at; then the bullet flies from
  // the PLAYER's eye to that point — cover between you and it eats the shot
  // even when the camera can see around the crate. raycastHumanoids picks the
  // front-most pierced capsule; its zone multiplier scales the weapon.

  const playerFire = (sx: number, sy: number) => {
    const s = simRef.current;
    const p = s.player;
    if (p.hp <= 0 || p.fireCooldown > 0) return;
    const weapon = WEAPONS[p.weapon];

    const rect = sceneRect.current;
    const cam = solveCamera(Orbit, { target: s.camTarget, yaw: camRef.current.yaw, pitch: camRef.current.pitch, dist: camRef.current.dist, fov: 50 });
    const ground = unprojectGround(sx - rect.x, sy - rect.y, rect, cam);
    const camPos = cam.pos as V3;
    const camDir = norm3([ground.x - camPos[0], -camPos[1], ground.y - camPos[2]]);

    // what the cursor is on: front-most bot capsule, else cover, else ground
    const aliveRigs = s.bots.filter((b) => b.mode !== 'down').map((b) => ({ id: b.id, rig: solveBotRig(b) }));
    const camPick = raycastHumanoids(aliveRigs, camPos, camDir);
    const camCoverT = nearestCoverT(camPos, camDir, 500);
    let aim: V3;
    if (camPick && camPick.hit.distance < camCoverT) {
      aim = camPick.hit.point as V3;
    } else if (Number.isFinite(camCoverT)) {
      aim = [camPos[0] + camDir[0] * camCoverT, camPos[1] + camDir[1] * camCoverT, camPos[2] + camDir[2] * camCoverT];
    } else {
      aim = [ground.x, 0.05, ground.y];
    }

    // the ballistic ray: player eye → aim point
    p.yaw = yawFacing(aim[0] - p.pos[0], aim[2] - p.pos[2]);
    p.lastFireAt = s.t;
    p.fireCooldown = weapon.cooldownSeconds;
    s.lastGunfireAt = s.t;
    const rig = solvePlayerRig();
    const eye = rig.eye as V3;
    const dir = norm3(sub(aim, eye));
    const coverT = nearestCoverT(eye, dir, weapon.rangeMeters);
    const pick = raycastHumanoids(aliveRigs, eye, dir);

    const muzzle: V3 = [eye[0] + dir[0] * 0.35, eye[1] - 0.25, eye[2] + dir[2] * 0.35];

    if (pick && pick.hit.distance < coverT && pick.hit.distance <= weapon.rangeMeters) {
      // the game's applyAimHitToNpc: weapon base × the hit's zone multiplier
      const hit: HumanoidHit = pick.hit;
      const damage = Math.round(weapon.damage * hit.damageMultiplier);
      const bot = s.bots.find((b) => b.id === pick.id)!;
      bot.hp = Math.max(0, bot.hp - damage);
      bot.lastHitAt = s.t;
      bot.lastSeen = [...p.pos] as V3; // getting shot reveals the shooter
      if (!npcKindDefinition(bot.kind).canFight) {
        bot.mode = 'flee';
        bot.fleeUntil = s.t + 4;
      } else if (bot.mode === 'patrol') {
        bot.mode = 'hunt';
      }
      addTracer(muzzle, hit.point as V3, weapon.tracer);
      addSpark(hit.point as V3, '#ff6b6b');
      const died = bot.hp <= 0;
      if (died) bot.mode = 'down';
      pushLog(`YOU → ${bot.id} · ${hit.zone.toUpperCase()} ×${hit.damageMultiplier} · −${damage}${died ? ' · DOWN' : ''}`);
    } else if (coverT <= weapon.rangeMeters) {
      const impact: V3 = [eye[0] + dir[0] * coverT, eye[1] + dir[1] * coverT, eye[2] + dir[2] * coverT];
      addTracer(muzzle, impact, weapon.tracer);
      addSpark(impact, '#cbd5e1');
      pushLog(`YOU → cover · blocked at ${coverT.toFixed(1)}m`);
    } else {
      const end: V3 = [eye[0] + dir[0] * weapon.rangeMeters, eye[1] + dir[1] * weapon.rangeMeters, eye[2] + dir[2] * weapon.rangeMeters];
      addTracer(muzzle, end, weapon.tracer);
    }
  };

  // ── a bot's shot: the PROBABILISTIC path ───────────────────────────────────
  // No ray at the player's body, ever. coverFractionOf supplies the missing
  // input; chance.ts owns the odds; rollZone picks where a landed shot struck;
  // zoneDamage scales the kind's weaponDamage. The tracer is THEATER drawn
  // after the dice — geometry never decides this hit.

  const botFire = (bot: Bot, playerRig: HumanoidRig, coverFraction: number, range: number) => {
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
    const yawR = bot.yaw * RAD;
    const muzzle: V3 = [bot.pos[0] - Math.sin(yawR) * 0.35, 1.32, bot.pos[2] - Math.cos(yawR) * 0.35];
    s.lastGunfireAt = s.t;

    if (landed) {
      const zone = rollZone();
      const damage = Math.round(zoneDamage(def.weaponDamage, zone));
      p.hp = Math.max(0, p.hp - damage);
      p.lastHurtAt = s.t;
      const zoneY: Record<DamageZone, number> = { head: 1.78, torso: 1.2, armL: 1.3, armR: 1.3, legL: 0.55, legR: 0.55 };
      const impact: V3 = [p.pos[0], zoneY[zone] - p.crouch01 * 0.45, p.pos[2]];
      addTracer(muzzle, impact, '#ff8c66');
      addSpark(impact, BAD);
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
    pushLog('healed — 100 hp');
  };
  const resetAll = () => {
    simRef.current = makeSim();
  };

  // ── input ──────────────────────────────────────────────────────────────────

  const actionsRef = useRef({ heal, resetAll, playerFire });
  actionsRef.current = { heal, resetAll, playerFire };

  // shift arrives as a raw SDL keycode, not 'shift' — track it by code and by
  // the modifier flag every other key event carries.
  const SHIFT_KEYS = ['sdl:1073742049', 'sdl:1073742053']; // LSHIFT, RSHIFT

  useEffect(() => {
    const offDown = busOn('__keydown', (event: any) => {
      const key = String(event?.key ?? '').toLowerCase();
      keysRef.current[key] = true;
      if (SHIFT_KEYS.includes(key)) keysRef.current.shift = true;
      else keysRef.current.shift = !!event?.shiftKey;
      const a = actionsRef.current;
      const s = simRef.current;
      if (key === 'c') s.player.crouched = !s.player.crouched;
      else if (key === 'h') a.heal();
      else if (key === 'r') a.resetAll();
      else if (key === 'v') setShowRays((v) => !v);
      else if (key === 'b') setShowCapsules((v) => !v);
      else if (key === 'p') setPaused((v) => !v);
      else if (key === '1' || key === '2' || key === '3') s.player.weapon = WEAPON_IDS[Number(key) - 1];
      // 'f' fires via the tick's autofire (hold = continuous, SMG earns its rate)
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

    const tick = () => {
      const now = host.performance?.now?.() ?? Date.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      const s = simRef.current;
      const ui = uiRef.current;
      const p = s.player;

      if (!ui.paused) {
        s.t += dt;

        // ── player movement: camera-relative WASD ──────────────────────────
        const cam = solveCamera(Orbit, { target: s.camTarget, yaw: camRef.current.yaw, pitch: camRef.current.pitch, dist: camRef.current.dist, fov: 50 });
        const view = norm3([s.camTarget[0] - cam.pos[0], 0, s.camTarget[2] - cam.pos[2]]);
        const right: V3 = [-view[2], 0, view[0]]; // screen-right (matches m4lookAt's s = up × f)
        const keys = keysRef.current;
        let ix = 0;
        let iz = 0;
        if (p.hp > 0) {
          if (keys.w) { ix += view[0]; iz += view[2]; }
          if (keys.s) { ix -= view[0]; iz -= view[2]; }
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
          if (s.t - p.lastFireAt > 0.4) p.yaw = yawFacing(ix, iz);
        }
        p.anim += dt * (p.running ? 1.25 : 1);
        p.crouch01 = clamp(p.crouch01 + (p.crouched ? dt : -dt) / 0.18, 0, 1);
        p.fireCooldown = Math.max(0, p.fireCooldown - dt);
        // hold F = autofire (SMG earns its fire rate)
        if (keys.f && p.fireCooldown <= 0 && p.hp > 0) actionsRef.current.playerFire(cursorRef.current.x, cursorRef.current.y);

        // ── bot AI ──────────────────────────────────────────────────────────
        const playerRig = solvePlayerRig();
        const playerEye = playerRig.eye as V3;
        const playerAlive = p.hp > 0;

        for (const bot of s.bots) {
          if (bot.mode === 'down') {
            bot.downT = clamp(bot.downT + dt / 0.55, 0, 1);
            bot.moving = false;
            continue;
          }
          const def = npcKindDefinition(bot.kind);
          const toPlayer = sub(p.pos, bot.pos);
          const range = Math.hypot(toPlayer[0], toPlayer[2]);
          bot.rangeMeters = range;

          // both directions of LoS, every tick — the HUD readouts ARE the lab
          const botEye: V3 = [bot.pos[0], 1.72, bot.pos[2]];
          const cover = coverFractionOf(botEye, playerRig);
          bot.exposure = 1 - cover.fraction;
          const botRig = solveBotRig(bot);
          bot.exposedToPlayer = 1 - coverFractionOf(playerEye, botRig).fraction;
          bot.chance = playerAlive && def.canFight
            ? hitChance({ rangeMeters: range, coverFraction: cover.fraction, targetCrouched: p.crouched, shooterSkill: SHOOTER_SKILL[bot.kind] })
            : 0;

          const seesPlayer = playerAlive && bot.exposure >= EXPOSURE_TO_FIRE && range < SIGHT_RANGE;

          let vx = 0;
          let vz = 0;
          let speed = def.walkSpeedMetersPerSecond;
          bot.running = false;

          if (!def.canFight) {
            // civilian: a body that flees, never a combatant (kinds.ts canFight)
            const scaredBy = s.t - s.lastGunfireAt < 4 && range < 14;
            if (scaredBy) { bot.mode = 'flee'; bot.fleeUntil = s.t + 3; }
            if (bot.mode === 'flee') {
              if (s.t > bot.fleeUntil && range > 16) bot.mode = 'patrol';
              const away = norm3([-toPlayer[0], 0, -toPlayer[2]]);
              vx = away[0]; vz = away[2];
              speed = def.runSpeedMetersPerSecond;
              bot.running = true;
            }
          } else if (seesPlayer) {
            bot.mode = 'engage';
            bot.lastSeen = [...p.pos] as V3;
            bot.yaw = yawFacing(toPlayer[0], toPlayer[2]);
            if (range > ENGAGE_ADVANCE_DIST) {
              const ahead = norm3([toPlayer[0], 0, toPlayer[2]]);
              vx = ahead[0]; vz = ahead[2];
              speed = def.runSpeedMetersPerSecond;
              bot.running = true;
            }
            bot.fireCooldown -= dt;
            if (bot.fireCooldown <= 0) {
              botFire(bot, playerRig, cover.fraction, range);
              bot.fireCooldown = FIRE_COOLDOWN[bot.kind] * (0.85 + Math.random() * 0.4);
            }
          } else if (bot.mode === 'engage') {
            bot.mode = 'hunt';
          }

          if (bot.mode === 'hunt' && bot.lastSeen) {
            const d = sub(bot.lastSeen, bot.pos);
            const dl = Math.hypot(d[0], d[2]);
            if (dl < 0.7 || !playerAlive) {
              bot.mode = 'patrol';
            } else {
              vx = d[0] / dl; vz = d[2] / dl;
              speed = def.runSpeedMetersPerSecond;
              bot.running = true;
            }
          }
          if (bot.mode === 'patrol') {
            const wp = bot.patrol[bot.wpIndex];
            const d = sub(wp, bot.pos);
            const dl = Math.hypot(d[0], d[2]);
            if (dl < 0.5) {
              bot.wpIndex = (bot.wpIndex + 1) % bot.patrol.length;
            } else {
              vx = d[0] / dl; vz = d[2] / dl;
            }
          }

          bot.moving = vx !== 0 || vz !== 0;
          if (bot.moving) {
            slideMove(bot.pos, vx * speed, vz * speed, dt, 0.32);
            if (bot.mode !== 'engage') bot.yaw = yawFacing(vx, vz);
            bot.anim += dt * (bot.running ? 1.25 : 1);
          }
        }

        // bodies don't stack: cheap pairwise pushout (bots + player)
        const bodies: Array<{ pos: V3 }> = [p, ...s.bots.filter((b) => b.mode !== 'down')];
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

        // cursor → aim point + hovered target (render feedback only)
        const rect = sceneRect.current;
        const ground = unprojectGround(cursorRef.current.x - rect.x, cursorRef.current.y - rect.y, rect, cam);
        const camDir = norm3([ground.x - cam.pos[0], -cam.pos[1], ground.y - cam.pos[2]]);
        const aliveRigs = s.bots.filter((b) => b.mode !== 'down').map((b) => ({ id: b.id, rig: solveBotRig(b) }));
        const hover = raycastHumanoids(aliveRigs, cam.pos as V3, camDir);
        const hoverCoverT = nearestCoverT(cam.pos as V3, camDir, 500);
        s.targetId = hover && hover.hit.distance < hoverCoverT ? hover.id : '';
        s.aimPoint = [ground.x, 0.04, ground.y];

        // fx decay
        s.tracers = s.tracers.filter((tr) => s.t - tr.bornAt < 0.1);
        s.sparks = s.sparks.filter((sp) => s.t - sp.bornAt < 0.28);

        // camera follows the player
        const k = 1 - Math.exp(-5 * dt);
        s.camTarget = [
          lerp(s.camTarget[0], p.pos[0], k),
          lerp(s.camTarget[1], 1.1 - p.crouch01 * 0.35, k),
          lerp(s.camTarget[2], p.pos[2], k),
        ];
      }

      setTick((t) => t + 1);
      handle = schedule(tick);
    };

    handle = schedule(tick);
    return () => cancel(handle);
  }, []);

  // ── orbit drag vs click-to-fire ────────────────────────────────────────────

  const onDown = (e: any) => {
    cursorRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) };
    orbitRef.current = { x: cursorRef.current.x, y: cursorRef.current.y, moved: 0 };
  };
  const onMove = (e: any) => {
    const nx = Number(e?.x ?? 0);
    const ny = Number(e?.y ?? 0);
    cursorRef.current = { x: nx, y: ny };
    const d = orbitRef.current;
    if (!d) return;
    d.moved += Math.abs(nx - d.x) + Math.abs(ny - d.y);
    setYaw((v) => v + (nx - d.x) * 0.35);
    setPitch((v) => Math.max(12, Math.min(80, v - (ny - d.y) * 0.25)));
    d.x = nx; d.y = ny;
  };
  const onUp = (e: any) => {
    const d = orbitRef.current;
    orbitRef.current = null;
    if (d && d.moved < 6) playerFire(Number(e?.x ?? d.x), Number(e?.y ?? d.y));
  };

  // ── per-frame render derivation ────────────────────────────────────────────

  const s = simRef.current;
  const p = s.player;
  const weapon = WEAPONS[p.weapon];
  const playerRig = solvePlayerRig();
  const botRigs = s.bots.map((bot) => ({ bot, rig: solveBotRig(bot) }));
  const cam = solveCamera(Orbit, { target: s.camTarget, yaw, pitch, dist, fov: 50 });
  const camPos = cam.pos as V3;

  const maxExposure = Math.max(0, ...s.bots.filter((b) => b.mode !== 'down' && npcKindDefinition(b.kind).canFight).map((b) => b.exposure));
  const wasted = p.hp <= 0;
  const hurtFlash = clamp(1 - (s.t - p.lastHurtAt) / 0.3, 0, 1);

  // LoS ray fx: engaging fighters' eye → each player sample. Green = the
  // sample is visible (it counts AGAINST your cover); red = cut at the cover
  // hit. Merged with tracers/sparks into ONE keyed list rendered last (the
  // reconciler's variable-array rule).
  type Fx =
    | { key: string; kind: 'seg'; a: V3; b: V3; radius: number; material: any }
    | { key: string; kind: 'spark'; p: V3; scale: number; material: any };
  const fx: Fx[] = [];
  if (showRays) {
    for (const { bot } of botRigs) {
      if (bot.mode === 'down' || !npcKindDefinition(bot.kind).canFight) continue;
      if (bot.rangeMeters >= SIGHT_RANGE) continue;
      const botEye: V3 = [bot.pos[0], 1.72, bot.pos[2]];
      const cover = coverFractionOf(botEye, playerRig);
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
  if (showCapsules) {
    for (const { bot, rig } of botRigs) {
      if (bot.mode === 'down') continue;
      rig.zones.forEach((z, i) => {
        fx.push({ key: `cap-${bot.id}-${i}`, kind: 'seg', a: z.a as V3, b: z.b as V3, radius: z.radius, material: { color: s.t - bot.lastHitAt < 0.18 ? '#ffffff' : '#38bdf8', opacity: 0.22 } });
      });
    }
    playerRig.zones.forEach((z, i) => {
      fx.push({ key: `cap-you-${i}`, kind: 'seg', a: z.a as V3, b: z.b as V3, radius: z.radius, material: { color: CYAN, opacity: 0.18 } });
    });
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
          <Chip label="capsules (b)" active={showCapsules} color="#38bdf8" onPress={() => setShowCapsules((v) => !v)} />
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Chip label="heal (h)" color={GOOD} onPress={heal} />
          <Chip label={paused ? 'resume (p)' : 'pause (p)'} active={paused} color={WARN} onPress={() => setPaused((v) => !v)} />
          <Chip label="reset (r)" onPress={resetAll} />
        </Row>

        <Box style={{ height: 4 }} />
        <Text fontSize={11} color={DIM} style={{ fontWeight: 800 }}>BOTS — chance.ts ground truth, live</Text>
        <Col style={{ gap: 7 }}>
          {s.bots.map((bot) => {
            const def = npcKindDefinition(bot.kind);
            const down = bot.mode === 'down';
            return (
              <Col key={bot.id} style={{ gap: 3, padding: 7, borderRadius: 6, borderWidth: 1, borderColor: s.targetId === bot.id ? CYAN : '#1a2638', backgroundColor: '#0d1524' }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text fontSize={11} color={down ? DIM : INK} style={{ fontWeight: 800 }}>{`${bot.id} · ${def.label.toLowerCase()}`}</Text>
                  <Text fontSize={10} color={down ? BAD : DIM}>{bot.mode.toUpperCase()}</Text>
                </Row>
                <MeterRow label="" frac={bot.hp / def.maxHealth} color={hpColor((bot.hp / def.maxHealth) * 100)} right={`${bot.hp}/${def.maxHealth}`} />
                {down ? null : def.canFight ? (
                  <Text fontSize={10} color={DIM}>
                    {`${bot.rangeMeters.toFixed(1)}m · sees ${Math.round(bot.exposure * 100)}% of you → would hit ${Math.round(bot.chance * 100)}% · you see ${Math.round(bot.exposedToPlayer * 100)}%`}
                  </Text>
                ) : (
                  <Text fontSize={10} color={DIM}>{`unarmed — flees gunfire (canFight: false) · you see ${Math.round(bot.exposedToPlayer * 100)}%`}</Text>
                )}
              </Col>
            );
          })}
        </Col>

        <Box style={{ height: 4 }} />
        <Text fontSize={11} color={DIM} style={{ fontWeight: 800 }}>SHOTS</Text>
        <Col style={{ gap: 2 }}>
          {s.log.length === 0 ? (
            <Text fontSize={10} color={DIM}>no shots yet — click a bot</Text>
          ) : (
            s.log.map((line, i) => (
              <Text key={`${i}.${line}`} fontSize={10} color={i === 0 ? INK : DIM}>{line}</Text>
            ))
          )}
        </Col>
      </Col>

      {/* ── right: the arena ── */}
      <Pressable
        onLayout={(lr: any) => { sceneRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#101725">
          <OrbitCamera target={s.camTarget} yaw={yaw} pitch={pitch} dist={dist} fov={50} />
          <Scene3D.Fog enabled={false} />
          <Scene3D.Skybox zenith="#16243d" horizon="#3d4f6e" ground="#0c0f15" sunDir={[0.45, 0.5, 0.3]} sunColor="#ffe7b0" haze={0.25} cloud={0.18} night={0} />
          <Scene3D.AmbientLight color="#9aa8c4" intensity={0.55} />
          <Scene3D.DirectionalLight direction={[0.45, 0.85, 0.3]} color="#fff2d8" intensity={0.9} />

          {/* ground */}
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: ARENA_HALF * 2 + 3, height: 0.08, depth: ARENA_HALF * 2 + 3 }} material="#1a2433" position={[0, -0.04, 0]} />

          {/* cover — the very AABBs the rays test */}
          {OBSTACLES.map((ob) => (
            <Scene3D.Mesh key={ob.id} geometry={Geometry.Box} params={{ width: ob.w, height: ob.h, depth: ob.d }} material={TIER_COLOR[ob.tier]} position={[ob.x, ob.h / 2, ob.z]} />
          ))}

          {/* bots — fixed count; down bodies stay where they fell */}
          {botRigs.map(({ bot, rig }) => (
            <Fragment key={bot.id}>
              <Figure rig={rig} palette={NPC_PALETTES[bot.paletteIndex]} marker={bot.mode === 'down' ? undefined : [bot.pos[0], 0, bot.pos[2]]} />
              {bot.mode === 'down' ? null : (
                <HealthBar x={bot.pos[0]} y={2.45} z={bot.pos[2]} frac={bot.hp / npcKindDefinition(bot.kind).maxHealth} camPos={camPos} />
              )}
              {s.targetId === bot.id ? (
                <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.42, tube: 0.02, segments: 24, sides: 6 }} material={CYAN} position={[bot.pos[0], 0.06, bot.pos[2]]} />
              ) : null}
            </Fragment>
          ))}

          {/* the player */}
          <Figure rig={playerRig} palette={PLAYER_PALETTE} marker={[p.pos[0], 0, p.pos[2]]} />

          {/* cursor aim ring */}
          <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.24, tube: 0.015, segments: 20, sides: 6 }} material={s.targetId ? CYAN : '#d7b46a'} position={s.aimPoint} />

          {/* ALL variable-length fx in one keyed list, last child */}
          {fx.map((item) =>
            item.kind === 'seg' ? (
              <SegmentMesh key={item.key} a={item.a} b={item.b} radius={item.radius} material={item.material} />
            ) : (
              <Scene3D.Mesh key={item.key} geometry={Geometry.Sphere} params={{ radius: 1, segments: 8, rings: 6 }} material={item.material} position={item.p} scale={[item.scale, item.scale, item.scale]} />
            ),
          )}
        </Scene3D>

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

        <Box style={{ position: 'absolute', left: 14, bottom: 14 }}>
          <Text fontSize={11} color={DIM}>wasd move · shift run · c crouch · click/f fire · 1/2/3 weapon · v rays · b capsules · drag orbits</Text>
        </Box>
        <Box style={{ position: 'absolute', right: 14, bottom: 14, flexDirection: 'row', gap: 6 }}>
          <Chip label="zoom −" onPress={() => setDist((v) => Math.min(34, v + 2))} />
          <Chip label="zoom +" onPress={() => setDist((v) => Math.max(8, v - 2))} />
        </Box>
      </Pressable>
    </Row>
  );
}
