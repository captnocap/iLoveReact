// /world — single-player workspace with reusable 3D components.
//
// Architecture: ONE <Scene3D> root. Everything inside it is a component
// that returns <Scene3D.Mesh> / <Scene3D.Light> fragments. No nested
// Scene3D containers — that would create multiple render-to-texture
// surfaces instead of one shared scene.

import { useEffect, useRef, useState } from 'react';
import { Box, Col, Row, Pressable, Scene3D, StaticSurface, Text } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { useIFTTT, busOn } from '@reactjit/runtime/hooks/useIFTTT';
import { DEFAULT_AVATAR } from '../character/catalog';
import { BlockFace3D } from '../gallery/components/block-faces/BlockFace3D';
import type { AvatarPart, Vec3 } from '@reactjit/runtime/avatar';

// ── Constants ────────────────────────────────────────────────────────

const MOVE_SPEED = 2.5;
const TURN_SPEED = 1.8;
const LOOK_SPEED = 1.2;
const FPS_CAM_Y = 1.58;
const TPS_CAM_DIST = 4.2;
const TPS_CAM_HEIGHT = 2.6;
const TPS_TARGET_Y = 1.1;

// ── Math helpers ─────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function rotateY([x, y, z]: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, y, -x * s + z * c];
}

function addV3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

// ── Reusable 3D components ───────────────────────────────────────────
//
// Each component returns a fragment of Scene3D.Mesh / Scene3D.Light nodes.
// They must be rendered INSIDE a <Scene3D> root — never wrap their own.

function Desk() {
  return (
    <>
      <Scene3D.Mesh geometry="box" material="#3d2e1e" position={[0, 0.78, -1.2]} sizeX={2.6} sizeY={0.06} sizeZ={1.3} />
      <Scene3D.Mesh geometry="box" material="#2e2216" position={[0, 0.84, -1.8]} sizeX={2.6} sizeY={0.06} sizeZ={0.04} />
      <Scene3D.Mesh geometry="cylinder" material="#2a2015" position={[-1.1, 0.39, -0.7]} radius={0.035} sizeY={0.78} />
      <Scene3D.Mesh geometry="cylinder" material="#2a2015" position={[1.1, 0.39, -0.7]} radius={0.035} sizeY={0.78} />
      <Scene3D.Mesh geometry="cylinder" material="#2a2015" position={[-1.1, 0.39, -1.7]} radius={0.035} sizeY={0.78} />
      <Scene3D.Mesh geometry="cylinder" material="#2a2015" position={[1.1, 0.39, -1.7]} radius={0.035} sizeY={0.78} />
      <Scene3D.Mesh geometry="box" material="#342818" position={[-0.75, 0.52, -1.2]} sizeX={0.9} sizeY={0.28} sizeZ={1.15} />
      <Scene3D.Mesh geometry="box" material="#8a7a65" position={[-0.75, 0.58, -0.62]} sizeX={0.35} sizeY={0.02} sizeZ={0.02} />
      <Scene3D.Mesh geometry="box" material="#8a7a65" position={[-0.75, 0.48, -0.62]} sizeX={0.35} sizeY={0.02} sizeZ={0.02} />
    </>
  );
}

function MonitorApp() {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#ff4422', padding: 16, gap: 10 }}>
      <Text style={{ fontSize: 18, color: '#ffffff', fontWeight: 'bold' }}>HELLO 3D</Text>
      <Box style={{ height: 4, backgroundColor: '#ffffff', width: '60%' }} />
      <Text style={{ fontSize: 12, color: '#ffddcc' }}>This is a real React app</Text>
      <Text style={{ fontSize: 12, color: '#ffddcc' }}>rendered onto a 3D mesh.</Text>
    </Box>
  );
}

function Monitor() {
  return (
    <>
      <Scene3D.Mesh geometry="box" material="#1a1a1a" position={[0, 0.82, -1.4]} sizeX={0.28} sizeY={0.015} sizeZ={0.2} />
      <Scene3D.Mesh geometry="box" material="#1a1a1a" position={[0, 0.92, -1.45]} sizeX={0.04} sizeY={0.18} sizeZ={0.04} />
      <Scene3D.Mesh geometry="box" material="#111111" position={[0, 1.15, -1.48]} sizeX={1.1} sizeY={0.68} sizeZ={0.035} />
      <Scene3D.Mesh geometry="box" material="#ffffff" position={[0, 1.15, -1.46]} sizeX={1.0} sizeY={0.58} sizeZ={0.005} textureKey="monitor-screen" />
      <Scene3D.Mesh geometry="sphere" material="#44ff66" position={[0.48, 0.82, -1.46]} radius={0.008} />
    </>
  );
}

function Keyboard() {
  return (
    <>
      <Scene3D.Mesh geometry="box" material="#222222" position={[0, 0.83, -0.65]} sizeX={0.65} sizeY={0.025} sizeZ={0.24} />
      <Scene3D.Mesh geometry="box" material="#333333" position={[0, 0.845, -0.73]} sizeX={0.58} sizeY={0.012} sizeZ={0.03} />
      <Scene3D.Mesh geometry="box" material="#333333" position={[0, 0.845, -0.68]} sizeX={0.58} sizeY={0.012} sizeZ={0.03} />
      <Scene3D.Mesh geometry="box" material="#333333" position={[0, 0.845, -0.63]} sizeX={0.58} sizeY={0.012} sizeZ={0.03} />
      <Scene3D.Mesh geometry="box" material="#333333" position={[0, 0.845, -0.58]} sizeX={0.5} sizeY={0.012} sizeZ={0.03} />
      <Scene3D.Mesh geometry="box" material="#444444" position={[0, 0.845, -0.53]} sizeX={0.22} sizeY={0.014} sizeZ={0.03} />
    </>
  );
}

function Mouse() {
  return (
    <>
      <Scene3D.Mesh geometry="sphere" material="#1a1a1a" position={[0.55, 0.84, -0.65]} radius={0.055} />
      <Scene3D.Mesh geometry="box" material="#222222" position={[0.535, 0.875, -0.65]} sizeX={0.03} sizeY={0.015} sizeZ={0.045} />
      <Scene3D.Mesh geometry="box" material="#222222" position={[0.565, 0.875, -0.65]} sizeX={0.03} sizeY={0.015} sizeZ={0.045} />
      <Scene3D.Mesh geometry="cylinder" material="#444444" position={[0.55, 0.885, -0.65]} radius={0.012} sizeY={0.02} />
      <Scene3D.Mesh geometry="torus" material="#111111" position={[0.55, 0.82, -0.55]} radius={0.08} tubeRadius={0.008} rotation={[Math.PI / 2, 0, 0]} />
    </>
  );
}

function Chair() {
  return (
    <>
      <Scene3D.Mesh geometry="box" material="#2a2a2a" position={[0, 0.5, 0.3]} sizeX={0.55} sizeY={0.06} sizeZ={0.5} />
      <Scene3D.Mesh geometry="box" material="#2a2a2a" position={[0, 0.85, 0.52]} sizeX={0.5} sizeY={0.6} sizeZ={0.05} />
      <Scene3D.Mesh geometry="cylinder" material="#111111" position={[0, 0.28, 0.3]} radius={0.04} sizeY={0.4} />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <Scene3D.Mesh
            key={`chair-leg-${i}`}
            geometry="cylinder"
            material="#111111"
            position={[Math.cos(a) * 0.18, 0.04, 0.3 + Math.sin(a) * 0.18]}
            radius={0.018}
            sizeY={0.08}
            rotation={[0.3, 0, a]}
          />
        );
      })}
      <Scene3D.Mesh geometry="box" material="#333333" position={[-0.32, 0.72, 0.3]} sizeX={0.04} sizeY={0.03} sizeZ={0.35} />
      <Scene3D.Mesh geometry="box" material="#333333" position={[0.32, 0.72, 0.3]} sizeX={0.04} sizeY={0.03} sizeZ={0.35} />
    </>
  );
}

function CoffeeMug() {
  return (
    <>
      <Scene3D.Mesh geometry="cylinder" material="#cc5533" position={[-0.9, 0.88, -0.9]} radius={0.045} sizeY={0.09} />
      <Scene3D.Mesh geometry="torus" material="#cc5533" position={[-0.84, 0.9, -0.9]} radius={0.025} tubeRadius={0.008} />
      {/* Steam frozen to confirm per-frame spam source */}
      <Scene3D.Mesh geometry="sphere" material="#ffffff" position={[-0.9, 0.98, -0.9]} radius={0.012} />
      <Scene3D.Mesh geometry="sphere" material="#ffffff" position={[-0.88, 1.04, -0.9]} radius={0.009} />
    </>
  );
}

function PottedPlant() {
  return (
    <>
      <Scene3D.Mesh geometry="cylinder" material="#b85c3e" position={[2.5, 0.35, -2.5]} radius={0.12} sizeY={0.5} />
      <Scene3D.Mesh geometry="sphere" material="#44aa55" position={[2.5, 0.85, -2.5]} radius={0.22} />
      <Scene3D.Mesh geometry="sphere" material="#55bb66" position={[2.3, 0.75, -2.4]} radius={0.14} />
      <Scene3D.Mesh geometry="sphere" material="#338844" position={[2.7, 0.78, -2.6]} radius={0.16} />
    </>
  );
}

function Room() {
  return (
    <>
      <Scene3D.Mesh geometry="plane" material="#1a222e" position={[0, 0, 0]} sizeX={16} sizeZ={12} />
      <Scene3D.Mesh geometry="plane" material="#151d28" position={[0, 3, -6]} rotation={[Math.PI / 2, 0, 0]} sizeX={16} sizeZ={6} />
      <Scene3D.Mesh geometry="plane" material="#151d28" position={[-8, 3, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2]} sizeX={12} sizeZ={6} />
    </>
  );
}

// ── NPC data ─────────────────────────────────────────────────────────

interface Npc {
  id: string;
  x: number;
  z: number;
  yaw: number;
  archetype: string;
  seed: string;
  bobPhase: number;
  bobSpeed: number;
}

const NPCS: Npc[] = [
  { id: 'npc-1', x: -1.8, z: -0.8, yaw: 0.4, archetype: 'humanFem', seed: 'dana', bobPhase: 0, bobSpeed: 1.2 },
  { id: 'npc-2', x: 2.2, z: 1.5, yaw: -1.8, archetype: 'robot', seed: 'unit-7', bobPhase: 2, bobSpeed: 0.0 },
  { id: 'npc-3', x: -2.5, z: 2.0, yaw: -0.6, archetype: 'ghost', seed: 'boo', bobPhase: 4, bobSpeed: 0.8 },
];

// ── Avatar renderer ──────────────────────────────────────────────────

function RenderAvatar({
  x, y, z, yaw, archetype, seed, prefix, hideHead,
}: {
  x: number; y: number; z: number; yaw: number;
  archetype: string; seed: string; prefix: string; hideHead?: boolean;
}) {
  const worldPos: Vec3 = [x, y, z];
  const parts = DEFAULT_AVATAR.parts.map((p) => {
    if (p.visible === false) return null;
    if (hideHead && p.kind === 'head') return null;
    const wp = addV3(rotateY(p.position, yaw), worldPos);
    const baseRot = p.rotation ?? [0, 0, 0];
    const worldRot: Vec3 = [baseRot[0], baseRot[1] + yaw, baseRot[2]];
    return (
      <Scene3D.Mesh
        key={`${prefix}-${p.id}`}
        geometry={p.geometry}
        material={p.color}
        position={wp}
        rotation={worldRot}
        scale={p.scale}
        radius={p.radius}
        tubeRadius={p.tubeRadius}
        sizeX={p.size?.[0]}
        sizeY={p.size?.[1]}
        sizeZ={p.size?.[2]}
      />
    );
  });

  const headPart = DEFAULT_AVATAR.parts.find((p) => p.kind === 'head');
  const headPos = headPart
    ? addV3(rotateY(headPart.position, yaw), worldPos)
    : ([x, y + 1.55, z] as Vec3);
  const headRadius = headPart?.radius ?? 0.35;

  return (
    <>
      {parts}
      {!hideHead && (
        <BlockFace3D
          center={headPos as [number, number, number]}
          radius={headRadius}
          archetype={archetype as any}
          seed={seed}
          frame="idle"
        />
      )}
    </>
  );
}

// ── Input tracker ────────────────────────────────────────────────────

function useKeyTracker() {
  const keys = useRef(new Set<string>());
  const down = (k: string) => keys.current.add(k);
  const up = (k: string) => keys.current.delete(k);
  return { keys, down, up };
}

// ── Main page ────────────────────────────────────────────────────────

export default function WorldPage() {
  const [camMode, setCamMode] = useState<'fps' | 'tps'>('tps');
  const [showGrid, setShowGrid] = useState(false);
  const [, setHudTick] = useState(0);

  const sim = useRef({ x: 0, z: 4, yaw: 0, pitch: 0.1 });
  const timeRef = useRef(0);

  const { keys, down, up } = useKeyTracker();

  // Held keys: raw bus subscription (no useIFTTT re-render churn)
  useEffect(() => {
    const onDown = (ev: any) => {
      const k = String(ev?.key ?? '');
      if (k === 'w') down('w');
      if (k === 'a') down('a');
      if (k === 's') down('s');
      if (k === 'd') down('d');
      if (k === 'q') down('q');
      if (k === 'e') down('e');
      if (k === 'r') down('r');
      if (k === 'f') down('f');
    };
    const onUp = (ev: any) => {
      const k = String(ev?.key ?? '');
      if (k === 'w') up('w');
      if (k === 'a') up('a');
      if (k === 's') up('s');
      if (k === 'd') up('d');
      if (k === 'q') up('q');
      if (k === 'e') up('e');
      if (k === 'r') up('r');
      if (k === 'f') up('f');
    };
    const unsubDown = busOn('__keydown', onDown);
    const unsubUp = busOn('__keyup', onUp);
    return () => { unsubDown(); unsubUp(); };
  }, []);

  useIFTTT('key:tab', () => setCamMode((m) => (m === 'fps' ? 'tps' : 'fps')));
  useIFTTT('key:g', () => setShowGrid((g) => !g));

  // Mouse drag look
  const dragging = useRef(false);
  const onMouseDown = () => { dragging.current = true; };
  const onMouseUp = () => { dragging.current = false; };

  useEffect(() => {
    const unsub = busOn('system:cursor:move', (ev: any) => {
      if (!dragging.current) return;
      sim.current.yaw -= Number(ev?.dx ?? 0) * 0.004;
      sim.current.pitch += Number(ev?.dy ?? 0) * 0.004;
      sim.current.pitch = clamp(sim.current.pitch, -0.6, 0.8);
    });
    return unsub;
  }, []);

  // Game loop — only trigger React re-render when state actually changes.
  // Standing still should be completely silent (no layout ops, no batch-ops).
  useEffect(() => {
    const g: any = globalThis;
    const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, 16);
    const cancel = g.cancelAnimationFrame ? g.cancelAnimationFrame.bind(g) : clearTimeout;
    let handle: any = 0;
    let last = g.performance?.now ? g.performance.now() : Date.now();
    let prevX = sim.current.x;
    let prevZ = sim.current.z;
    let prevYaw = sim.current.yaw;
    let prevPitch = sim.current.pitch;

    const tick = () => {
      const now = g.performance?.now ? g.performance.now() : Date.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const s = sim.current;
      const k = keys.current;
      timeRef.current += dt;

      let moved = false;

      let move = 0;
      let strafe = 0;
      if (k.has('w')) move += 1;
      if (k.has('s')) move -= 1;
      if (k.has('a')) strafe -= 1;
      if (k.has('d')) strafe += 1;

      if (move !== 0 || strafe !== 0) {
        const sy = Math.sin(s.yaw);
        const cy = Math.cos(s.yaw);
        s.x += (sy * move + cy * strafe) * MOVE_SPEED * dt;
        s.z += (cy * move - sy * strafe) * MOVE_SPEED * dt;
        moved = true;
      }

      if (k.has('q')) { s.yaw += TURN_SPEED * dt; moved = true; }
      if (k.has('e')) { s.yaw -= TURN_SPEED * dt; moved = true; }
      if (k.has('r')) { s.pitch += LOOK_SPEED * dt; moved = true; }
      if (k.has('f')) { s.pitch -= LOOK_SPEED * dt; moved = true; }
      s.pitch = clamp(s.pitch, -0.6, 0.8);

      if (moved || s.x !== prevX || s.z !== prevZ || s.yaw !== prevYaw || s.pitch !== prevPitch) {
        prevX = s.x;
        prevZ = s.z;
        prevYaw = s.yaw;
        prevPitch = s.pitch;
        setHudTick((t) => (t + 1) & 0xffff);
      }

      handle = sched(tick);
    };
    handle = sched(tick);
    return () => cancel(handle);
  }, []);

  const s = sim.current;
  const t = timeRef.current;

  const camPos: Vec3 =
    camMode === 'fps'
      ? [s.x, FPS_CAM_Y, s.z]
      : [
          s.x - Math.sin(s.yaw) * TPS_CAM_DIST,
          TPS_CAM_HEIGHT,
          s.z - Math.cos(s.yaw) * TPS_CAM_DIST,
        ];
  const camTarget: Vec3 =
    camMode === 'fps'
      ? [
          s.x + Math.sin(s.yaw) * Math.cos(s.pitch),
          FPS_CAM_Y + Math.sin(s.pitch),
          s.z + Math.cos(s.yaw) * Math.cos(s.pitch),
        ]
      : [s.x, TPS_TARGET_Y, s.z];

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: 'theme:bg' }}>
      <Pressable
        style={{ width: '100%', height: '100%' }}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
      >
        {/* ONE Scene3D root. Everything inside is a fragment of meshes/lights. */}
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0c111a" showGrid={showGrid} showAxes={false}>
          <Scene3D.Camera position={camPos} target={camTarget} fov={camMode === 'fps' ? 75 : 50} />
          <Scene3D.AmbientLight color="#ffffff" intensity={0.3} />
          <Scene3D.DirectionalLight direction={[0.4, 0.9, 0.5]} color="#ffffff" intensity={0.7} />
          <Scene3D.PointLight position={[1.5, 2.5, -1]} color="#ffc48a" intensity={0.5} />
          <Scene3D.PointLight position={[-2, 2, 2]} color="#8ac4ff" intensity={0.35} />

          <Room />
          <Desk />
          <Monitor />
          <Keyboard />
          <Mouse />
          <Chair />
          <CoffeeMug />
          <PottedPlant />
          <Scene3D.Mesh geometry="box" material="#2a2a3a" position={[0, 0.005, 0.5]} sizeX={3} sizeY={0.01} sizeZ={2} />

          {/* NPCs — bob frozen to isolate per-frame spam source */}
          {NPCS.map((npc) => (
            <RenderAvatar
              key={npc.id}
              x={npc.x}
              y={0}
              z={npc.z}
              yaw={npc.yaw}
              archetype={npc.archetype}
              seed={npc.seed}
              prefix={npc.id}
            />
          ))}

          {/* Player */}
          <RenderAvatar
            x={s.x}
            y={0}
            z={s.z}
            yaw={s.yaw}
            archetype="human"
            seed="world-1"
            prefix="player"
            hideHead={camMode === 'fps'}
          />
        </Scene3D>
      </Pressable>

      {/* HUD */}
      <Box style={{
        position: 'absolute',
        left: 14, top: 14,
        paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12,
        backgroundColor: 'theme:bg',
        borderWidth: 1, borderColor: 'theme:rule',
        borderRadius: 8,
        gap: 6,
      }}>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <S.Label style={{ color: 'theme:accentHot' }}>WORLD</S.Label>
          <S.Caption>{camMode === 'fps' ? '1st person' : '3rd person'}</S.Caption>
        </Row>
        <S.Caption style={{ fontSize: 11 }}>
          WASD move · QE turn · RF pitch · Tab toggle · G grid
        </S.Caption>
        <S.Caption style={{ fontSize: 11, color: 'theme:inkDim' }}>
          {`x:${s.x.toFixed(1)} z:${s.z.toFixed(1)} yaw:${(s.yaw * 57.3).toFixed(0)}°`}
        </S.Caption>
      </Box>

      {/* Hidden offscreen capture — feeds the monitor screen texture */}
      <StaticSurface staticKey="monitor-screen" style={{ position: 'absolute', left: -9999, top: 0, width: 512, height: 300 }}>
        <MonitorApp />
      </StaticSurface>

      {/* Mode toggle */}
      <Box style={{ position: 'absolute', right: 14, top: 14, gap: 6 }}>
        <Row style={{ gap: 6 }}>
          <S.ButtonOutline onPress={() => setCamMode('fps')}>
            <S.ButtonOutlineLabel>{camMode === 'fps' ? '● FPS' : 'FPS'}</S.ButtonOutlineLabel>
          </S.ButtonOutline>
          <S.ButtonOutline onPress={() => setCamMode('tps')}>
            <S.ButtonOutlineLabel>{camMode === 'tps' ? '● TPS' : 'TPS'}</S.ButtonOutlineLabel>
          </S.ButtonOutline>
        </Row>
      </Box>
    </Box>
  );
}
