// The thingymajigger registry — the single lookup table both bake() and the live
// renderers go through. Adding a world object = one new file + one line here.
import type { Thingymajigger } from './kit';
import PalmTree from './PalmTree';
import Dumpster from './Dumpster';
import Sign from './Sign';
import CityBuilding from './CityBuilding';
import Wall from './Wall';
import Toilet from './Toilet';
import Bed from './Bed';
import Lamp from './Lamp';
import Door from './Door';
import Floorboard from './Floorboard';
import Storefront from './Storefront';

export const THINGYMAJIGGERS: Record<string, Thingymajigger<any>> = {
  // static — baked into the scene by the entity tree via meshOf()
  [PalmTree.kind]: PalmTree,
  [Dumpster.kind]: Dumpster,
  [Sign.kind]: Sign,
  [CityBuilding.kind]: CityBuilding,
  [Wall.kind]: Wall,
  [Toilet.kind]: Toilet,
  [Bed.kind]: Bed,
  [Lamp.kind]: Lamp,
  // dynamic — re-rendered live from game state by render3d/World.tsx
  [Door.kind]: Door,
  [Floorboard.kind]: Floorboard,
  [Storefront.kind]: Storefront,
  // person … (Characters3D is still its own home; fold in later if useful)
};

// The bridge from the entity-authoring tree to the registry: wrap a thingymajigger's
// Mesh as an Entity `render` fn. x,z = the absolute footprint CORNER (what bake passes
// as ax,ay); baseY is sampled at the footprint centre so a thing sits on the terrain it
// stands on. Extra Mesh props (tint, a building's w/d/tier/style) ride in via `params`.
// One place does this wiring, so atlas + entities never re-implement it.
export function meshOf(kind: string, params: Record<string, any> = {}) {
  const tmj = THINGYMAJIGGERS[kind];
  const w = params.w ?? tmj.size[0];
  const h = params.d ?? params.h ?? tmj.size[1];
  return (ax: number, ay: number, heightAt: (x: number, y: number) => number) =>
    tmj.Mesh({ x: ax, z: ay, baseY: heightAt(ax + w / 2, ay + h / 2), ...params });
}

export { defineThingymajigger } from './kit';
export type { Thingymajigger, ThingProps } from './kit';
