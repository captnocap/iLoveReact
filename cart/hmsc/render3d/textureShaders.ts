// textureShaders.ts — the CANONICAL texture-shader catalog: every tunable WGSL
// recipe a texture can be authored from, each one NAMED, range-bounded, draggable
// parameters — never a bare data[] of magic numbers. (This is the catalog that
// used to live editor-side as hmsc-int/shaderCatalog.ts with one entry; it moved
// game-side because the GAME bakes stored materials from these specs — the editor
// only adds sliders on top.)
//
// A shader here is a RECIPE, not an assignable asset: the texture studio
// Materializes a tuned recipe into a stored material (render3d/customTextures.ts),
// and THAT lands in the texture registry for faces/tiles/parts. Canvas is always
// exactly 1 tile — wider looks decompose into per-tile materials.
//
// Two shader families:
//   • ROAD — the game's own layered road-tile shader (asphalt base + marking
//     overlays), imported from roadTileFill.ts.
//   • THE FILL BOARDS — the effect_fills evaluation boards (A–H), one mega-WGSL
//     (render3d/fillShader.ts) whose D[] selects [materialId, variant, seed,
//     quality, board]. Each board material becomes one spec with its three
//     authored takes as variants and seed/detail-grade as the tunable base.

import { ROAD_TILE_SHADER } from './roadTileFill';
import { FILL_SHADER } from './fillShader';

export interface ShaderParam {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  integer?: boolean;
}

// One overlay child — sits on the shared base and adds its own layer.
export interface ShaderVariant {
  id: string;
  label: string;
  value: number; // the selector the shader reads to pick this overlay/take
  params: ShaderParam[]; // this overlay's own sliders (empty = nothing to tune)
}

export interface ShaderSpec {
  id: string;
  label: string;
  group: string; // catalog rail grouping ('HMSC · Game', 'E · Neon Surface', …)
  blurb: string;
  shader: string; // the real WGSL string — single source, no copies
  base: ShaderParam[]; // shared across every variant
  variants: ShaderVariant[]; // the overlay children (>= 1)
  // Pack base + overlay values into the exact data[] fs_main expects.
  buildData: (variantValue: number, base: Record<string, number>, overlay: Record<string, number>) => number[];
}

// Default value maps — the slider starting positions for the base or a variant.
export function paramDefaults(params: ShaderParam[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) out[p.key] = p.default;
  return out;
}

// A spec's out-of-the-box data[]: first variant + every default. THE way to get
// a default look (replaces hand-written default data arrays).
export function defaultShaderData(spec: ShaderSpec): number[] {
  return spec.buildData(spec.variants[0].value, paramDefaults(spec.base), paramDefaults(spec.variants[0].params));
}

// ── Road, decomposed into one-tile layered materials ─────────────────────────
// Base = asphalt (shared). Variants = the per-tile overlays a road is built from.
// See roadTileFill.ts for the D[] layout.
const ROAD: ShaderSpec = {
  id: 'road',
  label: 'Road',
  group: 'HMSC · Game',
  blurb: 'One road tile: shared asphalt base + the lane/centerline/bike overlay.',
  shader: ROAD_TILE_SHADER,
  base: [
    { key: 'brightness', label: 'Asphalt brightness', default: 1, min: 0.4, max: 1.6, step: 0.05 },
    { key: 'speckle', label: 'Asphalt grain', default: 0.12, min: 0, max: 0.4, step: 0.01 },
  ],
  variants: [
    { id: 'asphalt', label: 'Asphalt (base)', value: 0, params: [] },
    {
      id: 'yellow', label: 'Yellow Center', value: 1, params: [
        { key: 'lineHalf', label: 'Line thickness', default: 0.05, min: 0.02, max: 0.2, step: 0.005, unit: 'm' },
        { key: 'doubleGap', label: 'Double-line gap', default: 0.12, min: 0, max: 0.4, step: 0.01, unit: 'm' },
      ],
    },
    {
      id: 'white', label: 'White Divider', value: 2, params: [
        { key: 'lineHalf', label: 'Line thickness', default: 0.05, min: 0.02, max: 0.2, step: 0.005, unit: 'm' },
        { key: 'dashPeriod', label: 'Dash period', default: 0.35, min: 0.1, max: 1, step: 0.05, unit: 'm' },
        { key: 'dashFrac', label: 'Dash on-fraction', default: 0.5, min: 0.05, max: 0.95, step: 0.05 },
      ],
    },
    {
      id: 'bike', label: 'Bike Lane', value: 3, params: [
        { key: 'bikeEdge', label: 'Edge-line thickness', default: 0.05, min: 0.02, max: 0.2, step: 0.005, unit: 'm' },
      ],
    },
  ],
  buildData: (variantValue, base, o) => [
    variantValue,
    base.brightness,
    base.speckle,
    o.lineHalf ?? 0.05,
    o.doubleGap ?? 0.12,
    o.dashPeriod ?? 0.35,
    o.dashFrac ?? 0.5,
    o.bikeEdge ?? 0.05,
  ],
};

// ── The fill boards (effect_fills A–H) ───────────────────────────────────────
// D = [materialId, variant, seed, quality, board]. Each material's default seed
// follows the board's spread formula (coefA·materialId + coefB·variant + coefC),
// matching the evaluation cart's swatches exactly at variant 0; the seed is then
// a free slider. Detail grade is the PSX→Max quality axis.

const FILL_GRADES = ['PSX', 'PS2', 'Preview', 'Std', 'Max'] as const;
const FILL_GRADE_STD = 3;
const FILL_SEED_MAX = 500; // every board formula lands well under this

type FillMaterial = { slug: string; name: string; variants: [string, string, string] };
type FillBoard = {
  board: number;            // D[4]
  letter: string;           // catalog/board letter (A–H)
  title: string;            // board name for the group label
  seedCoef: [number, number, number]; // [perMaterial, perVariant, offset]
  materials: FillMaterial[]; // index = materialId (D[0])
};

// Generic take names for the boards whose variants were never individually named
// (A–D are index-only in effect_fills' CATALOG.md).
const TAKES: [string, string, string] = ['Take 1', 'Take 2', 'Take 3'];

const FILL_BOARDS: FillBoard[] = [
  {
    board: 0, letter: 'A', title: 'Environment', seedCoef: [17, 5, 3],
    materials: [
      { slug: 'road', name: 'Road', variants: TAKES },
      { slug: 'concrete', name: 'Concrete', variants: TAKES },
      { slug: 'brick', name: 'Brick', variants: TAKES },
      { slug: 'sand', name: 'Sand', variants: TAKES },
      { slug: 'water', name: 'Water', variants: TAKES },
      { slug: 'grass', name: 'Grass', variants: TAKES },
      { slug: 'wood', name: 'Wood', variants: TAKES },
    ],
  },
  {
    board: 1, letter: 'B', title: 'Condemned', seedCoef: [23, 11, 41],
    materials: [
      { slug: 'mold-wall', name: 'Mold Wall', variants: TAKES },
      { slug: 'peel-paint', name: 'Peel Paint', variants: TAKES },
      { slug: 'linoleum', name: 'Linoleum', variants: TAKES },
      { slug: 'bath-tile', name: 'Bath Tile', variants: TAKES },
      { slug: 'mildew-brick', name: 'Mildew Brick', variants: TAKES },
      { slug: 'rot-siding', name: 'Rot Siding', variants: TAKES },
      { slug: 'rust-sheet', name: 'Rust Sheet', variants: TAKES },
    ],
  },
  {
    board: 2, letter: 'C', title: 'Props & Wearables', seedCoef: [29, 13, 89],
    materials: [
      { slug: 'blade-steel', name: 'Blade Steel', variants: TAKES },
      { slug: 'gunmetal', name: 'Gunmetal', variants: TAKES },
      { slug: 'grip-polymer', name: 'Grip Polymer', variants: TAKES },
      { slug: 'leather', name: 'Leather', variants: TAKES },
      { slug: 'denim', name: 'Denim', variants: TAKES },
      { slug: 'fabric', name: 'Fabric', variants: TAKES },
      { slug: 'skin', name: 'Skin', variants: TAKES },
    ],
  },
  {
    board: 3, letter: 'D', title: 'Neon Rot', seedCoef: [31, 17, 131],
    materials: [
      { slug: 'peel-wallpaper', name: 'Peel Wallpaper', variants: TAKES },
      { slug: 'motel-carpet', name: 'Motel Carpet', variants: TAKES },
      { slug: 'rotten-rug', name: 'Rotten Rug', variants: TAKES },
      { slug: 'neon-stucco', name: 'Neon Stucco', variants: TAKES },
      { slug: 'pool-tile', name: 'Pool Tile', variants: TAKES },
      { slug: 'booth-vinyl', name: 'Booth Vinyl', variants: TAKES },
      { slug: 'drop-ceiling', name: 'Drop Ceiling', variants: TAKES },
      { slug: 'pdx-carpet', name: 'PDX Carpet', variants: TAKES },
    ],
  },
  {
    board: 4, letter: 'E', title: 'Neon Surface', seedCoef: [37, 19, 181],
    materials: [
      { slug: 'stucco-facade', name: 'Stucco Facade', variants: ['Pink', 'Teal', 'Lilac'] },
      { slug: 'neon-tube', name: 'Neon Tube', variants: ['Pink', 'Cyan', 'Orange'] },
      { slug: 'sunset-sky', name: 'Sunset Sky', variants: ['Dusk', 'Night', 'Dawn'] },
      { slug: 'wet-asphalt', name: 'Wet Asphalt', variants: ['Neon Puddle', 'Orange', 'Oil Slick'] },
      { slug: 'car-paint', name: 'Car Paint', variants: ['Candy Red', 'Chrome', 'Matte Black'] },
      { slug: 'crt-screen', name: 'CRT Screen', variants: ['Terminal Green', 'Web Blue', 'Dead Static'] },
      { slug: 'palm-canopy', name: 'Palm Canopy', variants: ['Lush', 'Dry', 'Silhouette'] },
    ],
  },
  {
    board: 5, letter: 'F', title: 'Contraband', seedCoef: [41, 23, 229],
    materials: [
      { slug: 'cash-stack', name: 'Cash Stack', variants: ['Clean', 'Worn', 'Blood'] },
      { slug: 'product-baggie', name: 'Product Baggie', variants: ['Crystal', 'Powder', 'Brick'] },
      { slug: 'blood-pool', name: 'Blood Pool', variants: ['Fresh', 'Dried', 'Smear'] },
      { slug: 'evidence', name: 'Evidence', variants: ['Hazard Tape', 'Chalk Outline', 'Numbered Marker'] },
      { slug: 'refuse', name: 'Refuse', variants: ['Cardboard', 'Wet Trash', 'Crushed Can'] },
      { slug: 'corkboard', name: 'Corkboard', variants: ['Bare', 'Photos', 'Red String'] },
      { slug: 'substance', name: 'Substance', variants: ['Pills', 'Lines + Razor', 'Residue'] },
    ],
  },
  {
    board: 6, letter: 'G', title: 'Liminal', seedCoef: [43, 27, 271],
    materials: [
      { slug: 'fogged-mirror', name: 'Fogged Mirror', variants: ['Steam', 'Wiped Trails', 'Droplets'] },
      { slug: 'salt-flat', name: 'Salt Flat', variants: ['White', 'Pink Lake', 'Borax'] },
      { slug: 'moss-carpet', name: 'Moss Carpet', variants: ['Deep Green', 'Bright Lichen', 'Dried Peat'] },
      { slug: 'tarnished-silver', name: 'Tarnished Silver', variants: ['Diagonal Buff', 'Circular Polish', 'Crosshatch'] },
      { slug: 'ice-sheet', name: 'Ice Sheet', variants: ['Arctic Clear', 'Glacial Blue', 'Sunset Melt'] },
      { slug: 'charcoal-bed', name: 'Charcoal Bed', variants: ['Orange Ember', 'Yellow Coals', 'Red Coals'] },
      { slug: 'stained-glass', name: 'Stained Glass', variants: ['Warm Cathedral', 'Cool Chapel', 'Sunset Rose'] },
    ],
  },
  {
    board: 7, letter: 'H', title: 'Second Pass', seedCoef: [47, 29, 313],
    materials: [
      { slug: 'asphalt', name: 'Asphalt', variants: ['Double Yellow', 'Crosswalk + Manhole', 'Oil + Skids'] },
      { slug: 'sidewalk', name: 'Sidewalk', variants: ['Grey', 'Terracotta', 'Flagstone'] },
      { slug: 'stone-wall', name: 'Stone Wall', variants: ['Granite', 'Sandstone', 'Basalt'] },
      { slug: 'dune', name: 'Dune', variants: ['Golden', 'White Gypsum', 'Red Martian'] },
      { slug: 'deep-water', name: 'Deep Water', variants: ['Deep Ocean', 'Tropical', 'Storm Grey'] },
      { slug: 'turf', name: 'Turf', variants: ['Mowed Stripes', 'Clover Meadow', 'Dry Summer'] },
      { slug: 'plank-deck', name: 'Plank Deck', variants: ['Fresh Cedar', 'Weathered Grey', 'Water-Stained'] },
    ],
  },
];

function fillSpec(b: FillBoard, materialId: number, m: FillMaterial): ShaderSpec {
  const [perMaterial, perVariant, offset] = b.seedCoef;
  const defaultSeed = perMaterial * materialId + offset; // variant-0 swatch seed
  return {
    id: `${b.letter.toLowerCase()}-${m.slug}`,
    label: m.name,
    group: `${b.letter} · ${b.title}`,
    blurb: `${b.title} board: ${m.name.toLowerCase()} — three authored takes, seed + detail grade tunable.`,
    shader: FILL_SHADER,
    base: [
      { key: 'seed', label: 'Seed', default: defaultSeed, min: 0, max: FILL_SEED_MAX, step: 1, integer: true },
      {
        key: 'grade', label: `Detail grade (${FILL_GRADES.join(' → ')})`,
        default: FILL_GRADE_STD, min: 0, max: FILL_GRADES.length - 1, step: 1, integer: true,
      },
    ],
    variants: m.variants.map((label, v) => ({
      id: `v${v}`,
      label,
      value: v,
      // The board formula nudges the seed per variant; expose that as the
      // variant's own offset so each take starts on its authored swatch.
      params: [
        { key: 'seedShift', label: 'Take seed shift', default: perVariant * v, min: 0, max: FILL_SEED_MAX, step: 1, integer: true },
      ],
    })),
    buildData: (variantValue, base, o) => [
      materialId,
      variantValue,
      (base.seed ?? defaultSeed) + (o.seedShift ?? perVariant * variantValue),
      base.grade ?? FILL_GRADE_STD,
      b.board,
    ],
  };
}

const FILL_SPECS: ShaderSpec[] = FILL_BOARDS.flatMap((b) => b.materials.map((m, i) => fillSpec(b, i, m)));

// ── The catalog ──────────────────────────────────────────────────────────────

export const HMSC_SHADERS: ShaderSpec[] = [ROAD, ...FILL_SPECS];

export function shaderSpec(id: string): ShaderSpec | undefined {
  return HMSC_SHADERS.find((s) => s.id === id);
}

// Group order for catalog rails: the game's own shaders first, then the boards.
export function shaderGroups(): { group: string; specs: ShaderSpec[] }[] {
  const out: { group: string; specs: ShaderSpec[] }[] = [];
  for (const spec of HMSC_SHADERS) {
    const g = out.find((x) => x.group === spec.group);
    if (g) g.specs.push(spec); else out.push({ group: spec.group, specs: [spec] });
  }
  return out;
}
