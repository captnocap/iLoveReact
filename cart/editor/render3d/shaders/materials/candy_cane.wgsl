// @material candy_cane
// @slug candy-cane
// @name Candy Cane
// @board props
// @variant-labels Classic Red, Winter Mint, Triple Twist
// @kind surface
// @tags props, candy, stripes, sweet
// @author fable-food
fn candy_cane(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let wob = fbm(uv.x * 4.0 + seed, uv.y * 4.0, 3.0) * 0.06;
  let diag = uv.x + uv.y + wob + seed * 0.01;
  var stripes = 6.0;
  var inkA = vec3f(0.86, 0.10, 0.14);
  var inkB = vec3f(0.97, 0.95, 0.93);
  var thin = vec3f(0.86, 0.10, 0.14);
  if (variant > 0.5 && variant < 1.5) {
    inkA = vec3f(0.10, 0.55, 0.32);
    inkB = vec3f(0.96, 0.98, 0.96);
    thin = vec3f(0.82, 0.14, 0.18);
    stripes = 7.0;
  } else if (variant >= 1.5) {
    inkA = vec3f(0.88, 0.16, 0.30);
    inkB = vec3f(0.98, 0.93, 0.88);
    thin = vec3f(0.98, 0.62, 0.12);
    stripes = 9.0;
  }
  let band = fract(diag * stripes * 0.5);
  var col = inkB;
  let wide = smoothstep(0.02, 0.06, band) * (1.0 - smoothstep(0.42, 0.46, band));
  col = mix(col, inkA, wide);
  let pin = smoothstep(0.60, 0.63, band) * (1.0 - smoothstep(0.70, 0.73, band));
  col = mix(col, thin, pin);
  let curve = sin(band * 6.28318) * 0.5 + 0.5;
  col = col * (0.86 + curve * 0.22);
  let gloss = smoothstep(0.75, 0.98, sin((diag * stripes + 0.6) * 3.14159) * 0.5 + 0.5);
  col = mix(col, vec3f(1.0, 0.99, 0.97), gloss * 0.35);
  let sugar = speckle(px, 2.0, seed + 3.0, 0.972);
  col = mix(col, vec3f(0.99, 0.98, 0.97), sugar * 0.4);
  return sat3(col);
}
