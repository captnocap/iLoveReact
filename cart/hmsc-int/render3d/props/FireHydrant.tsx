import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../game/kinds/props';
import { at, type V3 } from './place';

// A classic fire hydrant: a squat red barrel with a domed bonnet, a top cap
// nut, a front pumper nozzle, and two side outlets. Short and solid — the
// player bumps it. Built from the geometry registry the same way PlayerFigure
// sculpts the player.
//
// The barrel is authored at AUTHORED_HEIGHT meters, then a uniform scale lifts
// every part (offsets AND radii) to the kind's heightMeters, so resizing the
// hydrant is a one-number change in propKinds.ts.

const HYDRANT_RED = '#c2362f';
const HYDRANT_RED_DARK = '#9c2a25';
const HYDRANT_CAP = '#c9ccd1';

const AUTHORED_HEIGHT = 0.78;

export function FireHydrant(props: { prop: WorldProp }) {
  const yaw = props.prop.yawDegrees;
  const s = propKindDefinition(props.prop.kind).heightMeters / AUTHORED_HEIGHT;
  const place = (local: V3): V3 => at(props.prop, [local[0] * s, local[1] * s, local[2] * s]);
  return (
    <>
      {/* Base flange on the sidewalk */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.2 * s, height: 0.06 * s, segments: 16 }} material={HYDRANT_RED_DARK} position={place([0, 0.03, 0])} />
      {/* Barrel body */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.13 * s, height: 0.46 * s, segments: 16 }} material={HYDRANT_RED} position={place([0, 0.31, 0])} />
      {/* Domed shoulders */}
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.155 * s, segments: 14, rings: 8 }} scale={[1, 0.7, 1]} material={HYDRANT_RED} position={place([0, 0.56, 0])} />
      {/* Bonnet + top cap nut */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.075 * s, height: 0.1 * s, segments: 12 }} material={HYDRANT_RED_DARK} position={place([0, 0.67, 0])} />
      <Scene3D.Mesh geometry={Geometry.Cone} params={{ radius: 0.07 * s, height: 0.08 * s, segments: 8 }} material={HYDRANT_CAP} position={place([0, 0.75, 0])} />
      {/* Front pumper nozzle (faces -Z at yaw 0) */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.055 * s, height: 0.14 * s, segments: 10 }} material={HYDRANT_CAP} position={place([0, 0.42, -0.15])} rotation={[90, yaw, 0]} />
      {/* Side outlets */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.05 * s, height: 0.12 * s, segments: 10 }} material={HYDRANT_CAP} position={place([0.15, 0.46, 0])} rotation={[0, yaw, 90]} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.05 * s, height: 0.12 * s, segments: 10 }} material={HYDRANT_CAP} position={place([-0.15, 0.46, 0])} rotation={[0, yaw, 90]} />
    </>
  );
}
