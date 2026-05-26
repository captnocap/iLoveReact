// The world atlas — the root entity tree, baked once into the flat absolute world.
//
// Map (root) → zones (downtown / overlook / trap-lot) → buildings → objects.
// Everything is authored relative-to-itself; bake() flattens to absolute. This is
// the single source of truth: the query API (packedAt/kindAt/propAt/heightAt/
// propsIn) feeds pathfinding/picking/minimap, and `frags` feeds the one <Scene3D>.

import {
  T, CITY_W, CITY_H, RECTS, BLDGS, PROPS, type Bldg, type Prop,
} from './citymap';
import { bake, type Entity, type Surface } from './entity';
import { crackhouse } from './entities';
import { THINGYMAJIGGERS } from '../thingymajiggers';

const SURF: Record<number, Surface> = {
  [T.Road]: 'road', [T.Sidewalk]: 'sidewalk', [T.Plaza]: 'plaza',
  [T.Water]: 'water', [T.Sand]: 'sand', [T.Grime]: 'grime',
};

// ── entity constructors from the authored citymap arrays ─────────────────────
const groundZone = (w: number, h: number, surface: Surface): Entity => ({ size: [w, h], ground: surface });

function buildingEntity(b: Bldg): Entity {
  const w = b.x1 - b.x0 + 1;
  const d = b.y1 - b.y0 + 1;
  return {
    size: [w, d],
    pack: T.Wall | (b.h << 3) | (b.style << 6),
    render: (ax, ay, heightAt) =>
      THINGYMAJIGGERS.cityBuilding.Mesh({ x: ax, z: ay, baseY: heightAt(ax + w / 2, ay + d / 2), w, d, tier: b.h, style: b.style }),
  };
}

function propEntity(p: Prop): Entity {
  return {
    size: [1, 1],
    prop: p.kind,
    propTint: p.tint,
    render: (ax, ay, heightAt) =>
      THINGYMAJIGGERS[p.kind]?.Mesh({ x: ax + 0.5, z: ay + 0.5, baseY: heightAt(ax + 0.5, ay + 0.5), tint: p.tint }) ?? null,
  };
}

// ── downtown (chunk 0) — the original city, composed from its authored arrays ─
const downtown: Entity = {
  size: [CITY_W, CITY_H],
  ground: 'sidewalk', // base fill; rects override below
  connections: [
    { side: 'N', at: 12, span: 28, surface: 'sidewalk' }, // links the overlook to the north
    { side: 'E', at: 14, span: 16, surface: 'sidewalk' }, // links the trap-lot to the east
  ],
  contents: [
    ...RECTS.map((r) => ({ at: [r.x0, r.y0] as [number, number], of: groundZone(r.x1 - r.x0 + 1, r.y1 - r.y0 + 1, SURF[r.t]) })),
    ...BLDGS.map((b) => ({ at: [b.x0, b.y0] as [number, number], of: buildingEntity(b) })),
    ...PROPS.map((p) => ({ at: [Math.floor(p.x), Math.floor(p.y)] as [number, number], of: propEntity(p) })),
  ],
};

// ── overlook — a raised neon park to the NORTH (negative y) ───────────────────
function overlookHeight(_lx: number, ly: number): number {
  const H = 3.6, plateau = 8, foot = 20;
  if (ly >= foot) return 0;        // south edge: flat, meets downtown's seam
  if (ly <= plateau) return H;     // north: the plateau
  return H * ((foot - ly) / (foot - plateau));
}
const overlook: Entity = {
  size: [28, 22],
  ground: 'plaza',
  height: overlookHeight,
  connections: [{ side: 'S', at: 0, span: 28, surface: 'sidewalk' }],
  contents: [
    { at: [6, 4], of: propEntity({ x: 0.5, y: 0.5, kind: 'palm', tint: 0 }) },
    { at: [21, 4], of: propEntity({ x: 0.5, y: 0.5, kind: 'palm', tint: 0 }) },
  ],
};

// ── trap-lot — a small grime zone east of downtown, holding the crackhouse ────
const trapLot: Entity = {
  size: [16, 16],
  ground: 'grime',
  connections: [{ side: 'W', at: 0, span: 16, surface: 'sidewalk' }],
  contents: [
    { at: [2, 2], of: crackhouse }, // Zone → Building → Object, proven
  ],
};

// ── the map ──────────────────────────────────────────────────────────────
const world: Entity = {
  size: [1, 1],
  contents: [
    { at: [0, 0], of: downtown },
    { at: [12, -22], of: overlook },
    { at: [52, 14], of: trapLot },
  ],
};

export const WORLD = bake(world);

// Query API (consumed by tiles / terrain / window / picking).
export const packedAt = WORLD.packedAt;
export const kindAt = WORLD.kindAt;
export const propAt = WORLD.propAt;
export const heightAt = WORLD.heightAt;
export const propsIn = WORLD.propsIn;
export const featureAt = WORLD.featureAt;
export const byPath = WORLD.byPath;
export const features = WORLD.features;
export const frags = WORLD.frags;
