// @material greek_key_border
// @slug greek-key-border
// @name Greek Key Border
// @board wood_brick_stone
// @variant-labels Black On Ochre, Terracotta White, Gold On Aegean
// @kind surface
// @tags wood_brick_stone, meander, greek, border
// @author fable-mosaic_tile
fn greek_key_border(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var ground = vec3f(0.80, 0.62, 0.28);
  var stroke = vec3f(0.13, 0.11, 0.10);
  var trim = vec3f(0.55, 0.24, 0.16);
  if (variant > 0.5 && variant < 1.5) {
    ground = vec3f(0.62, 0.30, 0.20);
    stroke = vec3f(0.92, 0.89, 0.82);
    trim = vec3f(0.20, 0.16, 0.14);
  } else if (variant >= 1.5) {
    ground = vec3f(0.12, 0.24, 0.40);
    stroke = vec3f(0.85, 0.68, 0.28);
    trim = vec3f(0.75, 0.74, 0.70);
  }
  let bands = 3.0;
  let band = floor(uv.y * bands);
  let by = fract(uv.y * bands);
  let shift = rand(vec2f(band, seed * 0.23)) * 4.0;
  let mxRaw = uv.x * 6.0 + shift;
  let mcell = floor(mxRaw);
  let m = vec2f(fract(mxRaw), (by - 0.22) / 0.56);
  // meander spiral strokes in the unit cell
  var key = segment_mark(m, vec2f(0.0, 0.12), vec2f(1.0, 0.12), 0.055);
  key = max(key, segment_mark(m, vec2f(0.14, 0.12), vec2f(0.14, 0.86), 0.055));
  key = max(key, segment_mark(m, vec2f(0.14, 0.86), vec2f(0.76, 0.86), 0.055));
  key = max(key, segment_mark(m, vec2f(0.76, 0.86), vec2f(0.76, 0.42), 0.055));
  key = max(key, segment_mark(m, vec2f(0.76, 0.42), vec2f(0.44, 0.42), 0.055));
  key = max(key, segment_mark(m, vec2f(0.44, 0.42), vec2f(0.44, 0.62), 0.055));
  let inField = step(0.22, by) * (1.0 - step(0.78, by));
  // rail stripes between bands
  let rail = (1.0 - smoothstep(0.010, 0.030, abs(by - 0.10))) + (1.0 - smoothstep(0.010, 0.030, abs(by - 0.90)));
  let toneShift = rand(vec2f(mcell, band + seed)) * 0.18;
  var col = ground * (0.90 + toneShift);
  col = mix(col, stroke, key * inField);
  col = mix(col, trim, sat(rail));
  // fresco-style wear
  let wear = fbm(uv.x * 6.0 + seed * 0.4, uv.y * 6.0, 3.0) * 0.5 + 0.5;
  col = mix(col, ground * 0.9, smoothstep(0.6, 0.95, wear) * 0.35);
  col = col - vec3f(crack_field(uv, seed, 7.0) * 0.12 + speckle(px, 1.8, seed, 0.94) * 0.08);
  return sat3(col);
}
