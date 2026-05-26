// Composed entities — the proof that the recursive model goes all the way down.
//
// A crackhouse is a BUILDING entity whose contents are a floor + wall segments +
// furniture OBJECTS, each placed at LOCAL offsets. The toilet doesn't know it's in
// a crackhouse; the crackhouse doesn't know it's in a zone. bake() flattens it all
// to absolute. Open-top + a door gap so you can walk in and see the furniture.

import { Scene3D } from '@reactjit/runtime/primitives';
import { T } from './citymap';
import type { Entity } from './entity';

const WALL_PACK = T.Wall | (0 << 3) | (3 << 6); // grime-style wall, height tier 0
const WALL_H = 2.4;

// A blocking wall segment: stamps its footprint as Wall + draws a grimy box.
function wall(w: number, h: number): Entity {
  return {
    size: [w, h],
    pack: WALL_PACK,
    render: (ax, ay) => (
      <Scene3D.Mesh geometry="box" material="#241d22"
        position={[ax + w / 2, WALL_H / 2, ay + h / 2]} sizeX={w} sizeY={WALL_H} sizeZ={h} />
    ),
  };
}

// ── interior objects (each is 1×1, render-only, local origin) ───────────────
export const toilet: Entity = {
  size: [1, 1],
  render: (ax, ay) => (
    <>
      <Scene3D.Mesh geometry="box" material="#d8dde2" position={[ax + 0.5, 0.22, ay + 0.55]} sizeX={0.4} sizeY={0.34} sizeZ={0.46} />
      <Scene3D.Mesh geometry="box" material="#c8ced3" position={[ax + 0.5, 0.5, ay + 0.18]} sizeX={0.42} sizeY={0.5} sizeZ={0.16} />
    </>
  ),
};

export const bed: Entity = {
  size: [2, 1],
  render: (ax, ay) => (
    <>
      <Scene3D.Mesh geometry="box" material="#3a2630" position={[ax + 1, 0.18, ay + 0.5]} sizeX={1.8} sizeY={0.28} sizeZ={0.9} />
      <Scene3D.Mesh geometry="box" material="#8a6a78" position={[ax + 0.3, 0.42, ay + 0.5]} sizeX={0.3} sizeY={0.22} sizeZ={0.8} />
    </>
  ),
};

export const lamp: Entity = {
  size: [1, 1],
  render: (ax, ay) => (
    <>
      <Scene3D.Mesh geometry="cylinder" material="#2a2228" position={[ax + 0.5, 0.4, ay + 0.5]} radius={0.05} sizeY={0.8} />
      <Scene3D.Mesh geometry="box" material="#ffd98a" position={[ax + 0.5, 0.86, ay + 0.5]} sizeX={0.28} sizeY={0.2} sizeZ={0.28} />
    </>
  ),
};

// ── the crackhouse (BUILDING entity: floor + walls + furniture) ─────────────
// 13×12, open-top, door gap in the south wall at local x6–7.
// One floorboard per tile of a room. Most hide nothing; ONE hides the stash, and
// you need a crowbar to pry it. floorboard[i] ↔ local tile i (row-major), so in a
// 4×4 room index 12 is local (0,3) — the last row. The cache object is mutable;
// prying it flips `opened` and the dynamic render pops the board up.
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
    { at: [2, 0], of: bed },
    { at: [0, 0], of: lamp },
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
    { at: [1, 1], of: toilet },
    { at: [8, 6], of: bedroom },                                // the addressable room
  ],
};
