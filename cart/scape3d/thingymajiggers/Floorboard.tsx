// A floorboard. Dynamic: reads `opened` (flipped by the 'pry' action). Intact boards
// sit flush; a pried board tilts up beside a dark gap in the floor.
import { Fragment } from 'react';
import { Scene3D } from '@reactjit/primitives';
import { defineThingymajigger, type ThingProps } from './kit';

interface FloorboardProps extends ThingProps { opened?: boolean; }

export default defineThingymajigger<FloorboardProps>({
  kind: 'floorboard',
  size: [1, 1],
  Mesh: ({ x, z, baseY, opened }) => {
    const cx = x + 0.5, cz = z + 0.5;
    if (opened) {
      return (
        <Fragment>
          <Scene3D.Mesh geometry="box" material="#08080c" position={[cx, baseY + 0.02, cz]} sizeX={0.86} sizeY={0.06} sizeZ={0.86} />
          <Scene3D.Mesh geometry="box" material="#2a2018" position={[cx - 0.28, baseY + 0.34, cz]} rotation={[0, 0, 1.0]} sizeX={0.9} sizeY={0.06} sizeZ={0.84} />
        </Fragment>
      );
    }
    return (
      <Scene3D.Mesh geometry="box" material="#241c14" position={[cx, baseY + 0.07, cz]} sizeX={0.94} sizeY={0.06} sizeZ={0.94} />
    );
  },
});
