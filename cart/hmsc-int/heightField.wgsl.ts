// heightField.wgsl.ts — the ONE shader that renders the whole heightfield.
//
// Per fragment it bilinearly samples the height buffer (a GPU storage buffer fed
// by <Effect data>) and maps Z to a colour: cool below 0, neutral at 0, warm
// above — plus faint tile grid lines. This scales per-pixel: 17x17 demo or
// 241x241 full chunk is the same shader, just a bigger buffer. No geometry, no
// nodes. (WGSL gotchas honored: no unary +, no backticks in comments.)
//
// D[] layout (see encodeField): [0]cols [1]rows [2]visRef [3]tilesX [4]tilesY,
// then rows*cols heights row-major.

export const HEIGHT_FIELD_WGSL = `
@group(0) @binding(1) var<storage, read> D: array<f32>;

fn hAt(ix: i32, iy: i32, cols: i32, rows: i32) -> f32 {
  let cx = clamp(ix, 0, cols - 1);
  let cy = clamp(iy, 0, rows - 1);
  return D[5 + cy * cols + cx];
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let cols = i32(D[0]);
  let rows = i32(D[1]);
  let visRef = max(D[2], 0.01);
  let tilesX = D[3];
  let tilesY = D[4];

  // uv 0..1 over the quad → sample position in the corner grid.
  let fp = in.uv * vec2f(f32(cols - 1), f32(rows - 1));
  let ix = i32(floor(fp.x));
  let iy = i32(floor(fp.y));
  let fr = fract(fp);
  let h00 = hAt(ix, iy, cols, rows);
  let h10 = hAt(ix + 1, iy, cols, rows);
  let h01 = hAt(ix, iy + 1, cols, rows);
  let h11 = hAt(ix + 1, iy + 1, cols, rows);
  let hz = mix(mix(h00, h10, fr.x), mix(h01, h11, fr.x), fr.y);

  let neutral = vec3f(0.10, 0.13, 0.19);
  let warm = vec3f(0.98, 0.75, 0.15);
  let cool = vec3f(0.22, 0.62, 0.95);
  let t = clamp(abs(hz) / visRef, 0.0, 1.0);
  var col = neutral;
  if (hz > 0.0) { col = mix(neutral, warm, t); }
  if (hz < 0.0) { col = mix(neutral, cool, t); }

  // Faint 1m tile grid.
  let tile = in.uv * vec2f(tilesX, tilesY);
  let gf = abs(fract(tile) - vec2f(0.5));
  let edge = max(gf.x, gf.y);
  col = mix(col, col + vec3f(0.05), smoothstep(0.46, 0.5, edge) * 0.6);

  return vec4f(col, 1.0);
}
`;
