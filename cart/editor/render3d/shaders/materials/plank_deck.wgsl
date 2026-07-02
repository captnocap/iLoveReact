// @material plank_deck
// @slug plank-deck
// @name Plank Deck
// @board second_pass
// @variant-labels Fresh Cedar, Weathered Grey, Water-Stained
// @kind surface
// @tags second_pass, plank, deck
// @author legacy
fn plank_deck(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Weathered deck boards with end-checking cracks, nail pops, water stain.
  let row = floor(uv.y * 5.0);
  let row_warp = (rand(vec2f(row, seed)) - 0.5) * 0.006;
  let local_y = fract(uv.y * 5.0 + row_warp);
  let gap = 1.0 - smoothstep(0.012, 0.032, min(local_y, 1.0 - local_y));

  let grain = sin((uv.x + fbm(uv.x * 4.0, uv.y * 1.0 + seed, 3.0) * 0.03) * 65.0 + row) * 0.5 + 0.5;
  let knot = 1.0 - smoothstep(0.04, 0.07, length((uv - vec2f(0.35 + rand(vec2f(row, seed + 1.0)) * 0.3, (row + 0.5) / 5.0)) * vec2f(1.0, 4.0)));

  var lo = vec3f(0.58, 0.38, 0.18);
  var hi = vec3f(0.86, 0.62, 0.32);
  if (variant > 0.5 && variant < 1.5) {
    lo = vec3f(0.42, 0.42, 0.40);
    hi = vec3f(0.68, 0.68, 0.64);
  } else if (variant >= 1.5) {
    lo = vec3f(0.32, 0.26, 0.18);
    hi = vec3f(0.52, 0.44, 0.30);
  }
  var col = mix(lo, hi, grain * 0.6 + 0.25);
  col = mix(col, vec3f(0.48, 0.30, 0.14), knot * 0.42);

  let end_crack = line_near(uv.x - 0.5, 0.006) * (smoothstep(0.0, 0.12, local_y) + smoothstep(1.0, 0.88, local_y));
  col = mix(col, vec3f(0.22, 0.16, 0.10), end_crack * 0.52);

  let nail_x = step(0.5, fract(uv.x * 6.0 + row * 0.3));
  let nail_y = step(0.35, local_y) * step(local_y, 0.65);
  let nail = nail_x * nail_y * speckle(px, 2.2, seed, 0.88);
  col = col + vec3f(0.12, 0.10, 0.06) * nail;

  let water = smoothstep(0.55, 0.92, uv.y) * smoothstep(0.45, 0.75, fbm(uv.x * 3.0 + row, uv.y * 2.0 + seed, 3.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.24, 0.18, 0.10), water * 0.32);

  col = mix(col, vec3f(0.08, 0.07, 0.06), gap * 0.88);
  return sat3(col);
}
