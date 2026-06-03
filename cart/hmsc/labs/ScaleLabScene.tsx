import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { HMSC_SCALE } from '../world/scale';

const LAB_ORIGIN_X = 3.25;
const LAB_ORIGIN_Z = -2.5;
const PLAYER_VISUAL_SHOE_BOTTOM = -0.16;
const PLAYER_VISUAL_HAT_TOP = 2.29;
const PLAYER_VISUAL_TOTAL_HEIGHT = PLAYER_VISUAL_HAT_TOP - PLAYER_VISUAL_SHOE_BOTTOM;
const ASPHALT_HEIGHT_METERS = 0.08;
const SIDEWALK_HEIGHT_METERS = 0.11;
const LOW_LEDGE_HEIGHT_METERS = 1.2;
const HIGH_LEDGE_HEIGHT_METERS = 1.6;
const RULER_TICK_COUNT = 34;
const RULER_TICK_METERS = 0.1;

function labX(x: number): number {
  return LAB_ORIGIN_X + x;
}

function labZ(z: number): number {
  return LAB_ORIGIN_Z + z;
}

function MeterBlock(props: { x: number; height: number; color: string; depth?: number }) {
  const depth = props.depth ?? 0.82;
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 0.82, height: props.height, depth }}
        material={props.color}
        position={[labX(props.x), props.height / 2, labZ(0)]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 0.9, height: 0.018, depth: depth + 0.08 }}
        material="#f8fafc"
        position={[labX(props.x), props.height + 0.012, labZ(0)]}
      />
    </>
  );
}

function HeightLine(props: { y: number; x?: number; width?: number; color: string }) {
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: props.width ?? 5.6, height: 0.012, depth: 0.024 }}
      material={props.color}
      position={[labX(props.x ?? 0.55), props.y, labZ(-0.92)]}
    />
  );
}

function RulerTick(props: { y: number; major?: boolean }) {
  const major = !!props.major;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: major ? 0.95 : 0.54, height: 0.018, depth: 0.035 }}
      material={major ? '#f8fafc' : '#64748b'}
      position={[labX(-2.35 + (major ? 0 : 0.2)), props.y, labZ(0)]}
    />
  );
}

function DoorFrame(props: { x: number }) {
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 0.08, height: HMSC_SCALE.doorHeightMeters, depth: 0.12 }}
        material="#f59e0b"
        position={[labX(props.x - HMSC_SCALE.doorWidthMeters / 2), HMSC_SCALE.doorHeightMeters / 2, labZ(0)]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 0.08, height: HMSC_SCALE.doorHeightMeters, depth: 0.12 }}
        material="#f59e0b"
        position={[labX(props.x + HMSC_SCALE.doorWidthMeters / 2), HMSC_SCALE.doorHeightMeters / 2, labZ(0)]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: HMSC_SCALE.doorWidthMeters + 0.08, height: 0.08, depth: 0.12 }}
        material="#f59e0b"
        position={[labX(props.x), HMSC_SCALE.doorHeightMeters, labZ(0)]}
      />
    </>
  );
}

export function ScaleLabScene() {
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 8.4, height: 0.035, depth: 5.4 }}
        material="#0d1626"
        position={[labX(1.1), -0.018, labZ(0)]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: HMSC_SCALE.playerCapsuleRadiusMeters * 2, height: HMSC_SCALE.playerCapsuleHeightMeters, depth: HMSC_SCALE.playerCapsuleRadiusMeters * 2 }}
        material="#1e40af"
        position={[labX(0), HMSC_SCALE.playerCapsuleHeightMeters / 2, labZ(0.72)]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Cylinder}
        params={{ radius: HMSC_SCALE.playerCapsuleRadiusMeters, height: 0.035, segments: 24 }}
        material="#38bdf8"
        position={[labX(0), 0.03, labZ(0.72)]}
      />
      <Scene3D.Mesh
        geometry={Geometry.Cylinder}
        params={{ radius: HMSC_SCALE.playerCapsuleRadiusMeters, height: 0.035, segments: 24 }}
        material="#38bdf8"
        position={[labX(0), HMSC_SCALE.playerCapsuleHeightMeters, labZ(0.72)]}
      />
      <MeterBlock x={1.35} height={ASPHALT_HEIGHT_METERS} color="#20242d" />
      <MeterBlock x={2.35} height={SIDEWALK_HEIGHT_METERS} color="#596170" />
      <MeterBlock x={3.05} height={LOW_LEDGE_HEIGHT_METERS} color="#b7791f" />
      <MeterBlock x={4.05} height={HIGH_LEDGE_HEIGHT_METERS} color="#94a3b8" />
      <DoorFrame x={5.25} />
      <HeightLine y={0} color="#22d3ee" />
      <HeightLine y={HMSC_SCALE.playerStepHeightMeters} color="#22c55e" />
      <HeightLine y={LOW_LEDGE_HEIGHT_METERS} color="#b7791f" />
      <HeightLine y={HIGH_LEDGE_HEIGHT_METERS} color="#f8fafc" />
      <HeightLine y={HMSC_SCALE.playerCapsuleHeightMeters} color="#60a5fa" />
      <HeightLine y={HMSC_SCALE.visualHumanMinMeters} color="#a3e635" />
      <HeightLine y={HMSC_SCALE.visualHumanMaxMeters} color="#84cc16" />
      <HeightLine y={PLAYER_VISUAL_TOTAL_HEIGHT} color="#c084fc" />
      <HeightLine y={PLAYER_VISUAL_HAT_TOP} color="#fde047" />
      <HeightLine y={HMSC_SCALE.doorHeightMeters} color="#f59e0b" />
      <HeightLine y={HMSC_SCALE.storyHeightMeters} color="#fb7185" />
      {Array.from({ length: RULER_TICK_COUNT }, (_, i) => i * RULER_TICK_METERS).map((y) => (
        <RulerTick key={`hmsc-scale-tick-${y.toFixed(1)}`} y={y} major={Math.abs(y - Math.round(y)) < 0.001} />
      ))}
    </>
  );
}
