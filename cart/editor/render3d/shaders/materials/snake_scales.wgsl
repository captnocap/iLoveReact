// @material snake_scales
// @slug snake-scales
// @name Snake Scales
// @board props
// @variant-labels Grass Viper, Desert Rattler, Blood Banded
// @kind surface
// @tags props, scales, reptile
// @author fable-creature_skins
fn snake_scales(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var scalec = vec3f(0.28, 0.48, 0.20);
  var gapc = vec3f(0.08, 0.13, 0.05);
  var keelc = vec3f(0.72, 0.84, 0.50);
  if (variant > 0.5 && variant < 1.5) {
    scalec = vec3f(0.72, 0.56, 0.32);
    gapc = vec3f(0.30, 0.21, 0.11);
    keelc = vec3f(0.90, 0.80, 0.58);
  } else if (variant >= 1.5) {
    scalec = vec3f(0.55, 0.12, 0.10);
    gapc = vec3f(0.10, 0.04, 0.05);
    keelc = vec3f(0.86, 0.42, 0.28);
  }
  let p = vec2f(uv.x * 11.0 + seed * 0.19, uv.y * 15.0 - seed * 0.11);
  let row = floor(p.y);
  let xo = fract(row * 0.5);
  let cellx = floor(p.x + xo);
  let fx = fract(p.x + xo);
  let fy = fract(p.y);
  let dist1 = length(vec2f((fx - 0.5) * 1.25, (fy - 0.02) * 0.85));
  let inside = 1.0 - smoothstep(0.46, 0.55, dist1);
  let tone = rand(vec2f(cellx * 1.3, row * 2.1) + seed);
  let bandv = step(0.5, fract(row * 0.20 + seed * 0.01)) * smoothstep(1.5, 1.6, variant);
  var sc = scalec * (0.78 + tone * 0.40);
  sc = mix(sc, gapc * 1.6, bandv * 0.8);
  var col = mix(gapc, sc, inside);
  let keel = line_near(fx - 0.5, 0.05) * inside * smoothstep(0.85, 0.35, fy);
  col = mix(col, keelc, keel * 0.7);
  col = col - vec3f(0.09, 0.09, 0.06) * smoothstep(0.55, 0.95, fy) * inside;
  col = col * (0.92 + (fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.5 + 0.5) * 0.16);
  return sat3(col);
}
