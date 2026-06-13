// mineProp — MINE a prop's self-contained component asset into flat PropPartSpec
// data (GUIDING_LIGHT: the component is the ONE source; the recipe is DERIVED,
// never a hand-kept second copy).
//
// A prop asset (render3d/props/<Prop>.tsx) is a pure function: given a prop it
// returns a tree of <Scene3D.Mesh geometry params scale position rotation
// material>. We evaluate it with a CANONICAL prop (origin, yaw 0) — so each
// mesh's `position` IS its local offset (at(prop,local) collapses to local) and
// `rotation` is the local rotation — then walk the React element tree and lower
// every Scene3D.Mesh to a {shape, local, size, color, rotation} spec. This is
// the exact inverse of DataProp.partGeometry, so render==bake==mine by
// construction. Authoring/compile-time only — it never runs in a frame (it
// produces the artifact the host then reads as data).

import { Fragment } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { hx, type Color, type PropPartSpec, type Rotation } from '../../game/kinds/propModels';

type PropComponent = (props: { prop: WorldProp }) => any;

function scaleAxis(scale: unknown, i: number): number {
  if (Array.isArray(scale)) return (scale[i] as number) ?? 1;
  if (typeof scale === 'number') return scale;
  return 1;
}

function materialColor(material: unknown): { color: Color; opacity?: number } {
  if (typeof material === 'string') return { color: hx(material) };
  if (material && typeof material === 'object') {
    const m = material as { color?: string; opacity?: number };
    return { color: hx(m.color ?? '#888888'), opacity: m.opacity };
  }
  return { color: hx('#888888') };
}

// One <Scene3D.Mesh>'s resolved props → a PropPartSpec. Sizes invert each
// geometry's params exactly as DataProp/the recipe helpers express them.
function meshToSpec(props: any): PropPartSpec {
  const geo = props.geometry;
  const p = props.params ?? {};
  const sx = scaleAxis(props.scale, 0), sy = scaleAxis(props.scale, 1), sz = scaleAxis(props.scale, 2);
  const local = (props.position ?? [0, 0, 0]) as readonly [number, number, number];
  const rotation = props.rotation as Rotation | undefined;
  const { color, opacity } = materialColor(props.material);

  let shape: PropPartSpec['shape'];
  let size: readonly [number, number, number];
  if (geo === Geometry.Cylinder) {
    const segments = (p.segments ?? 16) as number;
    shape = segments <= 8 ? 'cylinder8' : 'cylinder16';
    const d = (p.radius ?? 0.5) * 2;
    size = [d * sx, (p.height ?? 1) * sy, d * sz];
  } else if (geo === Geometry.Sphere) {
    shape = 'sphere';
    const d = (p.radius ?? 0.5) * 2;
    size = [d * sx, d * sy, d * sz];
  } else {
    // Box (and any unit-box-scaled mesh): size = params × scale.
    shape = 'box';
    size = [(p.width ?? 1) * sx, (p.height ?? 1) * sy, (p.depth ?? 1) * sz];
  }
  const spec: PropPartSpec = { shape, local, size, color };
  if (rotation && (rotation[0] || rotation[1] || rotation[2])) spec.rotation = rotation;
  if (opacity != null && opacity < 1) spec.opacity = opacity;
  return spec;
}

// Walk a React element tree, calling pure sub-components, collecting the resolved
// props of every <Scene3D.Mesh>. Scene3D.Mesh is matched by reference and its
// props read directly — it is never rendered (so no GPU/host is touched).
function collectMeshProps(node: any, out: any[]): void {
  if (node == null || node === false || node === true || typeof node === 'string' || typeof node === 'number') return;
  if (Array.isArray(node)) { for (const child of node) collectMeshProps(child, out); return; }
  if (typeof node !== 'object') return;
  const type = node.type;
  if (type === Scene3D.Mesh) { out.push(node.props ?? {}); return; }
  if (type === Fragment) { collectMeshProps(node.props?.children, out); return; }
  if (typeof type === 'function') {
    // a pure sub-component (a model's local Part helper, Chair, etc.) — evaluate
    // it and recurse. Hook-using components can't be mined this way (caught by
    // the caller); the prop assets are pure but for one (TrafficLight).
    collectMeshProps(type(node.props ?? {}), out);
    return;
  }
  // any other host element (e.g. a wrapping View) — recurse its children.
  if (node.props?.children !== undefined) collectMeshProps(node.props.children, out);
}

/** Mine a prop component asset into its flat parts, evaluated at the kind's real
 *  scale (the asset reads heightMeters off the kind) but at origin/yaw 0 so the
 *  mesh positions ARE the local offsets. */
export function mineProp(component: PropComponent, kind: WorldProp['kind']): PropPartSpec[] {
  const prop = { kind, x: 0, y: 0, z: 0, yawDegrees: 0, createdByCommand: 'mineProp' } as WorldProp;
  const meshes: any[] = [];
  collectMeshProps(component({ prop }), meshes);
  return meshes.map(meshToSpec);
}
