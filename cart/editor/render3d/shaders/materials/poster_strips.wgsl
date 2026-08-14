// @material poster_strips
// @slug poster-strips
// @name Poster Strips
// @board wall_props
// @variant-labels Paper Fade, Marker Smear, Burned Cut
// @kind surface
// @tags wall_props, poster, prop, torn
// @author editor
fn poster_strips(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.90, 0.86, 0.80);
  var text = vec3f(0.22, 0.31, 0.44);
  var tear = vec3f(0.13, 0.11, 0.12);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.82, 0.78, 0.74);
    text = vec3f(0.18, 0.24, 0.20);
    tear = vec3f(0.10, 0.10, 0.12);
  } else if (variant >= 1.5) {
    base = vec3f(0.66, 0.58, 0.54);
    text = vec3f(0.80, 0.12, 0.12);
    tear = vec3f(0.25, 0.16, 0.10);
  }
  let stripe = fract(uv.y * 9.0 + seed * 0.2);
  let mask = 1.0 - smoothstep(0.40, 0.60, abs(sin(uv.x * 25.0 + seed) * 0.8 + 0.2 - stripe));
  var col = mix(base, text, mask * 0.22);
  col = col + vec3f(0.2, 0.24, 0.30) * (1.0 - mask) * 0.18;
  let edges = line_near(fract(uv.y * 12.0 + seed), 0.02);
  col = mix(col, tear, edges * 0.4);
  let fray = speckle(px, 1.9, seed + 7.0, 0.96);
  col = mix(col, vec3f(0.30, 0.24, 0.16), fray * 0.28);
  return sat3(col);
}

