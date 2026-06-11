import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../game/kinds/props';
import { at } from './place';

// A chain-link fence segment: two vertical posts with a top rail, a bottom rail,
// and wire mesh represented by a thin translucent grid plane. Solid — the player
// bumps it. The segment spans along local X (perpendicular to the prop's facing
// at yaw 0) so chaining segments at the same yaw creates a continuous run.
// Authored at AUTHORED_HEIGHT and scaled to the kind's heightMeters.

const POST = '#6b7280';
const POST_DARK = '#4b5563';
const RAIL = '#9ca3af';
const MESH = '#b0b8c4';

const AUTHORED_HEIGHT = 1.2;

export function Fence(props: { prop: WorldProp }) {
  const yaw = props.prop.yawDegrees;
  const def = propKindDefinition(props.prop.kind);
  const s = def.heightMeters / AUTHORED_HEIGHT;
  const halfSpan = def.footprintRadiusMeters * 0.95; // segment half-width
  const postR = 0.05 * s;

  return (
    <>
      {/* Left post */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: postR, height: def.heightMeters, segments: 8 }} material={POST} position={at(props.prop, [-halfSpan, def.heightMeters / 2, 0])} />
      {/* Left post cap */}
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: postR * 1.3, segments: 8, rings: 6 }} material={POST_DARK} position={at(props.prop, [-halfSpan, def.heightMeters + postR * 0.3, 0])} />
      {/* Right post */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: postR, height: def.heightMeters, segments: 8 }} material={POST} position={at(props.prop, [halfSpan, def.heightMeters / 2, 0])} />
      {/* Right post cap */}
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: postR * 1.3, segments: 8, rings: 6 }} material={POST_DARK} position={at(props.prop, [halfSpan, def.heightMeters + postR * 0.3, 0])} />
      {/* Top rail */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.025 * s, height: halfSpan * 2, segments: 6 }} material={RAIL} position={at(props.prop, [0, def.heightMeters - 0.04 * s, 0])} rotation={[0, yaw, 90]} />
      {/* Bottom rail */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.025 * s, height: halfSpan * 2, segments: 6 }} material={RAIL} position={at(props.prop, [0, 0.06 * s, 0])} rotation={[0, yaw, 90]} />
      {/* Wire mesh panel */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: halfSpan * 2, height: def.heightMeters - 0.14 * s, depth: 0.015 * s }} material={MESH} position={at(props.prop, [0, (def.heightMeters - 0.14 * s) / 2 + 0.06 * s, 0])} rotation={[0, yaw, 0]} />
    </>
  );
}
