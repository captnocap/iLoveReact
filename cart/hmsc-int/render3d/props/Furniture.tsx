import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../world/propKinds';
import type { V3 } from './place';
import { at } from './place';

// Furniture — chair, couch, table, floor lamp, and the park bench. All face
// -Z at yaw 0 (backrests sit at +Z, behind the sitter), the standard prop
// facing convention. Long pieces (couch, bench) span local X, matching the
// thin yaw-aware collision AABB in world/props.ts.

const WOOD = '#8a6240';
const WOOD_DARK = '#6b4a2e';
const METAL = '#3a3f46';
const CUSHION = '#7d4f43';
const CUSHION_LIGHT = '#96604f';
const LAMP_SHADE = '#e8d9b0';
const LAMP_GLOW = '#ffe9a8';

function Part(props: { prop: WorldProp; local: V3; size: V3; material: string; tiltX?: number }) {
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: props.size[0], height: props.size[1], depth: props.size[2] }}
      material={props.material}
      position={at(props.prop, props.local)}
      rotation={[props.tiltX ?? 0, props.prop.yawDegrees, 0]}
    />
  );
}

function Chair(props: { prop: WorldProp }) {
  const seatY = 0.45;
  const legs: V3[] = [[0.2, seatY / 2, 0.2], [-0.2, seatY / 2, 0.2], [0.2, seatY / 2, -0.2], [-0.2, seatY / 2, -0.2]];
  return (
    <>
      {legs.map((leg, index) => (
        <Part key={index} prop={props.prop} local={leg} size={[0.05, seatY, 0.05]} material={WOOD_DARK} />
      ))}
      <Part prop={props.prop} local={[0, seatY, 0]} size={[0.5, 0.06, 0.5]} material={WOOD} />
      {/* Backrest rises behind the sitter (+Z) */}
      <Part prop={props.prop} local={[0, seatY + 0.27, 0.23]} size={[0.5, 0.5, 0.05]} material={WOOD} tiltX={-6} />
    </>
  );
}

function Couch(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const w = def.footprintRadiusMeters * 2; // full length along X
  return (
    <>
      {/* Base frame */}
      <Part prop={props.prop} local={[0, 0.18, 0]} size={[w, 0.3, 0.85]} material={WOOD_DARK} />
      {/* Seat cushions */}
      <Part prop={props.prop} local={[-w * 0.225, 0.4, -0.05]} size={[w * 0.42, 0.16, 0.7]} material={CUSHION} />
      <Part prop={props.prop} local={[w * 0.225, 0.4, -0.05]} size={[w * 0.42, 0.16, 0.7]} material={CUSHION_LIGHT} />
      {/* Backrest along +Z */}
      <Part prop={props.prop} local={[0, 0.55, 0.34]} size={[w, 0.6, 0.22]} material={CUSHION} tiltX={-4} />
      {/* Armrests */}
      <Part prop={props.prop} local={[-w * 0.46, 0.45, 0]} size={[w * 0.09, 0.55, 0.8]} material={CUSHION_LIGHT} />
      <Part prop={props.prop} local={[w * 0.46, 0.45, 0]} size={[w * 0.09, 0.55, 0.8]} material={CUSHION_LIGHT} />
    </>
  );
}

function Table(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const topY = def.heightMeters - 0.04;
  const half = def.footprintRadiusMeters - 0.08;
  const legs: V3[] = [[half, topY / 2, half], [-half, topY / 2, half], [half, topY / 2, -half], [-half, topY / 2, -half]];
  return (
    <>
      {legs.map((leg, index) => (
        <Part key={index} prop={props.prop} local={leg} size={[0.07, topY, 0.07]} material={WOOD_DARK} />
      ))}
      <Part prop={props.prop} local={[0, topY + 0.02, 0]} size={[def.footprintRadiusMeters * 2, 0.06, def.footprintRadiusMeters * 2]} material={WOOD} />
    </>
  );
}

function FloorLamp(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  return (
    <>
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.17, height: 0.04, segments: 14 }} material={METAL} position={at(props.prop, [0, 0.02, 0])} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.022, height: h - 0.34, segments: 8 }} material={METAL} position={at(props.prop, [0, (h - 0.34) / 2 + 0.04, 0])} />
      {/* Warm bulb inside an upside-down cone shade */}
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.07, segments: 10, rings: 8 }} material={LAMP_GLOW} position={at(props.prop, [0, h - 0.26, 0])} />
      <Scene3D.Mesh geometry={Geometry.Cone} params={{ radius: 0.21, height: 0.3, segments: 14 }} material={LAMP_SHADE} position={at(props.prop, [0, h - 0.15, 0])} rotation={[180, 0, 0]} />
    </>
  );
}

function Bench(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const w = def.footprintRadiusMeters * 2; // full length along X
  const seatY = 0.45;
  return (
    <>
      {/* Cast end frames */}
      <Part prop={props.prop} local={[-w * 0.44, seatY / 2, 0]} size={[0.06, seatY, 0.5]} material={METAL} />
      <Part prop={props.prop} local={[w * 0.44, seatY / 2, 0]} size={[0.06, seatY, 0.5]} material={METAL} />
      {/* Seat slats */}
      <Part prop={props.prop} local={[0, seatY, -0.14]} size={[w, 0.04, 0.13]} material={WOOD} />
      <Part prop={props.prop} local={[0, seatY, 0.02]} size={[w, 0.04, 0.13]} material={WOOD_DARK} />
      <Part prop={props.prop} local={[0, seatY, 0.18]} size={[w, 0.04, 0.13]} material={WOOD} />
      {/* Back slats, leaning back */}
      <Part prop={props.prop} local={[0, seatY + 0.24, 0.26]} size={[w, 0.12, 0.04]} material={WOOD} tiltX={-12} />
      <Part prop={props.prop} local={[0, seatY + 0.38, 0.29]} size={[w, 0.12, 0.04]} material={WOOD_DARK} tiltX={-12} />
    </>
  );
}

export function Furniture(props: { prop: WorldProp }) {
  switch (props.prop.kind) {
    case 'couch': return <Couch prop={props.prop} />;
    case 'table': return <Table prop={props.prop} />;
    case 'floorLamp': return <FloorLamp prop={props.prop} />;
    case 'bench': return <Bench prop={props.prop} />;
    case 'chair':
    default:
      return <Chair prop={props.prop} />;
  }
}
