// game/textures/shaders.ts — the CANONICAL texture-shader catalog: every tunable
// WGSL recipe a texture can be authored from, each one NAMED, range-bounded,
// draggable parameters — never a bare data[] of magic numbers. (Lineage: lived as
// cart/hmsc/render3d/textureShaders.ts, and before that editor-side as
// hmsc-int/shaderCatalog.ts with one entry; TEXPORT-0606 moved the texture
// pipeline behind the game/textures door — the captured ground floor bakes
// stored materials from these specs, the editor only adds sliders on top.)
//
// A ShaderSpec here is a RECIPE: ShaderLab can still tune it and Materialize a
// custom frozen look. The registry also derives ShaderTexturePresets from these
// recipes so authored takes/quality grades are directly assignable without
// opening the lab. Canvas is always exactly 1 tile — wider looks decompose into
// per-tile materials.
//
// Two shader families:
//   • ROAD — the game's own layered road-tile shader (asphalt base + marking
//     overlays), imported from the W-2 render lane's roadTileFill.ts.
//   • THE FILL BOARDS — the effect_fills evaluation boards (A–O), one mega-WGSL
//     (the W-2 lane's fillShader.ts) whose D[] selects [materialId, variant,
//     seed, quality, board]. Each board material becomes one spec with its three
//     authored takes as variants and seed/detail-grade as the tunable base.

// GAP(W-2): the raw WGSL sources sit with the world-render fills in
// cart/hmsc/render3d (tileFill prelude + per-surface fills); they move when the
// world render lane is captured.
import { ROAD_TILE_SHADER } from '../../render3d/roadTileFill';
import { FILL_SHADER } from '../../render3d/fillShader';
import { packMissionData } from './missionCode';

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
  group: string; // visible material-browser shelf by purpose/use, never board family
  blurb: string;
  shader: string; // the real WGSL string — single source, no copies
  base: ShaderParam[]; // shared across every variant
  variants: ShaderVariant[]; // the overlay children (>= 1)
  // Pack base + overlay values into the exact data[] fs_main expects.
  buildData: (variantValue: number, base: Record<string, number>, overlay: Record<string, number>) => number[];
}

export type ShaderTexturePreset = {
  id: string;
  label: string;
  group: string;
  shaderId: string;
  shader: string;
  data: number[];
};

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
  group: 'Pavement & Streets',
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

// ── Cutout stencil — shapes authored in the cutout painter (/cutout) ─────────
// The painter Materializes an extracted cutout into THIS recipe: data carries
// a coarse stencil grid (row-major 0/1 cells) plus fill/background colors —
// fill inside the shape, background (or transparency) outside. The catalog's
// slider form edits the colors over a full tile; the painter packs the real
// cells (editors/cutout/extraction.ts packStencilData — the layout below is
// pinned by its P4 test).
//
// data D[]:
//   D[0] gridW   stencil grid width  (cells per row)
//   D[1] gridH   stencil grid height
//   D[2..4]      fill r,g,b
//   D[5..7]      background r,g,b
//   D[8]         background alpha (0 = the shape floats on transparency)
//   D[9]         reserved
//   D[10+]       cells, row-major, 0/1
export const CUTOUT_STENCIL_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let gw = max(D[0], 1.0);
  let gh = max(D[1], 1.0);
  let igw = u32(gw);
  let cx = min(u32(floor(in.uv.x * gw)), igw - 1u);
  let cy = min(u32(floor(in.uv.y * gh)), u32(gh) - 1u);
  let m = D[10u + cy * igw + cx];
  if (m < 0.5) {
    return vec4f(D[5], D[6], D[7], D[8]);
  }
  return vec4f(D[2], D[3], D[4], 1.0);
}
`;

const STENCIL_SLIDER_GRID = 8; // the slider form's full-tile grid (all cells set)

const CUTOUT_STENCIL: ShaderSpec = {
  id: 'cutout-stencil',
  label: 'Cutout Stencil',
  group: 'Codes & Stencils',
  blurb: 'A shape painted in the cutout painter (/cutout), frozen as a stencil: fill color inside the shape, background or transparency outside. Materialize real shapes from /cutout; the sliders here tune a full tile.',
  shader: CUTOUT_STENCIL_SHADER,
  base: [
    { key: 'fillR', label: 'Fill red', default: 1, min: 0, max: 1, step: 0.05 },
    { key: 'fillG', label: 'Fill green', default: 1, min: 0, max: 1, step: 0.05 },
    { key: 'fillB', label: 'Fill blue', default: 1, min: 0, max: 1, step: 0.05 },
    { key: 'bgR', label: 'Background red', default: 0, min: 0, max: 1, step: 0.05 },
    { key: 'bgG', label: 'Background green', default: 0, min: 0, max: 1, step: 0.05 },
    { key: 'bgB', label: 'Background blue', default: 0, min: 0, max: 1, step: 0.05 },
    { key: 'bgAlpha', label: 'Background alpha', default: 1, min: 0, max: 1, step: 0.05 },
  ],
  variants: [{ id: 'full', label: 'Full tile', value: 0, params: [] }],
  buildData: (_variantValue, base) => {
    const data = [
      STENCIL_SLIDER_GRID, STENCIL_SLIDER_GRID,
      base.fillR ?? 1, base.fillG ?? 1, base.fillB ?? 1,
      base.bgR ?? 0, base.bgG ?? 0, base.bgB ?? 0,
      base.bgAlpha ?? 1,
      0,
    ];
    for (let i = 0; i < STENCIL_SLIDER_GRID * STENCIL_SLIDER_GRID; i++) data.push(1);
    return data;
  },
};

// ── Mission code (req_1620/1621) ─────────────────────────────────────────────
// A unique, decodable code minted from a mission key (game/textures/missionCode.ts
// owns the codec). The shader is a dumb grid sampler — finder patterns + payload
// are already baked into the packed modules; this just reads a module's bit and
// returns dark or light, with a quiet-zone border. data[] layout is documented in
// missionCode.ts. The catalog form below previews a sample code; real codes are
// generated per mission via missionCodeDoc() and ride the decal pipeline.
export const MISSION_CODE_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let N = max(D[0], 1.0);
  let quiet = D[8];
  let span = N + quiet * 2.0;
  let mx = floor(in.uv.x * span) - quiet;
  let my = floor(in.uv.y * span) - quiet;
  let light = vec4f(D[4], D[5], D[6], D[7]);
  if (mx < 0.0 || my < 0.0 || mx >= N || my >= N) {
    return light;
  }
  let iN = u32(N);
  let idx = u32(my) * iN + u32(mx);
  let wordBits = u32(max(D[9], 1.0));
  let word = u32(D[11u + idx / wordBits]);
  let bit = (word >> (idx % wordBits)) & 1u;
  if (bit == 1u) {
    return vec4f(D[1], D[2], D[3], 1.0);
  }
  return light;
}
`;

const MISSION_CODE: ShaderSpec = {
  id: 'mission-code',
  label: 'Mission Code',
  group: 'Codes & Stencils',
  blurb: 'A unique, scannable code minted from a mission — finder patterns + the mission key, CRC-checked and decodable. Generated per mission (not hand-tuned); the sliders here recolor a sample.',
  shader: MISSION_CODE_SHADER,
  base: [
    { key: 'darkR', label: 'Module red', default: 0.04, min: 0, max: 1, step: 0.05 },
    { key: 'darkG', label: 'Module green', default: 0.04, min: 0, max: 1, step: 0.05 },
    { key: 'darkB', label: 'Module blue', default: 0.04, min: 0, max: 1, step: 0.05 },
    { key: 'lightR', label: 'Field red', default: 0.96, min: 0, max: 1, step: 0.05 },
    { key: 'lightG', label: 'Field green', default: 0.96, min: 0, max: 1, step: 0.05 },
    { key: 'lightB', label: 'Field blue', default: 0.96, min: 0, max: 1, step: 0.05 },
  ],
  variants: [{ id: 'sample', label: 'Sample', value: 0, params: [] }],
  buildData: (_variantValue, base) => packMissionData(
    'preview',
    [base.darkR ?? 0.04, base.darkG ?? 0.04, base.darkB ?? 0.04],
    [base.lightR ?? 0.96, base.lightG ?? 0.96, base.lightB ?? 0.96],
  ),
};

// ── The fill boards (effect_fills A–J) ───────────────────────────────────────
// D = [materialId, variant, seed, quality, board]. Each material's default seed
// follows the board's spread formula (coefA·materialId + coefB·variant + coefC),
// matching the evaluation cart's swatches exactly at variant 0; the seed is then
// a free slider. Detail grade is the PSX→Max quality axis.

const FILL_GRADES = ['PSX', 'PS2', 'Preview', 'Std', 'Max'] as const;
const FILL_GRADE_STD = 3;
const FILL_SEED_MAX = 2200; // every board formula lands well under this

type FillMaterial = { slug: string; name: string; variants: [string, string, string] };
type FillBoard = {
  board: number;            // D[4]
  letter: string;           // effect_fills demo board letter — drives the stable material id only
  title: string;            // effect_fills demo board name (origin batch; the editor groups by purpose, not this)
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
  {
    board: 8, letter: 'I', title: 'Facades', seedCoef: [53, 31, 367],
    materials: [
      { slug: 'brick-apartment', name: 'Brick Apartment', variants: ['Red Brick', 'Buff Brick', 'Sooted Grey'] },
      { slug: 'brick-fire-escape', name: 'Brick + Fire Escape', variants: ['Black Iron', 'Rust', 'Worn Grey'] },
      { slug: 'brick-shopfront', name: 'Brick Shopfront', variants: ['Green Awning', 'Red Awning', 'Blue Awning'] },
      { slug: 'brick-entrance', name: 'Brick Entrance', variants: ['Stoop', 'Recessed', 'Double Door'] },
      { slug: 'brick-rollshutter', name: 'Roll Shutter', variants: ['Plain', 'Tagged', 'Graffitied'] },
      { slug: 'brick-bodega', name: 'Bodega Front', variants: ['Bodega', 'Laundromat', 'Diner'] },
    ],
  },
  {
    board: 9, letter: 'J', title: 'Wall Props', seedCoef: [59, 37, 421],
    materials: [
      { slug: 'wall-flag', name: 'Hanging Flag', variants: ['Red', 'Blue & Gold', 'Green'] },
      { slug: 'wall-plants', name: 'Wall Plants', variants: ['Window Box', 'Hanging Vines', 'Ivy Climb'] },
      { slug: 'wall-billboard', name: 'Billboard', variants: ['Poster', 'Faded', 'Torn'] },
      { slug: 'wall-sign', name: 'Projecting Sign', variants: ['Blade', 'Neon', 'Shingle'] },
      { slug: 'wall-ac', name: 'AC & Vents', variants: ['Window AC', 'Vent Grille', 'Conduit'] },
    ],
  },
  {
    board: 10, letter: 'K', title: 'Street Ground', seedCoef: [61, 41, 463],
    materials: [
      { slug: 'sidewalk-grid', name: 'Sidewalk Grid', variants: ['Old Grey', 'Warm Aggregate', 'Blue Dust'] },
      { slug: 'sidewalk-utility', name: 'Utility Sidewalk', variants: ['Water Covers', 'Telecom Pullbox', 'Gas Plates'] },
      { slug: 'sidewalk-pavers', name: 'Sidewalk Pavers', variants: ['Red Brick', 'Concrete Blocks', 'Basalt Setts'] },
      { slug: 'curb-crosswalk', name: 'Curb + Crosswalk', variants: ['Fresh Paint', 'Worn Paint', 'ADA Ramp'] },
      { slug: 'alley-concrete', name: 'Alley Concrete', variants: ['Oil Spots', 'Trash Stains', 'Patchwork'] },
      { slug: 'plaza-terrazzo', name: 'Plaza Terrazzo', variants: ['Speckled', 'Brass Inlay', 'Cracked'] },
      { slug: 'storm-drain', name: 'Storm Drain', variants: ['Curb Grate', 'Round Drain', 'Trench Drain'] },
    ],
  },
  {
    board: 11, letter: 'L', title: 'Wood Brick Stone', seedCoef: [67, 43, 509],
    materials: [
      { slug: 'plywood-sheet', name: 'Plywood Sheet', variants: ['Fresh OSB', 'Boarded Window', 'Painted Scrap'] },
      { slug: 'clapboard-siding', name: 'Clapboard Siding', variants: ['Whitewash', 'Seafoam', 'Rotten Tan'] },
      { slug: 'parquet-floor', name: 'Parquet Floor', variants: ['Herringbone', 'Checker', 'Basket Weave'] },
      { slug: 'brick-herringbone', name: 'Brick Herringbone', variants: ['Red Clay', 'Buff Clay', 'Sooted'] },
      { slug: 'cinder-block', name: 'Cinder Block', variants: ['Raw Grey', 'Painted Cream', 'Tagged Blue'] },
      { slug: 'fieldstone', name: 'Fieldstone', variants: ['River Rock', 'Mossy', 'Dry Stack'] },
      { slug: 'marble-slab', name: 'Marble Slab', variants: ['White Vein', 'Green Vein', 'Black Vein'] },
    ],
  },
  {
    board: 12, letter: 'M', title: 'Metal Yard', seedCoef: [71, 47, 557],
    materials: [
      { slug: 'corrugated-metal', name: 'Corrugated Metal', variants: ['Galvanized', 'Rust Bottom', 'Painted Blue'] },
      { slug: 'diamond-plate', name: 'Diamond Plate', variants: ['Clean', 'Greasy', 'Worn Edge'] },
      { slug: 'brushed-steel', name: 'Brushed Steel', variants: ['Horizontal', 'Vertical', 'Circular'] },
      { slug: 'rusted-panel', name: 'Rusted Panel', variants: ['Orange Bloom', 'Black Rust', 'Peeling Paint'] },
      { slug: 'chainlink-panel', name: 'Chainlink Panel', variants: ['Fence', 'Razor Top', 'Privacy Slats'] },
      { slug: 'painted-metal-door', name: 'Painted Metal Door', variants: ['Green Exit', 'Red Service', 'Grey Fire'] },
      { slug: 'copper-patina', name: 'Copper Patina', variants: ['New Copper', 'Verdigris', 'Rain Streaks'] },
    ],
  },
  {
    board: 13, letter: 'N', title: 'Wallpapers', seedCoef: [73, 53, 601],
    materials: [
      { slug: 'floral-wallpaper', name: 'Floral Wallpaper', variants: ['Rose', 'Avocado', 'Blue China'] },
      { slug: 'stripe-wallpaper', name: 'Stripe Wallpaper', variants: ['Hotel Red', 'Hospital Mint', 'Navy Gold'] },
      { slug: 'motel-wallpaper', name: 'Motel Wallpaper', variants: ['Palm', 'Sunburst', 'Cigarette Tan'] },
      { slug: 'kids-wallpaper', name: 'Kids Wallpaper', variants: ['Stars', 'Clouds', 'Alphabet'] },
      { slug: 'damask-wallpaper', name: 'Damask Wallpaper', variants: ['Gold', 'Burgundy', 'Smoke Black'] },
      { slug: 'smoke-stained-wallpaper', name: 'Smoke-Stained Paper', variants: ['Ceiling Fade', 'Water Leak', 'Nicotine'] },
      { slug: 'office-wallcover', name: 'Office Wallcover', variants: ['Cubicle Grey', 'Beige Weave', 'Conference Blue'] },
      { slug: 'rose-trellis-wallpaper', name: 'Rose Trellis', variants: ['Dusty Rose', 'Sage Garden', 'Blue Parlor'] },
      { slug: 'vine-wallpaper', name: 'Vine Wallpaper', variants: ['Ivy Cream', 'Wisteria', 'Black Vine'] },
      { slug: 'chinoiserie-wallpaper', name: 'Chinoiserie Paper', variants: ['Blue Porcelain', 'Green Birds', 'Ochre Scene'] },
      { slug: 'art-deco-wallpaper', name: 'Art Deco Paper', variants: ['Gold Fan', 'Teal Fan', 'Noir Fan'] },
      { slug: 'toile-wallpaper', name: 'Toile Wallpaper', variants: ['French Blue', 'Sepia Farm', 'Red Hunt'] },
      { slug: 'tropical-wallpaper', name: 'Tropical Wallpaper', variants: ['Palm Green', 'Pink Flamingo', 'Night Jungle'] },
      { slug: 'kitchen-wallpaper', name: 'Kitchen Wallpaper', variants: ['Lemon Grid', 'Daisy Yellow', 'Cherry Cream'] },
      { slug: 'nursery-wallpaper', name: 'Nursery Wallpaper', variants: ['Moon Blue', 'Peach Bows', 'Mint Ducks'] },
      { slug: 'torn-layered-wallpaper', name: 'Torn Layered Paper', variants: ['Old Floral', 'Plaster Reveal', 'Many Layers'] },
    ],
  },
  {
    board: 14, letter: 'O', title: 'Gradients', seedCoef: [79, 59, 653],
    materials: [
      { slug: 'sunset-gradient', name: 'Sunset Gradient', variants: ['Miami Pink', 'Sodium Orange', 'Purple Night'] },
      { slug: 'vapor-gradient', name: 'Vapor Gradient', variants: ['Cyan Magenta', 'Acid Lime', 'Deep Violet'] },
      { slug: 'sodium-fog', name: 'Sodium Fog', variants: ['Streetlamp', 'Tunnel', 'Parking Deck'] },
      { slug: 'fluorescent-panel', name: 'Fluorescent Panel', variants: ['Office White', 'Sick Green', 'Flicker Pink'] },
      { slug: 'hazard-gradient', name: 'Hazard Gradient', variants: ['Warning Stripe', 'Bio Spill', 'Police Tape'] },
      { slug: 'wet-neon-fade', name: 'Wet Neon Fade', variants: ['Pink Reflection', 'Blue Reflection', 'Oil Rainbow'] },
      { slug: 'grime-gradient', name: 'Grime Gradient', variants: ['Top Soot', 'Bottom Mold', 'Corner Dirt'] },
    ],
  },
];

// ── Editor shelves ───────────────────────────────────────────────────────────
// The catalog rail groups by authoring intent: where this material belongs or
// what it is made of. The effect_fills board letters still drive stable ids and
// WGSL board slots, but they are implementation detail, not UX vocabulary.
const TEXTURE_CATEGORIES = [
  'Pavement & Streets',
  'Terrain & Water',
  'Exterior Walls',
  'Storefronts & Facades',
  'Signs & Wall Fixtures',
  'Wallpaper & Interior Walls',
  'Floors & Tile',
  'Glass, Light & Gradients',
  'Metal & Industrial',
  'Wood, Fabric & Body',
  'Props & Clutter',
  'Codes & Stencils',
] as const;
type TextureCategory = typeof TEXTURE_CATEGORIES[number];

const CATEGORY_BY_SLUG: Record<string, TextureCategory> = {
  // Pavement & Streets — hard outdoor circulation surfaces.
  road: 'Pavement & Streets', asphalt: 'Pavement & Streets', sidewalk: 'Pavement & Streets',
  'sidewalk-grid': 'Pavement & Streets', 'sidewalk-utility': 'Pavement & Streets',
  'sidewalk-pavers': 'Pavement & Streets', 'curb-crosswalk': 'Pavement & Streets',
  'alley-concrete': 'Pavement & Streets', 'storm-drain': 'Pavement & Streets',
  'wet-asphalt': 'Pavement & Streets',
  // Terrain & Water — organic ground, landscape, and outdoor natural surfaces.
  sand: 'Terrain & Water', dune: 'Terrain & Water', water: 'Terrain & Water',
  'deep-water': 'Terrain & Water', grass: 'Terrain & Water', turf: 'Terrain & Water',
  'palm-canopy': 'Terrain & Water', 'salt-flat': 'Terrain & Water', 'ice-sheet': 'Terrain & Water',
  // Exterior Walls — bare wall/construction skins.
  brick: 'Exterior Walls', concrete: 'Exterior Walls', 'stone-wall': 'Exterior Walls',
  'stucco-facade': 'Exterior Walls', 'neon-stucco': 'Exterior Walls',
  'mold-wall': 'Exterior Walls', 'peel-paint': 'Exterior Walls',
  'mildew-brick': 'Exterior Walls', 'rot-siding': 'Exterior Walls', 'rust-sheet': 'Exterior Walls',
  'clapboard-siding': 'Exterior Walls', 'brick-herringbone': 'Exterior Walls',
  'cinder-block': 'Exterior Walls', fieldstone: 'Exterior Walls', 'marble-slab': 'Exterior Walls',
  // Storefronts & Facades — wall faces with baked architectural detail.
  'brick-apartment': 'Storefronts & Facades', 'brick-fire-escape': 'Storefronts & Facades',
  'brick-shopfront': 'Storefronts & Facades', 'brick-entrance': 'Storefronts & Facades',
  'brick-rollshutter': 'Storefronts & Facades', 'brick-bodega': 'Storefronts & Facades',
  // Signs & Wall Fixtures — things mounted onto wall faces.
  'wall-flag': 'Signs & Wall Fixtures', 'wall-plants': 'Signs & Wall Fixtures',
  'wall-billboard': 'Signs & Wall Fixtures', 'wall-sign': 'Signs & Wall Fixtures',
  'wall-ac': 'Signs & Wall Fixtures', 'neon-tube': 'Signs & Wall Fixtures',
  // Wallpaper & Interior Walls — paper, panel, ceiling, and wallcover.
  'peel-wallpaper': 'Wallpaper & Interior Walls', 'drop-ceiling': 'Wallpaper & Interior Walls',
  'floral-wallpaper': 'Wallpaper & Interior Walls', 'stripe-wallpaper': 'Wallpaper & Interior Walls',
  'motel-wallpaper': 'Wallpaper & Interior Walls', 'kids-wallpaper': 'Wallpaper & Interior Walls',
  'damask-wallpaper': 'Wallpaper & Interior Walls', 'smoke-stained-wallpaper': 'Wallpaper & Interior Walls',
  'office-wallcover': 'Wallpaper & Interior Walls', 'rose-trellis-wallpaper': 'Wallpaper & Interior Walls',
  'vine-wallpaper': 'Wallpaper & Interior Walls', 'chinoiserie-wallpaper': 'Wallpaper & Interior Walls',
  'art-deco-wallpaper': 'Wallpaper & Interior Walls', 'toile-wallpaper': 'Wallpaper & Interior Walls',
  'tropical-wallpaper': 'Wallpaper & Interior Walls', 'kitchen-wallpaper': 'Wallpaper & Interior Walls',
  'nursery-wallpaper': 'Wallpaper & Interior Walls', 'torn-layered-wallpaper': 'Wallpaper & Interior Walls',
  // Floors & Tile — indoor walkable/flat surfaces.
  linoleum: 'Floors & Tile', 'bath-tile': 'Floors & Tile', 'pool-tile': 'Floors & Tile',
  'motel-carpet': 'Floors & Tile', 'rotten-rug': 'Floors & Tile', 'pdx-carpet': 'Floors & Tile',
  'booth-vinyl': 'Floors & Tile', 'plank-deck': 'Floors & Tile', 'moss-carpet': 'Floors & Tile',
  'plywood-sheet': 'Floors & Tile', 'parquet-floor': 'Floors & Tile', 'plaza-terrazzo': 'Floors & Tile',
  // Glass, Light & Gradients — emissive, reflective, screen, and atmospheric looks.
  'sunset-sky': 'Glass, Light & Gradients', 'car-paint': 'Glass, Light & Gradients',
  'crt-screen': 'Glass, Light & Gradients', 'fogged-mirror': 'Glass, Light & Gradients',
  'stained-glass': 'Glass, Light & Gradients', 'sunset-gradient': 'Glass, Light & Gradients',
  'vapor-gradient': 'Glass, Light & Gradients', 'sodium-fog': 'Glass, Light & Gradients',
  'fluorescent-panel': 'Glass, Light & Gradients', 'hazard-gradient': 'Glass, Light & Gradients',
  'wet-neon-fade': 'Glass, Light & Gradients', 'grime-gradient': 'Glass, Light & Gradients',
  // Metal & Industrial — metal panels, doors, fences, and machine surfaces.
  'blade-steel': 'Metal & Industrial', gunmetal: 'Metal & Industrial',
  'grip-polymer': 'Metal & Industrial', 'tarnished-silver': 'Metal & Industrial',
  'charcoal-bed': 'Metal & Industrial', 'brushed-steel': 'Metal & Industrial',
  'copper-patina': 'Metal & Industrial', 'corrugated-metal': 'Metal & Industrial',
  'diamond-plate': 'Metal & Industrial', 'rusted-panel': 'Metal & Industrial',
  'chainlink-panel': 'Metal & Industrial', 'painted-metal-door': 'Metal & Industrial',
  // Wood, Fabric & Body — softer substances and character/prop skins.
  leather: 'Wood, Fabric & Body', denim: 'Wood, Fabric & Body', fabric: 'Wood, Fabric & Body',
  skin: 'Wood, Fabric & Body', wood: 'Wood, Fabric & Body',
  // Props & Clutter — discrete set dressing / evidence / mess.
  'cash-stack': 'Props & Clutter', 'product-baggie': 'Props & Clutter',
  'blood-pool': 'Props & Clutter', evidence: 'Props & Clutter', refuse: 'Props & Clutter',
  corkboard: 'Props & Clutter', substance: 'Props & Clutter',
};

export function textureCategory(slug: string): TextureCategory {
  return CATEGORY_BY_SLUG[slug] ?? 'Props & Clutter';
}

function fillSpec(b: FillBoard, materialId: number, m: FillMaterial): ShaderSpec {
  const [perMaterial, perVariant, offset] = b.seedCoef;
  const defaultSeed = perMaterial * materialId + offset; // variant-0 swatch seed
  return {
    id: `${b.letter.toLowerCase()}-${m.slug}`,
    label: m.name,
    group: textureCategory(m.slug),
    blurb: `${m.name} — three authored takes, seed + detail grade tunable.`,
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

export const HMSC_SHADERS: ShaderSpec[] = [ROAD, CUTOUT_STENCIL, MISSION_CODE, ...FILL_SPECS];

function slugPart(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
}

function frozenData(spec: ShaderSpec, variant: ShaderVariant, basePatch: Record<string, number> = {}): number[] {
  return spec.buildData(
    variant.value,
    { ...paramDefaults(spec.base), ...basePatch },
    paramDefaults(variant.params),
  );
}

function shaderPresetsFor(spec: ShaderSpec): ShaderTexturePreset[] {
  const hasGrade = spec.base.some((p) => p.key === 'grade');
  if (hasGrade) {
    return spec.variants.flatMap((variant) => FILL_GRADES.map((grade, gradeValue) => ({
      id: `${spec.id}--${variant.id}--${slugPart(grade)}`,
      label: `${spec.label} · ${variant.label} · ${grade}`,
      group: spec.group,
      shaderId: spec.id,
      shader: spec.shader,
      data: frozenData(spec, variant, { grade: gradeValue }),
    })));
  }
  if (spec.id === 'road') {
    return spec.variants.map((variant) => ({
      id: `${spec.id}--${variant.id}`,
      label: `${spec.label} · ${variant.label}`,
      group: spec.group,
      shaderId: spec.id,
      shader: spec.shader,
      data: frozenData(spec, variant),
    }));
  }
  return [];
}

export const HMSC_SHADER_PRESETS: ShaderTexturePreset[] = HMSC_SHADERS.flatMap(shaderPresetsFor);
export const HMSC_BROWSE_SHADER_PRESETS: ShaderTexturePreset[] = HMSC_SHADER_PRESETS.filter((preset) => {
  const spec = shaderSpec(preset.shaderId);
  if (!spec) return false;
  return spec.id === 'road' || preset.id.endsWith('--std');
});

export function shaderSpec(id: string): ShaderSpec | undefined {
  return HMSC_SHADERS.find((s) => s.id === id);
}

export function shaderTexturePreset(id: string): ShaderTexturePreset | undefined {
  return HMSC_SHADER_PRESETS.find((p) => p.id === id);
}

// Group order for catalog rails: the purpose categories in their declared order
// (TEXTURE_CATEGORIES), with any stragglers appended in first-seen order.
export function shaderGroups(): { group: string; specs: ShaderSpec[] }[] {
  const out: { group: string; specs: ShaderSpec[] }[] = [];
  for (const spec of HMSC_SHADERS) {
    const g = out.find((x) => x.group === spec.group);
    if (g) g.specs.push(spec); else out.push({ group: spec.group, specs: [spec] });
  }
  const rank = (group: string) => {
    const i = (TEXTURE_CATEGORIES as readonly string[]).indexOf(group);
    return i === -1 ? TEXTURE_CATEGORIES.length : i;
  };
  return out.sort((a, b) => rank(a.group) - rank(b.group));
}
