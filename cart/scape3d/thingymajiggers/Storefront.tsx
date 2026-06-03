// A storefront awning — a tinted neon slab over a shop entrance. Dynamic, and placed
// by an entity's WORLD coords (not tile authoring), so x,z are used directly.
import { Scene3D } from '@reactjit/primitives';
import { signNeon } from '../render3d/palette3d';
import { defineThingymajigger, type ThingProps } from './kit';

interface StorefrontProps extends ThingProps { tint: number; }

export default defineThingymajigger<StorefrontProps>({
  kind: 'storefront',
  size: [1, 1],
  Mesh: ({ x, z, baseY, tint }) => (
    <Scene3D.Mesh geometry="box" material={signNeon(tint)} position={[x, baseY + 1.0, z]} sizeX={1.2} sizeY={0.18} sizeZ={1.0} />
  ),
});
