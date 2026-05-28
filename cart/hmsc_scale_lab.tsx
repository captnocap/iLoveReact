// hmsc_scale_lab - visual scale ruler for the HMSC player against world tile metrics.
//
// Ship: ./scripts/ship hmsc_scale_lab

import { useEffect, useRef, useState } from 'react';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import { Box, Col, Row, Text, Pressable, Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import { PlayerFigure } from './hmsc/render3d/PlayerFigure';
import { HMSC_SCALE } from './hmsc/world/scale';

const PLAYER_CAPSULE_HEIGHT = HMSC_SCALE.playerCapsuleHeightMeters;
const PLAYER_RADIUS = HMSC_SCALE.playerCapsuleRadiusMeters;
const PLAYER_VISUAL_SHOE_BOTTOM = -0.16;
const PLAYER_VISUAL_HEAD_TOP = 2.04;
const PLAYER_VISUAL_HAT_TOP = 2.29;
const PLAYER_VISUAL_TOTAL_HEIGHT = PLAYER_VISUAL_HAT_TOP - PLAYER_VISUAL_SHOE_BOTTOM;
const PLAYER_STEP_HEIGHT = HMSC_SCALE.playerStepHeightMeters;
const HUMAN_MIN_HEIGHT = HMSC_SCALE.visualHumanMinMeters;
const HUMAN_MAX_HEIGHT = HMSC_SCALE.visualHumanMaxMeters;
const ASPHALT_HEIGHT = 0.08;
const SIDEWALK_HEIGHT = 0.11;
const LEDGE_A_HEIGHT = 1.2;
const LEDGE_B_HEIGHT = 1.6;
const DOOR_HEIGHT = HMSC_SCALE.doorHeightMeters;
const STORY_HEIGHT = HMSC_SCALE.storyHeightMeters;
const TILE_SIZE = HMSC_SCALE.tileMeters;
const CAMERA_DRAG_SPEED = 0.006;

type Vec3 = [number, number, number];
type CameraPreset = 'front' | 'side' | 'top' | 'three';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cameraFromOrbit(yaw: number, pitch: number, distance: number): Vec3 {
  const cp = Math.cos(pitch);
  return [
    Math.sin(yaw) * cp * distance + 0.9,
    Math.sin(pitch) * distance + 1.1,
    Math.cos(yaw) * cp * distance + 0.2,
  ];
}

function MeterBlock(props: { label: string; x: number; height: number; color: string; depth?: number }) {
  const depth = props.depth ?? 0.82;
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 0.82, height: props.height, depth }}
        material={props.color}
        position={[props.x, props.height / 2, 0]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 0.9, height: 0.018, depth: depth + 0.08 }}
        material="#f8fafc"
        position={[props.x, props.height + 0.012, 0]}
      />
    </>
  );
}

function DoorFrame(props: { x: number }) {
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 0.08, height: DOOR_HEIGHT, depth: 0.12 }}
        material="#f59e0b"
        position={[props.x - HMSC_SCALE.doorWidthMeters / 2, DOOR_HEIGHT / 2, 0]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 0.08, height: DOOR_HEIGHT, depth: 0.12 }}
        material="#f59e0b"
        position={[props.x + HMSC_SCALE.doorWidthMeters / 2, DOOR_HEIGHT / 2, 0]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: HMSC_SCALE.doorWidthMeters + 0.08, height: 0.08, depth: 0.12 }}
        material="#f59e0b"
        position={[props.x, DOOR_HEIGHT, 0]}
      />
    </>
  );
}

function RulerTick(props: { y: number; major?: boolean; color?: string }) {
  const major = !!props.major;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: major ? 0.95 : 0.54, height: 0.018, depth: 0.035 }}
      material={props.color ?? (major ? '#f8fafc' : '#64748b')}
      position={[-2.35 + (major ? 0 : 0.2), props.y, 0]}
    />
  );
}

function HeightLine(props: { y: number; x?: number; width?: number; color: string }) {
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: props.width ?? 5.6, height: 0.012, depth: 0.024 }}
      material={props.color}
      position={[props.x ?? 0.55, props.y, -0.92]}
    />
  );
}

function GroundGrid() {
  const lines = [];
  for (let i = -4; i <= 4; i += 1) {
    lines.push(
      <Scene3D.Mesh
        key={`gx-${i}`}
        geometry={Geometry.Box}
        params={{ width: 0.018, height: 0.012, depth: 5.2 }}
        material={i === 0 ? '#94a3b8' : '#243044'}
        position={[i * TILE_SIZE, 0.012, 0]}
      />,
      <Scene3D.Mesh
        key={`gz-${i}`}
        geometry={Geometry.Box}
        params={{ width: 8.2, height: 0.012, depth: 0.018 }}
        material={i === 0 ? '#94a3b8' : '#243044'}
        position={[0, 0.014, i * TILE_SIZE]}
      />,
    );
  }
  return <>{lines}</>;
}

function LabelSwatch(props: { color: string; label: string; value: string }) {
  return (
    <Row style={{ gap: 8, alignItems: 'center' }}>
      <Box style={{ width: 12, height: 12, backgroundColor: props.color, borderRadius: 2 }} />
      <Text fontSize={12} color="#dbeafe" style={{ fontWeight: 700 }}>{props.label}</Text>
      <Text fontSize={12} color="#94a3b8">{props.value}</Text>
    </Row>
  );
}

function CameraButton(props: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 7,
        paddingBottom: 7,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: props.selected ? '#60a5fa' : '#334155',
        backgroundColor: props.selected ? '#172554' : '#0f172a',
      }}
    >
      <Text fontSize={12} color="#e5eefc" style={{ fontWeight: 800 }}>{props.label}</Text>
    </Pressable>
  );
}

export default function HmscScaleLab() {
  const playerPosition = { x: 0, y: 0, z: 0 };
  const cameraTarget: Vec3 = [0.85, 1.05, 0.02];
  const [camera, setCamera] = useState({ yaw: 0.74, pitch: 0.31, distance: 6.5, preset: 'three' as CameraPreset });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const cameraPosition = cameraFromOrbit(camera.yaw, camera.pitch, camera.distance);

  const setPreset = (preset: CameraPreset) => {
    const next = {
      front: { yaw: 0, pitch: 0.13, distance: 6.25, preset },
      side: { yaw: Math.PI / 2, pitch: 0.14, distance: 6.1, preset },
      top: { yaw: 0.4, pitch: 1.24, distance: 5.7, preset },
      three: { yaw: 0.74, pitch: 0.31, distance: 6.5, preset },
    }[preset];
    setCamera(next);
  };

  useEffect(() => {
    const setKey = (event: any) => {
      const key = String(event?.key ?? '').toLowerCase();
      if (key === '1') setPreset('front');
      if (key === '2') setPreset('side');
      if (key === '3') setPreset('top');
      if (key === '4') setPreset('three');
      if (key === '-' || key === '_') setCamera((c) => ({ ...c, distance: clamp(c.distance + 0.45, 3.4, 10), preset: c.preset }));
      if (key === '=' || key === '+') setCamera((c) => ({ ...c, distance: clamp(c.distance - 0.45, 3.4, 10), preset: c.preset }));
    };
    return busOn('__keydown', setKey);
  }, []);

  const beginDrag = (event: any) => {
    dragRef.current = { x: Number(event?.x ?? 0), y: Number(event?.y ?? 0) };
  };
  const moveDrag = (event: any) => {
    const drag = dragRef.current;
    if (!drag) return;
    const x = Number(event?.x ?? drag.x);
    const y = Number(event?.y ?? drag.y);
    const dx = x - drag.x;
    const dy = y - drag.y;
    drag.x = x;
    drag.y = y;
    setCamera((c) => ({
      yaw: c.yaw - dx * CAMERA_DRAG_SPEED,
      pitch: clamp(c.pitch + dy * CAMERA_DRAG_SPEED, -0.12, 1.34),
      distance: c.distance,
      preset: c.preset,
    }));
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <Pressable
      style={{ width: '100%', height: '100%', backgroundColor: '#020617' }}
      onMouseDown={beginDrag}
      onMouseMove={moveDrag}
      onMouseUp={endDrag}
    >
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#07111f" showGrid={false} showAxes={false}>
        <Scene3D.Camera position={cameraPosition} target={cameraTarget} fov={42} />
        <Scene3D.AmbientLight color="#a7b7d8" intensity={0.62} />
        <Scene3D.DirectionalLight direction={[0.35, 0.92, 0.4]} color="#fff0d0" intensity={0.82} />
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 8.4, height: 0.035, depth: 5.4 }} material="#0d1626" position={[0, -0.018, 0]} />
        <GroundGrid />

        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: PLAYER_RADIUS * 2, height: PLAYER_CAPSULE_HEIGHT, depth: PLAYER_RADIUS * 2 }} material="#1e40af" position={[0, PLAYER_CAPSULE_HEIGHT / 2, 0.72]} />
        <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: PLAYER_RADIUS, height: 0.035, segments: 24 }} material="#38bdf8" position={[0, 0.03, 0.72]} />
        <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: PLAYER_RADIUS, height: 0.035, segments: 24 }} material="#38bdf8" position={[0, PLAYER_CAPSULE_HEIGHT, 0.72]} />

        <PlayerFigure position={playerPosition} yawDegrees={180} animationSeconds={0} moving={false} running={false} />

        <MeterBlock label="asphalt" x={1.35} height={ASPHALT_HEIGHT} color="#20242d" />
        <MeterBlock label="sidewalk" x={2.35} height={SIDEWALK_HEIGHT} color="#596170" />
        <MeterBlock label="ledge-a" x={3.05} height={LEDGE_A_HEIGHT} color="#b7791f" />
        <MeterBlock label="ledge-b" x={4.05} height={LEDGE_B_HEIGHT} color="#94a3b8" />
        <DoorFrame x={5.25} />

        <HeightLine y={0} color="#22d3ee" />
        <HeightLine y={PLAYER_STEP_HEIGHT} color="#22c55e" />
        <HeightLine y={LEDGE_A_HEIGHT} color="#b7791f" />
        <HeightLine y={LEDGE_B_HEIGHT} color="#f8fafc" />
        <HeightLine y={PLAYER_CAPSULE_HEIGHT} color="#60a5fa" />
        <HeightLine y={HUMAN_MIN_HEIGHT} color="#a3e635" />
        <HeightLine y={HUMAN_MAX_HEIGHT} color="#84cc16" />
        <HeightLine y={PLAYER_VISUAL_HEAD_TOP} color="#c084fc" />
        <HeightLine y={PLAYER_VISUAL_HAT_TOP} color="#fde047" />
        <HeightLine y={DOOR_HEIGHT} color="#f59e0b" />
        <HeightLine y={STORY_HEIGHT} color="#fb7185" />

        {Array.from({ length: 34 }, (_, i) => i * 0.1).map((y) => (
          <RulerTick key={`tick-${y.toFixed(1)}`} y={y} major={Math.abs(y - Math.round(y)) < 0.001} />
        ))}
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.035, height: 3.3, depth: 0.035 }} material="#94a3b8" position={[-2.8, 1.65, 0]} />
      </Scene3D>

      <Box style={{ position: 'absolute', top: 14, left: 14, width: 368, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#08111f' }}>
        <Col style={{ gap: 8 }}>
          <Text fontSize={16} color="#f8fafc" style={{ fontWeight: 900 }}>HMSC SCALE LAB</Text>
          <Text fontSize={12} color="#93a4b8">1 grid square = 1.00m. Cyan base line is the physics foot/origin plane.</Text>
          <LabelSwatch color="#22c55e" label="step height" value={`${PLAYER_STEP_HEIGHT.toFixed(2)}m`} />
          <LabelSwatch color="#b7791f" label="ledge A" value={`${LEDGE_A_HEIGHT.toFixed(2)}m`} />
          <LabelSwatch color="#f8fafc" label="ledge B" value={`${LEDGE_B_HEIGHT.toFixed(2)}m`} />
          <LabelSwatch color="#60a5fa" label="physics capsule" value={`${PLAYER_CAPSULE_HEIGHT.toFixed(2)}m tall x ${(PLAYER_RADIUS * 2).toFixed(2)}m wide`} />
          <LabelSwatch color="#84cc16" label="normal human band" value={`${HUMAN_MIN_HEIGHT.toFixed(2)}-${HUMAN_MAX_HEIGHT.toFixed(2)}m`} />
          <LabelSwatch color="#c084fc" label="visual head top" value={`${PLAYER_VISUAL_HEAD_TOP.toFixed(2)}m`} />
          <LabelSwatch color="#fde047" label="visual hat top" value={`${PLAYER_VISUAL_HAT_TOP.toFixed(2)}m; total incl. shoe dip ${PLAYER_VISUAL_TOTAL_HEIGHT.toFixed(2)}m`} />
          <LabelSwatch color="#f59e0b" label="door target" value={`${HMSC_SCALE.doorWidthMeters.toFixed(2)}m wide x ${DOOR_HEIGHT.toFixed(2)}m tall`} />
          <LabelSwatch color="#fb7185" label="story target" value={`${STORY_HEIGHT.toFixed(2)}m`} />
          <LabelSwatch color="#94a3b8" label="ruler ticks" value="0.10m minor, 1.00m major" />
          <Text fontSize={12} color="#fbbf24">Ledge delta: {(LEDGE_B_HEIGHT - LEDGE_A_HEIGHT).toFixed(2)}m.</Text>
          <Text fontSize={12} color="#93a4b8">Car {HMSC_SCALE.car.lengthMeters}x{HMSC_SCALE.car.widthMeters}x{HMSC_SCALE.car.heightMeters}m; bus {HMSC_SCALE.bus.lengthMeters}x{HMSC_SCALE.bus.widthMeters}x{HMSC_SCALE.bus.heightMeters}m.</Text>
        </Col>
      </Box>
      <Box style={{ position: 'absolute', top: 14, right: 14, padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#08111f' }}>
        <Col style={{ gap: 8 }}>
          <Row style={{ gap: 8 }}>
            <CameraButton label="front 1" selected={camera.preset === 'front'} onPress={() => setPreset('front')} />
            <CameraButton label="side 2" selected={camera.preset === 'side'} onPress={() => setPreset('side')} />
            <CameraButton label="top 3" selected={camera.preset === 'top'} onPress={() => setPreset('top')} />
            <CameraButton label="3/4 4" selected={camera.preset === 'three'} onPress={() => setPreset('three')} />
          </Row>
          <Text fontSize={12} color="#94a3b8">drag to orbit, +/- zoom</Text>
        </Col>
      </Box>
    </Pressable>
  );
}
