import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { propKindDefinition } from '../../game/kinds/props';
import { at, type V3 } from './place';

// The tree family — six silhouettes that read at a glance: oak (broad blob
// canopy), pine (stacked cones), birch (slim pale trunk, light oval canopy),
// cypress (tall dark column), palm (leaning trunk, splayed fronds), dead
// (bare angled branches). Every shape derives from its kind's heightMeters and
// trunk footprintRadiusMeters, so resizing a tree is a propKinds.ts edit. The
// collision footprint is the TRUNK — you bump the trunk and walk under the
// canopy edge. Canopy blobs follow the Bush rule (one scaled unit sphere per
// blob) so all trees instance cheaply.

const BARK = '#5c4631';
const BARK_DARK = '#4a3826';
const BARK_PALE = '#d8d4c8';
const LEAF_DARK = '#1f4a20';
const LEAF_MID = '#2f6b2f';
const LEAF_LIGHT = '#43883a';
const LEAF_PALE = '#6aa84f';
const PINE_DARK = '#1d3d24';
const PINE_MID = '#26512e';
const PALM_FROND = '#3a7d36';
const DEAD_WOOD = '#6e5d4b';

function Blob(props: { prop: WorldProp; local: V3; scale: V3; material: string; rotation?: [number, number, number] }) {
  return (
    <Scene3D.Mesh
      geometry={Geometry.Sphere}
      params={{ radius: 1, segments: 12, rings: 8 }}
      scale={props.scale}
      material={props.material}
      position={at(props.prop, props.local)}
      rotation={props.rotation}
    />
  );
}

function Trunk(props: { prop: WorldProp; radius: number; height: number; material?: string; local?: V3 }) {
  const base = props.local ?? [0, 0, 0];
  return (
    <Scene3D.Mesh
      geometry={Geometry.Cylinder}
      params={{ radius: props.radius, height: props.height, segments: 10 }}
      material={props.material ?? BARK}
      position={at(props.prop, [base[0], base[1] + props.height / 2, base[2]])}
    />
  );
}

// Broad deciduous tree: stout trunk, big clustered canopy filling the top half.
function Oak(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const r = def.footprintRadiusMeters;
  const canopy = h * 0.32;
  return (
    <>
      <Trunk prop={props.prop} radius={r} height={h * 0.48} />
      <Blob prop={props.prop} local={[0, h * 0.66, 0]} scale={[canopy, canopy * 0.85, canopy]} material={LEAF_MID} />
      <Blob prop={props.prop} local={[canopy * 0.7, h * 0.58, canopy * 0.25]} scale={[canopy * 0.65, canopy * 0.55, canopy * 0.65]} material={LEAF_DARK} />
      <Blob prop={props.prop} local={[-canopy * 0.65, h * 0.6, -canopy * 0.3]} scale={[canopy * 0.6, canopy * 0.5, canopy * 0.6]} material={LEAF_LIGHT} />
      <Blob prop={props.prop} local={[canopy * 0.15, h * 0.62, -canopy * 0.7]} scale={[canopy * 0.55, canopy * 0.5, canopy * 0.55]} material={LEAF_DARK} />
      <Blob prop={props.prop} local={[-canopy * 0.2, h * 0.6, canopy * 0.68]} scale={[canopy * 0.55, canopy * 0.48, canopy * 0.55]} material={LEAF_LIGHT} />
      <Blob prop={props.prop} local={[0, h * 0.84, 0]} scale={[canopy * 0.55, canopy * 0.45, canopy * 0.55]} material={LEAF_MID} />
    </>
  );
}

// Conifer: three stacked cones narrowing to the tip.
function Pine(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const r = def.footprintRadiusMeters;
  const tiers: { y: number; radius: number; height: number; material: string }[] = [
    { y: h * 0.38, radius: h * 0.21, height: h * 0.36, material: PINE_DARK },
    { y: h * 0.6, radius: h * 0.165, height: h * 0.32, material: PINE_MID },
    { y: h * 0.82, radius: h * 0.115, height: h * 0.3, material: PINE_DARK },
  ];
  return (
    <>
      <Trunk prop={props.prop} radius={r} height={h * 0.32} material={BARK_DARK} />
      {tiers.map((tier, index) => (
        <Scene3D.Mesh
          key={index}
          geometry={Geometry.Cone}
          params={{ radius: tier.radius, height: tier.height, segments: 12 }}
          material={tier.material}
          position={at(props.prop, [0, tier.y, 0])}
        />
      ))}
    </>
  );
}

// Slim pale trunk with dark bark bands and an airy light-green oval canopy.
function Birch(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const r = def.footprintRadiusMeters;
  const canopy = h * 0.22;
  const yaw = props.prop.yawDegrees;
  return (
    <>
      <Trunk prop={props.prop} radius={r} height={h * 0.62} material={BARK_PALE} />
      {/* Bark bands */}
      {[0.18, 0.34, 0.5].map((frac, index) => (
        <Scene3D.Mesh
          key={index}
          geometry={Geometry.Box}
          params={{ width: r * 2.1, height: h * 0.025, depth: r * 2.1 }}
          material={BARK_DARK}
          position={at(props.prop, [0, h * frac, 0])}
          rotation={[0, yaw + index * 30, 0]}
        />
      ))}
      <Blob prop={props.prop} local={[0, h * 0.74, 0]} scale={[canopy, canopy * 1.15, canopy]} material={LEAF_PALE} />
      <Blob prop={props.prop} local={[canopy * 0.55, h * 0.68, canopy * 0.3]} scale={[canopy * 0.6, canopy * 0.7, canopy * 0.6]} material={LEAF_LIGHT} />
      <Blob prop={props.prop} local={[-canopy * 0.5, h * 0.7, -canopy * 0.35]} scale={[canopy * 0.55, canopy * 0.65, canopy * 0.55]} material={LEAF_PALE} />
    </>
  );
}

// Tall narrow column — the Mediterranean roadside silhouette.
function Cypress(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const r = def.footprintRadiusMeters;
  return (
    <>
      <Trunk prop={props.prop} radius={r * 0.6} height={h * 0.14} material={BARK_DARK} />
      <Blob prop={props.prop} local={[0, h * 0.5, 0]} scale={[h * 0.13, h * 0.42, h * 0.13]} material={PINE_DARK} />
      <Blob prop={props.prop} local={[0, h * 0.78, 0]} scale={[h * 0.09, h * 0.22, h * 0.09]} material={PINE_MID} />
      <Blob prop={props.prop} local={[h * 0.04, h * 0.4, -h * 0.03]} scale={[h * 0.11, h * 0.3, h * 0.11]} material={PINE_MID} />
    </>
  );
}

// Leaning segmented trunk, splayed frond ring, coconuts. The trunk drifts in
// local +X as it climbs, so the crown hangs off-axis like a beach palm.
function Palm(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const r = def.footprintRadiusMeters;
  const segments = 4;
  const lean = h * 0.18; // total crown drift in local +X
  const crown: V3 = [lean, h * 0.92, 0];
  const fronds = 7;
  const frondLength = h * 0.34;
  return (
    <>
      {Array.from({ length: segments }, (_, index) => {
        const t = index / segments;
        const segH = (h * 0.92) / segments;
        return (
          <Scene3D.Mesh
            key={index}
            geometry={Geometry.Cylinder}
            params={{ radius: r * (1 - t * 0.35), height: segH * 1.1, segments: 8 }}
            material={index % 2 === 0 ? BARK : BARK_DARK}
            position={at(props.prop, [lean * (t + 0.5 / segments), segH * (index + 0.5), 0])}
          />
        );
      })}
      {/* Frond ring — long flattened blobs yawed radially around the crown */}
      {Array.from({ length: fronds }, (_, index) => {
        const a = (index / fronds) * 360;
        const rad = a * Math.PI / 180;
        const reach = frondLength * 0.55;
        return (
          <Blob
            key={index}
            prop={props.prop}
            local={[crown[0] + Math.cos(rad) * reach, crown[1] - h * 0.02, crown[2] + Math.sin(rad) * reach]}
            scale={[frondLength, h * 0.025, frondLength * 0.22]}
            material={PALM_FROND}
            rotation={[0, props.prop.yawDegrees - a, 0]}
          />
        );
      })}
      {/* Crown heart + coconuts */}
      <Blob prop={props.prop} local={crown} scale={[h * 0.06, h * 0.05, h * 0.06]} material={PINE_MID} />
      <Blob prop={props.prop} local={[crown[0] + h * 0.035, crown[1] - h * 0.035, crown[2] + h * 0.02]} scale={[h * 0.028, h * 0.028, h * 0.028]} material={BARK_DARK} />
      <Blob prop={props.prop} local={[crown[0] - h * 0.03, crown[1] - h * 0.035, crown[2] - h * 0.025]} scale={[h * 0.028, h * 0.028, h * 0.028]} material={BARK_DARK} />
    </>
  );
}

// Bare weathered trunk with a few angled dead branches. No leaves.
function Dead(props: { prop: WorldProp }) {
  const def = propKindDefinition(props.prop.kind);
  const h = def.heightMeters;
  const r = def.footprintRadiusMeters;
  const yaw = props.prop.yawDegrees;
  const branches: { y: number; angle: number; tilt: number; length: number }[] = [
    { y: h * 0.55, angle: 20, tilt: 55, length: h * 0.4 },
    { y: h * 0.68, angle: 150, tilt: 48, length: h * 0.34 },
    { y: h * 0.78, angle: 265, tilt: 40, length: h * 0.3 },
    { y: h * 0.88, angle: 80, tilt: 25, length: h * 0.24 },
  ];
  return (
    <>
      <Trunk prop={props.prop} radius={r} height={h * 0.92} material={DEAD_WOOD} />
      {branches.map((branch, index) => {
        const rad = branch.angle * Math.PI / 180;
        const tiltRad = branch.tilt * Math.PI / 180;
        const reach = (branch.length / 2) * Math.sin(tiltRad);
        return (
          <Scene3D.Mesh
            key={index}
            geometry={Geometry.Cylinder}
            params={{ radius: r * 0.32, height: branch.length, segments: 6 }}
            material={index % 2 === 0 ? DEAD_WOOD : BARK_DARK}
            position={at(props.prop, [Math.cos(rad) * reach, branch.y + (branch.length / 2) * Math.cos(tiltRad), Math.sin(rad) * reach])}
            rotation={[Math.sin(rad) * branch.tilt, yaw, -Math.cos(rad) * branch.tilt]}
          />
        );
      })}
    </>
  );
}

export function Tree(props: { prop: WorldProp }) {
  switch (props.prop.kind) {
    // Size variants (PROPBATCH-0611) share the species model — every
    // dimension derives from the registry's height/footprint.
    case 'treePine':
    case 'treePineYoung':
    case 'treePineGiant':
      return <Pine prop={props.prop} />;
    case 'treeBirch': return <Birch prop={props.prop} />;
    case 'treeCypress': return <Cypress prop={props.prop} />;
    case 'treePalm': return <Palm prop={props.prop} />;
    case 'treeDead': return <Dead prop={props.prop} />;
    case 'treeOak':
    case 'treeOakYoung':
    case 'treeOakGiant':
    default:
      return <Oak prop={props.prop} />;
  }
}
