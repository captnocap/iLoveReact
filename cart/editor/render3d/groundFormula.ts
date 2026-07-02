// groundFormula.ts — the editor's painted-ground FORMULA (MAPPAINT req_2473).
//
// The tile channel renders through the host's per-fragment ground pipeline
// (framework/gpu/3d.zig): the cart pushes ONE WGSL body defining
// `fn hf_ground_rgb(uv) -> vec3f` via __map_set_ground_look, and the host map
// engine encodes each painted chunk's cell grid as the D reference stream the
// body reads. Descended from cart/hmsc-int/render3d/heightfieldSurface.tsx
// (HEIGHTFIELD_TILE_BODY) with this cart's own TILE_KINDS order baked in —
// the road-grammar extras (median centerline, parking stalls, marker resolve)
// join with the road channel.
//
// D[] layout v2 (the engine's encodeGroundData contract): [0]cols [1]rows
// [2]tilePal [3]floraPal [4]zonePal, then tilePal×3 + floraPal×3 + zonePal×3
// palette rgb floats, then rows×cols PACKED cells. Packed cell (24 bits, exact
// in f32): (tile+1) + (flora+1)·1024 + (zone+1)·262144; 0 = empty slot. Flora
// and zones tint OVER the ground material — the authoring overlay view; the
// real populations materialize at Compile. (WGSL: no unary +, no backticks in
// comments.)
import { hexToRgb01 } from '@reactjit/runtime/paint';
import { TILE_FILL_WGSL, tileFillMaterialId, tileFillVariant } from './tileFill';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import { FLORA_KIND_DEFINITIONS } from '../world/floraKinds';

// Per-kind (materialId, variant) into tileMaterial, baked into the shader from
// TILE_KINDS order — the SAME order the engine ships cell indices in.
const MAT_IDS = TILE_KINDS.map((k) => tileFillMaterialId(k));
const VARIANTS = TILE_KINDS.map((k) => tileFillVariant(k));

export const EDITOR_GROUND_FORMULA = `
${TILE_FILL_WGSL}
fn hf_tile_mat(k: i32) -> f32 {
  var m = array<f32, ${MAT_IDS.length}>(${MAT_IDS.map((x) => x.toFixed(1)).join(', ')});
  if (k < 0) { return 0.0; }
  return m[clamp(k, 0, ${MAT_IDS.length - 1})];
}
fn hf_tile_var(k: i32) -> f32 {
  var v = array<f32, ${VARIANTS.length}>(${VARIANTS.map((x) => x.toFixed(1)).join(', ')});
  if (k < 0) { return 0.0; }
  return v[clamp(k, 0, ${VARIANTS.length - 1})];
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
  let seed = tf_rand(floor(p) + vec2f(3.1, 7.7)) * 50.0;

  var rgb = vec3f(0.0);
  if (kind < 0) {
    // unpainted: the editor's dark grid ground
    let gf0 = abs(fc - vec2f(0.5));
    let edge0 = max(gf0.x, gf0.y);
    let g = smoothstep(0.46, 0.5, edge0) * 0.07;
    rgb = vec3f(0.05 + g, 0.07 + g, 0.10 + g);
  } else {
    rgb = tileMaterial(hf_tile_mat(kind), fc, fc * 64.0, hf_tile_var(kind), seed);
    // Slab joint at tile edges — concrete/sidewalk slabs carry it; ROAD-material
    // cells skip it so asphalt reads as one seamless carriageway across tiles.
    if (hf_tile_mat(kind) < 0.5) {
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
