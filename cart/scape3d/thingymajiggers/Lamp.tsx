// A floor lamp — thin stem + a glowing shade.
import { Fragment } from 'react';
import { Scene3D } from '@reactjit/runtime/primitives';
import { defineThingymajigger } from './kit';

export default defineThingymajigger({
  kind: 'lamp',
  size: [1, 1],
  examine: 'A floor lamp, bulb buzzing. Nowhere to hide anything.',
  Mesh: ({ x, z, baseY }) => (
    <Fragment>
      <Scene3D.Mesh geometry="cylinder" material="#2a2228" position={[x + 0.5, baseY + 0.4, z + 0.5]} radius={0.05} sizeY={0.8} />
      <Scene3D.Mesh geometry="box" material="#ffd98a" position={[x + 0.5, baseY + 0.86, z + 0.5]} sizeX={0.28} sizeY={0.2} sizeZ={0.28} />
    </Fragment>
  ),
});
