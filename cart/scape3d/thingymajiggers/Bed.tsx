// A mattress on a low frame + a pillow. 2×1 footprint.
import { Fragment } from 'react';
import { Scene3D } from '@reactjit/runtime/primitives';
import { defineThingymajigger } from './kit';

export default defineThingymajigger({
  kind: 'bed',
  size: [2, 1],
  Mesh: ({ x, z, baseY }) => (
    <Fragment>
      <Scene3D.Mesh geometry="box" material="#3a2630" position={[x + 1, baseY + 0.18, z + 0.5]} sizeX={1.8} sizeY={0.28} sizeZ={0.9} />
      <Scene3D.Mesh geometry="box" material="#8a6a78" position={[x + 0.3, baseY + 0.42, z + 0.5]} sizeX={0.3} sizeY={0.22} sizeZ={0.8} />
    </Fragment>
  ),
});
