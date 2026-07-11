// groundFormula.ts — the editor's painted-ground FORMULA (MAPPAINT req_2473,
// catalog-composed req_2494).
//
// The tile channel renders through the host's per-fragment ground pipeline
// (framework/gpu/3d.zig): the cart pushes ONE WGSL body defining
// `fn hf_ground_rgb(uv) -> vec3f` via __map_set_ground_look, and the host map
// engine encodes each painted chunk's cell grid as the D reference stream the
// body reads.
//
// req_2494: the ground no longer dispatches to four hand-written fills (which
// made sand and mud literally identical and water render as concrete). The
// FULL material catalog (render3d/shaders — the same materials the paint
// ink and Color Studio use) composes into the formula, and each TILE KIND
// carries a REBINDABLE (material, variant) binding: the defaults below give
// every kind a distinct real material, and the paint bar's texture picker can
// point any kind at any surface material. Rebinding regenerates this formula
// and re-pushes the ground look — pure cart-side, no engine change.
//
// D[] layout v4 (the engine's encodeGroundData contract): [0]cols [1]rows
// [2]tilePal [3]floraPal [4]zonePal [5]bindCount, then tilePal×3 + floraPal×3
// + zonePal×3 palette rgb floats, then bindCount×4 binding rows ([materialId,
// boardIndex, variant, joint]), then rows×cols PACKED cells, then rows×cols
// packed material references: (binding+1) + roadMarking·512 +
// undercoatToken·131072. The exact 24-bit packing preserves the material table,
// raster fallback markings, and the tile/material visually beneath a road.
// Finally: ribbonCount then ribbonCount×11 analytic curve floats. Packed cell
// (24 bits, exact in f32): (tile+1) + (flora+1)·1024 + (zone+1)·262144;
// 0 = empty slot. Flora and zones tint OVER the ground material — the
// authoring overlay view; the real populations materialize at Compile.
// (WGSL: no unary +, no backticks in comments.)
import { hexToRgb01 } from '@reactjit/runtime/paint';
import { FILL_FUNCS } from './shaders/_generated/dispatch';
import { MATERIALS, type RegistryMaterial } from './shaders/_generated/registry';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import { FLORA_KIND_DEFINITIONS } from '../world/floraKinds';

export type TileMaterialBinding = { fn: string; variant: number };

export const GROUND_STREAM_TUNING = {
  materialRefStride: 512,
  undercoatRefStride: 131072,
  ribbonSegmentFloats: 11,
} as const;

const MATERIAL_BY_FN = new Map(MATERIALS.map((m) => [m.fn, m]));

/** The catalog materials a tile can bind to (surface recipes only — gradients
 *  and compositions read wrong as ground). The picker lists THIS. */
export const GROUND_MATERIALS: RegistryMaterial[] = MATERIALS.filter((m) => m.kind === 'surface');

// Default kind → material bindings: every kind gets a DISTINCT real material.
// Sand is sand, mud is mud (its own authored material — the old formula sent
// both through one fill), water is water, roads are asphalt. Kinds not listed
// (walls/doors/markers — never painted as ground) fall back to concrete.
const DEFAULT_BINDINGS: TileMaterialOverrides = {
  water: { fn: 'water', variant: 0 },
  road: { fn: 'road', variant: 0 },
  asphalt: { fn: 'asphalt', variant: 0 },
  sidewalk: { fn: 'sidewalk', variant: 0 },
  mud: { fn: 'mud', variant: 0 },
  sand: { fn: 'sand', variant: 0 },
  grass: { fn: 'grass', variant: 0 },
  // Road grammar kinds must be bound explicitly. Falling through to concrete
  // made the whole carriageway read as sidewalk while only the median looked
  // like asphalt (req_2936). Lane flow stays semantic; the surface is asphalt.
  laneNorth: { fn: 'road', variant: 2 },
  laneSouth: { fn: 'road', variant: 2 },
  laneEast: { fn: 'road', variant: 2 },
  laneWest: { fn: 'road', variant: 2 },
  junction: { fn: 'road', variant: 2 },
  crosswalk: { fn: 'road', variant: 2 },
  median: { fn: 'road', variant: 2 },
  parking: { fn: 'asphalt', variant: 1 },
  parkingCross: { fn: 'asphalt', variant: 1 },
  vehicleSpawn: { fn: 'asphalt', variant: 0 },
};
const FALLBACK_BINDING: TileMaterialBinding = { fn: 'concrete', variant: 0 };

/** The curated DEFAULT look for a tile kind — what binding-less cells wear. */
export function tileBindingFor(kind: string): TileMaterialBinding {
  return DEFAULT_BINDINGS[kind] ?? FALLBACK_BINDING;
}

// ── the painted-material binding table (req_2693) ────────────────────────────
// The map's palette of hand-picked looks: the host engine owns the table
// (persisted in the RMAP), cells reference entries by index, and the formula
// dispatches on the 4-float rows packed here. Cart⇄host mirror is these two
// codecs. joint rides per binding so a picked sidewalk material keeps its slab
// edge and a picked asphalt stays seamless.

export function bindingsToFloats(bindings: readonly TileMaterialBinding[]): Float32Array {
  const out = new Float32Array(bindings.length * 4);
  bindings.forEach((b, i) => {
    const mat = MATERIAL_BY_FN.get(b.fn) ?? MATERIAL_BY_FN.get(FALLBACK_BINDING.fn)!;
    if (!MATERIAL_BY_FN.has(b.fn)) console.error(`[groundFormula] unknown binding material '${b.fn}' — packing ${FALLBACK_BINDING.fn}`);
    out[i * 4] = mat.materialId;
    out[i * 4 + 1] = mat.boardIndex;
    out[i * 4 + 2] = b.variant;
    out[i * 4 + 3] = SLAB_JOINT_FNS.has(mat.fn) ? 1 : 0;
  });
  return out;
}

export function floatsToBindings(rows: Float32Array): TileMaterialBinding[] {
  const out: TileMaterialBinding[] = [];
  for (let i = 0; i + 3 < rows.length; i += 4) {
    const mat = MATERIALS.find((m) => m.materialId === rows[i] && m.boardIndex === rows[i + 1]);
    if (!mat) console.error(`[groundFormula] host binding row ${i / 4} references unknown material id ${rows[i]} board ${rows[i + 1]} — keeping ${FALLBACK_BINDING.fn} so cell indices stay aligned`);
    out.push({ fn: mat?.fn ?? FALLBACK_BINDING.fn, variant: rows[i + 2] ?? 0 });
  }
  return out;
}

// Kinds whose ground reads as poured slabs — they keep the darkened tile-edge
// joint. Everything else (asphalt, earth, water …) must read seamless.
const SLAB_JOINT_FNS = new Set([
  'concrete', 'sidewalk', 'sidewalk_grid', 'sidewalk_utility', 'sidewalk_pavers',
  'alley_concrete', 'plaza_terrazzo',
]);

// ── Composing the catalog into the heightfield harness ───────────────────────
// The harness already binds the ground D stream at binding(1) and the generated
// dispatch declares its own D for the fill contract — strip the declaration so
// the composed module has ONE. mat_pal reads D[5..] as a palette section, which
// in the GROUND stream is palette/cell data, so neutralize it to always return
// the baked constants (per-kind recoloring of the painted ground is a later
// slice; it would ride a dedicated section of the ground stream, not the fill
// contract). Both edits assert their pattern so generator drift fails LOUD.
const D_DECL = '@group(0) @binding(1) var<storage, read> D: array<f32>;';
const MAT_PAL_COUNT_LINE = 'let n = i32(D[5] + 0.5);';

function composedFillFuncs(): string {
  if (!FILL_FUNCS.includes(D_DECL)) {
    throw new Error('[groundFormula] dispatch drift: D declaration not found — re-check build-shaders.ts output');
  }
  if (!FILL_FUNCS.includes(MAT_PAL_COUNT_LINE)) {
    throw new Error('[groundFormula] dispatch drift: mat_pal count line not found — re-check build-shaders.ts output');
  }
  // Catalog fills are authored for the EFFECT pipeline, whose uniform struct is
  // bound as `U` (U.time drives water waves, neon flicker, CRT scan …). The
  // ground pipeline binds the shared SceneUniforms as `S` and exposes the same
  // wrapped wall-clock as `S.time` — without this rewrite any time-animated
  // fill (water and grass are in the DEFAULTS) makes the whole composed module
  // fail WGSL compile ("no definition in scope for identifier: U") and ALL
  // painted ground goes invisible (req_2651).
  return FILL_FUNCS.replace(D_DECL, '// (D is declared by the heightfield harness)')
    .replace(MAT_PAL_COUNT_LINE, 'let n = 0; // ground stream carries cells, not a fill palette — baked colors only')
    .replace(/\bU\.time\b/g, 'S.time');
}

/** Build the STATIC ground formula. The kind→material tables baked here are
 *  the curated DEFAULTS only — they never change at runtime, so this WGSL
 *  compiles exactly once per app run. Hand-picked looks arrive as DATA: the
 *  binding table + per-cell material indices in the D stream (layout v4),
 *  pushed via mapSetTileBindings — a pick used to regenerate this source and
 *  stall 10-15s in the driver compile (req_2693). */
export function editorGroundFormula(): string {
  const bindings = TILE_KINDS.map((k) => {
    const b = tileBindingFor(k);
    const mat = MATERIAL_BY_FN.get(b.fn);
    if (!mat) {
      console.error(`[groundFormula] unknown material '${b.fn}' bound to tile kind '${k}' — using ${FALLBACK_BINDING.fn}`);
      return { mat: MATERIAL_BY_FN.get(FALLBACK_BINDING.fn)!, variant: FALLBACK_BINDING.variant, joint: true };
    }
    return { mat, variant: b.variant, joint: SLAB_JOINT_FNS.has(b.fn) };
  });
  const n = bindings.length;
  const roadKinds = {
    laneNorth: TILE_KINDS.indexOf('laneNorth'),
    laneSouth: TILE_KINDS.indexOf('laneSouth'),
    laneEast: TILE_KINDS.indexOf('laneEast'),
    laneWest: TILE_KINDS.indexOf('laneWest'),
    median: TILE_KINDS.indexOf('median'),
    crosswalk: TILE_KINDS.indexOf('crosswalk'),
    junction: TILE_KINDS.indexOf('junction'),
  };
  if (Object.values(roadKinds).some((index) => index < 0)) {
    throw new Error('[groundFormula] road-kind legend is incomplete — directional UV dispatch cannot be built');
  }
  const roadSurface = MATERIAL_BY_FN.get('road');
  const sidewalkSurface = MATERIAL_BY_FN.get('sidewalk');
  if (!roadSurface || !sidewalkSurface) {
    throw new Error('[groundFormula] analytic road ribbon requires Road and Sidewalk catalog materials');
  }
  const arr = (vals: number[], fixed: number) => vals.map((v) => v.toFixed(fixed)).join(', ');

  return `
${composedFillFuncs()}
fn hf_tile_mat(k: i32) -> i32 {
  var m = array<f32, ${n}>(${arr(bindings.map((b) => b.mat.materialId), 1)});
  return i32(m[clamp(k, 0, ${n - 1})]);
}
fn hf_tile_board(k: i32) -> f32 {
  var b = array<f32, ${n}>(${arr(bindings.map((b) => b.mat.boardIndex), 1)});
  return b[clamp(k, 0, ${n - 1})];
}
fn hf_tile_var(k: i32) -> f32 {
  var v = array<f32, ${n}>(${arr(bindings.map((b) => b.variant), 1)});
  return v[clamp(k, 0, ${n - 1})];
}
fn hf_tile_joint(k: i32) -> f32 {
  var j = array<f32, ${n}>(${arr(bindings.map((b) => (b.joint ? 1 : 0)), 1)});
  return j[clamp(k, 0, ${n - 1})];
}
fn hf_ground_rgb(uv0: vec2f) -> vec3f {
  let cols = i32(D[0]);
  let rows = i32(D[1]);
  let tilePal = i32(D[2]);
  let floraPal = i32(D[3]);
  let zonePal = i32(D[4]);
  let bindCount = i32(D[5]);
  let floraBase = 6 + tilePal * 3;
  let zoneBase = floraBase + floraPal * 3;
  let bindBase = zoneBase + zonePal * 3;
  let cellBase = bindBase + bindCount * 4;
  let matBase = cellBase + rows * cols;
  let ribbonBase = matBase + rows * cols;
  let ribbonCount = i32(D[ribbonBase]);

  let cx = clamp(i32(floor(uv0.x * f32(cols))), 0, cols - 1);
  let cy = clamp(i32(floor(uv0.y * f32(rows))), 0, rows - 1);
  let packed = i32(D[cellBase + cy * cols + cx]);
  let semanticKind = (packed % 1024) - 1;
  let flora = ((packed / 1024) % 256) - 1;
  let zone = (packed / 262144) - 1;
  let materialRef = i32(D[matBase + cy * cols + cx]);
  let undercoatToken = materialRef / ${GROUND_STREAM_TUNING.undercoatRefStride};
  let lowerMaterialRef = materialRef % ${GROUND_STREAM_TUNING.undercoatRefStride};
  let bind = (lowerMaterialRef % ${GROUND_STREAM_TUNING.materialRefStride}) - 1;
  let roadMark = lowerMaterialRef / ${GROUND_STREAM_TUNING.materialRefStride};
  // Analytic roads render over the exact tile/material they replaced. Token 1
  // means empty undercoat; N+2 means tile kind N. The semantic kind remains
  // available for junction/crosswalk policy and all gameplay stays native.
  let kind = select(semanticKind, undercoatToken - 2, undercoatToken > 0);

  // 1 tile = 1 m, so p IS world XZ in metres; fract gives the in-tile uv and
  // the per-cell seed varies the grain like the placed-piece path does.
  let p = uv0 * vec2f(f32(cols), f32(rows));
  let fc = fract(p);
  let seed = rand(floor(p) + vec2f(3.1, 7.7)) * 50.0;

  var rgb = vec3f(0.0);
  if (kind < 0) {
    // unpainted: the editor's dark grid ground
    let gf0 = abs(fc - vec2f(0.5));
    let edge0 = max(gf0.x, gf0.y);
    let g = smoothstep(0.46, 0.5, edge0) * 0.07;
    rgb = vec3f(0.05 + g, 0.07 + g, 0.10 + g);
  } else {
    // The cell's HAND-PICKED binding wins over the kind default — this is
    // what lets neighboring tiles of one kind wear different materials.
    var mat = hf_tile_mat(kind);
    var board = hf_tile_board(kind);
    var take = hf_tile_var(kind);
    var joint = hf_tile_joint(kind);
    if (bind >= 0 && bind < bindCount) {
      let bb = bindBase + bind * 4;
      mat = i32(D[bb]);
      board = D[bb + 1];
      take = D[bb + 2];
      joint = D[bb + 3];
    }
    // Catalog road fills author their longitudinal axis along UV.y. East/west
    // lanes therefore swap axes; a median has no direction tag, so infer its
    // axis from the immediately adjacent directional lane cells. This keeps
    // asphalt markings parallel to the semantic road rather than crossing it.
    var surfaceUv = fc;
    var surfaceMeters = p;
    var roadAlongX = undercoatToken == 0 && ((roadMark & 1) != 0 || semanticKind == ${roadKinds.laneEast} || semanticKind == ${roadKinds.laneWest});
    if (undercoatToken == 0 && roadMark == 0 && (semanticKind == ${roadKinds.median} || semanticKind == ${roadKinds.crosswalk})) {
      var northKind = -1;
      var southKind = -1;
      if (cy > 0) { northKind = (i32(D[cellBase + (cy - 1) * cols + cx]) % 1024) - 1; }
      if (cy < rows - 1) { southKind = (i32(D[cellBase + (cy + 1) * cols + cx]) % 1024) - 1; }
      roadAlongX = northKind == ${roadKinds.laneEast} || northKind == ${roadKinds.laneWest}
        || southKind == ${roadKinds.laneEast} || southKind == ${roadKinds.laneWest};
    }
    if (roadAlongX) {
      surfaceUv = vec2f(fc.y, fc.x);
      surfaceMeters = vec2f(p.y, p.x);
    }
    rgb = fill_pick(mat, board, surfaceUv, surfaceUv * 64.0, take, seed);
    if (roadMark > 0 && ribbonCount == 0) {
      rgb = road_apply_markings(rgb, surfaceUv, surfaceMeters, f32(roadMark));
    }
    // Slab joint at tile edges — concrete/sidewalk slabs carry it; seamless
    // surfaces (asphalt, earth, water) skip it so they read as one carriageway.
    if (joint > 0.5) {
      let je = min(min(fc.x, 1.0 - fc.x), min(fc.y, 1.0 - fc.y));
      let jaa = max(fwidth(je), 0.0008);
      rgb = mix(rgb, rgb * 0.5, (1.0 - smoothstep(0.012, 0.012 + jaa, je)) * 0.8);
    }
  }

  // The tile stamp above is GAMEPLAY. The visible road is the same filleted
  // centerline recipe as rail: evaluate the union of analytic carriageway and
  // sidewalk strips over the exact visual undercoat. Any carriageway wins over
  // another road's sidewalk at an overlap; junction/crosswalk policy still
  // comes from the semantic raster kind.
  if (ribbonCount > 0) {
    var bestFullD = 1e9;
    var bestFullExt = 0.0;
    var bestFullSigned = 0.0;
    var bestFullAlong = 0.0;
    var bestRoadD = 1e9;
    var bestRoadExt = 0.0;
    var bestRoadRight = 0.0;
    var bestRoadLeft = 0.0;
    var bestRoadSigned = 0.0;
    var bestRoadAlong = 0.0;
    var bestRoadTwoWay = 0.0;
    var bestRoadPhase = 0.0;
    for (var segment = 0; segment < ribbonCount; segment = segment + 1) {
      let row = ribbonBase + 1 + segment * ${GROUND_STREAM_TUNING.ribbonSegmentFloats};
      let a = vec2f(D[row], D[row + 1]);
      let b = vec2f(D[row + 2], D[row + 3]);
      let ab = b - a;
      let len2 = dot(ab, ab);
      if (len2 <= 0.000001) { continue; }
      let segmentM = sqrt(len2);
      let t = clamp(dot(p - a, ab) / len2, 0.0, 1.0);
      let q = a + ab * t;
      let delta = p - q;
      let distanceM = length(delta);
      let right = vec2f(0.0 - ab.y, ab.x) / segmentM;
      let signedM = dot(delta, right);
      let roadExt = select(D[row + 5], D[row + 4], signedM >= 0.0);
      let fullExt = select(D[row + 7], D[row + 6], signedM >= 0.0);
      let alongM = D[row + 10] + t * segmentM;
      if (distanceM <= fullExt + 0.25 && distanceM < bestFullD) {
        bestFullD = distanceM;
        bestFullExt = fullExt;
        bestFullSigned = signedM;
        bestFullAlong = alongM;
      }
      if (distanceM <= roadExt + 0.25 && distanceM < bestRoadD) {
        bestRoadD = distanceM;
        bestRoadExt = roadExt;
        bestRoadRight = D[row + 4];
        bestRoadLeft = D[row + 5];
        bestRoadSigned = signedM;
        bestRoadAlong = alongM;
        bestRoadTwoWay = D[row + 8];
        bestRoadPhase = D[row + 9];
      }
    }

    var fullMask = 0.0;
    if (bestFullD < 1e8) {
      let aa = max(fwidth(bestFullD), 0.008);
      fullMask = 1.0 - smoothstep(bestFullExt - aa, bestFullExt + aa, bestFullD);
    }
    var roadMask = 0.0;
    if (bestRoadD < 1e8) {
      let aa = max(fwidth(bestRoadD), 0.008);
      roadMask = 1.0 - smoothstep(bestRoadExt - aa, bestRoadExt + aa, bestRoadD);
    }

    if (fullMask > 0.0) {
      let sidewalkMeters = vec2f(bestFullSigned, bestFullAlong);
      let sidewalkUv = fract(sidewalkMeters);
      let sidewalkRgb = fill_pick(
        ${sidewalkSurface.materialId}, ${sidewalkSurface.boardIndex.toFixed(1)},
        sidewalkUv, sidewalkMeters * 64.0, 0.0, seed
      );
      rgb = mix(rgb, sidewalkRgb, max(fullMask - roadMask, 0.0));
    }
    if (roadMask > 0.0) {
      let roadMeters = vec2f(bestRoadSigned, bestRoadAlong);
      let roadUv = fract(roadMeters);
      var roadRgb = fill_pick(
        ${roadSurface.materialId}, ${roadSurface.boardIndex.toFixed(1)},
        roadUv, roadMeters * 64.0, 2.0, seed
      );
      roadRgb = road_apply_ribbon_markings(
        roadRgb,
        bestRoadSigned,
        bestRoadAlong,
        bestRoadRight,
        bestRoadLeft,
        bestRoadTwoWay,
        bestRoadPhase,
        select(0.0, 1.0, semanticKind == ${roadKinds.junction}),
        select(0.0, 1.0, semanticKind == ${roadKinds.crosswalk})
      );
      rgb = mix(rgb, roadRgb, roadMask);
    }
  }
  // flora authoring tint (composite lane) — grain-speckled so a painted
  // population reads organic, not a flat decal; the real blades/palms
  // materialize at Compile
  if (flora >= 0 && flora < floraPal) {
    let fb = floraBase + flora * 3;
    let tint = vec3f(D[fb], D[fb + 1], D[fb + 2]);
    let organic = 0.30 + 0.25 * (fbm(p.x * 2.3, p.y * 2.3, 3.0) * 0.5 + 0.5);
    rgb = mix(rgb, tint, organic);
  }
  // zone authoring tint — a translucent wash + a brighter zone border
  if (zone >= 0 && zone < zonePal) {
    let zb = zoneBase + zone * 3;
    let tint = vec3f(D[zb], D[zb + 1], D[zb + 2]);
    rgb = mix(rgb, tint, 0.22);
    let ze = min(min(fc.x, 1.0 - fc.x), min(fc.y, 1.0 - fc.y));
    var borderCell = false;
    if (cx > 0 && ((i32(D[cellBase + cy * cols + cx - 1]) / 262144) - 1) != zone) { borderCell = true; }
    if (cx < cols - 1 && ((i32(D[cellBase + cy * cols + cx + 1]) / 262144) - 1) != zone) { borderCell = true; }
    if (cy > 0 && ((i32(D[cellBase + (cy - 1) * cols + cx]) / 262144) - 1) != zone) { borderCell = true; }
    if (cy < rows - 1 && ((i32(D[cellBase + (cy + 1) * cols + cx]) / 262144) - 1) != zone) { borderCell = true; }
    if (borderCell) {
      rgb = mix(rgb, tint, (1.0 - smoothstep(0.06, 0.14, ze)) * 0.65);
    }
  }
  return rgb;
}
`;
}

/** THE ground formula — static for the whole run; material picks are data. */
export const EDITOR_GROUND_FORMULA = editorGroundFormula();

function paletteOf(colors: readonly string[]): Float32Array {
  const out = new Float32Array(colors.length * 3);
  colors.forEach((hex, i) => {
    const [r, g, b] = hexToRgb01(hex);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  });
  return out;
}

/** The tile-kind palette (rgb triples in TILE_KINDS order) — the D-stream
 *  palette section plus the dock's swatches share this one source. */
export const TILE_KIND_PALETTE: Float32Array = paletteOf(TILE_KINDS.map((k) => tileKindDefinition(k).render.color));

/** The flora-kind palette (FLORA_KIND_DEFINITIONS order). */
export const FLORA_KIND_PALETTE: Float32Array = paletteOf(FLORA_KIND_DEFINITIONS.map((d) => d.color));

/** Zone palette from the live zone list (re-pushed whenever zones change). */
export function zonePaletteOf(zones: readonly { color: string }[]): Float32Array {
  return paletteOf(zones.map((z) => z.color));
}
