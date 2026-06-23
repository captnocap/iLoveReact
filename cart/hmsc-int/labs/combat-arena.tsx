// labs/combat-arena.tsx — the COMBAT integration lab: fall damage, line of
// sight, aiming with items, and a fight against perceiving NPCs.
//
// THE WHOLE POINT (req_0925): this lab rides the GAME'S OWN player substrate —
// it does NOT re-roll movement, camera, the frame loop, or the player figure.
// It mounts `useEmbodiedPlayer` (the exact controller PlayRoute uses): the host
// physics step owns movement + gravity + jump + collision (GAME_PHYSICS), the
// V23 host camera owns the orbit/ADS solve (GAME_NATIVE_CAMERA), the figure is
// the real baked-preview rig. We add ONLY combat on top, in the substrate's
// `onFrame` hook:
//
//   • arena colliders (stairs to a ledge, cover) ride `worldExtras.solids`
//   • fall damage reads the real player's airborne→grounded transition
//   • LoS = GAME_PERCEPTION cones + GAME_CHANCE bone-sample cover
//   • aiming = the real ADS camera + a geometric ray vs GAME_FIGURE hitboxes
//   • NPCs = GAME_KINDS + the perception ladder + GAME_CHANCE dice for incoming
//
// Because the substrate owns the loop, there is NO second rAF here and the only
// per-frame React churn is the NPCs (≤4 rigs) — the lag in the first cut was a
// parallel loop + a 5-figure preview rebuild every frame. Contract:
// combat-arena.notes.md. (STRUCTURE note: a lab may only import game/ — but the
// integrated on-foot controller lives in Embodied.tsx, not yet a game/ door; the
// user ruled the lab MUST reuse it, so we import it directly until it graduates.)

import { memo, useMemo, useRef, useState } from 'react';
import { useRerender } from '@reactjit/runtime/hooks';
import { GAME_CAMERA, GAME_CHANCE, GAME_FIGURE, GAME_INPUT, GAME_ITEMS, GAME_KINDS, GAME_LOOP, GAME_NATIVE_CAMERA, GAME_PERCEPTION, type CollisionRect, type OrientedCollisionRect } from '@game';
import { Box, Col, Row, Text, Pressable, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { CharacterCaptures, FigureMeshes, buildPartRender } from '@game/figure/render';
import type { GameState } from '../design';
import { createInitialGameState } from '../state/gameState';
import { EmbodiedCaptures, EmbodiedMouseSurface, EmbodiedScene, useEmbodiedPlayer, type PlayerPose } from '../Embodied';

// ── door-derived types ────────────────────────────────────────────────────────
type RigFrame = ReturnType<typeof GAME_FIGURE.buildRigFrame>;
type BoneId = RigFrame['hitboxes'][number]['id'];
type ZoneId = ReturnType<typeof GAME_FIGURE.damageZoneForBone>;
type Perceiver = ReturnType<typeof GAME_PERCEPTION.calmPerceiver>;
type Awareness = Perceiver['mode'];
type Noise = ReturnType<typeof GAME_PERCEPTION.gunshotNoise>;
type ChanceZone = ReturnType<typeof GAME_CHANCE.rollZone>;
type RangeProfile = NonNullable<Parameters<typeof GAME_CHANCE.attackChance>[0]['profile']>;
type NpcKind = ReturnType<typeof GAME_KINDS.npcs.get>['kind'];
type V3 = [number, number, number];

// ── palette ──────────────────────────────────────────────────────────────────
const BG = '#0a0f1a';
const PANEL = '#0a1120';
const INK = '#e8eef8';
const DIM = '#7e93b4';
const FAINT = '#46587a';
const ACCENT = '#38bdf8';
const DEG = Math.PI / 180;
const EYE_HEIGHT = 1.6;

// ── tuning the lab carries (each notes where it graduates) ────────────────────
const FALL = { safeSpeed: 7, perSpeed: 11, lethalSpeed: 18 }; // → a player condition system
const ZONE_MULT: Record<ZoneId, number> = { head: 2.5, torso: 1, lArm: 0.55, rArm: 0.55, lLeg: 0.7, rLeg: 0.7 };
const CHANCE_ZONE_TO_RIG: Record<ChanceZone, ZoneId> = { head: 'head', torso: 'torso', armL: 'lArm', armR: 'rArm', legL: 'lLeg', legR: 'rLeg' };

type Weapon = { id: string; label: string; ranged: boolean; auto: boolean; damage: number; cooldownSeconds: number; profile: RangeProfile | null };
const WEAPONS: Weapon[] = [
  { id: 'fist', label: 'fists', ranged: false, auto: false, damage: 14, cooldownSeconds: 0.45, profile: null },
  { id: 'pistol', label: GAME_ITEMS.is('pistol') ? GAME_ITEMS.get('pistol').label : 'pistol', ranged: true, auto: false, damage: 26, cooldownSeconds: 0.32, profile: { baseAccuracy: 0.85, optimalRange: 10, falloffPerMeter: 0.02, maxRange: 45, glassPenalty: 0.5 } },
  { id: 'smg', label: 'SMG', ranged: true, auto: true, damage: 13, cooldownSeconds: 0.085, profile: { baseAccuracy: 0.7, optimalRange: 8, falloffPerMeter: 0.03, maxRange: 38, glassPenalty: 0.45 } },
  { id: 'rifle', label: 'rifle', ranged: true, auto: false, damage: 42, cooldownSeconds: 0.6, profile: { baseAccuracy: 0.95, optimalRange: 24, falloffPerMeter: 0.012, maxRange: 90, glassPenalty: 0.6 } },
];
const NPC_PROFILE: RangeProfile = { baseAccuracy: 0.8, optimalRange: 9, falloffPerMeter: 0.025, maxRange: 36, glassPenalty: 0.5 };
const SHOOTER_SKILL: Partial<Record<NpcKind, number>> = { thug: 0.5, police: 0.75, civilian: 0.2, paramedic: 0.2 };

// ── arena geometry: stairs to a 4m ledge to fall off, plus cover ──────────────
// The flat chunk floor (the game world) is the ground; these ride
// worldExtras.solids as EXTRA colliders the real host step honors.
type Cover = { x: number; z: number; halfX: number; halfZ: number; top: number; tone: string };
const COVER: Cover[] = [
  { x: 4, z: -2, halfX: 1.2, halfZ: 1.2, top: 1.7, tone: '#5a4632' },
  { x: -5, z: -4, halfX: 1.2, halfZ: 1.2, top: 1.7, tone: '#5a4632' },
  { x: 0, z: -9, halfX: 4, halfZ: 0.4, top: 2.7, tone: '#46506a' },
  { x: -10, z: 2, halfX: 2.5, halfZ: 0.4, top: 0.95, tone: '#3a4358' },
];
const STEP_N = 10, STEP_RISE = 0.4, STEP_DEPTH = 0.85, STEP_X = 14, STEP_HALF_Z = 3.5;
const LEDGE_TOP = STEP_N * STEP_RISE; // 4m
const LEDGE_MIN_X = STEP_X + STEP_N * STEP_DEPTH;

function arenaSolids(): CollisionRect[] {
  const rects: CollisionRect[] = [];
  for (let i = 0; i < STEP_N; i++) {
    const top = (i + 1) * STEP_RISE;
    const minX = STEP_X + i * STEP_DEPTH;
    rects.push({ minX, maxX: minX + STEP_DEPTH, minZ: -STEP_HALF_Z, maxZ: STEP_HALF_Z, topMeters: top, blocksPlayer: true, friction: 1, restitution: 0, floorMeters: top - STEP_RISE });
  }
  rects.push({ minX: LEDGE_MIN_X, maxX: LEDGE_MIN_X + 7, minZ: -STEP_HALF_Z, maxZ: STEP_HALF_Z, topMeters: LEDGE_TOP, blocksPlayer: true, friction: 1, restitution: 0, floorMeters: 0 });
  for (const c of COVER) rects.push({ minX: c.x - c.halfX, maxX: c.x + c.halfX, minZ: c.z - c.halfZ, maxZ: c.z + c.halfZ, topMeters: c.top, blocksPlayer: true, friction: 1, restitution: 0, floorMeters: 0 });
  return rects;
}

// ── vector + ray helpers ─────────────────────────────────────────────────────
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function aimForward(yawDeg: number, pitchDeg: number): V3 {
  const y = yawDeg * DEG, pp = pitchDeg * DEG, cp = Math.cos(pp);
  return [-Math.sin(y) * cp, Math.sin(pp), -Math.cos(y) * cp];
}
function place(local: V3, yawDeg: number, origin: V3): V3 {
  const r = yawDeg * DEG, c = Math.cos(r), s = Math.sin(r);
  return [local[0] * c + local[2] * s + origin[0], local[1] + origin[1], -local[0] * s + local[2] * c + origin[2]];
}
function rotEulerInv(v: V3, rx: number, ry: number, rz: number): V3 {
  let [x, y, z] = v;
  const cy = Math.cos(ry), sy = Math.sin(ry); [x, z] = [x * cy - z * sy, x * sy + z * cy];
  const cx = Math.cos(rx), sx = Math.sin(rx); [y, z] = [y * cx + z * sx, -y * sx + z * cx];
  const cz = Math.cos(rz), sz = Math.sin(rz); [x, y] = [x * cz + y * sz, -x * sz + y * cz];
  return [x, y, z];
}
function rayOrientedBox(o: V3, dir: V3, center: V3, rot: V3, half: V3): number | null {
  const lo = rotEulerInv(sub(o, center), rot[0], rot[1], rot[2]);
  const ld = rotEulerInv(dir, rot[0], rot[1], rot[2]);
  let tMin = -Infinity, tMax = Infinity;
  for (let a = 0; a < 3; a++) {
    const h = half[a], od = lo[a], dd = ld[a];
    if (Math.abs(dd) < 1e-8) { if (od < -h || od > h) return null; continue; }
    let t1 = (-h - od) / dd, t2 = (h - od) / dd;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMax < 0 ? null : (tMin >= 0 ? tMin : tMax);
}
function rayCoverT(o: V3, dir: V3, c: Cover): number | null {
  return rayOrientedBox(o, dir, [c.x, c.top / 2, c.z], [0, 0, 0], [c.halfX, c.top / 2, c.halfZ]);
}
function segmentClear(a: V3, b: V3): boolean {
  const d = sub(b, a), L = len(d);
  if (L < 1e-5) return true;
  const dir: V3 = [d[0] / L, d[1] / L, d[2] / L];
  for (const c of COVER) { const t = rayCoverT(a, dir, c); if (t != null && t > 0.01 && t < L - 0.01) return false; }
  return true;
}

// NPCs are FULL figures, same humanoid system as the player — just different
// individuals (own face/outfit per seed). The player figure is the substrate's
// (live, on a dyn slot); NPC figures render with FigureMeshes `intern` so their
// geometry goes in the big retained buffer, NOT the scarce 48-slot live-sculpt
// pool (that pool starving is what dropped the player's head, not a real limit).
type Figure = { doc: ReturnType<typeof GAME_FIGURE.generateFace>; parts: ReturnType<typeof buildPartRender>; cartKey: string };
function makeFigure(seed: number, cartKey: string): Figure {
  const doc = GAME_FIGURE.generateFace(seed);
  return { doc, parts: buildPartRender(doc, GAME_FIGURE.hedDepthGrid(doc), cartKey, seed), cartKey };
}

// ── NPCs ───────────────────────────────────────────────────────────────────────
type Npc = {
  id: string; kind: NpcKind; x: number; z: number; yaw: number; gait: number; moving: boolean;
  hp: number; maxHp: number; dead: boolean; perceiver: Perceiver; fireCooldown: number;
};
const ROSTER: Array<{ kind: NpcKind; x: number; z: number; yaw: number; seed: number }> = [
  { kind: 'thug', x: -7, z: -13, yaw: 0, seed: 7001 },
  { kind: 'police', x: 8, z: -14, yaw: 0, seed: 7002 },
  { kind: 'civilian', x: -13, z: -7, yaw: 90, seed: 7003 },
  { kind: 'paramedic', x: 12, z: -5, yaw: -90, seed: 7004 },
];
function spawnNpcs(): Npc[] {
  return ROSTER.map((s) => {
    const def = GAME_KINDS.npcs.get(s.kind);
    return { id: `${s.kind}-${s.seed}`, kind: s.kind, x: s.x, z: s.z, yaw: s.yaw, gait: 0, moving: false, hp: def.maxHealth, maxHp: def.maxHealth, dead: false, perceiver: GAME_PERCEPTION.calmPerceiver(), fireCooldown: 0 };
  });
}

type Fx = { id: number; a: V3; b: V3; hit: boolean; until: number };
const FX_SECONDS = 0.09;

const ZONES: ZoneId[] = ['head', 'torso', 'lArm', 'rArm', 'lLeg', 'rLeg'];
function fullHp(): Record<ZoneId, number> { return { head: 100, torso: 100, lArm: 100, rArm: 100, lLeg: 100, rLeg: 100 }; }

// ── the lab ──────────────────────────────────────────────────────────────────
export default function CombatArena() {
  const [weapon, setWeapon] = useState(1);
  const [showCones, setShowCones] = useState(true);
  const [showHitboxes, setShowHitboxes] = useState(false);
  const rerender = useRerender();

  const uiRef = useRef({ weapon });
  uiRef.current = { weapon };

  // one distinct figure per NPC, built once (own face/outfit). Interned, so no
  // dyn-slot pressure — the player keeps its (live) figure.
  const npcFigs = useMemo(() => ROSTER.map((r, i) => makeFigure(r.seed, `hmscint.combatarena.npc${i}`)), []);

  // combat state in refs — the substrate owns the loop; we mutate here in onFrame.
  const npcsRef = useRef<Npc[]>(spawnNpcs());
  const fxRef = useRef<Fx[]>([]);
  const fxIdRef = useRef(1);
  const noisesRef = useRef<Noise[]>([]);
  const hpRef = useRef<Record<ZoneId, number>>(fullHp());
  const deadRef = useRef(false);
  const logRef = useRef<string[]>([]);
  const footClockRef = useRef(0);
  const lastTRef = useRef(GAME_LOOP.now());
  const prevGroundedRef = useRef(true);
  const prevVyRef = useRef(0);
  const prevLeftRef = useRef(false);
  const fireCdRef = useRef(0);
  const renderGateRef = useRef(0);

  const log = (line: string) => { logRef.current = [line, ...logRef.current].slice(0, 7); };

  // a minimal flat arena: the real default world stripped to its chunk floor
  // (the game's own ground), no city clutter; stairs/cover come as extra solids.
  const arena = useMemo<GameState>(() => {
    const base = createInitialGameState();
    return {
      ...base,
      sceneStep: 'lab.aim',
      player: { ...base.player, position: { x: 0.5, y: 0, z: 9 }, yawDegrees: 180 },
      world: { ...base.world, roads: [], junctions: [], props: [], buildings: [], landforms: [], waterBodies: [], zones: [], spawnedEntities: {}, npcs: {} },
    };
  }, []);
  const solids = useMemo(() => arenaSolids(), []);
  const worldExtras = useMemo(() => ({ solids: { rects: solids, orientedRects: [] as OrientedCollisionRect[] } }), [solids]);

  // the combat tick runs after the substrate's movement step, reading the REAL
  // player pose. Indirection so the embodied options never change identity.
  const tickRef = useRef<() => void>(() => {});
  const embodied = useEmbodiedPlayer({
    state: arena,
    figureCartKey: 'hmscint.combatarena.player',
    logTag: '[combat-arena]',
    aim: true,
    worldExtras,
    // crash-proof: a thrown combat frame must not kill the substrate's loop.
    onFrame: () => { try { tickRef.current(); } catch (e) { console.error('[combat-arena] tick threw', e); } },
  });

  const combatTick = () => {
    const now = GAME_LOOP.now();
    const dt = clamp((now - lastTRef.current) / 1000, 0.001, 0.05);
    lastTRef.current = now;
    const nowS = now / 1000;
    const p = embodied.playerRef.current;
    const look = embodied.lookRef.current;
    const ptr = GAME_INPUT.readPointer();
    const aiming = embodied.mouseCaptured && ptr.rightDown && !deadRef.current;
    const w = WEAPONS[uiRef.current.weapon];

    // ── FALL DAMAGE off the airborne→grounded transition (real host physics) ──
    if (!prevGroundedRef.current && p.grounded && !deadRef.current) {
      const impact = -prevVyRef.current;
      if (impact > FALL.safeSpeed) {
        const raw = (impact - FALL.safeSpeed) * FALL.perSpeed * (impact >= FALL.lethalSpeed ? 3 : 1);
        applyZone('lLeg', raw * 0.3); applyZone('rLeg', raw * 0.3); applyZone('torso', raw * 0.4);
        log(`fell ${impact.toFixed(1)} m/s → ${Math.round(raw)} dmg`);
        checkDeath();
      }
    }
    prevGroundedRef.current = p.grounded;
    prevVyRef.current = p.vy;

    // ── footstep noise on a cadence (perception hearing) ─────────────────────
    const moveMode: 'run' | 'walk' = p.running ? 'run' : 'walk';
    const fresh: Noise[] = [];
    footClockRef.current += dt;
    if (p.moving && p.grounded && footClockRef.current >= GAME_PERCEPTION.footstepCadenceSeconds(moveMode)) {
      footClockRef.current = 0;
      fresh.push(GAME_PERCEPTION.footstepNoise(moveMode, { x: p.x, z: p.z }, 0.7));
    }

    // ── PLAYER FIRE: a geometric ray (skill, not dice) ───────────────────────
    const fireEdge = ptr.leftDown && (w.auto ? true : !prevLeftRef.current);
    prevLeftRef.current = ptr.leftDown;
    if (aiming && fireEdge && !deadRef.current && nowS >= fireCdRef.current) {
      fireCdRef.current = nowS + w.cooldownSeconds;
      playerFire(p, look, w, nowS, fresh);
    }

    // ── NPCs: perceive → decide → maybe fire ─────────────────────────────────
    const playerBones = playerBoneWorld(p);
    const heardBus = noisesRef.current;
    for (const npc of npcsRef.current) { if (!npc.dead) stepNpc(npc, p, aiming, playerBones, heardBus, dt, nowS, fresh); }

    fxRef.current = fxRef.current.filter((f) => f.until > nowS);
    noisesRef.current = fresh;

    // re-render at ~30Hz (NPCs/fx); the player figure re-renders via the substrate.
    renderGateRef.current++;
    if ((renderGateRef.current & 1) === 0) rerender();
  };
  tickRef.current = combatTick;

  function applyZone(zone: ZoneId, dmg: number) { hpRef.current[zone] = Math.max(0, hpRef.current[zone] - dmg); }
  function checkDeath() { if (hpRef.current.head <= 0 || hpRef.current.torso <= 0) deadRef.current = true; }

  function playerBoneWorld(p: PlayerPose): Record<string, V3> {
    const rig = GAME_FIGURE.buildRigFrame('neutral', p.moving ? 'walk' : 'stand', p.gaitPhase, []);
    const out: Record<string, V3> = {};
    for (const hb of rig.hitboxes) out[hb.id] = place(hb.position, p.yaw, [p.x, p.y, p.z]);
    return out;
  }

  function playerFire(p: PlayerPose, look: { yaw: number; pitch: number }, w: Weapon, nowS: number, fresh: Noise[]) {
    // THE CROSSHAIR RAY comes from the HOST — the Zig side owns the camera solve
    // (V23), so its resolved optical axis is the only honest "what's under the
    // crosshair". JS deriving a direction from yaw/pitch diverges from the real
    // camera (that was the diagonal-bullets bug). Fallback to the game's own
    // orientation mapping when the host binding isn't built yet.
    const hostRay = GAME_NATIVE_CAMERA.activeRay();
    const origin: V3 = hostRay ? hostRay.origin : [p.x, p.y + EYE_HEIGHT, p.z];
    const dir: V3 = hostRay
      ? normalize(hostRay.dir)
      : aimForward(GAME_CAMERA.orientation.figureYawForCameraYaw(look.yaw), GAME_CAMERA.orientation.orbitPitchToAimPitch(look.pitch));
    const muzzle: V3 = [p.x, p.y + EYE_HEIGHT, p.z]; // tracer starts at the player, not the camera
    const reach = w.ranged ? (w.profile?.maxRange ?? 40) : GAME_CHANCE.tuning.meleeReachMeters;
    let blockT = Infinity;
    for (const c of COVER) { const t = rayCoverT(origin, dir, c); if (t != null && t > 0 && t < blockT) blockT = t; }
    let best: { npc: Npc; t: number; bone: BoneId } | null = null;
    for (const npc of npcsRef.current) {
      if (npc.dead) continue;
      const rig = GAME_FIGURE.buildRigFrame('neutral', npc.moving ? 'walk' : 'stand', npc.gait, []);
      for (const hb of rig.hitboxes) {
        const center = place(hb.position, npc.yaw, [npc.x, 0, npc.z]);
        const rot: V3 = [hb.rotation[0] * DEG, (hb.rotation[1] + npc.yaw) * DEG, hb.rotation[2] * DEG];
        const t = rayOrientedBox(origin, dir, center, rot, [hb.size[0] / 2, hb.size[1] / 2, hb.size[2] / 2]);
        if (t != null && t > 0 && t <= reach && t < blockT && (!best || t < best.t)) best = { npc, t, bone: hb.id };
      }
    }
    const dist = best ? best.t : reach;
    const hit: V3 = [origin[0] + dir[0] * dist, origin[1] + dir[1] * dist, origin[2] + dir[2] * dist];
    fxRef.current.push({ id: fxIdRef.current++, a: muzzle, b: hit, hit: !!best, until: nowS + FX_SECONDS });
    if (w.ranged) fresh.push(GAME_PERCEPTION.gunshotNoise({ x: p.x, z: p.z }));
    if (best) {
      const zone = GAME_FIGURE.damageZoneForBone(best.bone);
      const dmg = w.damage * ZONE_MULT[zone];
      best.npc.hp = Math.max(0, best.npc.hp - dmg);
      const def = GAME_KINDS.npcs.get(best.npc.kind);
      best.npc.perceiver = GAME_PERCEPTION.step(best.npc.perceiver, { damage: { position: { x: p.x, z: p.z } }, dtSeconds: 0, nowSeconds: nowS }, { profile: def.perception, canFight: def.canFight }).state;
      if (best.npc.hp <= 0) best.npc.dead = true;
      log(`${best.npc.kind} ${zone} −${Math.round(dmg)}${best.npc.dead ? ' DOWN' : ''}`);
    } else log(`${w.label} ${w.ranged ? 'miss' : 'whiff'}`);
  }

  function stepNpc(npc: Npc, p: PlayerPose, aiming: boolean, playerBones: Record<string, V3>, bus: Noise[], dt: number, nowS: number, fresh: Noise[]) {
    const def = GAME_KINDS.npcs.get(npc.kind);
    const eye: V3 = [npc.x, 1.5, npc.z];
    const cone = GAME_PERCEPTION.inVisionCone({ position: { x: npc.x, z: npc.z }, headingDegrees: npc.yaw + 180 }, { x: p.x, z: p.z }, def.perception);
    let sight: Parameters<typeof GAME_PERCEPTION.step>[1]['sight'] = null;
    if (cone.inCone && !deadRef.current) {
      const samples = GAME_CHANCE.coverSampleSpec.map((s) => {
        const bone = playerBones[s.bone] ?? [p.x, p.y + 1, p.z];
        return { clear: segmentClear(eye, [bone[0], bone[1] + s.liftMeters, bone[2]]) };
      });
      sight = { visible: cone.inCone, exposure: 1 - GAME_CHANCE.coverFractionFromSamples(samples), rangeMeters: cone.rangeMeters, position: { x: p.x, z: p.z } };
    }
    const heard = bus.filter((n) => GAME_PERCEPTION.noiseAudible(n, { x: npc.x, z: npc.z }, def.perception.hearingAcuity));
    npc.perceiver = GAME_PERCEPTION.step(npc.perceiver, { sight, noises: heard, dtSeconds: dt, nowSeconds: nowS }, { profile: def.perception, canFight: def.canFight }).state;

    const mode = npc.perceiver.mode;
    const target = npc.perceiver.lastKnown ?? npc.perceiver.stimulus;
    npc.moving = false;
    if ((mode === 'hostile' || mode === 'alert') && target) {
      npc.yaw = Math.atan2(-(target.x - npc.x), -(target.z - npc.z)) / DEG;
      const range = mode === 'hostile' ? Math.min(def.perception.visionRangeMeters * 0.7, NPC_PROFILE.optimalRange + 4) : 1.5;
      if (Math.hypot(target.x - npc.x, target.z - npc.z) > range) advance(npc, target.x, target.z, mode === 'hostile' ? def.runSpeedMetersPerSecond : def.walkSpeedMetersPerSecond, dt);
    } else if (mode === 'panic' && target) {
      npc.yaw = Math.atan2(target.x - npc.x, target.z - npc.z) / DEG;
      advance(npc, npc.x - (target.x - npc.x), npc.z - (target.z - npc.z), def.runSpeedMetersPerSecond, dt);
    } else if (mode === 'spooked' && npc.perceiver.stimulus) {
      npc.yaw = Math.atan2(-(npc.perceiver.stimulus.x - npc.x), -(npc.perceiver.stimulus.z - npc.z)) / DEG;
    }
    if (npc.moving) npc.gait += dt * 2.4;

    npc.fireCooldown -= dt;
    if (mode === 'hostile' && def.canFight && sight && sight.exposure > 0.12 && npc.fireCooldown <= 0 && !deadRef.current) {
      npc.fireCooldown = 0.5 + (1 - (SHOOTER_SKILL[npc.kind] ?? 0.4)) * 0.8;
      npcFire(npc, def, sight, p, aiming, nowS, fresh);
    }
  }

  function advance(npc: Npc, tx: number, tz: number, speed: number, dt: number) {
    const dx = tx - npc.x, dz = tz - npc.z, L = Math.hypot(dx, dz);
    if (L < 1e-3) return;
    const nx = npc.x + (dx / L) * speed * dt, nz = npc.z + (dz / L) * speed * dt;
    if (!insideCover(nx, nz)) { npc.x = nx; npc.z = nz; npc.moving = true; }
  }
  function insideCover(x: number, z: number): boolean {
    for (const c of COVER) if (Math.abs(x - c.x) < c.halfX + 0.4 && Math.abs(z - c.z) < c.halfZ + 0.4) return true;
    return false;
  }
  function npcFire(npc: Npc, def: ReturnType<typeof GAME_KINDS.npcs.get>, sight: NonNullable<Parameters<typeof GAME_PERCEPTION.step>[1]['sight']>, p: PlayerPose, aiming: boolean, nowS: number, fresh: Noise[]) {
    const breakdown = GAME_CHANCE.attackChance({
      profile: NPC_PROFILE, ranged: true, distanceMeters: sight.rangeMeters, los: 'clear',
      coverFraction: 1 - sight.exposure, shooter: { skill01: SHOOTER_SKILL[npc.kind] ?? 0.4, health01: npc.hp / npc.maxHp, hour: 12, awareness: aiming ? 'alert' : 'unaware' },
    });
    fresh.push(GAME_PERCEPTION.gunshotNoise({ x: npc.x, z: npc.z }));
    const eye: V3 = [npc.x, 1.5, npc.z];
    const center: V3 = [p.x, p.y + 1, p.z];
    if (GAME_CHANCE.rollHit(breakdown.final)) {
      const zone = CHANCE_ZONE_TO_RIG[GAME_CHANCE.rollZone()];
      const dmg = def.weaponDamage * ZONE_MULT[zone];
      applyZone(zone, dmg);
      fxRef.current.push({ id: fxIdRef.current++, a: eye, b: center, hit: true, until: nowS + FX_SECONDS });
      log(`${npc.kind} → you ${zone} −${Math.round(dmg)} (${Math.round(breakdown.final * 100)}%)`);
      checkDeath();
    } else {
      fxRef.current.push({ id: fxIdRef.current++, a: eye, b: [center[0] + 0.8, center[1] + 0.4, center[2] + 0.4], hit: false, until: nowS + FX_SECONDS });
    }
  }

  const resetArena = () => {
    npcsRef.current = spawnNpcs();
    fxRef.current = []; logRef.current = []; hpRef.current = fullHp(); deadRef.current = false;
    fireCdRef.current = 0;
    embodied.resetPlayer();
    rerender();
  };

  // ── render ──────────────────────────────────────────────────────────────────
  const nowS = GAME_LOOP.now() / 1000;
  const npcs = npcsRef.current;
  const hp = hpRef.current;
  const aimingNow = embodied.mouseCaptured && GAME_INPUT.readPointer().rightDown && !deadRef.current;

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      {/* ── left: the bench ──────────────────────────────────────────────────── */}
      <Col style={{ width: 232, height: '100%', backgroundColor: PANEL, padding: 12 }}>
        <Text style={{ color: INK, fontSize: 15 }}>combat arena</Text>
        <Text style={{ color: DIM, fontSize: 10, marginBottom: 10 }}>real player · fall · LoS · aim · NPCs</Text>

        <Text style={{ color: DIM, fontSize: 10, marginBottom: 4 }}>WEAPON</Text>
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
          {WEAPONS.map((wp, i) => (
            <Pressable key={wp.id} onPress={() => setWeapon(i)}>
              <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, marginRight: 4, marginBottom: 4, borderRadius: 5, backgroundColor: i === weapon ? '#16345a' : '#10203a' }}>
                <Text style={{ color: i === weapon ? ACCENT : DIM, fontSize: 11 }}>{wp.label}</Text>
              </Box>
            </Pressable>
          ))}
        </Box>

        <Text style={{ color: DIM, fontSize: 10, marginBottom: 4 }}>BODY · damage zones</Text>
        {ZONES.map((z) => (
          <Row key={z} style={{ alignItems: 'center', marginBottom: 3 }}>
            <Text style={{ color: DIM, fontSize: 10, width: 42 }}>{z}</Text>
            <Box style={{ flexGrow: 1, height: 8, borderRadius: 4, backgroundColor: '#10203a', overflow: 'hidden' }}>
              <Box style={{ width: `${clamp(hp[z], 0, 100)}%`, height: '100%', backgroundColor: hpColor(hp[z]) }} />
            </Box>
            <Text style={{ color: FAINT, fontSize: 9, width: 26, textAlign: 'right' }}>{Math.max(0, Math.round(hp[z]))}</Text>
          </Row>
        ))}

        <Row style={{ marginTop: 10 }}>
          <Toggle label="cones (V)" on={showCones} onTap={() => setShowCones((v) => !v)} />
          <Toggle label="hitbox (B)" on={showHitboxes} onTap={() => setShowHitboxes((v) => !v)} />
        </Row>

        <Box style={{ flexGrow: 1 }} />
        <Pressable onPress={resetArena}>
          <Box style={{ padding: 8, borderRadius: 6, backgroundColor: '#16345a', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: ACCENT, fontSize: 12 }}>reset arena</Text>
          </Box>
        </Pressable>
        <Text style={{ color: DIM, fontSize: 10 }}>click scene to capture · Esc release</Text>
        <Text style={{ color: DIM, fontSize: 10 }}>WASD move · Shift run · Space jump</Text>
        <Text style={{ color: DIM, fontSize: 10 }}>climb the stairs east, walk off → fall</Text>
        <Text style={{ color: DIM, fontSize: 10 }}>RMB aim · LMB fire</Text>
        {!GAME_INPUT.availability().complete ? <Text style={{ color: '#fbbf24', fontSize: 9, marginTop: 4 }}>pointer wire absent — mouse aim inert</Text> : null}
      </Col>

      {/* ── right: the arena (the REAL embodied scene) ───────────────────────── */}
      <Box style={{ flexGrow: 1, height: '100%', position: 'relative' }}>
        <EmbodiedScene embodied={embodied}>
          {/* a safety floor under the world's chunk floor so figures never float */}
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} material="#0e1a28" position={[0, -0.2, 0]} scale={[200, 0.2, 200]} />
          {/* stairs + ledge (the fall test) */}
          {solids.filter((r) => r.blocksPlayer).map((r, i) => (
            <Scene3D.Mesh key={`solid-${i}`} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }}
              material={i < STEP_N ? '#26344a' : '#2f3f5a'}
              position={[(r.minX + r.maxX) / 2, (r.floorMeters ?? 0) / 2 + r.topMeters / 2, (r.minZ + r.maxZ) / 2]}
              scale={[r.maxX - r.minX, Math.max(0.1, r.topMeters - (r.floorMeters ?? 0)), r.maxZ - r.minZ]} />
          ))}
          {/* cover (the rendered box IS the LoS occluder + the collider) */}
          {COVER.map((c, i) => (
            <Scene3D.Mesh key={`cover-${i}`} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} material={c.tone} position={[c.x, c.top / 2, c.z]} scale={[c.halfX * 2, c.top, c.halfZ * 2]} />
          ))}
          {/* NPCs: full distinct figures (interned — no dyn slots). Fixed-shape:
              dead ones stay mounted, laid down. */}
          {npcs.map((npc, i) => (
            <NpcFigure key={npc.id} parts={npcFigs[i].parts} x={npc.x} z={npc.z} yaw={npc.yaw} gait={npc.gait} dead={npc.dead} moving={npc.moving} showHitbox={showHitboxes} />
          ))}
          {/* player hitboxes on toggle (the player FIGURE is the substrate's) */}
          {showHitboxes ? <HitboxMeshes rig={embodied.rig} yawDeg={embodied.player.yaw} offset={embodied.figureOffset} tone="#38bdf8" /> : null}
          {/* FoV cones — fixed-length (one slot per npc, null when off/dead) */}
          {npcs.map((npc) => (showCones && !npc.dead ? <ConeMesh key={`cone-${npc.id}`} x={npc.x} z={npc.z} yaw={npc.yaw} mode={npc.perceiver.mode} /> : null))}
          {/* the ONE variable-length list, dead last (reconciler sibling-shift) */}
          {fxRef.current.map((f) => <TracerMesh key={f.id} fx={f} />)}
        </EmbodiedScene>

        <EmbodiedMouseSurface embodied={embodied} />

        {/* crosshair while aiming — absolute children consume left/top RAW, NOT
            % (left:'50%' pins to the corner — the bug you saw). Center it with a
            full-area flex box instead. */}
        {aimingNow ? (
          <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Box style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.85)' }} />
          </Box>
        ) : null}

        {/* perception readout */}
        <Box style={{ position: 'absolute', right: 12, top: 12, width: 190, padding: 10, borderRadius: 8, backgroundColor: 'rgba(8,14,24,0.8)' }}>
          <Text style={{ color: DIM, fontSize: 10, marginBottom: 4 }}>PERCEPTION</Text>
          {npcs.map((npc) => (
            <Row key={`susp-${npc.id}`} style={{ alignItems: 'center', marginBottom: 3 }}>
              <Text style={{ color: npc.dead ? FAINT : INK, fontSize: 10, width: 58 }}>{npc.kind}</Text>
              <Box style={{ flexGrow: 1, height: 7, borderRadius: 4, backgroundColor: '#10203a', overflow: 'hidden' }}>
                <Box style={{ width: `${Math.round(npc.perceiver.suspicion * 100)}%`, height: '100%', backgroundColor: modeColor(npc.perceiver.mode) }} />
              </Box>
              <Text style={{ color: modeColor(npc.perceiver.mode), fontSize: 8, width: 44, textAlign: 'right' }}>{npc.dead ? 'down' : npc.perceiver.mode}</Text>
            </Row>
          ))}
        </Box>

        {/* shot / fall log */}
        <Box style={{ position: 'absolute', left: 12, bottom: 12, minWidth: 240, padding: 10, borderRadius: 8, backgroundColor: 'rgba(8,14,24,0.78)' }}>
          {logRef.current.length === 0 ? <Text style={{ color: FAINT, fontSize: 10 }}>aim (RMB) + fire (LMB), or climb east and fall off</Text> : null}
          {logRef.current.map((line, i) => <Text key={i} style={{ color: i === 0 ? INK : DIM, fontSize: 10, fontFamily: 'monospace' }}>{line}</Text>)}
        </Box>

        {deadRef.current ? (
          <Box style={{ position: 'absolute', left: 0, right: 0, top: 24, alignItems: 'center' }}>
            <Box style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8, borderRadius: 8, backgroundColor: 'rgba(120,20,20,0.85)' }}>
              <Text style={{ color: '#fee2e2', fontSize: 14, fontFamily: 'monospace' }}>DOWN — reset the arena</Text>
            </Box>
          </Box>
        ) : null}
      </Box>

      {/* the player's face/skin captures (from the substrate) + one per NPC */}
      <EmbodiedCaptures embodied={embodied} />
      {npcFigs.map((f) => (
        <CharacterCaptures key={`cap-${f.cartKey}`} headTexKey={f.parts.head.texKey} skinTexKey={f.parts.torso.texKey} skin={f.doc.skin} layers={f.doc.layers} />
      ))}
    </Row>
  );
}

// ── render pieces ─────────────────────────────────────────────────────────────
const UNIT_CYL = { radius: 1, height: 1, segments: 8 };
const UNIT_BOX = { width: 1, height: 1, depth: 1 };

// A full distinct figure — same humanoid system as the player. `intern` keeps it
// off the live-sculpt dyn pool (the player owns that). Dead NPCs lie down (the
// rig carries the 'lay' action) and stay mounted (no sibling shift).
//
// MEMO'd on primitive props + the rig built INSIDE on a memo: an NPC that isn't
// moving costs nothing per frame (props equal → skipped; rig not rebuilt). Only
// NPCs whose pose actually changed re-diff. (The deep cost is still per-frame
// rig eval through the reconciler — the editor-preview path. Smooth multi-figure
// combat is the compiled Zig loader's job, not React's.)
const NpcFigure = memo(function NpcFigure(props: {
  parts: ReturnType<typeof buildPartRender>; x: number; z: number; yaw: number; gait: number; dead: boolean; moving: boolean; showHitbox: boolean;
}) {
  const rig = useMemo(
    () => GAME_FIGURE.buildRigFrame('neutral', props.dead ? 'stand' : props.moving ? 'walk' : 'stand', props.gait, props.dead ? [{ target: 'body', action: 'lay', phase: 1, weight: 1 } as any] : []),
    [props.dead, props.moving, props.gait],
  );
  const offset: V3 = [props.x, props.dead ? 0.2 : 0, props.z];
  return (
    <>
      <FigureMeshes rig={rig} parts={props.parts} yawDeg={props.yaw} offset={offset} intern />
      {props.showHitbox && !props.dead ? <HitboxMeshes rig={rig} yawDeg={props.yaw} offset={offset} tone="#fbbf24" /> : null}
    </>
  );
});

function HitboxMeshes(props: { rig: RigFrame; yawDeg: number; offset: V3; tone: string }) {
  return (
    <>
      {props.rig.hitboxes.map((hb, i) => (
        <Scene3D.Mesh key={`hb-${i}`} geometry={Geometry.Box} params={UNIT_BOX} material={{ color: props.tone, opacity: 0.24 } as any}
          position={place(hb.position, props.yawDeg, props.offset)}
          rotation={[hb.rotation[0], hb.rotation[1] + props.yawDeg, hb.rotation[2]]} scale={[hb.size[0], hb.size[1], hb.size[2]]} />
      ))}
    </>
  );
}

function TracerMesh(props: { fx: Fx }) {
  const { a, b, hit } = props.fx;
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const d = sub(b, a), L = Math.max(1e-3, len(d));
  const yaw = Math.atan2(d[0], d[2]) / DEG;
  const pitch = Math.asin(clamp(d[1] / L, -1, 1)) / DEG;
  return <Scene3D.Mesh geometry={Geometry.Cylinder} params={UNIT_CYL} material={hit ? '#fca5a5' : '#fde68a'} position={mid} rotation={[90 - pitch, yaw, 0]} scale={[0.03, L, 0.03]} />;
}

function ConeMesh(props: { x: number; z: number; yaw: number; mode: Awareness }) {
  // The cone must point where the FIGURE faces (its front is -Z at yaw 0, i.e.
  // [-sin yaw, -cos yaw]) — the same direction inVisionCone checks. Using
  // yaw+180 put the cone BEHIND the NPC (the backwards bug).
  const fx = -Math.sin(props.yaw * DEG), fz = -Math.cos(props.yaw * DEG);
  return (
    <Scene3D.Mesh geometry={Geometry.Cone} params={{ radius: 1, height: 1, segments: 4 } as any} material={{ color: modeColor(props.mode), opacity: 0.14 } as any}
      position={[props.x + fx * 4, 0.1, props.z + fz * 4]}
      rotation={[90, props.yaw, 0]} scale={[3.2, 8, 0.2]} />
  );
}

function Toggle(props: { label: string; on: boolean; onTap: () => void }) {
  return (
    <Pressable onPress={props.onTap}>
      <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, marginRight: 6, borderRadius: 5, backgroundColor: props.on ? '#16345a' : '#10203a' }}>
        <Text style={{ color: props.on ? ACCENT : DIM, fontSize: 10 }}>{props.label}</Text>
      </Box>
    </Pressable>
  );
}

// ── color helpers ──────────────────────────────────────────────────────────────
function hpColor(hp: number): string {
  const t = clamp(hp / 100, 0, 1);
  return t > 0.5 ? mix('#f59e0b', '#34d399', (t - 0.5) / 0.5) : mix('#ef4444', '#f59e0b', t / 0.5);
}
function modeColor(mode: Awareness): string {
  switch (mode) {
    case 'calm': return '#4ade80';
    case 'spooked': return '#facc15';
    case 'alert': return '#fb923c';
    case 'hostile': return '#ef4444';
    case 'panic': return '#a78bfa';
    case 'notify': return '#38bdf8';
    default: return '#7e93b4';
  }
}
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const k = clamp(t, 0, 1);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * k);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * k);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * k);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}
