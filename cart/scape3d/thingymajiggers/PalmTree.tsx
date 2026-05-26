// A stylised palm ~4.2 m tall — about 2× the 2 m player. Clearly a tree without
// going realistic-tall (a true 10 m palm read as absurd in this chunky PS1 register).
import { Fragment } from 'react';
import { Scene3D } from '@reactjit/runtime/primitives';
import { PALM_TRUNK, PALM_FROND } from '../render3d/palette3d';
import { defineThingymajigger } from './kit';

// One ring of fronds around the crown, drooping outward.
const ring = (x: number, z: number, baseY: number, tier: number, n: number, len: number, droop: number, y: number, reach: number) =>
  Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2 + tier * 0.4;
    return (
      <Scene3D.Mesh key={`f${tier}-${k}`} geometry="box" material={PALM_FROND}
        position={[x + Math.cos(a) * reach, baseY + y, z + Math.sin(a) * reach]}
        rotation={[droop, -a, 0]} sizeX={len} sizeY={0.05} sizeZ={0.22} />
    );
  });

export default defineThingymajigger({
  kind: 'palm',
  size: [1, 1],
  blocks: true,
  Mesh: ({ x, z, baseY }) => {
    const cx = x + 0.5, cz = z + 0.5; // centre of the 1×1 footprint
    return (
      <Fragment>
        <Scene3D.Mesh geometry="cylinder" material={PALM_TRUNK} position={[cx, baseY + 1.85, cz]} radius={0.14} sizeY={3.7} />
        <Scene3D.Mesh geometry="box" material={PALM_FROND} position={[cx, baseY + 3.9, cz]} sizeX={0.4} sizeY={0.24} sizeZ={0.4} />
        {ring(cx, cz, baseY, 0, 5, 1.5, 0.35, 4.0, 0.9)}
        {ring(cx, cz, baseY, 1, 4, 1.1, 0.8, 3.75, 0.68)}
      </Fragment>
    );
  },
});
