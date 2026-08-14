// @material curb_crosswalk
// @slug curb-crosswalk
// @name Curb + Crosswalk
// @board street_ground
// @variant-labels Fresh Paint, Worn Paint, ADA Ramp
// @kind surface
// @tags street_ground, curb, crosswalk
// @author legacy
fn curb_crosswalk(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = asphalt(uv, px, 1.0, seed);
  let curb = rect_mask(uv, 0.0, 1.0, 0.72, 1.0, 0.005);
  col = mix(col, sidewalk_grid(uv * vec2f(1.0, 1.8), px, 0.0, seed), curb);
  let ramp = rect_mask(uv, 0.34, 0.66, 0.68, 1.0, 0.015);
  if (variant >= 1.5) { col = mix(col, vec3f(0.62, 0.58, 0.50), ramp); }
  let stripe_base = step(0.18, uv.y) * step(uv.y, 0.68);
  let stripe = (1.0 - smoothstep(0.020, 0.050, abs(fract(uv.x * 6.0) - 0.5))) * stripe_base;
  let wear = fbm(uv.x * 10.0 + seed, uv.y * 10.0, 4.0) * 0.5 + 0.5;
  let paint = stripe * mix(0.84, 0.44, step(0.5, variant)) * smoothstep(0.20, 0.75, wear);
  col = mix(col, vec3f(0.92, 0.90, 0.82), paint);
  let tactile = speckle(px, 5.0, seed, 0.78) * ramp * step(1.5, variant);
  col = mix(col, vec3f(0.80, 0.66, 0.18), tactile * 0.70);
  return sat3(col);
}
