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
import { eachPaintedCell, FOLIAGE_SPEC_PALM, type GrassInstances, type FoliageCell } from './grassPopulation';
import { editorTunables } from '../editors/tunables';

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
  palmMed: 'med',
  palmDense: 'dense',
};

// P2 SETTINGS registry (req_1469): expose the palm-grove tunables on /settings so
// the per-tile spawn chance, trunk size, and crown shape are slider-controlled. The
// bake folds these overrides over the defaults (bakeGameFile applyOverrides), so a
// compile picks up whatever the user tuned — no second copy. Twin of grass/bush.
const PALM_TUNABLE_SPECS = {
  'density.sparse': { label: 'sparse chance /cell', min: 0, max: 1, step: 0.01, precision: 2 },
  'density.med': { label: 'grove chance /cell', min: 0, max: 1, step: 0.01, precision: 2 },
  'density.dense': { label: 'wall chance /cell', min: 0, max: 1, step: 0.01, precision: 2 },
  'trunkHeight.min': { label: 'trunk min (m)', min: 1, max: 20, step: 0.1, precision: 1 },
  'trunkHeight.max': { label: 'trunk max (m)', min: 1, max: 24, step: 0.1, precision: 1 },
  'trunkRadius.min': { label: 'trunk thin (m)', min: 0.05, max: 1, step: 0.01, precision: 2 },
  'trunkRadius.max': { label: 'trunk thick (m)', min: 0.05, max: 1.5, step: 0.01, precision: 2 },
  'fronds.min': { label: 'crown min fronds', min: 3, max: 40, step: 1, precision: 0 },
  'fronds.max': { label: 'crown max fronds', min: 3, max: 48, step: 1, precision: 0 },
  'frondLen.min': { label: 'frond min (m)', min: 0.5, max: 10, step: 0.1, precision: 1 },
  'frondLen.max': { label: 'frond max (m)', min: 0.5, max: 12, step: 0.1, precision: 1 },
} as const;
editorTunables().register({ system: 'palm', route: 'render3d/palmPopulation', table: PALM_CONFIG, specs: PALM_TUNABLE_SPECS });

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

/** One spawned palm's rolled parameters — the SHARED per-cell derivation that the
 *  full field (fronds + trunks), the trunk-only / cell-only recipe paths, and the
 *  loader's foliage.zig palmCrown all read, so they never drift. */
type PalmRoll = { cellKey: number; wx: number; wz: number; top: number; px: number; pz: number; trunkH: number; radius: number; outer: number; frondLen: number; leanYaw: number; root: [number, number, number] };

function eachPalm(world: GameState['world'], cb: (p: PalmRoll) => void): void {
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
    cb({ cellKey, wx, wz, top, px, pz, trunkH, radius, outer, frondLen, leanYaw, root });
  });
}

function pushTrunk(trunks: number[], tb: Bounds, p: PalmRoll): void {
  // Trunk: the PalmTrunk mesh (BASE-origin, 1 unit tall y∈[0,1]); position y is the cell
  // surface `top`. Scale x/z by span = radius/unit so the baked taper keeps shape; yaw leans.
  const span = p.radius / PALM_TRUNK_UNIT_RADIUS;
  trunks.push(p.px, p.top, p.pz, 0, p.leanYaw, 0, span, p.trunkH, span, PALM_CONFIG.trunkColor.r, PALM_CONFIG.trunkColor.g, PALM_CONFIG.trunkColor.b);
  tb.add(p.px, p.top, p.pz);
  tb.add(p.px, p.top + p.trunkH, p.pz);
}

/** Roll the palm grove for a world. Pure in (world): same world → identical field.
 *  Returns the frond crown cards and the trunk meshes as two separate batches. Used by
 *  the React preview; the BAKE recipe-izes the fronds (palmCells + loader foliage.zig). */
export function buildPalmInstances(world: GameState['world']): PalmField {
  const fronds: number[] = [];
  const trunks: number[] = [];
  const fb = new Bounds();
  const tb = new Bounds();
  eachPalm(world, (p) => {
    pushTrunk(trunks, tb, p);
    // Crown: drooping outer ring + steeper, shorter inner ring at the trunk top.
    const topY = p.top + p.trunkH;
    crownRing(fronds, p.px, topY, p.pz, p.outer, p.frondLen, p.root, 40);
    crownRing(fronds, p.px, topY + p.frondLen * 0.12, p.pz, Math.max(5, Math.round(p.outer * 0.6)), p.frondLen * 0.62, p.root, 18);
    const r = p.frondLen * 1.1;
    fb.add(p.px - r, topY - r, p.pz - r);
    fb.add(p.px + r, topY + r, p.pz + r);
  });
  return { fronds: toInstances(fronds, fb), trunks: toInstances(trunks, tb) };
}

/** Crown cards alone — the ~frond~ batch (React preview only; the bake recipe-izes these). */
export function buildPalmFrondInstances(world: GameState['world']): GrassInstances {
  return buildPalmInstances(world).fronds;
}

/** Trunk meshes alone — built WITHOUT the fronds (the bake bakes trunks as distinct
 *  objects but recipe-izes the crown, so it must not allocate the ~614k frond rows). */
export function buildPalmTrunkInstances(world: GameState['world']): GrassInstances {
  const trunks: number[] = [];
  const tb = new Bounds();
  eachPalm(world, (p) => pushTrunk(trunks, tb, p));
  return toInstances(trunks, tb);
}

/** The palm CROWN recipe (req_1861): one FLORA cell per spawned palm. The loader
 *  regenerates the frond crown from the cell key via foliage.zig palmCrown/palmFrondRow,
 *  so the bake never enumerates the ~614k frond rows into the V8 heap. */
export function palmCells(world: GameState['world']): FoliageCell[] {
  const cells: FoliageCell[] = [];
  eachPalm(world, (p) => {
    const inner = Math.max(5, Math.round(p.outer * 0.6));
    cells.push({ cellKey: p.cellKey >>> 0, wx: p.wx, wz: p.wz, top: p.top, specId: FOLIAGE_SPEC_PALM, count: p.outer + inner });
  });
  return cells;
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
