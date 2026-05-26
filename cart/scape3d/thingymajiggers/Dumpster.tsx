// A ~1.3 m skip — chest-high on the 2 m player.
import { Fragment } from 'react';
import { Scene3D } from '@reactjit/runtime/primitives';
import { DUMPSTER, DUMPSTER_LID } from '../render3d/palette3d';
import { defineThingymajigger } from './kit';

export default defineThingymajigger({
  kind: 'dumpster',
  size: [1, 1],
  blocks: true,
  Mesh: ({ x, z, baseY }) => (
    <Fragment>
      <Scene3D.Mesh geometry="box" material={DUMPSTER} position={[x, baseY + 0.6, z]} sizeX={1.0} sizeY={1.12} sizeZ={0.82} />
      <Scene3D.Mesh geometry="box" material={DUMPSTER_LID} position={[x, baseY + 1.22, z]} sizeX={1.08} sizeY={0.14} sizeZ={0.9} />
    </Fragment>
  ),
});
