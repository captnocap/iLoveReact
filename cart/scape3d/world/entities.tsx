// Composed entities — the proof that the recursive model goes all the way down.
//
// A crackhouse is a BUILDING entity whose contents are a floor + wall segments +
// furniture, each placed at LOCAL offsets. The toilet doesn't know it's in a
// crackhouse; the crackhouse doesn't know it's in a zone. bake() flattens it all to
// absolute. Every drawable piece is a thingymajigger — this file only COMPOSES them;
// no mesh code lives here.

import { T } from './citymap';
import type { Entity } from './entity';
import { meshOf, THINGYMAJIGGERS } from '../thingymajiggers';

const WALL_PACK = T.Wall | (0 << 3) | (3 << 6); // grime-style wall, height tier 0

// A wall run: stamps its footprint as Wall (pathfinding/tile logic) + draws the wall
// thingymajigger sized to the run.
const wall = (w: number, h: number): Entity => ({
  size: [w, h],
  pack: WALL_PACK,
  render: meshOf('wall', { w, h }),
});

// A furniture fixture: a render-only thingymajigger on the floor (footprint from its
// registry entry, so a 2×1 bed claims two tiles).
const fixture = (kind: string): Entity => ({
  size: THINGYMAJIGGERS[kind].size,
  kind,
  render: meshOf(kind),
});

// One floorboard per tile of a room. Most hide nothing; ONE hides the stash, and you
// need a crowbar to pry it. floorboard[i] ↔ local tile i (row-major), so in a 4×4 room
// index 12 is local (0,3) — the last row. The cache is mutable; prying it flips
// `opened` and the dynamic render pops the board up.
function floorboards(w: number, h: number, stashIndex: number, money: number) {
  const out: { at: [number, number]; of: Entity }[] = [];
  for (let i = 0; i < w * h; i++) {
    const lx = i % w;
    const ly = (i / w) | 0;
    const cache = i === stashIndex ? { needs: 'crowbar', money, opened: false } : { opened: false };
    out.push({ at: [lx, ly], of: { size: [1, 1], kind: 'floorboard', id: `floorboard${i}`, cache } });
  }
  return out;
}

// The bedroom: a 4×4 addressable room. Its floorboard[12] holds $1,000,000 under a
// crowbar gate — i.e. crackhouse_47.bedroom.floorboard12.cache.
const bedroom: Entity = {
  id: 'bedroom',
  size: [4, 4],
  contents: [
    ...floorboards(4, 4, 12, 1_000_000),
    { at: [2, 0], of: fixture('bed') },
    { at: [0, 0], of: fixture('lamp') },
  ],
};

export const crackhouse: Entity = {
  id: 'crackhouse_47',
  size: [13, 12],
  contents: [
    { at: [0, 0], of: { size: [13, 12], ground: 'grime' } },   // interior floor (walkable)
    { at: [0, 0], of: wall(13, 1) },                            // north wall
    { at: [0, 11], of: wall(6, 1) },                            // south wall (left of door)
    { at: [8, 11], of: wall(5, 1) },                            // south wall (right of door)
    { at: [0, 1], of: wall(1, 10) },                            // west wall
    { at: [12, 1], of: wall(1, 10) },                           // east wall
    { at: [1, 1], of: fixture('toilet') },
    { at: [8, 6], of: bedroom },                                // the addressable room
  ],
};
