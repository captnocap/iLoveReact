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

// Negative material ids are not valid catalog ids, so -1 is the batch envelope
// marker. Keeping the layout here makes the one-tile and many-tile paths use the
// exact same WGSL source and therefore the same compiled GPU pipeline.
export const FILL_GRID_DATA = Object.freeze({
  marker: -1,
  markerIndex: 0,
  cellCountIndex: 1,
  columnsIndex: 2,
  cellSizeIndex: 3,
  gapIndex: 4,
  thumbnailSizeIndex: 5,
  thumbnailInsetIndex: 6,
  cornerRadiusIndex: 7,
  offsetStartIndex: 8,
  headerFloats: 8,
} as const);

// The canonical entry handles both an ordinary tile row and a packed grid
// envelope. The branch is uniform for the whole Effect. Normal material views
// pay one comparison; Paint's browser avoids compiling a second 409-material
// shader and routes all standard thumbnails through one Effect instance.
const FILL_MAIN_SRC = `
fn fill_render(data_base: u32, input_uv: vec2f, pixel_size: vec2f) -> vec4f {
  mat_data_base = data_base;
  let material = i32(D[data_base] + 0.5);
  let variant = D[data_base + 1u];
  let seed = D[data_base + 2u];
  let quality = D[data_base + 3u];
  let board = D[data_base + 4u];
  var uv = input_uv;
  if (quality < 0.5) {
    uv = (floor(input_uv * 32.0) + vec2f(0.5, 0.5)) / 32.0;
  } else if (quality < 1.5) {
    uv = (floor(input_uv * 64.0) + vec2f(0.5, 0.5)) / 64.0;
  }
  let px = uv * pixel_size;
  var col = fill_pick(material, board, uv, px, variant, seed);
  let vignette = 1.0 - smoothstep(0.20, 0.88, length(uv - vec2f(0.5, 0.5)));
  col = quality_pass(col, uv, px, seed, quality, board);
  col = col * (0.82 + vignette * 0.20);
  return vec4f(sat3(col), 1.0);
}

fn fill_grid_rounded_alpha(p: vec2f, size: f32, radius: f32) -> f32 {
  let half_size = vec2f(size * 0.5);
  let q = abs(p - half_size) - (half_size - vec2f(radius));
  let distance = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
  let aa = max(fwidth(distance), 0.5);
  return 1.0 - smoothstep(-aa, aa, distance);
}

fn fill_grid(in: VsOut) -> vec4f {
  let columns = max(D[${FILL_GRID_DATA.columnsIndex}], 1.0);
  let cell_size = max(D[${FILL_GRID_DATA.cellSizeIndex}], 1.0);
  let gap = max(D[${FILL_GRID_DATA.gapIndex}], 0.0);
  let stride = cell_size + gap;
  let thumb_size = clamp(D[${FILL_GRID_DATA.thumbnailSizeIndex}], 1.0, cell_size);
  let thumb_inset = max(D[${FILL_GRID_DATA.thumbnailInsetIndex}], 0.0);
  let corner_radius = clamp(D[${FILL_GRID_DATA.cornerRadiusIndex}], 0.0, thumb_size * 0.5);
  let surface_px = in.uv * vec2f(U.size_w, U.size_h);
  let column = floor(surface_px.x / stride);
  let row = floor(surface_px.y / stride);
  let local = surface_px - vec2f(column, row) * stride;
  if (column < 0.0 || column >= columns || row < 0.0
      || local.x >= cell_size || local.y >= cell_size) {
    return vec4f(0.0);
  }

  let cell_index = u32(row * columns + column);
  let cell_count = u32(max(D[${FILL_GRID_DATA.cellCountIndex}], 0.0));
  if (cell_index >= cell_count) { return vec4f(0.0); }
  let row_offset = i32(D[${FILL_GRID_DATA.offsetStartIndex}u + cell_index]);
  if (row_offset < 0) { return vec4f(0.0); }

  let thumb_px = local - vec2f(thumb_inset);
  if (thumb_px.x < 0.0 || thumb_px.y < 0.0
      || thumb_px.x >= thumb_size || thumb_px.y >= thumb_size) {
    return vec4f(0.0);
  }

  let tile = fill_render(u32(row_offset), thumb_px / thumb_size, vec2f(thumb_size));
  let alpha = fill_grid_rounded_alpha(thumb_px, thumb_size, corner_radius);
  return vec4f(tile.rgb * alpha, alpha);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  if (D[${FILL_GRID_DATA.markerIndex}] == ${FILL_GRID_DATA.marker.toFixed(1)}) {
    return fill_grid(in);
  }
  return fill_render(0u, in.uv, vec2f(U.size_w, U.size_h));
}
`;

/** The material function library (no entry point) — for callers that supply their
 *  own fs_main (the world-scaled atlas painter). Reuses the exact catalog materials. */
export { FILL_FUNCS };
/** The canonical tile-local fill shader (funcs + standard fs_main). */
export const FILL_SHADER = FILL_FUNCS + FILL_MAIN_SRC;
