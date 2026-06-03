import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../world/propKinds';
import { at } from './place';

// A stop sign: the unmistakable red octagon with a white rim, on a slim pole.
// The octagon is a thin 8-segment cylinder turned to face the oncoming lane
// (-Z at yaw 0); the white plate behind it peeks out as the border. No letters
// are sculpted — the shape and colours read as STOP on their own. Its kind sets
// trafficControl 'stopSign', so world/traffic.ts always reports 'stop' here.

const SIGN_RED = '#c0241f';
const SIGN_WHITE = '#eef0ec';
const POLE = '#8b9099';
const POLE_DARK = '#62676f';
// 8-segment cylinders start with a vertex on the axis; a 22.5° roll lands a flat
// edge on top, the way a real stop sign sits.
const OCTAGON_FLAT_TOP_ROLL_DEGREES = 22.5;

export function StopSign(props: { prop: WorldProp }) {
  const yaw = props.prop.yawDegrees;
  const height = propKindDefinition(props.prop.kind).heightMeters;
  const faceY = height - 0.5;
  return (
    <>
      {/* Pole + base */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.14, height: 0.12, segments: 10 }} material={POLE_DARK} position={at(props.prop, [0, 0.06, 0])} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.05, height, segments: 10 }} material={POLE} position={at(props.prop, [0, height / 2, 0])} />
      {/* White border plate (slightly larger, just behind) */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.45, height: 0.04, segments: 8 }} material={SIGN_WHITE} position={at(props.prop, [0, faceY, 0.005])} rotation={[90, yaw, OCTAGON_FLAT_TOP_ROLL_DEGREES]} />
      {/* Red octagon face */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.4, height: 0.05, segments: 8 }} material={SIGN_RED} position={at(props.prop, [0, faceY, -0.02])} rotation={[90, yaw, OCTAGON_FLAT_TOP_ROLL_DEGREES]} />
    </>
  );
}
