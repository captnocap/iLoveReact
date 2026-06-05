// heightTileView.wgsl.ts — height authoring view over the painted tile ground.
//
// The height layer must not replace the tile board: sculpting needs tile context.
// This shader reads the tile section first, then the height section, and tints the
// tile colour by elevation while keeping the ground readable.

export const HEIGHT_TILE_VIEW_WGSL = `
@group(0) @binding(1) var<storage, read> D: array<f32>;

fn hAt(base: i32, ix: i32, iy: i32, cols: i32, rows: i32) -> f32 {
  let cx = clamp(ix, 0, cols - 1);
  let cy = clamp(iy, 0, rows - 1);
  return D[base + 5 + cy * cols + cx];
}

fn warmRamp(t: f32) -> vec3f {
  let c0 = vec3f(0.98, 0.78, 0.24);
  let c1 = vec3f(0.98, 0.45, 0.18);
  let c2 = vec3f(1.00, 0.92, 0.78);
  let s = clamp(t, 0.0, 1.0) * 2.0;
  if (s < 1.0) { return mix(c0, c1, s); }
  return mix(c1, c2, s - 1.0);
}

fn coolRamp(t: f32) -> vec3f {
  let c0 = vec3f(0.20, 0.75, 0.88);
  let c1 = vec3f(0.18, 0.36, 0.88);
  let c2 = vec3f(0.08, 0.12, 0.42);
  let s = clamp(t, 0.0, 1.0) * 2.0;
  if (s < 1.0) { return mix(c0, c1, s); }
  return mix(c1, c2, s - 1.0);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let cols = i32(D[0]);
  let rows = i32(D[1]);
  let tpal = i32(D[2]);
  let tCellBase = 3 + tpal * 3;
  let hBase = tCellBase + cols * rows;

  let cx = clamp(i32(floor(in.uv.x * f32(cols))), 0, cols - 1);
  let cy = clamp(i32(floor(in.uv.y * f32(rows))), 0, rows - 1);
  let cell = cy * cols + cx;

  let gf = abs(fract(in.uv * vec2f(f32(cols), f32(rows))) - vec2f(0.5));
  let edge = max(gf.x, gf.y);

  let tkind = i32(D[tCellBase + cell]);
  var col = vec3f(0.05, 0.07, 0.10);
  if (tkind >= 0) {
    let pb = 3 + tkind * 3;
    col = vec3f(D[pb], D[pb + 1], D[pb + 2]);
  }
  col = col * mix(1.0, 0.84, smoothstep(0.44, 0.5, edge));

  let hcols = i32(D[hBase]);
  let hrows = i32(D[hBase + 1]);
  let visRef = max(D[hBase + 2], 0.01);
  let fp = in.uv * vec2f(f32(hcols - 1), f32(hrows - 1));
  let ix = i32(floor(fp.x));
  let iy = i32(floor(fp.y));
  let fr = fract(fp);
  let h00 = hAt(hBase, ix, iy, hcols, hrows);
  let h10 = hAt(hBase, ix + 1, iy, hcols, hrows);
  let h01 = hAt(hBase, ix, iy + 1, hcols, hrows);
  let h11 = hAt(hBase, ix + 1, iy + 1, hcols, hrows);
  let hz = mix(mix(h00, h10, fr.x), mix(h01, h11, fr.x), fr.y);
  let ht = clamp(abs(hz) / visRef, 0.0, 1.0);

  if (abs(hz) > 0.025) {
    let tint = select(coolRamp(ht), warmRamp(ht), hz > 0.0);
    col = mix(col, tint, 0.34 + 0.30 * smoothstep(0.0, 0.28, ht));

    let af = fract(abs(hz));
    let near = min(af, 1.0 - af);
    let contour = 1.0 - smoothstep(0.0, 0.055, near);
    col = mix(col, vec3f(0.02, 0.03, 0.05), contour * 0.45);
  }

  return vec4f(col, 1.0);
}
`;
