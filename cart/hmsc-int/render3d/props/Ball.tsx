import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../game/kinds/props';
import { at } from './place';

// Balls — a sphere resting on the ground (center at one radius up), dressed by
// kind: beach ball gets two colored bands, soccer ball gets black patches,
// basketball gets black seams. The kind's footprintRadiusMeters IS the ball
// radius, so the mesh and the collision square agree. Solid — the player bumps
// them (rolling/kick dynamics is a separate system; props are static today).

const BEACH_BODY = '#f4f1e8';
const BEACH_RED = '#e0452f';
const BEACH_BLUE = '#2f6fe0';
const SOCCER_BODY = '#f0f0ee';
const SOCCER_PATCH = '#1c1c20';
const BASKETBALL_BODY = '#d3722c';
const BASKETBALL_SEAM = '#2a1c12';

// Evenly-ish spread points on the upper hemisphere + equator for soccer patches.
const SOCCER_PATCHES: [number, number][] = [
  // [azimuth degrees, elevation degrees]
  [0, 65],
  [80, 20],
  [160, 45],
  [240, 15],
  [320, 40],
  [120, -10],
  [280, -20],
];

export function Ball(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const r = def.footprintRadiusMeters;
  const yaw = props.prop.yawDegrees;
  const center: [number, number, number] = [0, r, 0];
  const body =
    props.prop.kind === 'ballBeach' ? BEACH_BODY :
    props.prop.kind === 'ballBasketball' ? BASKETBALL_BODY :
    SOCCER_BODY;
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Sphere}
        params={{ radius: 1, segments: 16, rings: 12 }}
        scale={[r, r, r]}
        material={body}
        position={at(props.prop, center)}
      />
      {props.prop.kind === 'ballBeach' && (
        <>
          {/* Two colored bands wrapping the ball */}
          <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.82, tube: 0.24, segments: 20, sides: 10 }} scale={[r, r, r]} material={BEACH_RED} position={at(props.prop, center)} rotation={[0, yaw, 0]} />
          <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.82, tube: 0.24, segments: 20, sides: 10 }} scale={[r, r, r]} material={BEACH_BLUE} position={at(props.prop, center)} rotation={[90, yaw, 0]} />
        </>
      )}
      {props.prop.kind === 'ballSoccer' && SOCCER_PATCHES.map(([azimuth, elevation], index) => {
        const a = azimuth * Math.PI / 180;
        const e = elevation * Math.PI / 180;
        const px = Math.cos(e) * Math.cos(a);
        const py = Math.sin(e);
        const pz = Math.cos(e) * Math.sin(a);
        return (
          <Scene3D.Mesh
            key={index}
            geometry={Geometry.Sphere}
            params={{ radius: 1, segments: 8, rings: 6 }}
            scale={[r * 0.3, r * 0.3, r * 0.3]}
            material={SOCCER_PATCH}
            position={at(props.prop, [center[0] + px * r * 0.86, center[1] + py * r * 0.86, center[2] + pz * r * 0.86])}
          />
        );
      })}
      {props.prop.kind === 'ballBasketball' && (
        <>
          {/* Seam rings: one equator, two vertical */}
          <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.99, tube: 0.035, segments: 22, sides: 8 }} scale={[r, r, r]} material={BASKETBALL_SEAM} position={at(props.prop, center)} rotation={[0, yaw, 0]} />
          <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.99, tube: 0.035, segments: 22, sides: 8 }} scale={[r, r, r]} material={BASKETBALL_SEAM} position={at(props.prop, center)} rotation={[90, yaw, 0]} />
          <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.99, tube: 0.035, segments: 22, sides: 8 }} scale={[r, r, r]} material={BASKETBALL_SEAM} position={at(props.prop, center)} rotation={[90, yaw + 90, 0]} />
        </>
      )}
    </>
  );
}
