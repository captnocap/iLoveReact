import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { dumpsterBodyMeters } from '../../world/propKinds';
import { at } from './place';

// A back-alley dumpster: a beat-up metal box with a sloped hinged lid, a rust
// patina, and a pair of horizontal reinforcing ribs. Solid — the player bumps it.
// The body box and scale come from propKinds.dumpsterBodyMeters() — the ONE
// definition host physics and the compiled renderer also consume (req_0623);
// part layout here is authored in units of that scale (parts' AABB top =
// DUMPSTER_AUTHORED_HEIGHT, so the lid peak lands exactly at heightMeters).

const BODY = '#4a5d3f';
const BODY_DARK = '#3a4a30';
const LID = '#556649';
const LID_DARK = '#45553a';
const RUST = '#7a5c3a';

export function Dumpster(props: { prop: WorldProp }) {
  const yaw = props.prop.yawDegrees;
  // Body box + scale from the registry's ONE definition (req_0623) — host
  // physics steps against the same numbers, so you bump what you see.
  const { scale: s, widthMeters: w, depthMeters: d } = dumpsterBodyMeters();

  return (
    <>
      {/* Wheels / base skids */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: w * 0.85, height: 0.06 * s, depth: d * 0.8 }} material={BODY_DARK} position={at(props.prop, [0, 0.03 * s, 0])} rotation={[0, yaw, 0]} />
      {/* Main body */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: w, height: 0.78 * s, depth: d }} material={BODY} position={at(props.prop, [0, 0.45 * s, 0])} rotation={[0, yaw, 0]} />
      {/* Top rim lip */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: w + 0.04 * s, height: 0.06 * s, depth: d + 0.04 * s }} material={BODY_DARK} position={at(props.prop, [0, 0.87 * s, 0])} rotation={[0, yaw, 0]} />
      {/* Sloped lid (two angled boxes meeting at a peak) */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: w + 0.02 * s, height: 0.08 * s, depth: d * 0.55 }} material={LID} position={at(props.prop, [0, 0.96 * s, d * 0.22])} rotation={[18, yaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: w + 0.02 * s, height: 0.08 * s, depth: d * 0.55 }} material={LID_DARK} position={at(props.prop, [0, 0.96 * s, -d * 0.22])} rotation={[-18, yaw, 0]} />
      {/* Horizontal reinforcing ribs */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: w + 0.02 * s, height: 0.04 * s, depth: d + 0.02 * s }} material={BODY_DARK} position={at(props.prop, [0, 0.62 * s, 0])} rotation={[0, yaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: w + 0.02 * s, height: 0.04 * s, depth: d + 0.02 * s }} material={BODY_DARK} position={at(props.prop, [0, 0.32 * s, 0])} rotation={[0, yaw, 0]} />
      {/* Rust streak on one corner */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.06 * s, height: 0.5 * s, depth: 0.06 * s }} material={RUST} position={at(props.prop, [w * 0.46, 0.5 * s, d * 0.46])} rotation={[0, yaw, 0]} />
    </>
  );
}
