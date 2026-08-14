// @material smuggled_wrap
// @slug smuggled-wrap
// @name Smuggled Wrap
// @board contraband
// @variant-labels Taut, Crumpled, Frayed
// @kind surface
// @tags contraband, wrap, wrapper
// @author editor
fn smuggled_wrap(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.86, 0.82, 0.60);
  var edge = vec3f(0.24, 0.16, 0.10);
  var stripe = vec3f(0.45, 0.35, 0.22);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.70, 0.63, 0.45);
    edge = vec3f(0.20, 0.14, 0.10);
    stripe = vec3f(0.35, 0.26, 0.16);
  } else if (variant >= 1.5) {
    base = vec3f(0.55, 0.50, 0.38);
    edge = vec3f(0.15, 0.10, 0.07);
    stripe = vec3f(0.80, 0.75, 0.65);
  }
  let wrap = fbm(uv.x * 4.6 + seed, uv.y * 4.6, 4.0) * 0.5 + 0.5;
  var col = mix(base, stripe, smoothstep(0.35, 0.58, wrap));
  let crease = 1.0 - smoothstep(0.04, 0.08, abs(sin(uv.x * 38.0 + uv.y * 12.0 + seed) * 0.5 + 0.5 - uv.y * 0.5));
  col = mix(col, edge, crease * 0.5);
  let tear = crack_field(uv + vec2f(seed * 0.12, seed * 0.03), seed + 9.0, 15.0);
  col = mix(col, vec3f(0.08, 0.05, 0.03), tear * 0.6);
  col = col + vec3f(0.08, 0.08, 0.08) * speckle(px, 2.3, seed + 1.0, 0.965);
  return sat3(col);
}

