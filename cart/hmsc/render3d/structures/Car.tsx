import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { StructureCar } from '../../world/structures';
import { rotateYaw, type V3 } from '../props/place';
import { AutoGlass } from '../materials';

// A parked car — the shared sub-model for the parking garage and the used car lot.
// A boxy sedan: a lower body, a set-back cabin with tinted glass, four tires, and
// headlights. Authored in local space (origin at the ground between the wheels,
// +Y up, the long axis along Z, nose toward −Z at yaw 0 — the same facing
// convention as PlayerFigure and the props), then lifted to the car's world anchor
// and yaw. Color comes from the placement's colorIndex, so a lot of cars reads
// varied without per-car authoring.

const CAR_COLORS = [
  '#b5403a', // red
  '#2f6fb0', // blue
  '#d8d2c4', // cream
  '#3b3f45', // graphite
  '#6f8f5a', // sage
  '#c9952f', // amber
  '#8a8f96', // silver
  '#2b2e33', // black
  '#7a4f86', // plum
];

const TIRE = '#16171a';
const GLASS = AutoGlass(); // translucent, breakable tinted auto glass
const TRIM = '#202327';
const LIGHT = '#f3ead0';

// Authored at this base size, then uniformly scaled by CAR_SCALE — bump that one
// number to resize the whole car (mesh + the matching CAR_* collision box in
// world/structures stay in sync by eye).
const CAR_SCALE = 1.2;
const LENGTH = 4.2;
const WIDTH = 1.8;
const WHEEL_R = 0.34;

export function Car(props: { car: StructureCar }) {
  const c = props.car;
  const body = CAR_COLORS[c.colorIndex % CAR_COLORS.length];
  const s = CAR_SCALE;
  // Place a local part (authored before scaling) into world space: scale it, rotate
  // by the car's yaw, then offset to the car anchor.
  const place = (local: V3): V3 => {
    const r = rotateYaw([local[0] * s, local[1] * s, local[2] * s], c.yawDegrees);
    return [c.x + r[0], c.y + r[1], c.z + r[2]];
  };
  const sc = (w: number, h: number, d: number): V3 => [w * s, h * s, d * s];
  const halfL = LENGTH / 2;
  return (
    <>
      {/* Lower body */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={sc(WIDTH, 0.62, LENGTH)} material={body} position={place([0, 0.66, 0])} />
      {/* Rocker / bumper band */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={sc(WIDTH + 0.06, 0.18, LENGTH + 0.1)} material={TRIM} position={place([0, 0.4, 0])} />
      {/* Cabin (set in from the body, glasshouse) */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={sc(WIDTH - 0.22, 0.5, LENGTH * 0.5)} material={body} position={place([0, 1.18, 0.05])} />
      {/* Greenhouse glass: windshield + rear */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={sc(WIDTH - 0.3, 0.42, LENGTH * 0.46)} material={GLASS} position={place([0, 1.2, 0.05])} />
      {/* Headlights (nose, −Z) and tail lights (+Z) */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={sc(0.34, 0.16, 0.08)} material={LIGHT} position={place([0.55, 0.72, -halfL])} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={sc(0.34, 0.16, 0.08)} material={LIGHT} position={place([-0.55, 0.72, -halfL])} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={sc(0.32, 0.14, 0.08)} material="#7a221d" position={place([0.55, 0.74, halfL])} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={sc(0.32, 0.14, 0.08)} material="#7a221d" position={place([-0.55, 0.74, halfL])} />
      {/* Four tires (cylinder axis along X → lay flat by rolling 90° about Z) */}
      {[
        [WIDTH / 2, WHEEL_R, halfL - 1.0],
        [-WIDTH / 2, WHEEL_R, halfL - 1.0],
        [WIDTH / 2, WHEEL_R, -(halfL - 1.0)],
        [-WIDTH / 2, WHEEL_R, -(halfL - 1.0)],
      ].map((w, i) => (
        <Scene3D.Mesh
          key={i}
          geometry={Geometry.Cylinder}
          params={{ radius: WHEEL_R * s, height: 0.26 * s, segments: 14 }}
          material={TIRE}
          position={place([w[0], w[1], w[2]])}
          rotation={[0, c.yawDegrees, 90]}
        />
      ))}
    </>
  );
}
