// A toilet — bowl + tank, sat in the back corner of its tile.
import { Fragment } from 'react';
import { Scene3D } from '@reactjit/runtime/primitives';
import { defineThingymajigger } from './kit';

export default defineThingymajigger({
  kind: 'toilet',
  size: [1, 1],
  Mesh: ({ x, z, baseY }) => (
    <Fragment>
      <Scene3D.Mesh geometry="box" material="#d8dde2" position={[x + 0.5, baseY + 0.22, z + 0.55]} sizeX={0.4} sizeY={0.34} sizeZ={0.46} />
      <Scene3D.Mesh geometry="box" material="#c8ced3" position={[x + 0.5, baseY + 0.5, z + 0.18]} sizeX={0.42} sizeY={0.5} sizeZ={0.16} />
    </Fragment>
  ),
});
