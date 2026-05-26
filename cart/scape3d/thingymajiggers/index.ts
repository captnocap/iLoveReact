// The thingymajigger registry — the single lookup table both bake() and the live
// renderers go through. Adding a world object = one new file + one line here.
import type { Thingymajigger } from './kit';
import PalmTree from './PalmTree';
import Dumpster from './Dumpster';
import Sign from './Sign';
import CityBuilding from './CityBuilding';

export const THINGYMAJIGGERS: Record<string, Thingymajigger<any>> = {
  [PalmTree.kind]: PalmTree,
  [Dumpster.kind]: Dumpster,
  [Sign.kind]: Sign,
  [CityBuilding.kind]: CityBuilding,
  // toilet, bed, lamp, door, floorboard, person … (migrating)
};

export { defineThingymajigger } from './kit';
export type { Thingymajigger, ThingProps } from './kit';
