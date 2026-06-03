import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../world/propKinds';
import { at } from './place';

// A classic US curbside mailbox: a rounded metal body on a wooden post, with a
// little red flag on the side. Solid — the player bumps it. Authored at
// AUTHORED_HEIGHT and scaled to the kind's heightMeters.

const POST = '#6b5a42';
const POST_DARK = '#4a3d2e';
const BOX = '#9ca3af';
const BOX_DARK = '#6b7280';
const FLAG = '#c23b22';

const AUTHORED_HEIGHT = 1.3;

export function Mailbox(props: { prop: WorldProp }) {
  const yaw = props.prop.yawDegrees;
  const s = propKindDefinition(props.prop.kind).heightMeters / AUTHORED_HEIGHT;

  return (
    <>
      {/* Wooden post */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.06 * s, height: 0.95 * s, segments: 8 }} material={POST} position={at(props.prop, [0, 0.475 * s, 0])} />
      {/* Post base wedge */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.1 * s, height: 0.12 * s, segments: 8 }} material={POST_DARK} position={at(props.prop, [0, 0.06 * s, 0])} />
      {/* Mailbox body: a flattened cylinder for the rounded tunnel shape */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.18 * s, height: 0.42 * s, segments: 14 }} scale={[1, 1, 0.65]} material={BOX} position={at(props.prop, [0, 1.04 * s, 0])} rotation={[90, yaw, 0]} />
      {/* Door end cap (slightly darker) */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.18 * s, height: 0.03 * s, segments: 14 }} scale={[1, 1, 0.65]} material={BOX_DARK} position={at(props.prop, [0, 1.04 * s, 0.22 * s])} rotation={[90, yaw, 0]} />
      {/* Back end cap */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.18 * s, height: 0.03 * s, segments: 14 }} scale={[1, 1, 0.65]} material={BOX_DARK} position={at(props.prop, [0, 1.04 * s, -0.22 * s])} rotation={[90, yaw, 0]} />
      {/* Little red flag on the side (faces +X at yaw 0) */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.02 * s, height: 0.16 * s, depth: 0.08 * s }} material={FLAG} position={at(props.prop, [0.2 * s, 1.08 * s, 0.06 * s])} rotation={[0, yaw, 0]} />
      {/* Flag arm */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.012 * s, height: 0.12 * s, segments: 6 }} material={FLAG} position={at(props.prop, [0.18 * s, 1.02 * s, 0.06 * s])} rotation={[0, yaw, 90]} />
    </>
  );
}
