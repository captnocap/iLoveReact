import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../world/propKinds';
import type { V3 } from './place';
import { at } from './place';

// Street furniture beyond the signage family: the work-zone traffic cone, the
// concrete jersey barrier (spans local X, matching its thin yaw-aware collision
// AABB in world/props.ts), the public trash can, and the sidewalk planter.

const CONE_ORANGE = '#e8682a';
const CONE_BAND = '#f2efe8';
const CONCRETE = '#9a9a92';
const CONCRETE_DARK = '#82827a';
const CAN_BODY = '#3f5747';
const CAN_DARK = '#32463a';
const TERRACOTTA = '#a8593a';
const SOIL = '#3e2f22';
const LEAF_MID = '#2f6b2f';
const LEAF_LIGHT = '#43883a';
const FLOWER_PINK = '#d65d8a';
const FLOWER_YELLOW = '#e8c84a';

function TrafficCone(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const yaw = props.prop.yawDegrees;
  return (
    <>
      {/* Square base plate */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: def.footprintRadiusMeters * 2, height: h * 0.06, depth: def.footprintRadiusMeters * 2 }} material={CONE_ORANGE} position={at(props.prop, [0, h * 0.03, 0])} rotation={[0, yaw, 0]} />
      {/* The cone */}
      <Scene3D.Mesh geometry={Geometry.Cone} params={{ radius: h * 0.21, height: h * 0.94, segments: 12 }} material={CONE_ORANGE} position={at(props.prop, [0, h * 0.53, 0])} />
      {/* Reflective band */}
      <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: h * 0.125, tube: h * 0.035, segments: 14, sides: 8 }} scale={[1, 1.6, 1]} material={CONE_BAND} position={at(props.prop, [0, h * 0.52, 0])} />
    </>
  );
}

function Barrier(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const w = def.footprintRadiusMeters * 2; // full length along X
  const h = def.heightMeters;
  const yaw = props.prop.yawDegrees;
  const tier = (local: V3, size: V3, material: string) => (
    <Scene3D.Mesh geometry={Geometry.Box} params={{ width: size[0], height: size[1], depth: size[2] }} material={material} position={at(props.prop, local)} rotation={[0, yaw, 0]} />
  );
  return (
    <>
      {/* The jersey profile: wide foot, tapered middle, narrow crown */}
      {tier([0, h * 0.14, 0], [w, h * 0.28, 0.6], CONCRETE_DARK)}
      {tier([0, h * 0.47, 0], [w, h * 0.42, 0.4], CONCRETE)}
      {tier([0, h * 0.85, 0], [w, h * 0.3, 0.24], CONCRETE)}
      {/* Lift slot shadows on the foot */}
      {tier([-w * 0.3, h * 0.1, 0], [0.18, h * 0.12, 0.62], CONCRETE_DARK)}
      {tier([w * 0.3, h * 0.1, 0], [0.18, h * 0.12, 0.62], CONCRETE_DARK)}
    </>
  );
}

function TrashCan(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const r = def.footprintRadiusMeters;
  const yaw = props.prop.yawDegrees;
  return (
    <>
      {/* Body with rim */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: r * 0.92, height: h * 0.78, segments: 14 }} material={CAN_BODY} position={at(props.prop, [0, h * 0.41, 0])} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: r, height: h * 0.05, segments: 14 }} material={CAN_DARK} position={at(props.prop, [0, h * 0.82, 0])} />
      {/* Domed lid + swing flap on the front */}
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: r, segments: 14, rings: 8 }} scale={[1, 0.45, 1]} material={CAN_DARK} position={at(props.prop, [0, h * 0.84, 0])} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: r * 1.1, height: h * 0.16, depth: 0.02 }} material={CAN_BODY} position={at(props.prop, [0, h * 0.86, -r * 0.7])} rotation={[18, yaw, 0]} />
    </>
  );
}

function Planter(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const half = def.footprintRadiusMeters;
  const yaw = props.prop.yawDegrees;
  const boxH = h * 0.7;
  const greens: { local: V3; scale: V3; material: string }[] = [
    { local: [-half * 0.4, boxH + h * 0.18, -half * 0.2], scale: [half * 0.4, h * 0.28, half * 0.4], material: LEAF_MID },
    { local: [half * 0.35, boxH + h * 0.14, half * 0.25], scale: [half * 0.38, h * 0.24, half * 0.38], material: LEAF_LIGHT },
    { local: [0, boxH + h * 0.22, 0], scale: [half * 0.42, h * 0.3, half * 0.42], material: LEAF_MID },
  ];
  return (
    <>
      {/* Terracotta box with a soil bed */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: half * 2, height: boxH, depth: half * 2 }} material={TERRACOTTA} position={at(props.prop, [0, boxH / 2, 0])} rotation={[0, yaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: half * 1.8, height: h * 0.06, depth: half * 1.8 }} material={SOIL} position={at(props.prop, [0, boxH, 0])} rotation={[0, yaw, 0]} />
      {greens.map((green, index) => (
        <Scene3D.Mesh key={index} geometry={Geometry.Sphere} params={{ radius: 1, segments: 10, rings: 7 }} scale={green.scale} material={green.material} position={at(props.prop, green.local)} />
      ))}
      {/* Flowers poking out */}
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: h * 0.06, segments: 8, rings: 6 }} material={FLOWER_PINK} position={at(props.prop, [-half * 0.45, boxH + h * 0.38, half * 0.15])} />
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: h * 0.055, segments: 8, rings: 6 }} material={FLOWER_YELLOW} position={at(props.prop, [half * 0.4, boxH + h * 0.34, -half * 0.2])} />
    </>
  );
}

// A creosote utility pole: tall timber, two crossarms near the top with
// insulator pegs. Spans no wires — those belong to a future catenary pass.
function TelephonePole(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const r = def.footprintRadiusMeters;
  const yaw = props.prop.yawDegrees;
  const wood = '#4f3d2a';
  const woodDark = '#3e3021';
  const insulator = '#9aa8b5';
  const arm = (y: number, width: number) => (
    <>
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width, height: 0.09, depth: 0.09 }} material={woodDark} position={at(props.prop, [0, y, 0])} rotation={[0, yaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.03, height: 0.1, segments: 6 }} material={insulator} position={at(props.prop, [-width * 0.42, y + 0.08, 0])} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.03, height: 0.1, segments: 6 }} material={insulator} position={at(props.prop, [width * 0.42, y + 0.08, 0])} />
    </>
  );
  return (
    <>
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: r * 0.8, height: h, segments: 8 }} material={wood} position={at(props.prop, [0, h / 2, 0])} />
      {arm(h * 0.92, 1.7)}
      {arm(h * 0.82, 1.3)}
    </>
  );
}

// A street basketball hoop: pole, angled brace, white backboard with the
// target square, orange rim at ~3.05m facing -Z.
function BasketballHoop(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const yaw = props.prop.yawDegrees;
  const pole = '#3a3f46';
  const board = '#e8eaec';
  const rim = '#d3722c';
  const rimY = 3.05;
  const boardZ = -0.35;
  return (
    <>
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.07, height: h - 0.4, segments: 10 }} material={pole} position={at(props.prop, [0, (h - 0.4) / 2, 0])} />
      {/* Brace reaching forward to the board */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.06, height: 0.06, depth: 0.42 }} material={pole} position={at(props.prop, [0, h - 0.45, boardZ / 2])} rotation={[14, yaw, 0]} />
      {/* Backboard + target square (faces -Z) */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1.1, height: 0.75, depth: 0.04 }} material={board} position={at(props.prop, [0, rimY + 0.32, boardZ])} rotation={[0, yaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.45, height: 0.32, depth: 0.015 }} material={rim} position={at(props.prop, [0, rimY + 0.2, boardZ - 0.018])} rotation={[0, yaw, 0]} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 0.34, height: 0.22, depth: 0.018 }} material={board} position={at(props.prop, [0, rimY + 0.19, boardZ - 0.02])} rotation={[0, yaw, 0]} />
      {/* The rim, hanging forward off the board */}
      <Scene3D.Mesh geometry={Geometry.Torus} params={{ radius: 0.23, tube: 0.025, segments: 18, sides: 8 }} material={rim} position={at(props.prop, [0, rimY, boardZ - 0.26])} rotation={[0, yaw, 0]} />
    </>
  );
}

export function StreetFurniture(props: { prop: WorldProp }) {
  switch (props.prop.kind) {
    case 'barrier': return <Barrier prop={props.prop} />;
    case 'trashCan': return <TrashCan prop={props.prop} />;
    case 'planter': return <Planter prop={props.prop} />;
    case 'telephonePole': return <TelephonePole prop={props.prop} />;
    case 'basketballHoop': return <BasketballHoop prop={props.prop} />;
    case 'trafficCone':
    default:
      return <TrafficCone prop={props.prop} />;
  }
}
