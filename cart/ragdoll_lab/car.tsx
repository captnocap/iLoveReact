// car — the boxy sedan shared by the body-physics labs (ragdoll_lab launches
// it at the figure; pathing_lab drives fleets of them around the tile grid).
//
// Local frame: the car FACES +Z at yaw 0, matching the heading convention
// forward = [sin(yaw), 0, cos(yaw)] used everywhere (hmsc drive, Follow rig,
// host pathing lane offsets). `place` prepends the world yaw exactly like
// FigureMeshes: rotate local offsets about Y, add yawDeg to each ry.

import { Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';

type V3 = [number, number, number];
const RAD = Math.PI / 180;

const CHASSIS_PARAMS = { width: 1.8, height: 0.6, depth: 3.7 };
const CABIN_PARAMS = { width: 1.55, height: 0.55, depth: 1.7 };
const GLASS_PARAMS = { width: 1.4, height: 0.4, depth: 1.55 };
const WHEEL_PARAMS = { radius: 0.36, height: 0.26, segments: 14 };
const LIGHT_PARAMS = { width: 0.3, height: 0.14, depth: 0.1 };
const GLASS_MATERIAL = { color: '#9fc3e8', opacity: 0.85 };

function darkHex(hex: string, k = 0.7): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#5a1d18';
  const ch = (i: number) => Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * k).toString(16).padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

export function CarMeshes(props: { x: number; z: number; yawDeg: number; tone?: string }) {
  const tone = props.tone ?? '#b3382f';
  const cabinTone = darkHex(tone);
  const rad = props.yawDeg * RAD;
  const c = Math.cos(rad), s = Math.sin(rad);
  const place = (lx: number, ly: number, lz: number): V3 => [
    props.x + lx * c + lz * s,
    ly,
    props.z - lx * s + lz * c,
  ];
  const yaw = props.yawDeg;
  return (
    <>
      <Scene3D.Mesh geometry={Geometry.Box} params={CHASSIS_PARAMS} material={tone} position={place(0, 0.62, 0)} rotation={[0, yaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={CABIN_PARAMS} material={cabinTone} position={place(0, 1.18, -0.25)} rotation={[0, yaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={GLASS_PARAMS} material={GLASS_MATERIAL} position={place(0, 1.16, -0.25)} rotation={[0, yaw, 0]} />
      {[-0.85, 0.85].map((wx) => [-1.18, 1.18].map((wz) => (
        // wheels: cylinder Y-axis -> Rz(90) lays the axle across the car
        // (local X), then Ry(yaw) carries it to the world heading
        <Scene3D.Mesh key={`w${wx}.${wz}`} geometry={Geometry.Cylinder} params={WHEEL_PARAMS} material="#16181d"
          position={place(wx, 0.36, wz)} rotation={[0, yaw, 90]} />
      )))}
      <Scene3D.Mesh geometry={Geometry.Box} params={LIGHT_PARAMS} material="#ffe9a8" position={place(-0.55, 0.72, 1.86)} rotation={[0, yaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={LIGHT_PARAMS} material="#ffe9a8" position={place(0.55, 0.72, 1.86)} rotation={[0, yaw, 0]} />
    </>
  );
}
