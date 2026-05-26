// A ~1.3 m skip — chest-high on the 2 m player.
import { Fragment } from 'react';
import { Scene3D } from '@reactjit/runtime/primitives';
import { DUMPSTER, DUMPSTER_LID } from '../render3d/palette3d';
import { defineThingymajigger } from './kit';

export default defineThingymajigger({
  kind: 'dumpster',
  size: [1, 1],
  blocks: true,
  stash: 2, // big enough to bury a couple things in the trash
  examine: 'A dumpster. Something in it is leaking. Worth a dig, maybe.',
  Mesh: ({ x, z, baseY }) => {
    const cx = x + 0.5, cz = z + 0.5; // centre of the 1×1 footprint
    return (
      <Fragment>
        <Scene3D.Mesh geometry="box" material={DUMPSTER} position={[cx, baseY + 0.6, cz]} sizeX={1.0} sizeY={1.12} sizeZ={0.82} />
        <Scene3D.Mesh geometry="box" material={DUMPSTER_LID} position={[cx, baseY + 1.22, cz]} sizeX={1.08} sizeY={0.14} sizeZ={0.9} />
      </Fragment>
    );
  },
});
