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
// FULL material catalog (render3d/shaders — the same 113 materials the paint
// ink and Color Studio use) composes into the formula, and each TILE KIND
// carries a REBINDABLE (material, variant) binding: the defaults below give
// every kind a distinct real material, and the paint bar's texture picker can
// point any kind at any surface material. Rebinding regenerates this formula
// and re-pushes the ground look — pure cart-side, no engine change.
//
// D[] layout v2 (the engine's encodeGroundData contract): [0]cols [1]rows
// [2]tilePal [3]floraPal [4]zonePal, then tilePal×3 + floraPal×3 + zonePal×3
// palette rgb floats, then rows×cols PACKED cells. Packed cell (24 bits, exact
// in f32): (tile+1) + (flora+1)·1024 + (zone+1)·262144; 0 = empty slot. Flora
// and zones tint OVER the ground material — the authoring overlay view; the
// real populations materialize at Compile. (WGSL: no unary +, no backticks in
// comments.)
import { hexToRgb01 } from '@reactjit/runtime/paint';
import { FILL_FUNCS } from './shaders/_generated/dispatch';
import { MATERIALS, type RegistryMaterial } from './shaders/_generated/registry';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import { FLORA_KIND_DEFINITIONS } from '../world/floraKinds';

export type TileMaterialBinding = { fn: string; variant: number };
export type TileMaterialOverrides = Record<string, TileMaterialBinding>;

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
  junction: { fn: 'road', variant: 0 },
  crosswalk: { fn: 'curb_crosswalk', variant: 0 },
  median: { fn: 'road', variant: 1 },
  parking: { fn: 'asphalt', variant: 1 },
  parkingCross: { fn: 'asphalt', variant: 1 },
  vehicleSpawn: { fn: 'asphalt', variant: 0 },
};
const FALLBACK_BINDING: TileMaterialBinding = { fn: 'concrete', variant: 0 };

export function tileBindingFor(kind: string, overrides: TileMaterialOverrides): TileMaterialBinding {
  return overrides[kind] ?? DEFAULT_BINDINGS[kind] ?? FALLBACK_BINDING;
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

/** Build the ground formula for the given kind→material overrides. */
export function editorGroundFormula(overrides: TileMaterialOverrides = {}): string {
  const bindings = TILE_KINDS.map((k) => {
    const b = tileBindingFor(k, overrides);
    const mat = MATERIAL_BY_FN.get(b.fn);
    if (!mat) {
      console.error(`[groundFormula] unknown material '${b.fn}' bound to tile kind '${k}' — using ${FALLBACK_BINDING.fn}`);
      return { mat: MATERIAL_BY_FN.get(FALLBACK_BINDING.fn)!, variant: FALLBACK_BINDING.variant, joint: true };
    }
    return { mat, variant: b.variant, joint: SLAB_JOINT_FNS.has(b.fn) };
  });
  const n = bindings.length;
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
  let floraBase = 5 + tilePal * 3;
  let zoneBase = floraBase + floraPal * 3;
  let cellBase = zoneBase + zonePal * 3;

  let cx = clamp(i32(floor(uv0.x * f32(cols))), 0, cols - 1);
  let cy = clamp(i32(floor(uv0.y * f32(rows))), 0, rows - 1);
  let packed = i32(D[cellBase + cy * cols + cx]);
  let kind = (packed % 1024) - 1;
  let flora = ((packed / 1024) % 256) - 1;
  let zone = (packed / 262144) - 1;

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
    rgb = fill_pick(hf_tile_mat(kind), hf_tile_board(kind), fc, fc * 64.0, hf_tile_var(kind), seed);
    // Slab joint at tile edges — concrete/sidewalk slabs carry it; seamless
    // surfaces (asphalt, earth, water) skip it so they read as one carriageway.
    if (hf_tile_joint(kind) > 0.5) {
      let je = min(min(fc.x, 1.0 - fc.x), min(fc.y, 1.0 - fc.y));
      let jaa = max(fwidth(je), 0.0008);
      rgb = mix(rgb, rgb * 0.5, (1.0 - smoothstep(0.012, 0.012 + jaa, je)) * 0.8);
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

/** The default-bindings formula (boot arm; rebinds regenerate via
 *  editorGroundFormula(overrides)). */
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
