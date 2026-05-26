// Tile API over the MASTER grid. Tiles and props come from whichever chunk owns
// the coordinate (world/chunks.ts); this module just exposes that through the
// Kind/decor names the rest of the cart already uses. Coordinates may be negative
// (the master grid is signed/infinite); unclaimed tiles read as VOID.

import { kindAt, propAt } from './atlas';
import { type PropKind } from './citymap';

export const enum Kind {
  Road = 0,
  Sidewalk = 1,
  Plaza = 2,
  Water = 3,
  Sand = 4,
  Grime = 5,
  Wall = 6,
  Door = 7,
}

// Props placed in the world (blocking). Renamed from the old fantasy decor.
export type DecorKind = PropKind;

export function tileAt(x: number, y: number): number {
  return kindAt(x, y);
}

export function decorAt(x: number, y: number): DecorKind | null {
  const p = propAt(x, y);
  return p ? p.kind : null;
}
