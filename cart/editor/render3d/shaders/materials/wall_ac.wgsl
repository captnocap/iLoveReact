// @material wall_ac
// @slug wall-ac
// @name AC & Vents
// @board wall_props
// @variant-labels Window AC, Vent Grille, Conduit
// @kind surface
// @tags wall_props, ac, vents
// @author legacy
fn wall_ac(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Apartment-wall mechanicals: window AC units, an exhaust vent, or a conduit +
  // meter run. variant 0 window AC, 1 vent grille, 2 conduit & meter.
  var col = brick_facade(uv, px, 0.0, seed);
  if (variant < 0.5) {
    let ac = max(rect_mask(uv, 0.36, 0.64, 0.22, 0.34, 0.006), rect_mask(uv, 0.36, 0.64, 0.72, 0.84, 0.006));
    col = mix(col, vec3f(0.78, 0.78, 0.74), ac);
    let grille = (1.0 - smoothstep(0.004, 0.009, abs(fract(uv.y * 60.0) - 0.5))) * ac;
    col = mix(col, vec3f(0.55, 0.55, 0.52), grille * 0.6);
    let drip = vertical_drips(uv, seed, 1.0) * smoothstep(0.0, 0.20, uv.y) * (1.0 - smoothstep(0.34, 0.40, uv.y));
    col = mix(col, vec3f(0.30, 0.22, 0.14), drip * 0.4);
  } else if (variant < 1.5) {
    let vent = rect_mask(uv, 0.38, 0.62, 0.42, 0.64, 0.006);
    col = mix(col, vec3f(0.30, 0.30, 0.32), vent);
    let louver = (1.0 - smoothstep(0.010, 0.020, abs(fract(uv.y * 22.0) - 0.5))) * vent;
    col = mix(col, vec3f(0.12, 0.12, 0.13), louver * 0.7);
    let soot = smoothstep(0.64, 0.95, uv.y) * (1.0 - smoothstep(0.0, 0.18, abs(uv.x - 0.5))) * (fbm(uv.x * 8.0, uv.y * 8.0 + seed, 4.0) * 0.5 + 0.5);
    col = mix(col, vec3f(0.05, 0.05, 0.05), soot * 0.5);
  } else {
    let pipe = max(1.0 - smoothstep(0.006, 0.012, abs(uv.x - 0.30)), 1.0 - smoothstep(0.006, 0.012, abs(uv.x - 0.345)));
    col = mix(col, vec3f(0.30, 0.30, 0.33), pipe);
    let mbox = rect_mask(uv, 0.50, 0.66, 0.40, 0.62, 0.006);
    col = mix(col, vec3f(0.55, 0.55, 0.50), mbox);
    let dial = (1.0 - smoothstep(0.0, 0.04, length(uv - vec2f(0.58, 0.51)))) * mbox;
    col = mix(col, vec3f(0.85, 0.85, 0.80), dial);
    let run = (1.0 - smoothstep(0.006, 0.012, abs(uv.y - 0.62))) * step(0.30, uv.x) * step(uv.x, 0.58);
    col = mix(col, vec3f(0.28, 0.28, 0.30), run);
  }
  return sat3(col);
}
