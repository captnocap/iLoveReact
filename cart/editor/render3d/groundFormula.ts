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
// D[] layout (the engine's encodeGroundData contract): [0]cols [1]rows
// [2]paletteCount, paletteCount×3 palette rgb floats, rows×cols cell indices
// (−1 = empty). (WGSL: no unary +, no backticks in comments.)
import { hexToRgb01 } from '@reactjit/runtime/paint';
import { TILE_FILL_WGSL, tileFillMaterialId, tileFillVariant } from './tileFill';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';

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
  let pal = i32(D[2]);
  let cellBase = 3 + pal * 3;

  let cx = clamp(i32(floor(uv0.x * f32(cols))), 0, cols - 1);
  let cy = clamp(i32(floor(uv0.y * f32(rows))), 0, rows - 1);
  let kind = i32(D[cellBase + cy * cols + cx]);

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
  return rgb;
}
`;

/** The kind palette (rgb triples in TILE_KINDS order) — the D-stream palette
 *  section plus the dock's swatches share this one source. */
export const TILE_KIND_PALETTE: Float32Array = (() => {
  const out = new Float32Array(TILE_KINDS.length * 3);
  TILE_KINDS.forEach((k, i) => {
    const [r, g, b] = hexToRgb01(tileKindDefinition(k).render.color);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  });
  return out;
})();
