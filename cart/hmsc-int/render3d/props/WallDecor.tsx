import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import type { V3 } from './place';
import { at } from './place';

// Wall-mounted decor. The prop anchors at the WALL BASE on the floor; the
// decor hangs at height in local space, facing -Z at yaw 0 (the standard prop
// facing — place the anchor against a wall and yaw it to face the room).
//
// wallPainting — a framed landscape canvas at eye height.
// ledLight — a vertical glowing tube on two mounts (bright emissive-read color;
// Scene3D materials are unlit colors, so saturation IS the glow).

const FRAME = '#3d2b1c';
const FRAME_LIGHT = '#5a4128';
const CANVAS_SKY = '#7fb2d8';
const CANVAS_LAND = '#5d8a4a';
const CANVAS_SUN = '#f2d27a';
const LED_TUBE = '#5ff2ff';
const LED_MOUNT = '#2a2d33';

function Panel(props: { prop: WorldProp; local: V3; width: number; height: number; depth: number; material: string }) {
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: props.width, height: props.height, depth: props.depth }}
      material={props.material}
      position={at(props.prop, props.local)}
      rotation={[0, props.prop.yawDegrees, 0]}
    />
  );
}

function WallPainting(props: { prop: WorldProp }) {
  const cy = 1.5; // canvas center at eye height
  return (
    <>
      {/* Frame */}
      <Panel prop={props.prop} local={[0, cy, -0.03]} width={1.25} height={0.95} depth={0.05} material={FRAME} />
      <Panel prop={props.prop} local={[0, cy, -0.055]} width={1.15} height={0.85} depth={0.02} material={FRAME_LIGHT} />
      {/* Canvas: a sky band over a land band, with a sun */}
      <Panel prop={props.prop} local={[0, cy + 0.16, -0.065]} width={1.05} height={0.43} depth={0.01} material={CANVAS_SKY} />
      <Panel prop={props.prop} local={[0, cy - 0.21, -0.065]} width={1.05} height={0.33} depth={0.01} material={CANVAS_LAND} />
      <Panel prop={props.prop} local={[0.3, cy + 0.2, -0.072]} width={0.16} height={0.16} depth={0.005} material={CANVAS_SUN} />
    </>
  );
}

function LedLight(props: { prop: WorldProp }) {
  const top = 2.3;
  const bottom = 0.9;
  const tubeLength = top - bottom;
  return (
    <>
      {/* Mounts top and bottom */}
      <Panel prop={props.prop} local={[0, top, -0.03]} width={0.1} height={0.06} depth={0.06} material={LED_MOUNT} />
      <Panel prop={props.prop} local={[0, bottom, -0.03]} width={0.1} height={0.06} depth={0.06} material={LED_MOUNT} />
      {/* The glowing tube */}
      <Scene3D.Mesh
        geometry={Geometry.Cylinder}
        params={{ radius: 0.045, height: tubeLength, segments: 10 }}
        material={LED_TUBE}
        position={at(props.prop, [0, (top + bottom) / 2, -0.07])}
      />
    </>
  );
}

export function WallDecor(props: { prop: WorldProp }) {
  return props.prop.kind === 'ledLight' ? <LedLight prop={props.prop} /> : <WallPainting prop={props.prop} />;
}
