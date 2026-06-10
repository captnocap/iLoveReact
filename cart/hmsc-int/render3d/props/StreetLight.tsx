import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../world/propKinds';
import { at } from './place';

// A cobra-head street light: a tall pole, a cantilever arm reaching out over the
// road (the -Z facing at yaw 0), and a lamp head with a bright warm lens. There
// is no emissive material in the mesh path, so the lens uses a near-white warm
// colour that still reads as "lit" under any sky.

const POLE = '#3b4049';
const POLE_DARK = '#2a2e35';
const LAMP_HOUSING = '#4a4f57';
const LAMP_LIT = '#fff2c2';

export function StreetLight(props: { prop: WorldProp }) {
  const yaw = props.prop.yawDegrees;
  const height = propKindDefinition(props.prop.kind).heightMeters;
  const armReach = 1.15;
  return (
    <>
      {/* Foundation + pole */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.2, height: 0.3, segments: 12 }} material={POLE_DARK} position={at(props.prop, [0, 0.15, 0])} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.085, height: height - 0.3, segments: 12 }} material={POLE} position={at(props.prop, [0, (height - 0.3) / 2 + 0.3, 0])} />
      {/* Cantilever arm over the road */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.05, height: armReach, segments: 8 }} material={POLE} position={at(props.prop, [0, height - 0.1, -armReach / 2])} rotation={[90, yaw, 0]} />
      {/* Cobra lamp housing + downward lens at the arm tip */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.22, height: 0.12, depth: 0.4 }} material={LAMP_HOUSING} position={at(props.prop, [0, height - 0.12, -armReach])} rotation={[0, yaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.16, height: 0.04, depth: 0.3 }} material={LAMP_LIT} position={at(props.prop, [0, height - 0.19, -armReach])} rotation={[0, yaw, 0]} />
    </>
  );
}
