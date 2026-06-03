// Body Lab — parametric humanoid character model showcase.
//
// Six stylized body / face sculpts built from the same primitive skeleton:
// three male and three female characters with different silhouettes, hair,
// face language, and gear. All share one gait system; proportions and detail
// clusters carry the characterization.
//
// Ship: ./tools/rjit ship bodylab

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, Scene3D } from '@reactjit/primitives';
import { OrbitCamera } from '@reactjit/cameras';
import * as Geometry from '@reactjit/geometries';
import {
  drivePose,
  solveHumanoid,
  HumanoidFigure,
  DEFAULT_PROPORTIONS,
  type BodyProportions,
  type HumanoidPalette,
  type Vec3Tuple,
} from './humanoid';

// ── palette ──────────────────────────────────────────────────────────────────
const PAGE = '#060b14';
const BAR = '#0e1522';
const FRAME = '#1c2638';
const INK = '#e2e8f0';
const DIM = '#64748b';
const ACCENT = '#f59e0b';
const SCENE_BG = '#0a1020';

// ── figure definitions ───────────────────────────────────────────────────────

type FigureDef = {
  id: string;
  label: string;
  desc: string;
  proportions: BodyProportions;
  palette: HumanoidPalette;
};

const FIGURE_DEFS: FigureDef[] = [
  {
    id: 'samir',
    label: 'M: Samir',
    desc: 'Warehouse dad build: cap, beard, work vest, coffee in hand.',
    proportions: {
      ...DEFAULT_PROPORTIONS,
      shoulderHalfWidth: 0.39,
      hipHalfWidth: 0.25,
      hipHeight: 0.92,
      shoulderHeight: 1.44,
      neckHeight: 1.56,
      headCenterHeight: 1.76,
      hatHeight: 2.00,
      torsoWidth: 0.64,
      torsoHeight: 0.74,
      torsoDepth: 0.40,
      thighLength: 0.45,
      shinLength: 0.44,
      upperArmLength: 0.40,
      foreArmLength: 0.38,
      headRadius: 0.20,
      limbRadiusMul: 1.06,
      jointRadiusMul: 1.03,
      footRadius: 0.17,
      headStyle: 'beard',
      chestRadius: 0,
      buttRadius: 0,
      waistWidth: 0.46,
      waistDepth: 0.32,
      modelStyle: 'workdayDad',
    },
    palette: {
      skin: '#a97455',
      shirt: '#475569',
      pants: '#1f2937',
      shoe: '#18181b',
      hat: '#334155',
      hair: '#2a1a12',
      eye: '#111827',
      belt: '#27272a',
      nose: '#8f5f45',
      accent: '#d97706',
      metal: '#64748b',
      trim: '#f59e0b',
      marker: '#f59e0b',
    },
  },
  {
    id: 'daniel',
    label: 'M: Daniel',
    desc: 'Office commuter: narrow shoulders, blazer, backpack, soft glasses.',
    proportions: {
      ...DEFAULT_PROPORTIONS,
      shoulderHalfWidth: 0.31,
      hipHalfWidth: 0.20,
      hipHeight: 1.00,
      shoulderHeight: 1.54,
      neckHeight: 1.65,
      headCenterHeight: 1.84,
      hatHeight: 2.04,
      torsoWidth: 0.48,
      torsoHeight: 0.76,
      torsoDepth: 0.30,
      thighLength: 0.52,
      shinLength: 0.52,
      upperArmLength: 0.38,
      foreArmLength: 0.37,
      headRadius: 0.18,
      limbRadiusMul: 0.78,
      jointRadiusMul: 0.9,
      footRadius: 0.14,
      headStyle: 'goggles',
      chestRadius: 0,
      buttRadius: 0,
      waistWidth: 0.34,
      waistDepth: 0.25,
      modelStyle: 'officeCommuter',
    },
    palette: {
      skin: '#c08b6c',
      shirt: '#1e3a5f',
      pants: '#1f2937',
      shoe: '#111827',
      hat: '#2f1f18',
      hair: '#2f1f18',
      eye: '#0f172a',
      belt: '#111827',
      nose: '#a56f52',
      accent: '#eab308',
      metal: '#475569',
      trim: '#dbeafe',
      marker: '#38bdf8',
    },
  },
  {
    id: 'theo',
    label: 'M: Theo',
    desc: 'Bike courier: lean, hoodie, sling bag, scuffed sneakers.',
    proportions: {
      ...DEFAULT_PROPORTIONS,
      shoulderHalfWidth: 0.29,
      hipHalfWidth: 0.18,
      hipHeight: 1.02,
      shoulderHeight: 1.58,
      neckHeight: 1.68,
      headCenterHeight: 1.86,
      hatHeight: 2.18,
      torsoWidth: 0.44,
      torsoHeight: 0.72,
      torsoDepth: 0.26,
      thighLength: 0.58,
      shinLength: 0.58,
      upperArmLength: 0.39,
      foreArmLength: 0.39,
      headRadius: 0.18,
      limbRadiusMul: 0.66,
      jointRadiusMul: 0.82,
      footRadius: 0.13,
      headStyle: 'mohawk',
      chestRadius: 0,
      buttRadius: 0,
      waistWidth: 0.30,
      waistDepth: 0.22,
      modelStyle: 'bikeCourier',
    },
    palette: {
      skin: '#8d5f45',
      shirt: '#166534',
      pants: '#374151',
      shoe: '#e5e7eb',
      hat: '#111827',
      hair: '#111827',
      eye: '#111827',
      belt: '#0f172a',
      nose: '#744730',
      accent: '#f97316',
      metal: '#6b7280',
      trim: '#0f172a',
      marker: '#22c55e',
    },
  },
  {
    id: 'maya',
    label: 'F: Maya',
    desc: 'Studio teacher: tall, relaxed cardigan, necklace, tote bag.',
    proportions: {
      ...DEFAULT_PROPORTIONS,
      shoulderHalfWidth: 0.29,
      hipHalfWidth: 0.26,
      legHalfWidth: 0.17,
      hipHeight: 1.03,
      shoulderHeight: 1.59,
      neckHeight: 1.70,
      headCenterHeight: 1.89,
      hatHeight: 2.12,
      torsoWidth: 0.47,
      torsoHeight: 0.72,
      torsoDepth: 0.27,
      thighLength: 0.58,
      shinLength: 0.58,
      upperArmLength: 0.39,
      foreArmLength: 0.38,
      headRadius: 0.19,
      limbRadiusMul: 0.62,
      jointRadiusMul: 0.86,
      footRadius: 0.12,
      headStyle: 'hair',
      chestRadius: 0.075,
      buttRadius: 0.055,
      waistWidth: 0.31,
      waistDepth: 0.23,
      modelStyle: 'studioTeacher',
    },
    palette: {
      skin: '#d4a086',
      shirt: '#7c3aed',
      pants: '#334155',
      shoe: '#27272a',
      hat: '#23140f',
      hair: '#23140f',
      eye: '#111827',
      belt: '#4c1d95',
      nose: '#b87962',
      accent: '#f59e0b',
      metal: '#64748b',
      trim: '#a78bfa',
      marker: '#a78bfa',
    },
  },
  {
    id: 'rosa',
    label: 'F: Rosa',
    desc: 'Market vendor: sturdy frame, braid, apron, hip pouch.',
    proportions: {
      ...DEFAULT_PROPORTIONS,
      shoulderHalfWidth: 0.36,
      hipHalfWidth: 0.30,
      legHalfWidth: 0.20,
      hipHeight: 0.91,
      shoulderHeight: 1.43,
      neckHeight: 1.55,
      headCenterHeight: 1.74,
      hatHeight: 1.98,
      torsoWidth: 0.58,
      torsoHeight: 0.70,
      torsoDepth: 0.38,
      thighLength: 0.46,
      shinLength: 0.45,
      upperArmLength: 0.37,
      foreArmLength: 0.35,
      headRadius: 0.20,
      limbRadiusMul: 0.98,
      jointRadiusMul: 1.04,
      footRadius: 0.16,
      headStyle: 'braid',
      chestRadius: 0.085,
      buttRadius: 0.06,
      waistWidth: 0.40,
      waistDepth: 0.30,
      modelStyle: 'marketVendor',
    },
    palette: {
      skin: '#9a644a',
      shirt: '#be123c',
      pants: '#3f3f46',
      shoe: '#1c1917',
      hat: '#3b2416',
      hair: '#3b2416',
      eye: '#111827',
      belt: '#1c1917',
      nose: '#744730',
      accent: '#fbbf24',
      metal: '#a8a29e',
      trim: '#fed7aa',
      marker: '#f43f5e',
    },
  },
  {
    id: 'nia',
    label: 'F: Nia',
    desc: 'Grad student: compact, big backpack, side buns, notebook.',
    proportions: {
      ...DEFAULT_PROPORTIONS,
      shoulderHalfWidth: 0.23,
      hipHalfWidth: 0.22,
      legHalfWidth: 0.15,
      hipHeight: 0.78,
      shoulderHeight: 1.18,
      neckHeight: 1.28,
      headCenterHeight: 1.46,
      hatHeight: 1.68,
      torsoWidth: 0.40,
      torsoHeight: 0.52,
      torsoDepth: 0.24,
      thighLength: 0.37,
      shinLength: 0.37,
      upperArmLength: 0.30,
      foreArmLength: 0.28,
      headRadius: 0.21,
      limbRadiusMul: 0.62,
      jointRadiusMul: 0.88,
      footRadius: 0.11,
      headStyle: 'goggles',
      chestRadius: 0.055,
      buttRadius: 0.045,
      waistWidth: 0.28,
      waistDepth: 0.20,
      modelStyle: 'gradStudent',
    },
    palette: {
      skin: '#c98f6b',
      shirt: '#0f766e',
      pants: '#334155',
      shoe: '#1f2937',
      hat: '#1f1a17',
      hair: '#1f1a17',
      eye: '#111827',
      belt: '#164e63',
      nose: '#a86d50',
      accent: '#facc15',
      metal: '#64748b',
      trim: '#bae6fd',
      marker: '#14b8a6',
    },
  },
];

const SPACING = 2.4;

function figureX(i: number) {
  return (i - (FIGURE_DEFS.length - 1) / 2) * SPACING;
}

// ── component ────────────────────────────────────────────────────────────────

export default function BodyLab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [orbitYaw, setOrbitYaw] = useState(20);
  const [orbitPitch, setOrbitPitch] = useState(18);
  const [dist, setDist] = useState(13);
  const [clock, setClock] = useState(0);

  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const yawRef = useRef(orbitYaw);
  const pitchRef = useRef(orbitPitch);
  const rectRef = useRef({ x: 0, y: 0, width: 1280, height: 800 });

  yawRef.current = orbitYaw;
  pitchRef.current = orbitPitch;

  // animation clock
  useEffect(() => {
    const g: any = globalThis;
    const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, 16);
    let alive = true;
    let last = g.performance?.now?.() ?? Date.now();
    const loop = () => {
      if (!alive) return;
      const now = g.performance?.now?.() ?? Date.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setClock((c) => c + dt);
      if (autoRotate) {
        setOrbitYaw((y) => y + dt * 12);
      }
      sched(loop);
    };
    sched(loop);
    return () => { alive = false; };
  }, [autoRotate]);

  // camera target drifts toward selected figure
  const targetX = selectedId !== null ? figureX(FIGURE_DEFS.findIndex((d) => d.id === selectedId)) : 0;
  const smoothTargetX = useRef(targetX);
  useEffect(() => {
    const g: any = globalThis;
    const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, 16);
    let alive = true;
    const loop = () => {
      if (!alive) return;
      smoothTargetX.current += (targetX - smoothTargetX.current) * 0.08;
      sched(loop);
    };
    sched(loop);
    return () => { alive = false; };
  }, [targetX]);

  // orbit drag
  const onDown = (e: any) => {
    dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) };
  };
  const onMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0);
    const ny = Number(e?.y ?? 0);
    const dx = nx - d.x;
    const dy = ny - d.y;
    d.x = nx;
    d.y = ny;
    setOrbitYaw((v) => v + dx * 0.4);
    setOrbitPitch((v) => Math.max(4, Math.min(80, v - dy * 0.3)));
  };
  const onUp = () => {
    dragRef.current = null;
  };
  const onWheel = (e: any) => {
    const delta = Number(e?.deltaY ?? 0);
    setDist((d) => Math.max(4, Math.min(22, d + delta * 0.008)));
  };

  // memoized static scene (ground + lights + platforms)
  const staticScene = useMemo(
    () => (
      <>
        <Scene3D.AmbientLight color="#4a5a78" intensity={0.6} />
        <Scene3D.DirectionalLight direction={[0.45, 0.85, 0.35]} color="#ffdfc0" intensity={0.9} />
        <Scene3D.PointLight position={[8, 7, 6]} color="#ff8c42" intensity={0.35} />
        <Scene3D.PointLight position={[-8, 5, -4]} color="#4ecdc4" intensity={0.3} />
        {/* ground slab */}
        <Scene3D.Mesh
          geometry={Geometry.Box}
          params={{ width: 30, height: 0.15, depth: 10 }}
          material="#0f172a"
          position={[0, -0.075, 0]}
        />
        {/* small platforms under each figure */}
        {FIGURE_DEFS.map((_, i) => (
          <Scene3D.Mesh
            key={i}
            geometry={Geometry.Cylinder}
            params={{ radius: 0.85, height: 0.06, segments: 24 }}
            material="#1e293b"
            position={[figureX(i), 0.03, 0]}
          />
        ))}
      </>
    ),
    []
  );

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: PAGE, flexDirection: 'column' }}>
      {/* title bar */}
      <Col style={{ backgroundColor: BAR, borderColor: FRAME, borderBottomWidth: 1, padding: 12, gap: 8 }}>
        <Row style={{ gap: 10, alignItems: 'baseline' }}>
          <Text fontSize={16} color={INK} style={{ fontWeight: 'bold', letterSpacing: 0.6 }}>
            BODY LAB
          </Text>
          <Text fontSize={11} color={DIM}>
            archetype explorer — drag to orbit, scroll to zoom
          </Text>
        </Row>
        <Row style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Pressable
            onPress={() => setMoving((v) => !v)}
            style={{
              paddingTop: 5,
              paddingBottom: 5,
              paddingLeft: 11,
              paddingRight: 11,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: moving ? ACCENT : FRAME,
              backgroundColor: moving ? '#2a1d10' : '#141a28',
            }}
          >
            <Text fontSize={12} color={moving ? ACCENT : INK} style={{ fontWeight: moving ? 'bold' : 'normal' }}>
              {moving ? 'walking' : 'idle'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setAutoRotate((v) => !v)}
            style={{
              paddingTop: 5,
              paddingBottom: 5,
              paddingLeft: 11,
              paddingRight: 11,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: autoRotate ? '#3fc4c0' : FRAME,
              backgroundColor: autoRotate ? '#0e2422' : '#141a28',
            }}
          >
            <Text fontSize={12} color={autoRotate ? '#3fc4c0' : DIM}>
              rotate {autoRotate ? 'on' : 'off'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setOrbitYaw(20);
              setOrbitPitch(18);
              setDist(13);
              setSelectedId(null);
            }}
            style={{
              paddingTop: 5,
              paddingBottom: 5,
              paddingLeft: 11,
              paddingRight: 11,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: FRAME,
              backgroundColor: '#141a28',
            }}
          >
            <Text fontSize={12} color={DIM}>reset cam</Text>
          </Pressable>
        </Row>
      </Col>

      {/* 3D view */}
      <Pressable
        onLayout={(lr: any) => {
          rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height };
        }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onWheel={onWheel}
        style={{ flexGrow: 1, position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D
          style={{ width: '100%', height: '100%' }}
          backgroundColor={SCENE_BG}
          showGrid={false}
          showAxes={false}
        >
          <OrbitCamera
            target={[smoothTargetX.current, 1.15, 0]}
            yaw={orbitYaw}
            pitch={orbitPitch}
            dist={dist}
            zoom={1}
            fov={50}
          />
          {staticScene}
          {FIGURE_DEFS.map((def, i) => {
            const t = clock + i * 0.85;
            const pose = drivePose(t, moving, false);
            const base: Vec3Tuple = [figureX(i), 0, 0];
            const rig = solveHumanoid(base, 180, pose, def.proportions);
            return <HumanoidFigure key={def.id} rig={rig} palette={def.palette} />;
          })}
        </Scene3D>
      </Pressable>

      {/* figure cards */}
      <Row
        style={{
          backgroundColor: BAR,
          borderColor: FRAME,
          borderTopWidth: 1,
          padding: 10,
          gap: 8,
          overflow: 'scroll',
        }}
      >
        {FIGURE_DEFS.map((def) => {
          const on = selectedId === def.id;
          return (
            <Pressable
              key={def.id}
              onPress={() => setSelectedId((cur) => (cur === def.id ? null : def.id))}
              style={{
                minWidth: 140,
                padding: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: on ? ACCENT : FRAME,
                backgroundColor: on ? '#1f160a' : '#131a26',
              }}
            >
              <Row style={{ gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <Box
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: def.palette.shirt,
                  }}
                />
                <Text
                  fontSize={12}
                  color={on ? ACCENT : INK}
                  style={{ fontWeight: on ? 'bold' : 'normal' }}
                >
                  {def.label}
                </Text>
              </Row>
              <Text fontSize={10} color={DIM} style={{ lineHeight: 14 }}>
                {def.desc}
              </Text>
            </Pressable>
          );
        })}
      </Row>
    </Box>
  );
}
