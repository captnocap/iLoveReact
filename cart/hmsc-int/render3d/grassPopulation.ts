// grassPopulation — populate blade instances over painted grass-tile cells.
//
// Grass is a SURFACE POPULATION SYSTEM, not a prop list (the FluffyGrass move):
// wherever the world paints the 'grass'/'grassDry' tile, this rolls a deterministic
// scatter of blade-clump instances onto that surface. The roll is the SAME pure
// hash the scatter brush uses (game/kinds/scatter mix/unit) — stable in the cell
// coordinate, so repaint/re-render never shifts a blade. Output is ONE packed
// stride-12 instance buffer for <Scene3D.Instances geometry={GrassBlade}>; the host
// expands it to one instanced draw, and the grass scene3d pipeline paints the
// wisp/gradient/wind.
//
// TWO mask sources, both real and shared by the editor view AND the compiled bake:
//   • surfaceRegions of kind grass/grassDry (uniform-kind rects), and
//   • LANDFORM tile grids (`field.tiles`) — the painter writes grass into painted
//     chunks (→ heightfield landforms, id `painted_cx_cz`), so that's where most
//     grass actually lives. Blades sit on the landform's own sampled height, so
//     the height tool's relief carries them (see-it == walk-it).
//
// Stride-12 row (framework/gpu/3d.zig makeInstance): px,py,pz, rx,ry,rz(DEGREES),
// sx,sy,sz, cr,cg,cb.

import type { GameState } from '../design';
import { surfaceRegionTopMeters } from '../world/surfaceHeights';
import { mix, unit } from '../game/kinds/scatter';
// TILE_KINDS from the PAINTER's table — landform `field.tiles.idx` cells are encoded
// as indices into THIS list (PaintCanvas + chunkFloor), so density must look up by
// the same index space (the two tile tables are appended in lockstep, but reading
// the encoding source directly keeps this correct even if they ever drift).
import { FLORA_KINDS } from '../floraData';
import { editorTunables } from '../editors/tunables';

// THE grass globals — one mutable table the /settings rig tunes live (height,
// density per paint level, root colour range). Every leaf is a number so it rides
// the P2 tunable system for free: /settings sliders, persistence, and the change
// stream the editor re-bakes off (no inline magic, no second copy). Colours are
// r/g/b 0..1 leaves; the grass settings rig edits them through a ColorWheel.
export const GRASS_CONFIG = {
  height: { min: 0.26, max: 0.55 },
  width: { min: 0.8, max: 1.35 },
  // Blades scattered per painted grass cell, BY paint level — sparse/med/lush are
  // the 'Grass (Sparse)' / 'Grass' / 'Grass (Lush)' tiles.
  density: { sparse: 3, med: 7, lush: 16 },
  // The per-instance ROOT tint range the shader gradients up from (lo↔hi varied
  // per blade so the field reads alive). The bright tip derives from this in-shader.
  rootLo: { r: 0.16, g: 0.26, b: 0.10 },
  rootHi: { r: 0.27, g: 0.40, b: 0.16 },
};

// BUSH globals — the SAME card-population system as grass (the bush TILE replaces
// the old solid-sphere bush prop), just taller/wider/denser leafier clumps. A
// painted 'bush' cell grows a cluster of foliage cards (the BushClump geometry),
// run through the same foliage scene3d pipeline (wind + cutout + gradient).
export const BUSH_CONFIG = {
  height: { min: 0.7, max: 1.6 },
  width: { min: 1.4, max: 2.4 },
  // Bush cells are one density level ('med'); sparse/lush kept for the shared spec
  // shape (a future 'bushSparse'/'bushLush' tile would light them up for free).
  density: { sparse: 6, med: 14, lush: 26 },
  rootLo: { r: 0.12, g: 0.22, b: 0.08 },
  rootHi: { r: 0.22, g: 0.38, b: 0.14 },
};

// Sized to the GPU static-instance ceiling (framework/gpu/3d.zig
// MAX_STATIC_INSTANCES = 1,048,576), the buffer the compiled loader plants grass
// into — so the field never truncates before the hardware actually runs out.
// The old 80,000 cut a single lush chunk in half (14,400 tiles × 26 cards/tile ≈
// 374k cards/chunk), the visible diagonal wall the user hit (req_1291). Truncation
// past THIS cap stays LOUD (console.warn below) per the juice-limits rule — raise
// both this and MAX_STATIC_INSTANCES together if a map ever earns it.
const MAX_INSTANCES = 1048576;
const STRIDE = 12;

// A foliage population spec: the tunable config + which density level each of its
// painted tile kinds reads. grass and bush are two specs through ONE roll (below).
type DensityLevel = 'sparse' | 'med' | 'lush';
type FoliageSpec = {
  config: typeof GRASS_CONFIG;
  kindLevel: Readonly<Record<string, DensityLevel>>;
  levelByIndex: ReadonlyMap<number, DensityLevel>;
  warnLabel: string;
};

function levelByIndex(kindLevel: Readonly<Record<string, DensityLevel>>): ReadonlyMap<number, DensityLevel> {
  // idx into FLORA_KINDS (what a landform `field.flora.idx` cell carries).
  return new Map(
    Object.entries(kindLevel)
      .map(([k, lvl]) => [FLORA_KINDS.indexOf(k as any), lvl] as const)
      .filter(([i]) => i >= 0),
  );
}

function bladesForLevel(config: typeof GRASS_CONFIG, level: DensityLevel): number {
  return Math.max(0, Math.round(config.density[level]));
}

const GRASS_KIND_LEVEL: Readonly<Record<string, DensityLevel>> = {
  grassSparse: 'sparse',
  grassMed: 'med',
  grassDry: 'med',
  grassLush: 'lush',
};
const BUSH_KIND_LEVEL: Readonly<Record<string, DensityLevel>> = { bush: 'med' };

export const GRASS_TILE_KINDS: ReadonlySet<string> = new Set(Object.keys(GRASS_KIND_LEVEL));
export const BUSH_TILE_KINDS: ReadonlySet<string> = new Set(Object.keys(BUSH_KIND_LEVEL));

const GRASS_SPEC: FoliageSpec = { config: GRASS_CONFIG, kindLevel: GRASS_KIND_LEVEL, levelByIndex: levelByIndex(GRASS_KIND_LEVEL), warnLabel: 'grass' };
const BUSH_SPEC: FoliageSpec = { config: BUSH_CONFIG, kindLevel: BUSH_KIND_LEVEL, levelByIndex: levelByIndex(BUSH_KIND_LEVEL), warnLabel: 'bush' };

// P2 registry (SETTINGS-0605): grass + bush globals, /settings-editable + persisted.
// Each settings rig swaps the colour leaves for a ColorWheel; height/density slide.
const FOLIAGE_TUNABLE_SPECS = {
  'height.min': { label: 'clump min (m)', min: 0.05, max: 3, step: 0.01, precision: 2 },
  'height.max': { label: 'clump max (m)', min: 0.05, max: 4, step: 0.01, precision: 2 },
  'density.sparse': { label: 'sparse /cell', min: 0, max: 60, step: 1, precision: 0 },
  'density.med': { label: 'mid /cell', min: 0, max: 60, step: 1, precision: 0 },
  'density.lush': { label: 'lush /cell', min: 0, max: 80, step: 1, precision: 0 },
  'rootLo.r': { label: 'root lo R', min: 0, max: 1, step: 0.01, precision: 2 },
  'rootLo.g': { label: 'root lo G', min: 0, max: 1, step: 0.01, precision: 2 },
  'rootLo.b': { label: 'root lo B', min: 0, max: 1, step: 0.01, precision: 2 },
  'rootHi.r': { label: 'root hi R', min: 0, max: 1, step: 0.01, precision: 2 },
  'rootHi.g': { label: 'root hi G', min: 0, max: 1, step: 0.01, precision: 2 },
  'rootHi.b': { label: 'root hi B', min: 0, max: 1, step: 0.01, precision: 2 },
} as const;
editorTunables().register({ system: 'grass', route: 'render3d/grassPopulation', table: GRASS_CONFIG, specs: FOLIAGE_TUNABLE_SPECS });
editorTunables().register({ system: 'bush', route: 'render3d/grassPopulation', table: BUSH_CONFIG, specs: FOLIAGE_TUNABLE_SPECS });

export type GrassInstances = {
  data: Float32Array;
  count: number;
  truncated: boolean;
  // Bounding sphere over the whole field — instanced batches cull as ONE unit, so
  // <Scene3D.Instances> needs the field centre + radius (not the per-blade geometry
  // bounds, which would cull a map-wide lawn the moment its origin left the frustum).
  center: [number, number, number];
  radius: number;
};

type Landform = NonNullable<GameState['world']['landforms']>[number];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Bilinear height of a landform's own field at world (x,z) — matches the heightfield
 *  kind's rise (baseY + sampled grid), so blades sit exactly on the rendered relief. */
function landformFieldTop(lf: Landform, x: number, z: number): number {
  const f = lf.field;
  if (!f || !f.heights || f.cols < 1 || f.rows < 1) return lf.baseY;
  const fullW = (f.cols - 1) * f.cell;
  const fullD = (f.rows - 1) * f.cell;
  const gx = Math.max(0, Math.min(f.cols - 1, (x - lf.centerX + fullW / 2) / f.cell));
  const gz = Math.max(0, Math.min(f.rows - 1, (z - lf.centerZ + fullD / 2) / f.cell));
  const i0 = Math.floor(gx);
  const j0 = Math.floor(gz);
  const i1 = Math.min(i0 + 1, f.cols - 1);
  const j1 = Math.min(j0 + 1, f.rows - 1);
  const tx = gx - i0;
  const tz = gz - j0;
  const a = f.heights[j0 * f.cols + i0] ?? 0;
  const b = f.heights[j0 * f.cols + i1] ?? 0;
  const c = f.heights[j1 * f.cols + i0] ?? 0;
  const d = f.heights[j1 * f.cols + i1] ?? 0;
  return lf.baseY + (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/**
 * The ONE walk over every painted ground cell — grass surfaceRegions (uniform-kind
 * rects, flat at the region top) THEN landform tile grids (the painter's tiles on
 * relief, each cell on its own sampled height). Calls `cb(kind, wx, wz, top, cellKey)`
 * per cell with the resolved tile-kind string, the cell CENTRE in world metres, the
 * surface height, and the deterministic per-cell seed. Both the foliage population
 * (grass/bush) AND the palm population ride this, so every plant sits on the same
 * surface at the same stable seed (rule-of-two: one walk, no divergent copies).
 *
 * `cellKey` matches the legacy per-source seed exactly so the grass buffer stays
 * byte-identical: surfaceRegion cells pass the raw xz hash; landform cells pass the
 * pre-mixed cell hash (the populate roll then mixes once more, as it always has).
 */
export function eachPaintedCell(
  world: GameState['world'],
  cb: (kind: string, wx: number, wz: number, top: number, cellKey: number) => void,
): void {
  const c = world.cellSizeMeters;
  for (const region of world.surfaceRegions) {
    const top = surfaceRegionTopMeters(region, c);
    for (let j = 0; j < region.depth; j += 1) {
      for (let i = 0; i < region.width; i += 1) {
        const tileX = region.x + i;
        const tileZ = region.z + j;
        const key = Math.imul(tileX | 0, 0x85ebca6b) ^ Math.imul(tileZ | 0, 0xc2b2ae35);
        cb(region.kind, (tileX + 0.5) * c, (tileZ + 0.5) * c, top, key);
      }
    }
  }
  for (const lf of world.landforms ?? []) {
    // Populations read the FLORA channel, NOT the ground tiles (FLORADECOUPLE-0619):
    // grass/palms/bushes are what GROWS, decoupled from the surface beneath. A cell's
    // flora index → FLORA_KINDS name → the builders' density-level maps.
    const flora = lf.field?.flora;
    const f = lf.field;
    if (!flora || !f) continue;
    const fullW = (f.cols - 1) * f.cell;
    const fullD = (f.rows - 1) * f.cell;
    for (let tj = 0; tj < flora.rows; tj += 1) {
      for (let ti = 0; ti < flora.cols; ti += 1) {
        const kind = FLORA_KINDS[flora.idx[tj * flora.cols + ti]];
        if (!kind) continue;
        const wx = lf.centerX - fullW / 2 + ((ti + 0.5) / flora.cols) * fullW;
        const wz = lf.centerZ - fullD / 2 + ((tj + 0.5) / flora.rows) * fullD;
        const top = landformFieldTop(lf, wx, wz);
        const key = mix(Math.imul(ti | 0, 0x27d4eb2f) ^ Math.imul(tj | 0, 0x165667b1) ^ hashStr(lf.id));
        cb(kind, wx, wz, top, key);
      }
    }
  }
}

/**
 * Roll the blade instance buffer for a world. Pure in (world): same world → byte-
 * identical buffer. Scatters bladesPerCell blades per painted grass cell (from both
 * grass surfaceRegions and landform tile grids) at hashed sub-cell offset / yaw /
 * scale / tint, planted on the cell's surface height.
 */
function populateFoliage(world: GameState['world'], spec: FoliageSpec): GrassInstances {
  const c = world.cellSizeMeters;
  // Grow geometrically from a modest start up to the hard ceiling, so a small
  // field costs ~0.8 MB (not the 50 MB a flat MAX_INSTANCES pre-alloc would cost)
  // yet a lush map can still fill the GPU's whole static-instance budget. `buf` is
  // reassigned on grow — emitClump closes over the binding, so it always writes the
  // current array.
  let cap = Math.min(MAX_INSTANCES, 16384);
  let buf = new Float32Array(cap * STRIDE);
  let n = 0;
  let truncated = false;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  // One grass clump (bladesPerCell blades) at world cell (wx,wz) sitting on `top`.
  // `cellKey` seeds the deterministic roll — same cell → same clump, always.
  const emitClump = (wx: number, wz: number, top: number, cellKey: number, bladesPerCell: number): void => {
    if (wx < minX) minX = wx;
    if (wz < minZ) minZ = wz;
    if (wx > maxX) maxX = wx;
    if (wz > maxZ) maxZ = wz;
    if (top < minY) minY = top;
    if (top + spec.config.height.max > maxY) maxY = top + spec.config.height.max;
    const cellSeed = mix(cellKey);
    for (let k = 0; k < bladesPerCell; k += 1) {
      if (n >= cap) {
        if (cap >= MAX_INSTANCES) { truncated = true; return; }
        cap = Math.min(MAX_INSTANCES, cap * 2);
        const grown = new Float32Array(cap * STRIDE);
        grown.set(buf);
        buf = grown;
      }
      const h0 = mix(cellSeed ^ Math.imul(k + 1, 0x9e3779b9));
      const h1 = mix(h0 ^ 0x68bc21eb);
      const h2 = mix(h1 ^ 0x7feb352d);
      const h3 = mix(h2 ^ 0x846ca68b);
      // Sub-cell jitter (±half a metre) so blades fill the cell, not snap to centre.
      const px = wx + (unit(h0) - 0.5) * c;
      const pz = wz + (unit(h1) - 0.5) * c;
      const yaw = unit(h2) * 360;
      const height = lerp(spec.config.height.min, spec.config.height.max, unit(h3));
      const widthScale = lerp(spec.config.width.min, spec.config.width.max, unit(mix(h3 ^ 0x9b)));
      const tint = unit(mix(h2 ^ 0x51));
      const cr = lerp(spec.config.rootLo.r, spec.config.rootHi.r, tint);
      const cg = lerp(spec.config.rootLo.g, spec.config.rootHi.g, tint);
      const cb = lerp(spec.config.rootLo.b, spec.config.rootHi.b, tint);
      const o = n * STRIDE;
      buf[o + 0] = px;
      buf[o + 1] = top;
      buf[o + 2] = pz;
      buf[o + 3] = 0;
      buf[o + 4] = yaw;
      buf[o + 5] = 0;
      buf[o + 6] = widthScale;
      buf[o + 7] = height;
      buf[o + 8] = widthScale;
      buf[o + 9] = cr;
      buf[o + 10] = cg;
      buf[o + 11] = cb;
      n += 1;
    }
  };

  // Walk every painted cell (grass surfaceRegions + landform tile grids) through
  // the ONE shared iterator (eachPaintedCell) — palms ride the same walk, so they
  // plant on the exact same surface heights and cell seeds. emitClump no-ops once
  // the cap is hit, so the post-truncation tail is dropped identically.
  eachPaintedCell(world, (kind, wx, wz, top, cellKey) => {
    const level = spec.kindLevel[kind];
    if (!level) return;
    const density = bladesForLevel(spec.config, level);
    if (density <= 0) return;
    emitClump(wx, wz, top, cellKey, density);
  });

  if (truncated) {
    // Loud, never silent (juice-limits rule): tell the terminal the field outgrew
    // the cap so the number gets raised rather than the tail vanishing quietly.
    console.warn(`[grassPopulation] ${spec.warnLabel} instance cap ${cap} hit — field truncated; raise MAX_INSTANCES`);
  }

  const center: [number, number, number] = n === 0
    ? [0, 0, 0]
    : [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const radius = n === 0 ? 0 : Math.hypot(maxX - center[0], maxY - center[1], maxZ - center[2]);

  // Right-size the result with a COPY (slice, not subarray): the geometric buffer
  // is up to 2× over-allocated, and subarray would keep that whole ArrayBuffer
  // alive behind the returned view. slice frees it.
  return { data: buf.length === n * STRIDE ? buf : buf.slice(0, n * STRIDE), count: n, truncated, center, radius };
}

/** Grass blade field over painted grass-tile cells. */
export function buildGrassInstances(world: GameState['world']): GrassInstances {
  return populateFoliage(world, GRASS_SPEC);
}

/** Bush foliage field over painted 'bush'-tile cells — the SAME roll, bushier spec.
 *  Rendered with the BushClump geometry through the foliage pipeline (BushField). */
export function buildBushInstances(world: GameState['world']): GrassInstances {
  return populateFoliage(world, BUSH_SPEC);
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
