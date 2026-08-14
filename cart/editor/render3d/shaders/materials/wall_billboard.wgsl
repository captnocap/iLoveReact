// @material wall_billboard
// @slug wall-billboard
// @name Billboard
// @board wall_props
// @variant-labels Poster, Faded, Torn
// @kind gradient
// @tags wall_props, billboard
// @author legacy
fn wall_billboard(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Big framed billboard bolted to the brick, lit by a top light bar. variant 0
  // fresh poster, 1 sun-faded, 2 torn (peeling to brick).
  let brick_lo = vec3f(0.40, 0.13, 0.085);
  let brick_hi = vec3f(0.70, 0.28, 0.16);
  let brick_m = vec3f(0.52, 0.50, 0.46);
  var col = brick_wall(uv, px, brick_lo, brick_hi, brick_m, seed);
  let frame = rect_mask(uv, 0.06, 0.94, 0.16, 0.88, 0.006);
  let panel = rect_mask(uv, 0.08, 0.92, 0.18, 0.86, 0.006);
  col = mix(col, vec3f(0.12, 0.12, 0.13), frame);
  // Poster: a bold geometric ad — diagonal split, a sun disc, a headline band.
  let u = uv - vec2f(0.5, 0.52);
  var poster = mix(vec3f(0.95, 0.30, 0.20), vec3f(0.15, 0.20, 0.55), smoothstep(-0.3, 0.3, u.x + u.y));
  let disc = 1.0 - smoothstep(0.12, 0.16, length(u * vec2f(1.2, 1.0)));
  poster = mix(poster, vec3f(0.98, 0.85, 0.20), disc);
  let head = rect_mask(uv, 0.14, 0.86, 0.30, 0.40, 0.006);
  poster = mix(poster, vec3f(0.05, 0.05, 0.07), head);
  let headtext = rect_mask(uv, 0.18, 0.82, 0.33, 0.37, 0.004) * step(0.5, fract(uv.x * 26.0));
  poster = mix(poster, vec3f(0.95, 0.92, 0.85), headtext);
  if (variant > 0.5 && variant < 1.5) {
    let l = dot(poster, vec3f(0.333, 0.333, 0.333));
    poster = mix(poster, vec3f(l * 1.1 + 0.10), 0.55);
  }
  col = mix(col, poster, panel);
  if (variant >= 1.5) {
    let tear = smoothstep(0.46, 0.60, fbm(uv.x * 4.0 + seed, uv.y * 4.0, 4.0) * 0.5 + 0.5) * panel * step(0.55, uv.x);
    col = mix(col, brick_wall(uv, px, brick_lo, brick_hi, brick_m, seed), tear);
  }
  // Top flood-light bar.
  let lights = (1.0 - smoothstep(0.0, 0.010, abs(uv.y - 0.90))) * step(0.12, uv.x) * step(uv.x, 0.88) * step(0.5, fract(uv.x * 12.0));
  col = col + vec3f(0.70, 0.65, 0.50) * lights;
  // Support struts below.
  let strut = max(1.0 - smoothstep(0.0, 0.012, abs(uv.x - 0.30)), 1.0 - smoothstep(0.0, 0.012, abs(uv.x - 0.70))) * (1.0 - step(0.16, uv.y));
  col = mix(col, vec3f(0.14, 0.14, 0.15), strut);
  return sat3(col);
}
