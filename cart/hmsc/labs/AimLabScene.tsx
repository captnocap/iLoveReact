import { Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import type { GameState } from '../design';
import { HMSC_GAMEPLAY_CAMERA } from '../gameplay/camera';
import type { HmscGameplayRigSceneContext } from '../gameplay/HmscGameplayRig';

type V3 = [number, number, number];

type BottleTarget = {
  id: string;
  position: V3;
  kind: 'beer' | 'liquor' | 'pill';
};

const TARGETS: BottleTarget[] = [
  { id: 'beer-1', kind: 'beer', position: [-1.45, 1.42, 8.35] },
  { id: 'beer-2', kind: 'beer', position: [-0.65, 1.42, 8.35] },
  { id: 'pill-1', kind: 'pill', position: [0.1, 1.4, 8.35] },
  { id: 'liquor-1', kind: 'liquor', position: [0.82, 1.44, 8.35] },
  { id: 'beer-3', kind: 'beer', position: [1.55, 1.42, 8.35] },
];

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v: V3, s: number): V3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(v: V3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: V3): V3 {
  const len = length(v) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function aimForward(yawDegrees: number, pitchRadians: number): V3 {
  const yaw = radians(yawDegrees);
  const cp = Math.cos(pitchRadians);
  return normalize([Math.sin(yaw) * cp, -Math.sin(pitchRadians), Math.cos(yaw) * cp]);
}

function local(origin: V3, p: V3): V3 {
  return [origin[0] + p[0], origin[1] + p[1], origin[2] + p[2]];
}

function targetUnderCrosshair(state: GameState, context: HmscGameplayRigSceneContext): string {
  if (!context.aiming) return '';
  const player = state.player.position;
  const yawRadians = radians(context.cameraYawDegrees);
  const right: V3 = [-Math.cos(yawRadians), 0, Math.sin(yawRadians)];
  const origin: V3 = add([
    player.x - Math.sin(yawRadians) * HMSC_GAMEPLAY_CAMERA.distanceMeters,
    player.y + HMSC_GAMEPLAY_CAMERA.heightMeters,
    player.z - Math.cos(yawRadians) * HMSC_GAMEPLAY_CAMERA.distanceMeters,
  ], scale(right, HMSC_GAMEPLAY_CAMERA.aimShoulderShiftMeters));
  const forward = aimForward(context.cameraYawDegrees, context.cameraPitchRadians);
  let bestId = '';
  let bestScore = Infinity;

  for (const target of TARGETS) {
    const center: V3 = [target.position[0], target.position[1] + 0.72, target.position[2]];
    const toTarget = sub(center, origin);
    const along = dot(toTarget, forward);
    if (along < 0.5 || along > 80) continue;
    const nearest = add(origin, scale(forward, along));
    const miss = length(sub(center, nearest));
    const score = miss + along * 0.002;
    if (miss < 0.34 && score < bestScore) {
      bestId = target.id;
      bestScore = score;
    }
  }

  return bestId;
}

function BottlePart(props: {
  origin: V3;
  geometry: any;
  params: any;
  material: string;
  p: V3;
  s: V3;
}) {
  return (
    <Scene3D.Mesh
      geometry={props.geometry}
      params={props.params}
      material={props.material}
      position={local(props.origin, props.p)}
      scale={props.s}
    />
  );
}

function GalleryBottle(props: { target: BottleTarget; selected: boolean }) {
  const glow = props.selected ? '#67e8f9' : '#d7b46a';
  if (props.target.kind === 'liquor') {
    return (
      <>
        <BottlePart origin={props.target.position} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} material="#7b58ad" p={[0, 0.46, 0]} s={[0.42, 0.7, 0.28]} />
        <BottlePart origin={props.target.position} geometry={Geometry.Cylinder} params={{ radius: 0.5, height: 1, segments: 18 }} material="#3b2763" p={[0, 0.96, 0]} s={[0.12, 0.38, 0.12]} />
        <BottlePart origin={props.target.position} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} material={glow} p={[0, 0.48, -0.15]} s={[0.26, 0.24, 0.02]} />
      </>
    );
  }
  if (props.target.kind === 'pill') {
    return (
      <>
        <BottlePart origin={props.target.position} geometry={Geometry.Cylinder} params={{ radius: 0.5, height: 1, segments: 18 }} material="#d98238" p={[0, 0.42, 0]} s={[0.32, 0.72, 0.32]} />
        <BottlePart origin={props.target.position} geometry={Geometry.Cylinder} params={{ radius: 0.5, height: 1, segments: 18 }} material="#f7f1df" p={[0, 0.84, 0]} s={[0.34, 0.14, 0.34]} />
        <BottlePart origin={props.target.position} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} material={glow} p={[0, 0.38, -0.18]} s={[0.2, 0.22, 0.02]} />
      </>
    );
  }
  return (
    <>
      <BottlePart origin={props.target.position} geometry={Geometry.Cylinder} params={{ radius: 0.5, height: 1, segments: 18 }} material="#2f593a" p={[0, 0.42, 0]} s={[0.22, 0.62, 0.22]} />
      <BottlePart origin={props.target.position} geometry={Geometry.Cylinder} params={{ radius: 0.5, height: 1, segments: 18 }} material="#24472f" p={[0, 0.88, 0]} s={[0.11, 0.42, 0.11]} />
      <BottlePart origin={props.target.position} geometry={Geometry.Cylinder} params={{ radius: 0.5, height: 1, segments: 18 }} material={glow} p={[0, 1.11, 0]} s={[0.13, 0.05, 0.13]} />
    </>
  );
}

export function AimLabScene(props: { state: GameState; context: HmscGameplayRigSceneContext }) {
  const selectedId = targetUnderCrosshair(props.state, props.context);
  return (
    <>
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 7.2, height: 0.04, depth: 4.4 }} material="#0d1626" position={[0, -0.02, 8.35]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 4.5, height: 1.1, depth: 0.95 }} material="#263244" position={[0, 0.52, 8.35]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 4.8, height: 0.16, depth: 1.2 }} material="#536174" position={[0, 1.16, 8.35]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.25, height: 1.1, depth: 0.18 }} material="#111827" position={[-2.65, 0.5, 8.35]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.25, height: 1.1, depth: 0.18 }} material="#111827" position={[2.65, 0.5, 8.35]} />
      {TARGETS.map((target) => (
        <GalleryBottle key={target.id} target={target} selected={target.id === selectedId} />
      ))}
    </>
  );
}
