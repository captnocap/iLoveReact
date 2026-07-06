// @material force_field
// @slug force-field
// @name Force Field
// @board neon_surface
// @variant-labels Teal Ripple, Rose Aegis, Gold Bastion
// @kind gradient
// @tags neon_surface, shield, energy, ripple
// @author fable-scifi_hull
fn force_field(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var deep = vec3f(0.01, 0.05, 0.07);
  var wavec = vec3f(0.15, 0.75, 0.70);
  var hot = vec3f(0.70, 1.00, 0.95);
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.06, 0.01, 0.05);
    wavec = vec3f(0.90, 0.30, 0.55);
    hot = vec3f(1.00, 0.75, 0.85);
  } else if (variant >= 1.5) {
    deep = vec3f(0.06, 0.04, 0.01);
    wavec = vec3f(0.95, 0.70, 0.20);
    hot = vec3f(1.00, 0.95, 0.70);
  }
  let ctr = vec2f(0.5 + (fract(seed * 0.137) - 0.5) * 0.4, 0.5 + (fract(seed * 0.211) - 0.5) * 0.4);
  let r = length(uv - ctr);
  let ripple = sin(r * 55.0 - seed * 3.0) * 0.5 + 0.5;
  let decay = exp(-r * 3.5);
  var col = deep;
  col = col + wavec * pow(ripple, 3.0) * decay * 0.9;
  let inter = sin(uv.x * 40.0 + seed) * sin(uv.y * 40.0 - seed * 1.3) * 0.5 + 0.5;
  col = col + wavec * inter * 0.12;
  let shim = fbm(uv.x * 6.0 + seed * 2.0, uv.y * 6.0 - seed, 3.0) * 0.5 + 0.5;
  col = col + wavec * smoothstep(0.6, 0.9, shim) * 0.25;
  col = col + hot * exp(-r * r * 60.0) * (0.6 + ripple * 0.5);
  let sheenband = exp(-pow(uv.x * 0.7 + uv.y - 0.85 - fract(seed * 0.093) * 0.3, 2.0) * 18.0);
  col = col + hot * sheenband * 0.20;
  let spark = speckle(px, 2.0, seed + 17.0, 0.988);
  col = col + hot * spark * 0.8;
  let edge_dim = smoothstep(0.0, 0.18, uv.x) * smoothstep(0.0, 0.18, 1.0 - uv.x);
  col = mix(deep * 0.7, col, 0.4 + edge_dim * 0.6);
  return sat3(col);
}
