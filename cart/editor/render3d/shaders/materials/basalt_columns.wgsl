// @material basalt_columns
// @slug basalt-columns
// @name Basalt Columns
// @board wood_brick_stone
// @variant-labels Fresh Causeway, Lichen Worn, Tide Wet
// @kind surface
// @tags wood_brick_stone, basalt, volcanic, columns
// @author fable-geology
fn basalt_columns(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var face = vec3f(0.24, 0.24, 0.27);
  var joint = vec3f(0.05, 0.05, 0.06);
  var top_lite = vec3f(0.38, 0.38, 0.42);
  if (variant > 0.5 && variant < 1.5) {
    face = vec3f(0.32, 0.32, 0.30);
    joint = vec3f(0.08, 0.08, 0.07);
    top_lite = vec3f(0.52, 0.53, 0.44);
  } else if (variant >= 1.5) {
    face = vec3f(0.14, 0.15, 0.18);
    joint = vec3f(0.03, 0.03, 0.05);
    top_lite = vec3f(0.30, 0.33, 0.40);
  }
  let g = uv * 4.5 + vec2f(seed * 0.29, seed * 0.17);
  let d1 = fract(g) - vec2f(0.5, 0.5);
  let d2 = fract(g + vec2f(0.5, 0.5)) - vec2f(0.5, 0.5);
  let h1 = max(abs(d1.x) * 0.866 + abs(d1.y) * 0.5, abs(d1.y));
  let h2 = max(abs(d2.x) * 0.866 + abs(d2.y) * 0.5, abs(d2.y));
  var hd = h1;
  var cid = rand(floor(g) + vec2f(3.1, seed * 0.01));
  if (h2 < h1) { hd = h2; cid = rand(floor(g + vec2f(0.5, 0.5)) + vec2f(7.7, seed * 0.01)); }
  var col = mix(face * (0.8 + cid * 0.5), top_lite, step(0.82, cid) * 0.5);
  col = mix(col, joint, smoothstep(0.34, 0.44, hd));
  let ring = smoothstep(0.02, 0.005, abs(hd - 0.16 - cid * 0.08)) * step(0.5, fract(cid * 5.3));
  col = mix(col, joint, ring * 0.55);
  let grain = fbm(uv.x * 20.0 + seed, uv.y * 20.0, 3.0);
  col = col * (0.9 + grain * 0.32);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(col, vec3f(0.55, 0.58, 0.34), sat(blotch(uv, vec2f(0.4, 0.5), 0.2, vec2f(1.3, 0.8), seed + 4.0)) * step(0.55, cid) * 0.5);
  }
  if (variant >= 1.5) {
    let sheen = pow(sat(1.0 - abs(uv.x + uv.y - 1.0) * 1.8), 3.0);
    col = col + vec3f(0.10, 0.12, 0.15) * sheen;
  }
  col = mix(col, top_lite, speckle(px, 3.0, seed + 8.0, 0.975) * 0.4);
  return sat3(col);
}
