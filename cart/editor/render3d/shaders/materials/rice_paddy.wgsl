// @material rice_paddy
// @slug rice-paddy
// @name Rice Paddy
// @board environment
// @variant-labels Young Sprouts, Lush Mid Season, Golden Harvest
// @kind composition
// @tags environment, rice, farm
// @author fable-botanic
fn rice_paddy(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var sky_hi = vec3f(0.62, 0.70, 0.72);
  var sky_lo = vec3f(0.28, 0.38, 0.42);
  var sprout_lo = vec3f(0.16, 0.40, 0.14);
  var sprout_hi = vec3f(0.38, 0.64, 0.22);
  var rowwidth = 0.16;
  var waterkeep = 1.0;
  if (variant > 0.5 && variant < 1.5) {
    sprout_lo = vec3f(0.10, 0.32, 0.10);
    sprout_hi = vec3f(0.26, 0.55, 0.16);
    rowwidth = 0.34;
    waterkeep = 0.6;
  } else if (variant >= 1.5) {
    sky_hi = vec3f(0.76, 0.66, 0.52);
    sky_lo = vec3f(0.40, 0.34, 0.28);
    sprout_lo = vec3f(0.52, 0.44, 0.16);
    sprout_hi = vec3f(0.80, 0.68, 0.28);
    rowwidth = 0.38;
    waterkeep = 0.35;
  }
  let ripple = snoise(uv.x * 12.0 + U.time * 0.2 + seed, uv.y * 12.0) * 0.5 + 0.5;
  var water = mix(sky_lo, sky_hi, uv.y * 0.7 + ripple * 0.3);
  let reflec = line_near(sin(uv.y * 90.0 + snoise(uv.x * 6.0 + seed, uv.y * 3.0) * 3.0), 0.20);
  water = water * (0.9 + reflec * 0.25) * waterkeep + water * (1.0 - waterkeep) * 0.6;
  let rowp = fract(uv.y * 10.0 + seed * 0.21 + snoise(uv.x * 1.5 + seed, uv.y) * 0.03);
  let plantband = smoothstep(0.5 - rowwidth, 0.5 - rowwidth * 0.4, rowp) * smoothstep(0.5 + rowwidth, 0.5 + rowwidth * 0.4, rowp);
  let tuft = line_near(sin(uv.x * 130.0 + floor(uv.y * 10.0) * 7.0 + seed), 0.30);
  let tufttone = fbm(uv.x * 14.0 + seed, uv.y * 14.0, 3.0) * 0.5 + 0.5;
  let plantcol = mix(sprout_lo, sprout_hi, tufttone) * (0.7 + tuft * 0.5);
  var col = mix(water, plantcol, plantband);
  let mudedge = smoothstep(0.10, 0.02, abs(rowp - 0.5) - rowwidth * 0.55);
  col = mix(col, vec3f(0.24, 0.18, 0.12), mudedge * (1.0 - plantband) * 0.5);
  let fleck = speckle(px, 2.0, seed + 6.0, 0.97);
  col = col + vec3f(0.10, 0.10, 0.08) * fleck;
  return sat3(col);
}
