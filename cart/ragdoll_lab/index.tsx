// ragdoll_lab — body physics + hitbox damage for the head_lab figure.
//
// The question this lab answers: when something hits the body, WHERE did it
// hit, HOW hard, and what does the body do about it. Three systems compose:
//
//   1. hitboxes — head_lab's per-bone hitboxes (BodyRigFrame.hitboxes) are
//      the damage surface. The car's box is tested against every bone's box;
//      each overlapped bone maps to a damage REGION (head/torso/arms/legs)
//      and to the ragdoll JOINTS it kicks. Hitboxes render tinted by their
//      region's remaining HP and flash white on the frame they're struck.
//   2. ragdoll — head_lab/ragdoll.ts, the Verlet particle skeleton. On impact
//      the live animated pose seeds the particles (mid-stride handoff), the
//      car's velocity becomes joint impulses, and bonesFromRagdoll rebuilds a
//      bones record every frame — so the WHOLE dressed figure (parts, joint
//      sockets, clothing) tumbles through parts.ts buildRigFrameFromBones.
//   3. recovery — when the body comes to rest (and isn't K.O.), the settled
//      pose blends back to standing where it landed, and animation resumes.
//
// Try: LAUNCH CAR (l) · UPPERCUT (u) · TRIP (t) · HEAL (h) · RESET (r).
// Drag the scene to orbit. Auto slow-mo kicks in on impact.
//
// Ship: ./scripts/ship ragdoll_lab      Dev: ./scripts/dev ragdoll_lab

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Row, Pressable, Text, Scene3D } from '@reactjit/runtime/primitives';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import * as Geometry from '@reactjit/geometries';
import { OrbitCamera } from '@reactjit/cameras';
import { buildRigFrameFromBones, buildSkeleton, type BoneId, type SkeletonBone } from '../head_lab/parts';
import {
  createRagdoll, stepRagdoll, ragdollImpulse, ragdollMaxMotion, ragdollCenter, bonesFromRagdoll,
  offsetBones, blendBones,
  type JointId, type Ragdoll, type V3,
} from '../head_lab/ragdoll';
import { generateFace, hedDepthGrid } from '../head_lab/hed';
import { buildPartRender, CharacterCaptures, FigureMeshes } from '../head_lab/figureRender';
import { CarMeshes } from './car';

const BG = '#0b1018';
const INK = '#e8eef8';
const DIM = '#7f93b1';
const GOOD = '#34d399';
const WARN = '#f59e0b';
const BAD = '#ef4444';

const MIN_KMH = 15;
const MAX_KMH = 110;
const RECOVER_SECONDS = 0.85;
const SETTLE_MOTION = 0.0025; // max joint move per step that counts as "at rest"
const SETTLE_TICKS = 55;
const SLOMO_SCALE = 0.22;
const SLOMO_SECONDS = 1.1;

// ── damage model ─────────────────────────────────────────────────────────────

type Region = 'head' | 'torso' | 'lArm' | 'rArm' | 'lLeg' | 'rLeg';
const REGIONS: Region[] = ['head', 'torso', 'lArm', 'rArm', 'lLeg', 'rLeg'];
const REGION_LABEL: Record<Region, string> = {
  head: 'HEAD', torso: 'TORSO', lArm: 'L ARM', rArm: 'R ARM', lLeg: 'L LEG', rLeg: 'R LEG',
};
// damage = impact speed (m/s) × region multiplier — the head is the soft spot
const REGION_MULT: Record<Region, number> = { head: 1.7, torso: 1.0, lArm: 0.65, rArm: 0.65, lLeg: 0.8, rLeg: 0.8 };

const ARM_MARKS = ['Shoulder', 'UpperArm', 'Elbow', 'Forearm', 'Wrist', 'Hand'];
function boneRegion(b: BoneId): Region {
  if (b === 'head') return 'head';
  if (b === 'torso' || b === 'pelvis' || b === 'lHip' || b === 'rHip') return 'torso';
  const side = b.startsWith('l') ? 'l' : 'r';
  return ARM_MARKS.some((m) => b.includes(m)) ? (`${side}Arm` as Region) : (`${side}Leg` as Region);
}

// Which ragdoll joints a struck bone kicks.
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

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => {
    const va = (pa >> sh) & 0xff, vb = (pb >> sh) & 0xff;
    return Math.round(va + (vb - va) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
function hpColor(hp: number): string {
  const t = Math.max(0, Math.min(1, hp / 100));
  return t > 0.5 ? mixHex(WARN, GOOD, (t - 0.5) * 2) : mixHex(BAD, WARN, t * 2);
}

// ── bone-record helpers live in head_lab/ragdoll.ts (shared with pathing_lab)

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ── the car — model shared with pathing_lab (see ./car.tsx) ─────────────────

const CAR_HALF: V3 = [1.85, 0.7, 0.95]; // collision box half-extents (x-major lane)
const CAR_CENTER_Y = 0.7;

// ── sim state ────────────────────────────────────────────────────────────────

type Mode = 'anim' | 'ragdoll' | 'recover';

type Sim = {
  mode: Mode;
  animSeconds: number; // real-time clock (UI, flashes, slow-mo window)
  gaitPhase: number;
  origin: V3; // where the animated figure stands
  ragdoll: Ragdoll | null;
  settleTicks: number;
  recoverStart: number;
  recoverFrom: Record<BoneId, SkeletonBone> | null;
  recoverTarget: Record<BoneId, SkeletonBone> | null;
  car: { active: boolean; x: number; z: number; dir: 1 | -1; speed: number };
  regionsHit: Set<Region>; // damaged once per launch
  lastHitAt: Partial<Record<BoneId, number>>;
  sloMoUntil: number;
  hp: Record<Region, number>;
  log: string[];
  camTarget: V3;
  lastImpactKmh: number;
};

const fullHp = (): Record<Region, number> => ({ head: 100, torso: 100, lArm: 100, rArm: 100, lLeg: 100, rLeg: 100 });

function makeSim(): Sim {
  return {
    mode: 'anim',
    animSeconds: 0,
    gaitPhase: 0,
    origin: [0, 0, 0],
    ragdoll: null,
    settleTicks: 0,
    recoverStart: 0,
    recoverFrom: null,
    recoverTarget: null,
    car: { active: false, x: -18, z: 0, dir: 1, speed: 14 },
    regionsHit: new Set(),
    lastHitAt: {},
    sloMoUntil: -1,
    hp: fullHp(),
    log: [],
    camTarget: [0, 1.1, 0],
    lastImpactKmh: 0,
  };
}

// ── UI atoms (head_lab's lab chrome) ─────────────────────────────────────────

function Chip(props: { label: string; active?: boolean; color?: string; onPress: () => void }) {
  const color = props.color ?? '#3da9ff';
  return (
    <Pressable
      onPress={props.onPress}
      style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: props.active ? color : '#22324a', backgroundColor: props.active ? '#11263d' : '#101a2a' }}
    >
      <Text fontSize={12} color={props.active ? color : DIM}>{props.label}</Text>
    </Pressable>
  );
}

function Knob(props: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  const btn = { width: 24, height: 24, borderRadius: 5, borderWidth: 1, borderColor: '#22324a', backgroundColor: '#101a2a', alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <Row style={{ alignItems: 'center', gap: 6 }}>
      <Text fontSize={11} color={DIM} style={{ width: 78 }}>{props.label}</Text>
      <Pressable onPress={props.onMinus} style={btn}><Text fontSize={13} color={INK}>-</Text></Pressable>
      <Text fontSize={12} color={INK} style={{ width: 64, textAlign: 'center' }}>{props.value}</Text>
      <Pressable onPress={props.onPlus} style={btn}><Text fontSize={13} color={INK}>+</Text></Pressable>
    </Row>
  );
}

// The 2D twin of the 3D hitboxes: a body diagram whose regions wear their HP.
function DamageDiagram(props: { hp: Record<Region, number> }) {
  const region = (r: Region, style: any) => (
    <Box style={{ ...style, position: 'absolute', borderRadius: 4, backgroundColor: hpColor(props.hp[r]), opacity: props.hp[r] <= 0 ? 0.35 : 1 }} />
  );
  return (
    <Row style={{ gap: 12, alignItems: 'center' }}>
      <Box style={{ width: 92, height: 152, position: 'relative' }}>
        {region('head', { left: 33, top: 0, width: 26, height: 26 })}
        {region('torso', { left: 26, top: 30, width: 40, height: 56 })}
        {region('lArm', { left: 6, top: 32, width: 14, height: 52 })}
        {region('rArm', { left: 72, top: 32, width: 14, height: 52 })}
        {region('lLeg', { left: 28, top: 90, width: 15, height: 60 })}
        {region('rLeg', { left: 49, top: 90, width: 15, height: 60 })}
      </Box>
      <Col style={{ gap: 3 }}>
        {REGIONS.map((r) => (
          <Row key={r} style={{ gap: 6, alignItems: 'center' }}>
            <Text fontSize={10} color={DIM} style={{ width: 38 }}>{REGION_LABEL[r]}</Text>
            <Box style={{ width: 56, height: 7, borderRadius: 3, backgroundColor: '#101a2a', overflow: 'hidden' }}>
              <Box style={{ width: Math.max(0, props.hp[r]) * 0.56, height: 7, backgroundColor: hpColor(props.hp[r]) }} />
            </Box>
            <Text fontSize={10} color={props.hp[r] <= 0 ? BAD : INK} style={{ width: 30 }}>{`${Math.max(0, Math.round(props.hp[r]))}%`}</Text>
          </Row>
        ))}
      </Col>
    </Row>
  );
}

// ── the lab ──────────────────────────────────────────────────────────────────

const GROUND_PARAMS = { width: 34, height: 0.08, depth: 34 };
const ROAD_PARAMS = { width: 38, height: 0.05, depth: 4.2 };
const DASH_PARAMS = { width: 1.1, height: 0.02, depth: 0.14 };
const SEED = 4242;

export default function RagdollLab() {
  const [, setTick] = useState(0);
  const [yaw, setYaw] = useState(38);
  const [pitch, setPitch] = useState(16);
  const [dist, setDist] = useState(8.5);
  const [speedKmh, setSpeedKmh] = useState(50);
  const [walking, setWalking] = useState(true);
  const [showHitboxes, setShowHitboxes] = useState(true);
  const [autoSloMo, setAutoSloMo] = useState(true);

  const simRef = useRef<Sim>(makeSim());
  const lastBonesRef = useRef<Record<BoneId, SkeletonBone> | null>(null);
  const orbitRef = useRef<{ x: number; y: number } | null>(null);
  const lastDirRef = useRef<1 | -1>(1);
  const uiRef = useRef({ speedKmh, walking, autoSloMo });
  useEffect(() => { uiRef.current = { speedKmh, walking, autoSloMo }; }, [speedKmh, walking, autoSloMo]);

  const figure = useMemo(() => {
    const doc = generateFace(SEED, { style: 'masculine' });
    const faceDepth = hedDepthGrid(doc);
    return { doc, parts: buildPartRender(doc, faceDepth, 'ragdoll_lab', SEED) };
  }, []);

  // ── controls (also keyboard) ──────────────────────────────────────────────
  const launchCar = (dir?: 1 | -1) => {
    const s = simRef.current;
    const d = dir ?? (lastDirRef.current === 1 ? -1 : 1);
    lastDirRef.current = d;
    const bodyZ = s.mode === 'anim' ? s.origin[2] : (s.ragdoll ? ragdollCenter(s.ragdoll)[2] : s.origin[2]);
    s.car = { active: true, x: -d * 19, z: bodyZ, dir: d, speed: uiRef.current.speedKmh / 3.6 };
    s.regionsHit = new Set();
  };

  const enterRagdoll = () => {
    const s = simRef.current;
    if (s.mode === 'ragdoll' && s.ragdoll) return s.ragdoll;
    const bones = lastBonesRef.current ?? offsetBones(buildSkeleton('neutral', 'stand'), s.origin);
    s.ragdoll = createRagdoll(bones);
    s.mode = 'ragdoll';
    s.settleTicks = 0;
    return s.ragdoll;
  };

  const uppercut = () => {
    const s = simRef.current;
    const r = enterRagdoll();
    ragdollImpulse(r, 'head', [(Math.random() - 0.5) * 3, 8.5 + Math.random() * 2, (Math.random() - 0.5) * 3]);
    ragdollImpulse(r, 'chest', [0, 4.2, 0]);
    s.hp.head = Math.max(0, s.hp.head - 12);
    s.lastHitAt.head = s.animSeconds;
    s.log = [`HEAD -12 · uppercut`, ...s.log].slice(0, 6);
    if (uiRef.current.autoSloMo) s.sloMoUntil = s.animSeconds + SLOMO_SECONDS * 0.7;
  };

  const trip = () => {
    const r = enterRagdoll();
    const a = Math.random() * Math.PI * 2;
    ragdollImpulse(r, 'chest', [Math.cos(a) * 2.6, 1.4, Math.sin(a) * 2.6]);
    ragdollImpulse(r, 'lFoot', [Math.cos(a + 1) * 2, 0.6, Math.sin(a + 1) * 2]);
    ragdollImpulse(r, 'rFoot', [Math.cos(a - 1) * 2, 0.6, Math.sin(a - 1) * 2]);
  };

  const heal = () => {
    const s = simRef.current;
    s.hp = fullHp();
    s.log = ['healed — all regions 100%', ...s.log].slice(0, 6);
  };

  const resetAll = () => {
    simRef.current = makeSim();
    lastBonesRef.current = null;
  };

  const actionsRef = useRef({ launchCar, uppercut, trip, heal, resetAll });
  actionsRef.current = { launchCar, uppercut, trip, heal, resetAll };

  useEffect(() => {
    return busOn('__keydown', (event: any) => {
      const key = String(event?.key ?? '').toLowerCase();
      const a = actionsRef.current;
      if (key === 'l') a.launchCar();
      else if (key === 'u') a.uppercut();
      else if (key === 't') a.trip();
      else if (key === 'h') a.heal();
      else if (key === 'r') a.resetAll();
    });
  }, []);

  // ── the loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const host: any = globalThis;
    const schedule = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : (fn: any) => setTimeout(fn, 16);
    const cancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : clearTimeout;
    let handle: any = 0;
    let lastNow = host.performance?.now?.() ?? Date.now();

    const tick = () => {
      const now = host.performance?.now?.() ?? Date.now();
      const dtReal = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      const s = simRef.current;
      const ui = uiRef.current;
      s.animSeconds += dtReal;
      const dt = s.animSeconds < s.sloMoUntil ? dtReal * SLOMO_SCALE : dtReal;
      const ko = REGIONS.some((r) => s.hp[r] <= 0);

      // current world bones (collision surface + ragdoll seed + render source)
      let bones: Record<BoneId, SkeletonBone>;
      if (s.mode === 'ragdoll' && s.ragdoll) {
        bones = bonesFromRagdoll(s.ragdoll);
      } else if (s.mode === 'recover' && s.recoverFrom && s.recoverTarget) {
        const t = Math.min(1, (s.animSeconds - s.recoverStart) / RECOVER_SECONDS);
        bones = blendBones(s.recoverFrom, s.recoverTarget, t * t * (3 - 2 * t));
        if (t >= 1) s.mode = 'anim';
      } else {
        if (ui.walking) s.gaitPhase += 1.5 * dt;
        bones = offsetBones(buildSkeleton('neutral', ui.walking ? 'walk' : 'stand', s.gaitPhase % 1), s.origin);
      }
      lastBonesRef.current = bones;

      // car motion + per-bone hitbox collision
      if (s.car.active) {
        s.car.x += s.car.dir * s.car.speed * dt;
        if (Math.abs(s.car.x) > 21) s.car.active = false;

        const hits: BoneId[] = [];
        for (const id of Object.keys(bones) as BoneId[]) {
          const b = bones[id];
          const hx = b.hitbox[0] / 2 + 0.05, hy = b.hitbox[1] / 2 + 0.05, hz = b.hitbox[2] / 2 + 0.05;
          if (
            Math.abs(b.position[0] - s.car.x) < CAR_HALF[0] + hx &&
            Math.abs(b.position[1] - CAR_CENTER_Y) < CAR_HALF[1] + hy &&
            Math.abs(b.position[2] - s.car.z) < CAR_HALF[2] + hz
          ) hits.push(id);
        }

        if (hits.length > 0) {
          const wasAnimated = s.mode !== 'ragdoll';
          const r = enterRagdoll();
          if (wasAnimated && ui.autoSloMo) s.sloMoUntil = s.animSeconds + SLOMO_SECONDS;
          if (wasAnimated) s.lastImpactKmh = Math.round(s.car.speed * 3.6);
          for (const boneId of hits) {
            s.lastHitAt[boneId] = s.animSeconds;
            const region = boneRegion(boneId);
            if (!s.regionsHit.has(region)) {
              s.regionsHit.add(region);
              const dmg = Math.round(s.car.speed * REGION_MULT[region] * (0.9 + Math.random() * 0.3) * 1.35);
              s.hp[region] = Math.max(0, s.hp[region] - dmg);
              s.log = [
                `${REGION_LABEL[region]} -${dmg} · car @ ${Math.round(s.car.speed * 3.6)} km/h${s.hp[region] <= 0 ? ' · BROKEN' : ''}`,
                ...s.log,
              ].slice(0, 6);
            }
            // kick the bone's joints with the car's velocity + an upward lift
            for (const j of BONE_JOINTS[boneId]) {
              ragdollImpulse(r, j, [
                s.car.dir * s.car.speed * (0.85 + Math.random() * 0.5),
                1.6 + s.car.speed * 0.16 * (0.6 + Math.random() * 0.6),
                (Math.random() - 0.5) * 2.2,
              ], dt);
            }
          }
        }

        // the hood carries: joints still inside the car box get shoved ahead
        if (s.mode === 'ragdoll' && s.ragdoll) {
          const r = s.ragdoll;
          for (const j of Object.keys(r.pos) as JointId[]) {
            const p = r.pos[j];
            if (
              Math.abs(p[0] - s.car.x) < CAR_HALF[0] &&
              p[1] < CAR_CENTER_Y + CAR_HALF[1] &&
              Math.abs(p[2] - s.car.z) < CAR_HALF[2]
            ) {
              p[0] = s.car.x + s.car.dir * (CAR_HALF[0] + 0.06);
              ragdollImpulse(r, j, [s.car.dir * s.car.speed * 0.5, 0.8, 0], dt);
            }
          }
        }
      }

      // physics + settling + getting back up
      // ONE step per tick at the same dt the impulses were scaled with —
      // mismatched impulse/step dt silently rescales every kick velocity.
      // Arena walls keep an uppercut-stacked body on the platform.
      if (s.mode === 'ragdoll' && s.ragdoll) {
        stepRagdoll(s.ragdoll, dt, 15.5);
        if (!s.car.active && ragdollMaxMotion(s.ragdoll) < SETTLE_MOTION) {
          s.settleTicks += 1;
          if (s.settleTicks > SETTLE_TICKS && !ko) {
            const c = ragdollCenter(s.ragdoll);
            s.origin = [c[0], 0, c[2]];
            s.recoverFrom = bonesFromRagdoll(s.ragdoll);
            s.recoverTarget = offsetBones(buildSkeleton('neutral', 'stand'), s.origin);
            s.recoverStart = s.animSeconds;
            s.mode = 'recover';
            s.ragdoll = null;
          }
        } else {
          s.settleTicks = 0;
        }
      }

      // camera follows the body
      const want: V3 = s.mode === 'ragdoll' && s.ragdoll
        ? (() => { const c = ragdollCenter(s.ragdoll!); return [c[0], Math.max(0.6, c[1]), c[2]] as V3; })()
        : [s.origin[0], 1.1, s.origin[2]];
      const k = 1 - Math.exp(-5 * dtReal);
      s.camTarget = lerp3(s.camTarget, want, k);

      setTick((t) => t + 1);
      handle = schedule(tick);
    };

    handle = schedule(tick);
    return () => cancel(handle);
  }, []);

  // ── per-frame render derivation ───────────────────────────────────────────
  const s = simRef.current;
  const bones = lastBonesRef.current ?? offsetBones(buildSkeleton('neutral', 'stand'), s.origin);
  const rig = buildRigFrameFromBones(bones, 'neutral', 'tee', 'plain', ['cap'], 'jeans');
  const ko = REGIONS.some((r) => s.hp[r] <= 0);
  const sloMoActive = s.animSeconds < s.sloMoUntil;
  const status = ko
    ? 'K.O. — the body stays down. HEAL (h) to revive.'
    : s.mode === 'ragdoll'
      ? (s.car.active ? 'impact! physics owns the body' : 'tumbling… waiting for rest')
      : s.mode === 'recover'
        ? 'getting back up'
        : s.car.active
          ? 'incoming…'
          : 'animated. launch something at it.';

  const orbitDown = (e: any) => { orbitRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const orbitMove = (e: any) => {
    const d = orbitRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    setYaw((v) => v + (nx - d.x) * 0.4);
    setPitch((v) => Math.max(4, Math.min(80, v - (ny - d.y) * 0.3)));
    d.x = nx; d.y = ny;
  };
  const orbitUp = () => { orbitRef.current = null; };

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      {/* ── left: lab controls ── */}
      <Col style={{ width: 280, padding: 14, gap: 10 }}>
        <Text fontSize={15} color={INK} style={{ fontWeight: 900 }}>RAGDOLL LAB</Text>
        <Text fontSize={11} color={DIM}>{status}</Text>
        <Knob
          label="car speed"
          value={`${speedKmh} km/h`}
          onMinus={() => setSpeedKmh((v) => Math.max(MIN_KMH, v - 5))}
          onPlus={() => setSpeedKmh((v) => Math.min(MAX_KMH, v + 5))}
        />
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Chip label="car from left" color={BAD} onPress={() => launchCar(1)} />
          <Chip label="car from right" color={BAD} onPress={() => launchCar(-1)} />
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Chip label="uppercut (u)" color={WARN} onPress={uppercut} />
          <Chip label="trip (t)" color={WARN} onPress={trip} />
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Chip label="walk" active={walking} color={GOOD} onPress={() => setWalking((v) => !v)} />
          <Chip label="hitboxes" active={showHitboxes} color="#35d0ff" onPress={() => setShowHitboxes((v) => !v)} />
          <Chip label="auto slo-mo" active={autoSloMo} onPress={() => setAutoSloMo((v) => !v)} />
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Chip label="heal (h)" color={GOOD} onPress={heal} />
          <Chip label="reset (r)" onPress={resetAll} />
        </Row>
        <Box style={{ height: 8 }} />
        <Text fontSize={11} color={DIM} style={{ fontWeight: 800 }}>BODY DAMAGE</Text>
        <DamageDiagram hp={s.hp} />
        {s.lastImpactKmh > 0 ? (
          <Text fontSize={11} color={DIM}>{`last impact: ${s.lastImpactKmh} km/h`}</Text>
        ) : null}
        <Box style={{ height: 4 }} />
        <Text fontSize={11} color={DIM} style={{ fontWeight: 800 }}>HITS</Text>
        {s.log.length === 0 ? (
          <Text fontSize={11} color={DIM}>no hits yet — press l</Text>
        ) : (
          s.log.map((line, i) => (
            <Text key={`${i}.${line}`} fontSize={11} color={i === 0 ? INK : DIM}>{line}</Text>
          ))
        )}
      </Col>

      {/* ── right: the scene ── */}
      <Pressable
        onMouseDown={orbitDown}
        onMouseMove={orbitMove}
        onMouseUp={orbitUp}
        style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#101725">
          <OrbitCamera target={s.camTarget} yaw={yaw} pitch={pitch} dist={dist} fov={48} />
          <Scene3D.Fog enabled={false} />
          <Scene3D.Skybox zenith="#16243d" horizon="#3d4f6e" ground="#0c0f15" sunDir={[0.45, 0.5, 0.3]} sunColor="#ffe7b0" haze={0.25} cloud={0.18} night={0} />
          <Scene3D.AmbientLight color="#9aa8c4" intensity={0.55} />
          <Scene3D.DirectionalLight direction={[0.45, 0.85, 0.3]} color="#fff2d8" intensity={0.9} />

          {/* ground + the road the car owns */}
          <Scene3D.Mesh geometry={Geometry.Box} params={GROUND_PARAMS} material="#1a2433" position={[0, -0.04, 0]} />
          <Scene3D.Mesh geometry={Geometry.Box} params={ROAD_PARAMS} material="#232a33" position={[0, 0.005, 0]} />
          {[-15, -11, -7, -3, 1, 5, 9, 13].map((dx) => (
            <Scene3D.Mesh key={`dash${dx}`} geometry={Geometry.Box} params={DASH_PARAMS} material="#cfd6e0" position={[dx, 0.035, 0]} />
          ))}

          {/* the figure — animated, tumbling, or getting up; same rig path */}
          <FigureMeshes rig={rig} parts={figure.parts} />

          {/* hitboxes tinted by region HP, flashing white when struck */}
          {showHitboxes ? rig.hitboxes.map((hb) => {
            const region = boneRegion(hb.id);
            const flash = s.animSeconds - (s.lastHitAt[hb.id] ?? -9) < 0.16;
            return (
              <Scene3D.Mesh
                key={`hb-${hb.id}`}
                geometry={Geometry.Box}
                params={{ width: hb.size[0], height: hb.size[1], depth: hb.size[2] }}
                material={{ color: flash ? '#ffffff' : hpColor(s.hp[region]), opacity: flash ? 0.85 : 0.2 }}
                position={hb.position}
                rotation={hb.rotation}
              />
            );
          }) : null}

          {s.car.active ? <CarMeshes x={s.car.x} z={s.car.z} yawDeg={s.car.dir * 90} /> : null}
        </Scene3D>

        {sloMoActive ? (
          <Box style={{ position: 'absolute', right: 16, top: 12, paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, borderWidth: 1, borderColor: WARN, backgroundColor: '#02061799' }}>
            <Text fontSize={12} color={WARN} style={{ fontWeight: 800 }}>SLOW MOTION</Text>
          </Box>
        ) : null}
        {ko ? (
          <Box style={{ position: 'absolute', left: 0, right: 0, top: 40, alignItems: 'center' }}>
            <Text fontSize={42} color={BAD} style={{ fontWeight: 900 }}>K.O.</Text>
          </Box>
        ) : null}
        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <Knob label="zoom" value={dist.toFixed(1)} onMinus={() => setDist((v) => Math.max(3, v - 0.8))} onPlus={() => setDist((v) => Math.min(20, v + 0.8))} />
        </Box>
        <Box style={{ position: 'absolute', left: 14, bottom: 14 }}>
          <Text fontSize={11} color={DIM}>drag to orbit · l car · u uppercut · t trip · h heal · r reset</Text>
        </Box>
      </Pressable>

      {/* offscreen: the figure's face + skin bakes */}
      <CharacterCaptures
        headTexKey={figure.parts.head.texKey}
        skinTexKey={figure.parts.torso.texKey}
        skin={figure.doc.skin}
        layers={figure.doc.layers}
      />
    </Row>
  );
}
