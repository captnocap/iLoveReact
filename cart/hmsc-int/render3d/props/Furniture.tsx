import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../game/kinds/props';
import type { V3 } from './place';
import { at } from './place';

// Furniture — chairs (wood + painted variants), couch, table, floor lamp, the
// park bench, and the household set (beds, cupboard, sink, oven, fridge,
// computer). All face -Z at yaw 0 (backrests sit at +Z, behind the sitter),
// the standard prop facing convention. Long pieces (couch, bench, beds,
// cupboard) span local X, matching the thin yaw-aware collision AABB in
// world/props.ts.

const WOOD = '#8a6240';
const WOOD_DARK = '#6b4a2e';
const METAL = '#3a3f46';
const CUSHION = '#7d4f43';
const CUSHION_LIGHT = '#96604f';
const LAMP_SHADE = '#e8d9b0';
const LAMP_GLOW = '#ffe9a8';
const LINEN = '#ece8dd';
const APPLIANCE = '#d6d9dc';
const APPLIANCE_DARK = '#aab0b6';
const APPLIANCE_BLACK = '#22262b';
const PORCELAIN = '#eef0f2';

// Painted chair variants: seat/back color per kind; wood chair keeps wood legs,
// painted chairs get dark metal legs (the molded-plastic diner look).
const CHAIR_PAINT: Partial<Record<WorldProp['kind'], { body: string; legs: string }>> = {
  chairRed: { body: '#b03a2e', legs: METAL },
  chairBlue: { body: '#2e6fb0', legs: METAL },
  chairGreen: { body: '#3a8f4f', legs: METAL },
};

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
  const paint = CHAIR_PAINT[props.prop.kind];
  const body = paint?.body ?? WOOD;
  const legColor = paint?.legs ?? WOOD_DARK;
  const seatY = 0.45;
  const legs: V3[] = [[0.2, seatY / 2, 0.2], [-0.2, seatY / 2, 0.2], [0.2, seatY / 2, -0.2], [-0.2, seatY / 2, -0.2]];
  return (
    <>
      {legs.map((leg, index) => (
        <Part key={index} prop={props.prop} local={leg} size={[0.05, seatY, 0.05]} material={legColor} />
      ))}
      <Part prop={props.prop} local={[0, seatY, 0]} size={[0.5, 0.06, 0.5]} material={body} />
      {/* Backrest rises behind the sitter (+Z) */}
      <Part prop={props.prop} local={[0, seatY + 0.27, 0.23]} size={[0.5, 0.5, 0.05]} material={body} tiltX={-6} />
    </>
  );
}

// Beds span local X with the headboard at +X. Single gets one pillow and a
// teal blanket; double widens, takes two pillows and a maroon blanket.
function Bed(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const double = props.prop.kind === 'bedDouble';
  const w = def.footprintRadiusMeters * 2; // full length along X
  const d = double ? 1.5 : 1.0; // width across Z
  const blanket = double ? '#7d3b4a' : '#3a7d80';
  const pillows: V3[] = double
    ? [[w * 0.36, 0.5, -d * 0.22], [w * 0.36, 0.5, d * 0.22]]
    : [[w * 0.36, 0.5, 0]];
  return (
    <>
      {/* Frame + mattress */}
      <Part prop={props.prop} local={[0, 0.15, 0]} size={[w, 0.3, d]} material={WOOD_DARK} />
      <Part prop={props.prop} local={[0, 0.39, 0]} size={[w * 0.97, 0.18, d * 0.94]} material={LINEN} />
      {/* Blanket over the foot half */}
      <Part prop={props.prop} local={[-w * 0.16, 0.49, 0]} size={[w * 0.62, 0.06, d * 0.96]} material={blanket} />
      {pillows.map((pillow, index) => (
        <Part key={index} prop={props.prop} local={pillow} size={[w * 0.2, 0.1, d * (double ? 0.36 : 0.55)]} material={PORCELAIN} />
      ))}
      {/* Headboard at +X */}
      <Part prop={props.prop} local={[w * 0.49, def.heightMeters / 2, 0]} size={[0.07, def.heightMeters, d]} material={WOOD} />
    </>
  );
}

// A tall two-door wardrobe spanning local X, doors facing -Z.
function Cupboard(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const w = def.footprintRadiusMeters * 2;
  const d = 0.5;
  return (
    <>
      <Part prop={props.prop} local={[0, 0.04, 0]} size={[w, 0.08, d]} material={WOOD_DARK} />
      <Part prop={props.prop} local={[0, h / 2, 0]} size={[w, h - 0.12, d - 0.06]} material={WOOD} />
      <Part prop={props.prop} local={[0, h - 0.03, 0]} size={[w + 0.04, 0.06, d]} material={WOOD_DARK} />
      {/* Door faces with a center seam + knobs */}
      <Part prop={props.prop} local={[-w * 0.24, h * 0.52, -d / 2 + 0.015]} size={[w * 0.44, h * 0.84, 0.02]} material={WOOD_DARK} />
      <Part prop={props.prop} local={[w * 0.24, h * 0.52, -d / 2 + 0.015]} size={[w * 0.44, h * 0.84, 0.02]} material={WOOD_DARK} />
      <Part prop={props.prop} local={[-w * 0.06, h * 0.55, -d / 2 - 0.005]} size={[0.035, 0.035, 0.035]} material={METAL} />
      <Part prop={props.prop} local={[w * 0.06, h * 0.55, -d / 2 - 0.005]} size={[0.035, 0.035, 0.035]} material={METAL} />
    </>
  );
}

// A pedestal bathroom sink: column, basin, faucet facing -Z.
function Sink(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const yaw = props.prop.yawDegrees;
  return (
    <>
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.09, height: h * 0.78, segments: 10 }} material={PORCELAIN} position={at(props.prop, [0, h * 0.39, 0])} />
      {/* Basin: a squashed sphere bowl with a flat rim plate */}
      <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.27, segments: 14, rings: 8 }} scale={[1, 0.42, 0.85]} material={PORCELAIN} position={at(props.prop, [0, h * 0.82, 0])} />
      <Part prop={props.prop} local={[0, h * 0.88, 0]} size={[0.56, 0.04, 0.46]} material={PORCELAIN} />
      {/* Faucet at the back (+Z), spout reaching forward */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.022, height: 0.16, segments: 8 }} material={APPLIANCE_DARK} position={at(props.prop, [0, h * 0.96, 0.16])} />
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.018, height: 0.14, segments: 8 }} material={APPLIANCE_DARK} position={at(props.prop, [0, h + 0.03, 0.09])} rotation={[90, yaw, 0]} />
    </>
  );
}

// A kitchen stove: body, oven door with a dark window, handle, four burners.
function Oven(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const w = def.footprintRadiusMeters * 2;
  const d = 0.62;
  const burners: V3[] = [[-w * 0.22, h + 0.012, -0.14], [w * 0.22, h + 0.012, -0.14], [-w * 0.22, h + 0.012, 0.14], [w * 0.22, h + 0.012, 0.14]];
  return (
    <>
      <Part prop={props.prop} local={[0, h / 2, 0]} size={[w, h, d]} material={APPLIANCE} />
      <Part prop={props.prop} local={[0, h, 0]} size={[w, 0.025, d]} material={APPLIANCE_BLACK} />
      {burners.map((burner, index) => (
        <Scene3D.Mesh key={index} geometry={Geometry.Cylinder} params={{ radius: 0.085, height: 0.02, segments: 12 }} material={'#33373c'} position={at(props.prop, burner)} />
      ))}
      {/* Oven door (faces -Z): window + handle */}
      <Part prop={props.prop} local={[0, h * 0.42, -d / 2 + 0.005]} size={[w * 0.86, h * 0.5, 0.02]} material={APPLIANCE_DARK} />
      <Part prop={props.prop} local={[0, h * 0.45, -d / 2 - 0.005]} size={[w * 0.6, h * 0.26, 0.015]} material={APPLIANCE_BLACK} />
      <Part prop={props.prop} local={[0, h * 0.72, -d / 2 - 0.02]} size={[w * 0.8, 0.035, 0.035]} material={METAL} />
    </>
  );
}

// A two-door fridge: tall body, freezer seam up top, bar handles, dark kick.
function Fridge(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const w = def.footprintRadiusMeters * 2;
  const d = 0.72;
  const seamY = h * 0.68;
  return (
    <>
      <Part prop={props.prop} local={[0, 0.04, 0]} size={[w * 0.9, 0.08, d * 0.9]} material={APPLIANCE_BLACK} />
      <Part prop={props.prop} local={[0, h / 2 + 0.04, 0]} size={[w, h - 0.08, d]} material={APPLIANCE} />
      {/* Door seam between fridge and freezer */}
      <Part prop={props.prop} local={[0, seamY, -d / 2 + 0.002]} size={[w, 0.02, 0.02]} material={APPLIANCE_DARK} />
      {/* Bar handles (door faces -Z) */}
      <Part prop={props.prop} local={[-w * 0.34, seamY - h * 0.18, -d / 2 - 0.025]} size={[0.035, h * 0.3, 0.035]} material={APPLIANCE_DARK} />
      <Part prop={props.prop} local={[-w * 0.34, seamY + h * 0.1, -d / 2 - 0.025]} size={[0.035, h * 0.14, 0.035]} material={APPLIANCE_DARK} />
    </>
  );
}

// A desktop setup at the anchor: CRT-ish monitor, keyboard, tower at its side.
// Drop it on any raised surface piece, or the floor.
function Computer(props: { prop: WorldProp }) {
  return (
    <>
      {/* Monitor: shell, screen, neck, foot */}
      <Part prop={props.prop} local={[-0.05, 0.32, 0.06]} size={[0.36, 0.3, 0.3]} material={'#cfc8b4'} />
      <Part prop={props.prop} local={[-0.05, 0.32, -0.095]} size={[0.3, 0.24, 0.012]} material={'#2c4a66'} />
      <Part prop={props.prop} local={[-0.05, 0.14, 0.06]} size={[0.12, 0.06, 0.12]} material={'#b8b2a0'} />
      <Part prop={props.prop} local={[-0.05, 0.1, 0.06]} size={[0.24, 0.025, 0.2]} material={'#b8b2a0'} />
      {/* Keyboard in front */}
      <Part prop={props.prop} local={[-0.05, 0.105, -0.21]} size={[0.34, 0.025, 0.12]} material={'#d9d3c2'} tiltX={4} />
      {/* Tower standing at the right */}
      <Part prop={props.prop} local={[0.24, 0.27, 0.02]} size={[0.16, 0.42, 0.38]} material={'#c4bda9'} />
      <Part prop={props.prop} local={[0.24, 0.38, -0.175]} size={[0.1, 0.03, 0.012]} material={APPLIANCE_BLACK} />
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
      {/* Back slats, leaning back — top lands at the registry's 0.98m (PROPSCALE-0611) */}
      <Part prop={props.prop} local={[0, seatY + 0.33, 0.26]} size={[w, 0.12, 0.04]} material={WOOD} tiltX={-12} />
      <Part prop={props.prop} local={[0, seatY + 0.47, 0.29]} size={[w, 0.12, 0.04]} material={WOOD_DARK} tiltX={-12} />
    </>
  );
}

export function Furniture(props: { prop: WorldProp }) {
  switch (props.prop.kind) {
    case 'couch': return <Couch prop={props.prop} />;
    case 'table': return <Table prop={props.prop} />;
    case 'floorLamp': return <FloorLamp prop={props.prop} />;
    case 'bench': return <Bench prop={props.prop} />;
    case 'bedSingle':
    case 'bedDouble':
      return <Bed prop={props.prop} />;
    case 'cupboard': return <Cupboard prop={props.prop} />;
    case 'sink': return <Sink prop={props.prop} />;
    case 'oven': return <Oven prop={props.prop} />;
    case 'fridge': return <Fridge prop={props.prop} />;
    case 'computer': return <Computer prop={props.prop} />;
    case 'chair':
    case 'chairRed':
    case 'chairBlue':
    case 'chairGreen':
    default:
      return <Chair prop={props.prop} />;
  }
}
