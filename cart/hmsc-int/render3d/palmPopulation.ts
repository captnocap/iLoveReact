// palmPopulation.ts — palm GROVE population the grass way (req_1443). A painted
// 'palm' cell sparsely grows a palm = a PalmTrunk mesh + a CROWN of Frond cards
// (the ~frond~ foliage pipeline, the FluffyGrass move leaf-shaped). Rides the SAME
// eachPaintedCell walk grass/bush use, so palms plant on the exact surface height
// at a stable per-cell seed. The crown construction is ported from the proven
// cart/tree_probe.tsx tree()/crown() (an outer drooping ring + a steeper inner ring
// so the centre fills). Fronds and trunks are SEPARATE batches: the crown is the
// ~frond~ pipeline, the trunk is an ordinary mesh — different geometry, different
// pipeline, so the bake pushes them as two instance shapes.
import type { GameState } from '../design';
import { mix, unit } from '../game/kinds/scatter';
import { eachPaintedCell, type GrassInstances } from './grassPopulation';

const STRIDE = 12; // pos3 | rot3 (pitch,yaw,roll) | scale3 | rootColor3 — the foliage row

// The loader's buildPalmTrunk geometry (compiled twin of runtime/geometries/PalmTrunk)
// is 1 unit TALL (base y=0 → top y=1) with this base radius baked in unit space; a
// real-radius trunk scales x/z by (radius / this), exactly like cart/tree_probe.tsx
// (span = radius / PALM_TRUNK_DEFAULTS.baseRadius). Keep in lockstep with both.
const PALM_TRUNK_UNIT_RADIUS = 0.13;

// Palm-grove globals. A future /settings rig (editorTunables, like grass/bush) can
// swap these in; kept a plain table for now so the population stays pure data.
export const PALM_CONFIG = {
  // Per-DENSITY-LEVEL chance a painted palm cell spawns a palm (req_1467). Three
  // paint tiles map to these — sparse (scattered), med (a grove), dense (a wall of
  // palms). 0.06 was too low even for med: a small patch landed ~0 palms (req_1465).
  // 'dense' is capped under 1.0 so a wall still has a little breathing room, not a
  // rigid grid. Mirrors grass's sparse/med/lush density levels.
  density: { sparse: 0.08, med: 0.22, dense: 0.7 },
  trunkHeight: { min: 4.2, max: 7.0 },
  trunkRadius: { min: 0.14, max: 0.2 },
  // Crown: `fronds` in the outer drooping ring; the inner ring is 0.6× that.
  fronds: { min: 12, max: 18 },
  frondLen: { min: 3.0, max: 4.2 },
  // Frond ROOT tint the ~frond~ shader gradients root→tip from (varied per palm).
  rootLo: { r: 0.1, g: 0.3, b: 0.15 },
  rootHi: { r: 0.16, g: 0.4, b: 0.18 },
  // Palm-log trunk colour (the PalmTrunk geometry carries its own taper/scar rings).
  trunkColor: { r: 0.48, g: 0.38, b: 0.26 },
};

// Which density level each painted palm tile grows at — the parallel to grass's
// GRASS_KIND_LEVEL. A new 'palm*' tile only needs a row here to light up (req_1467).
type PalmDensity = keyof typeof PALM_CONFIG.density;
const PALM_KIND_DENSITY: Readonly<Record<string, PalmDensity>> = {
  palmSparse: 'sparse',
  palm: 'med',
  palmDense: 'dense',
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// One crown ring of fronds radiating from (x, topY, z): yawed evenly, pitched out
// into a droop, with slight per-frond length jitter (tree_probe.crown()).
function crownRing(
  out: number[],
  x: number,
  topY: number,
  z: number,
  count: number,
  frondLen: number,
  root: readonly [number, number, number],
  pitchBase: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const yaw = (i / count) * 360 + (i % 2) * 14;
    const pitch = pitchBase + (i % 3) * 12;
    const len = frondLen * (0.8 + 0.2 * (((i * 7) % 5) / 4));
    const wide = len * 0.55;
    out.push(x, topY, z, pitch, yaw, 0, wide, len, wide, root[0], root[1], root[2]);
  }
}

export type PalmField = { fronds: GrassInstances; trunks: GrassInstances };

/** Roll the palm grove for a world. Pure in (world): same world → identical field.
 *  Returns the frond crown cards and the trunk meshes as two separate batches. */
export function buildPalmInstances(world: GameState['world']): PalmField {
  const fronds: number[] = [];
  const trunks: number[] = [];
  const fb = new Bounds();
  const tb = new Bounds();

  eachPaintedCell(world, (kind, wx, wz, top, cellKey) => {
    const level = PALM_KIND_DENSITY[kind];
    if (!level) return; // not a palm tile
    const seed = mix(cellKey ^ 0x9d2c5680);
    if (unit(seed) > PALM_CONFIG.density[level]) return; // density-gated: most cells stay bare

    const h0 = mix(seed ^ 0x1b56c4e9);
    const h1 = mix(h0 ^ 0x68bc21eb);
    const h2 = mix(h1 ^ 0x7feb352d);
    const h3 = mix(h2 ^ 0x846ca68b);
    const trunkH = lerp(PALM_CONFIG.trunkHeight.min, PALM_CONFIG.trunkHeight.max, unit(h0));
    const radius = lerp(PALM_CONFIG.trunkRadius.min, PALM_CONFIG.trunkRadius.max, unit(h1));
    const outer = Math.round(lerp(PALM_CONFIG.fronds.min, PALM_CONFIG.fronds.max, unit(h2)));
    const frondLen = lerp(PALM_CONFIG.frondLen.min, PALM_CONFIG.frondLen.max, unit(h3));
    const leanYaw = (unit(mix(h2 ^ 0x51)) - 0.5) * 0.8 * 140; // which way the lean faces
    // Per-palm jitter inside the cell so a grove doesn't grid up.
    const px = wx + (unit(mix(h0 ^ 0xa5)) - 0.5) * world.cellSizeMeters * 0.7;
    const pz = wz + (unit(mix(h1 ^ 0xa5)) - 0.5) * world.cellSizeMeters * 0.7;
    const root: [number, number, number] = [
      lerp(PALM_CONFIG.rootLo.r, PALM_CONFIG.rootHi.r, unit(mix(h3 ^ 0x9b))),
      lerp(PALM_CONFIG.rootLo.g, PALM_CONFIG.rootHi.g, unit(mix(h3 ^ 0x9c))),
      lerp(PALM_CONFIG.rootLo.b, PALM_CONFIG.rootHi.b, unit(mix(h3 ^ 0x9d))),
    ];

    // Trunk: the PalmTrunk mesh (BASE-origin, 1 unit tall y∈[0,1]) so position y is
    // the cell surface `top` (base on the ground). Scale x/z by span = radius/unit so
    // the baked taper/bulge/curve/scar-rings keep their shape; yaw aims the lean.
    const span = radius / PALM_TRUNK_UNIT_RADIUS;
    trunks.push(px, top, pz, 0, leanYaw, 0, span, trunkH, span, PALM_CONFIG.trunkColor.r, PALM_CONFIG.trunkColor.g, PALM_CONFIG.trunkColor.b);
    tb.add(px, top, pz);
    tb.add(px, top + trunkH, pz);

    // Crown: drooping outer ring + steeper, shorter inner ring at the trunk top.
    const topY = top + trunkH;
    crownRing(fronds, px, topY, pz, outer, frondLen, root, 40);
    crownRing(fronds, px, topY + frondLen * 0.12, pz, Math.max(5, Math.round(outer * 0.6)), frondLen * 0.62, root, 18);
    const r = frondLen * 1.1;
    fb.add(px - r, topY - r, pz - r);
    fb.add(px + r, topY + r, pz + r);
  });

  return { fronds: toInstances(fronds, fb), trunks: toInstances(trunks, tb) };
}

/** Crown cards alone — the ~frond~ batch. */
export function buildPalmFrondInstances(world: GameState['world']): GrassInstances {
  return buildPalmInstances(world).fronds;
}

/** Trunk meshes alone — the ordinary-mesh batch. */
export function buildPalmTrunkInstances(world: GameState['world']): GrassInstances {
  return buildPalmInstances(world).trunks;
}

class Bounds {
  minX = Infinity; minY = Infinity; minZ = Infinity;
  maxX = -Infinity; maxY = -Infinity; maxZ = -Infinity;
  add(x: number, y: number, z: number): void {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (z < this.minZ) this.minZ = z;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
    if (z > this.maxZ) this.maxZ = z;
  }
}

function toInstances(rows: number[], b: Bounds): GrassInstances {
  const count = rows.length / STRIDE;
  const center: [number, number, number] =
    count === 0 ? [0, 0, 0] : [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
  const radius = count === 0 ? 0 : Math.hypot(b.maxX - center[0], b.maxY - center[1], b.maxZ - center[2]);
  return { data: Float32Array.from(rows), count, truncated: false, center, radius };
}
