// A blocking wall segment, sized by its footprint (w×h tiles). Interior/exterior
// wall runs are composed from these. Owns the wall height.
import { Scene3D } from '@reactjit/primitives';
import { defineThingymajigger, type ThingProps } from './kit';

const WALL_H = 2.4; // ~1.2× the player — interior walls read just over head height

interface WallProps extends ThingProps { w: number; h: number; }

export default defineThingymajigger<WallProps>({
  kind: 'wall',
  size: [1, 1], // nominal; the run's real footprint comes from w/h params
  blocks: true,
  Mesh: ({ x, z, baseY, w, h }) => (
    <Scene3D.Mesh geometry="box" material="#241d22"
      position={[x + w / 2, baseY + WALL_H / 2, z + h / 2]} sizeX={w} sizeY={WALL_H} sizeZ={h} />
  ),
});
