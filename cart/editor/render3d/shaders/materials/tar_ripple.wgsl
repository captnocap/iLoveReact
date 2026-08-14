// @material tar_ripple
// @slug tar-ripple
// @name Tar Ripple
// @board street_ground
// @variant-labels Still Puddle, Flaring Puddle, Muddy Puddle
// @kind surface
// @tags street_ground, tar, ripple, wet
// @author editor
fn tar_ripple(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var t1 = vec3f(0.06, 0.06, 0.07);
  var t2 = vec3f(0.55, 0.51, 0.44);
  var rim = vec3f(0.88, 0.86, 0.81);
  if (variant > 0.5 && variant < 1.5) {
    t1 = vec3f(0.09, 0.08, 0.10);
    t2 = vec3f(0.40, 0.36, 0.34);
    rim = vec3f(0.95, 0.91, 0.84);
  } else if (variant >= 1.5) {
    t1 = vec3f(0.11, 0.09, 0.10);
    t2 = vec3f(0.30, 0.26, 0.25);
    rim = vec3f(0.75, 0.69, 0.63);
  }
  let field = fbm(uv.x * 9.0 + seed, uv.y * 9.0 - seed, 4.0) * 0.5 + 0.5;
  let r = length(uv - vec2f(0.5, 0.5));
  let ring = smoothstep(0.05, 0.55, fract(r * 26.0 + field));
  var col = mix(t1, t2, smoothstep(0.25, 0.80, field));
  col = mix(col, rim, ring * 0.36);
  let streak = line_near(uv.x + sin(uv.y * 17.0 + seed) * 0.018 + 0.02, 0.012);
  col = mix(col, vec3f(0.90, 0.88, 0.82), streak * 0.22);
  col = col + vec3f(0.05, 0.05, 0.05) * speckle(px, 2.4, seed + 13.0, 0.968);
  return sat3(col);
}

