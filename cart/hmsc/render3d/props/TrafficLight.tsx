import { useEffect, useState } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { TrafficSignalPhase, WorldProp } from '../../design';
import { propKindDefinition } from '../../world/propKinds';
import { trafficClockSeconds, trafficSignalPhase } from '../../world/traffic';
import { at } from './place';

// A mast-arm traffic light: pole, cantilever arm over the road, and a three-lamp
// head facing the lane it governs (-Z at yaw 0). The head reads its live phase
// from world/traffic.ts — the SAME clock and cycle a vehicle reads — and lights
// the matching lamp bright while the others sit dark. It self-ticks at a low
// rate so only this one node re-renders; the rest of the world stays memoized.

const POLE = '#33373e';
const POLE_DARK = '#23262c';
const HOUSING = '#191b1f';
const LAMP_DARK_RED = '#3a1513';
const LAMP_DARK_YELLOW = '#3a3413';
const LAMP_DARK_GREEN = '#123a1d';
const LAMP_LIT_RED = '#ff3b30';
const LAMP_LIT_YELLOW = '#ffd23b';
const LAMP_LIT_GREEN = '#36d65b';

const SIGNAL_REFRESH_MS = 250;

function lampColors(phase: TrafficSignalPhase | null): { red: string; yellow: string; green: string } {
  return {
    red: phase === 'stop' ? LAMP_LIT_RED : LAMP_DARK_RED,
    yellow: phase === 'caution' ? LAMP_LIT_YELLOW : LAMP_DARK_YELLOW,
    green: phase === 'go' ? LAMP_LIT_GREEN : LAMP_DARK_GREEN,
  };
}

export function TrafficLight(props: { prop: WorldProp }) {
  const yaw = props.prop.yawDegrees;
  const height = propKindDefinition(props.prop.kind).heightMeters;
  const armReach = 1.4;

  // Low-rate self-tick so the lit lamp tracks the cycle without re-rendering the
  // whole world. A handful of lights at 4 Hz is negligible (no node storm).
  const [, setRefresh] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setRefresh((n) => (n + 1) & 0xffff), SIGNAL_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const lamps = lampColors(trafficSignalPhase(props.prop, trafficClockSeconds()));
  // TRAFFIC-HEAD-0610 (user report): the head used to hang at the arm's tip
  // FACING ALONG the arm — a quarter turn off a real mast-arm light. The arm
  // now cantilevers sideways (+X) over the road while the lamps keep facing
  // -Z at yaw 0 — the SAME facing world/traffic.ts gates the lane by, so what
  // the lamp looks at IS the approach it governs.
  const lensZ = -0.17;
  return (
    <>
      {/* Foundation, pole, cantilever arm (sideways, over the road) */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.24, height: 0.34, segments: 12 }} material={POLE_DARK} position={at(props.prop, [0, 0.17, 0])} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.1, height: height - 0.34, segments: 12 }} material={POLE} position={at(props.prop, [0, (height - 0.34) / 2 + 0.34, 0])} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.06, height: armReach, segments: 8 }} material={POLE} position={at(props.prop, [armReach / 2, height - 0.25, 0])} rotation={[90, yaw + 90, 0]} />
      {/* Signal head housing, hung from the arm's end */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.36, height: 1.12, depth: 0.3 }} material={HOUSING} position={at(props.prop, [armReach, height - 0.85, 0])} rotation={[0, yaw, 0]} />
      {/* Three lamp lenses on the front face (-Z at yaw 0 — the governed lane) */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.13, height: 0.07, segments: 14 }} material={lamps.red} position={at(props.prop, [armReach, height - 0.5, lensZ])} rotation={[90, yaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.13, height: 0.07, segments: 14 }} material={lamps.yellow} position={at(props.prop, [armReach, height - 0.85, lensZ])} rotation={[90, yaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.13, height: 0.07, segments: 14 }} material={lamps.green} position={at(props.prop, [armReach, height - 1.2, lensZ])} rotation={[90, yaw, 0]} />
    </>
  );
}
