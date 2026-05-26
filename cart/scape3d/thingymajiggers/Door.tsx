// A door leaf, oriented to the wall it sits in; open = swung ~80°. Dynamic: the
// caller passes live `open` + which way the wall runs. ~2.1 m so the 2 m player
// actually clears it (was 1.7 m — you couldn't fit through).
import { Scene3D } from '@reactjit/runtime/primitives';
import { DOOR_LEAF, DOOR_FRAME } from '../render3d/palette3d';
import { defineThingymajigger, type ThingProps } from './kit';

interface DoorProps extends ThingProps { open: boolean; ewWall: boolean; }

export default defineThingymajigger<DoorProps>({
  kind: 'door',
  size: [1, 1],
  Mesh: ({ x, z, baseY, open, ewWall }) => {
    const cx = x + 0.5, cz = z + 0.5;
    const swing = open ? 1.4 : 0;
    const yaw = ewWall ? swing : Math.PI / 2 + swing;
    return (
      <Scene3D.Mesh geometry="box" material={open ? DOOR_FRAME : DOOR_LEAF}
        position={[cx, baseY + 1.05, cz]} rotation={[0, yaw, 0]}
        sizeX={0.96} sizeY={2.1} sizeZ={0.14} />
    );
  },
});
