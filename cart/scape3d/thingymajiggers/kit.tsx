// thingymajiggers/ — the ONE category. A toilet, a 13×12 tower, a palm, a dumpster
// are all the same kind of thing: a placed object that owns its material, its mesh,
// AND its footprint. Nothing outside a thingymajigger's own file decides its size —
// that's what kills the "which system writes the model?" split.
//
// Why the silly name: "thing" is the most overloaded word in English ("this thing's
// broken", "try that thing"), so it's ungreppable. `thingymajigger` returns EXACTLY
// our world objects, zero false positives. (And it's a decent easter egg.)
//
// bake() (static objects, baked into the one <Scene3D>'s frag list) and the live
// renderers (dynamic objects: door/character/floorboard) BOTH resolve meshes through
// the registry, so a thingymajigger has exactly one home regardless of when it draws.

import type { ReactNode } from 'react';

// Base props every thingymajigger's Mesh receives: where its origin sits in the
// single scene. baseY = terrain height under the origin, so feet/base ride relief.
// Specific thingymajiggers extend this (a building adds w/d/tier/style, a sign a tint).
export interface ThingProps {
  x: number;      // absolute world X of the origin (tile units; 1 tile = 1 m)
  z: number;      // absolute world Z
  baseY: number;  // ground height under the origin
}

export interface Thingymajigger<P extends ThingProps = ThingProps> {
  kind: string;               // registry key + interaction/semantic type
  size: [number, number];     // footprint in tiles — pathfinding + bake read this
  blocks?: boolean;           // occupies its tiles for movement
  Mesh: (p: P) => ReactNode;  // emits <Scene3D.Mesh> children at ABSOLUTE coords
}

// Identity helper — gives each module file inference + a uniform shape to register.
export function defineThingymajigger<P extends ThingProps>(t: Thingymajigger<P>): Thingymajigger<P> {
  return t;
}
