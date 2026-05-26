// A ~3 m storefront sign on a pole — the neon panel reads above head height.
import { Fragment } from 'react';
import { Scene3D } from '@reactjit/runtime/primitives';
import { SIGN_POLE, signNeon } from '../render3d/palette3d';
import { defineThingymajigger, type ThingProps } from './kit';

interface SignProps extends ThingProps { tint: number; }

export default defineThingymajigger<SignProps>({
  kind: 'sign',
  size: [1, 1],
  blocks: true,
  Mesh: ({ x, z, baseY, tint }) => (
    <Fragment>
      <Scene3D.Mesh geometry="cylinder" material={SIGN_POLE} position={[x, baseY + 1.5, z]} radius={0.06} sizeY={3.0} />
      <Scene3D.Mesh geometry="box" material={signNeon(tint)} position={[x, baseY + 3.2, z]} sizeX={1.0} sizeY={0.72} sizeZ={0.1} />
      <Scene3D.Mesh geometry="box" material={SIGN_POLE} position={[x, baseY + 3.2, z - 0.06]} sizeX={1.16} sizeY={0.88} sizeZ={0.05} />
    </Fragment>
  ),
});
