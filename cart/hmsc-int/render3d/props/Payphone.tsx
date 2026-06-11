import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../game/kinds/props';
import { at, type V3 } from './place';

// A sidewalk payphone: a stand pole, an acoustic hood (the curved privacy shell),
// a phone box body with a lit keypad, a coin slot, and a handset on its cradle.
// Faces −Z at yaw 0, like every prop. Authored at AUTHORED_HEIGHT and uniformly
// scaled to the kind's heightMeters, so resizing is one number in propKinds.ts.

const HOOD = '#2f6db0';
const HOOD_DARK = '#214f80';
const BODY = '#d7dbe0';
const PANEL = '#1e242b';
const KEYS = '#cfe7ff';
const METAL = '#9a9ea4';
const HANDSET = '#16181b';

// PROPSCALE-0611: 1.54 = the hood's real top (1.46 + 0.08); was 1.45, which
// rendered ~6% over the registry height.
const AUTHORED_HEIGHT = 1.54;

export function Payphone(props: { prop: WorldProp }) {
  const yaw = props.prop.yawDegrees;
  const s = propKindDefinition(props.prop.kind).heightMeters / AUTHORED_HEIGHT;
  const place = (local: V3): V3 => at(props.prop, [local[0] * s, local[1] * s, local[2] * s]);
  return (
    <>
      {/* Stand pole */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.05 * s, height: 1.0 * s, segments: 10 }} material={METAL} position={place([0, 0.5, 0])} />
      {/* Phone box body */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.42 * s, 0.6 * s, 0.22 * s]} material={BODY} position={place([0, 1.12, 0])} />
      {/* Acoustic hood arching over the top, facing −Z */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.5 * s, 0.16 * s, 0.34 * s]} material={HOOD} position={place([0, 1.46, -0.04])} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.5 * s, 0.34 * s, 0.06 * s]} material={HOOD_DARK} position={place([0, 1.3, 0.1])} />
      {/* Front panel: keypad + screen, on the −Z face */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.3 * s, 0.42 * s, 0.04 * s]} material={PANEL} position={place([0, 1.14, -0.12])} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.22 * s, 0.14 * s, 0.03 * s]} material={KEYS} position={place([0, 1.0, -0.14])} />
      {/* Coin slot strip */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.18 * s, 0.05 * s, 0.03 * s]} material={METAL} position={place([0, 1.28, -0.14])} />
      {/* Handset hung on the left side with a short cord box */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.08 * s, 0.34 * s, 0.08 * s]} material={HANDSET} position={place([-0.24, 1.12, -0.06])} rotation={[10, yaw, 0]} />
    </>
  );
}
