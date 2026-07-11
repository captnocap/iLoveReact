// Editor-owned shader assembly: helpers + materials + generated dispatch + the
// standard tile-local fs_main. Replaces the old fillShader.ts single file;
// same D[] contract, same exports (FILL_FUNCS / FILL_SHADER), so downstream
// consumers (game/textures/shaders.ts, editors/model/MaterialFill.tsx) only
// need their import path updated.
//
// D[] = [materialId, variant, seed, quality, board] — see boards.ts for board
// slugs/ids and _generated/registry.ts for the material catalog. To add or
// remove a material, only materials/*.wgsl changes; then run:
//   tools/v8cli cart/editor/render3d/shaders/build-shaders.ts
import { FILL_FUNCS } from './_generated/dispatch';

// the standard tile-local entry: pick the material at in.uv, then vignette/quality.
const FILL_MAIN_SRC = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let material = i32(D[0] + 0.5);
  let variant = D[1];
  let seed = D[2];
  let quality = D[3];
  let board = D[4];
  var uv = in.uv;
  if (quality < 0.5) {
    uv = (floor(in.uv * 32.0) + vec2f(0.5, 0.5)) / 32.0;
  } else if (quality < 1.5) {
    uv = (floor(in.uv * 64.0) + vec2f(0.5, 0.5)) / 64.0;
  }
  let px = uv * vec2f(U.size_w, U.size_h);
  var col = fill_pick(material, board, uv, px, variant, seed);
  let vignette = 1.0 - smoothstep(0.20, 0.88, length(uv - vec2f(0.5, 0.5)));
  col = quality_pass(col, uv, px, seed, quality, board);
  col = col * (0.82 + vignette * 0.20);
  return vec4f(sat3(col), 1.0);
}
`;

/** The material function library (no entry point) — for callers that supply their
 *  own fs_main (the world-scaled atlas painter). Reuses the exact catalog materials. */
export { FILL_FUNCS };
/** The canonical tile-local fill shader (funcs + standard fs_main). */
export const FILL_SHADER = FILL_FUNCS + FILL_MAIN_SRC;
