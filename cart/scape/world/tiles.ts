// Tile API over the authored city. There is no procedural generation anymore —
// every tile and prop comes from world/citymap.ts (hand-placed). This module just
// exposes the city through the Kind/decor names the rest of the cart already uses.

import { cityPropAt, cityTileAt, type PropKind } from './citymap';

export const enum Kind {
  Road = 0,
  Sidewalk = 1,
  Plaza = 2,
  Water = 3,
  Sand = 4,
  Grime = 5,
  Wall = 6,
}

// Props placed in the world (blocking). Renamed from the old fantasy decor.
export type DecorKind = PropKind;

export function tileAt(x: number, y: number): number {
  return cityTileAt(x, y);
}

export function decorAt(x: number, y: number): DecorKind | null {
  const p = cityPropAt(x, y);
  return p ? p.kind : null;
}
