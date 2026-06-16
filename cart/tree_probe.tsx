// tree_probe — the ~frond~ foliage pipeline as real trees: a trunk mesh + a CROWN
// of Frond instances radiating from the top, each an arched leaf card the shader
// cuts (feathered coconut OR broad split) and the wind bends. The grass move,
// leaf-shaped. `rjit shot tree_probe`.
//
// NOTE: instance `data` MUST be a plain number[] — a Float32Array serializes to a
// JSON object, not an array, so v8_app.zig drops it (the host reads v == .array).
import { useMemo } from 'react';
import { Box, Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';

const STRIDE = 12;

// Crown rows for one tree: `count` fronds from the trunk top (x, topY, z), yawed
// evenly and pitched out into a droop, with slight per-frond jitter.
function crown(x: number, topY: number, z: number, count: number, frondLen: number, root: [number, number, number], pitchBase = 38): number[] {
  const rows: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const yaw = (i / count) * 360 + (i % 2) * 14;
    const pitch = pitchBase + (i % 3) * 12;
    const len = frondLen * (0.8 + 0.2 * (((i * 7) % 5) / 4));
    const wide = len * 0.55;
    rows.push(x, topY, z, pitch, yaw, 0, wide, len, wide, root[0], root[1], root[2]);
  }
  return rows;
}

// A full crown: a drooping OUTER ring + a shorter, steeper INNER ring so the
// center fills in (a bare radial fan reads thin). The per-frond shader curve
// makes every frond of both rings snake its own way.
function tree(x: number, topY: number, z: number, outer: number, len: number, root: [number, number, number]): number[] {
  return [
    ...crown(x, topY, z, outer, len, root, 40),
    ...crown(x, topY + len * 0.12, z, Math.max(5, Math.round(outer * 0.6)), len * 0.62, root, 18),
  ];
}

function Trunk(props: { x: number; z: number; height: number; lean?: number; radius?: number }) {
  // PalmTrunk is 1 unit tall; scale Y to height and X/Z to the real radius span.
  // The geometry carries its own taper + curve + scar rings, so the trunk reads
  // as a palm log instead of a cigar. A small yaw varies which way the lean faces.
  const span = (props.radius ?? 0.13) / Geometry.PALM_TRUNK_DEFAULTS.baseRadius;
  return (
    <Scene3D.Mesh
      geometry={Geometry.PalmTrunk}
      params={Geometry.PALM_TRUNK_DEFAULTS}
      position={[props.x, 0, props.z]}
      rotation={[0, (props.lean ?? 0) * 140, 0]}
      scale={[span, props.height, span]}
      material="#7a6043"
    />
  );
}

export default function TreeProbe() {
  // classic coconut palm (left), broad-leaf (center)
  const classic = useMemo(() => tree(-7, 8.2, 0, 18, 5.0, [0.12, 0.32, 0.16]), []);
  const broad = useMemo(() => tree(0, 6.4, -7, 13, 3.8, [0.14, 0.34, 0.14]), []);
  // weeping/flowing palm (right) — long flowing tips
  const flowing = useMemo(() => tree(6, 7.4, 5, 18, 6.2, [0.10, 0.30, 0.15]), []);
  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#7fb4e6" showAxes={false}>
        <Scene3D.Camera position={[1, 7, 22]} target={[0, 5, -2]} fov={58} far={4000} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.75} />
        <Scene3D.DirectionalLight direction={[-0.4, -1, -0.3]} color="#fff6e0" intensity={0.7} />
        <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 70, height: 2, depth: 70 }} material="#d8c79a" position={[0, -1, 0]} />
        <Trunk x={-7} z={0} height={8.2} lean={0.3} />
        <Trunk x={6} z={5} height={7.4} lean={-0.4} />
        <Trunk x={0} z={-7} height={6.4} radius={0.34} />
        <Scene3D.Instances geometry={Geometry.Frond} params={Geometry.FROND_DEFAULTS} data={classic} count={classic.length / STRIDE} stride={STRIDE} center={[-7, 8, 0]} boundsRadius={60} textureKey="~frond~" />
        <Scene3D.Instances geometry={Geometry.Frond} params={Geometry.BROAD_FROND_DEFAULTS} data={broad} count={broad.length / STRIDE} stride={STRIDE} center={[0, 6, -7]} boundsRadius={60} textureKey="~frond~" />
        <Scene3D.Instances geometry={Geometry.Frond} params={Geometry.FLOWING_FROND_DEFAULTS} data={flowing} count={flowing.length / STRIDE} stride={STRIDE} center={[6, 7, 5]} boundsRadius={60} textureKey="~frond~" />
      </Scene3D>
    </Box>
  );
}
