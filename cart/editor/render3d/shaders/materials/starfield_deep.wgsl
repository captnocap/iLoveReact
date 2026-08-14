// @material starfield_deep
// @slug starfield-deep
// @name Deep Starfield
// @board gradients
// @variant-labels Cold Sparse, Warm Dense, Jewel Field
// @kind surface
// @tags gradients, stars, night, space
// @author fable-sky_space
fn starfield_deep(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.01, 0.02, 0.06);
  var hazeTone = vec3f(0.07, 0.09, 0.16);
  var brightTint = vec3f(0.86, 0.90, 0.98);
  var faintGate = 0.965;
  var midGate = 0.982;
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.03, 0.02, 0.04); hazeTone = vec3f(0.13, 0.09, 0.08);
    brightTint = vec3f(0.98, 0.88, 0.72); faintGate = 0.945; midGate = 0.972;
  } else if (variant >= 1.5) {
    base = vec3f(0.02, 0.01, 0.05); hazeTone = vec3f(0.10, 0.06, 0.14);
    brightTint = vec3f(0.92, 0.80, 0.95); faintGate = 0.955; midGate = 0.978;
  }
  let haze = fbm(uv.x * 2.5 + seed, uv.y * 2.5 - seed * 0.4, 4.0) + 0.5;
  var col = mix(base, hazeTone, smoothstep(0.35, 0.95, haze) * 0.6);
  let faint = speckle(px, 1.0, seed, faintGate);
  let mid = speckle(px, 1.5, seed + 7.0, midGate);
  let bright = speckle(px, 2.4, seed + 13.0, 0.993);
  col = col + vec3f(0.30, 0.32, 0.40) * faint;
  col = col + vec3f(0.62, 0.66, 0.75) * mid;
  col = col + brightTint * bright;
  let gx = fract(seed * 0.171) * 0.7 + 0.15;
  let gy = fract(seed * 0.317) * 0.7 + 0.15;
  let giant = dot_mark(uv, vec2f(gx, gy), 0.012);
  let halo = exp(-length(uv - vec2f(gx, gy)) * 18.0);
  col = col + vec3f(0.95, 0.62, 0.35) * (giant + halo * 0.5);
  return sat3(col);
}
