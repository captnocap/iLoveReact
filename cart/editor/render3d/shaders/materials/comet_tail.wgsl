// @material comet_tail
// @slug comet-tail
// @name Comet Tail
// @board gradients
// @variant-labels Ion Blue, Dust Gold, Green Visitor
// @kind composition
// @tags gradients, comet, space, streak
// @author fable-sky_space
fn comet_tail(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var night = vec3f(0.02, 0.02, 0.07);
  var headCol = vec3f(0.90, 0.95, 0.99);
  var tailCol = vec3f(0.35, 0.55, 0.95);
  var dustCol = vec3f(0.75, 0.68, 0.50);
  if (variant > 0.5 && variant < 1.5) {
    night = vec3f(0.04, 0.02, 0.05); headCol = vec3f(0.99, 0.92, 0.80); tailCol = vec3f(0.85, 0.62, 0.30); dustCol = vec3f(0.60, 0.42, 0.28);
  } else if (variant >= 1.5) {
    night = vec3f(0.02, 0.04, 0.06); headCol = vec3f(0.85, 0.98, 0.90); tailCol = vec3f(0.30, 0.85, 0.55); dustCol = vec3f(0.45, 0.62, 0.40);
  }
  let head = vec2f(0.72 + fract(seed * 0.19) * 0.1, 0.64 + fract(seed * 0.41) * 0.1);
  let axis = normalize(vec2f(-0.82, -0.57));
  let rel = uv - head;
  let along = dot(rel, axis);
  let perp = dot(rel, vec2f(-axis.y, axis.x));
  var col = night + vec3f(0.03, 0.03, 0.06) * (fbm(uv.x * 3.0 + seed, uv.y * 3.0, 4.0) + 0.5);
  let behind = sat(along);
  let width = 0.015 + behind * 0.16;
  let tailGlow = exp(-perp * perp / (width * width)) * exp(-behind * 2.2) * step(0.0, along);
  let wisp = fbm(along * 6.0 + seed, perp * 30.0, 4.0) + 0.5;
  col = col + tailCol * tailGlow * (0.45 + wisp * 0.9);
  let dustPerp = perp - behind * behind * 0.35;
  let dustGlow = exp(-dustPerp * dustPerp / (width * width * 2.5)) * exp(-behind * 1.7) * step(0.0, along);
  col = col + dustCol * dustGlow * 0.5;
  let coma = exp(-length(rel) * 22.0);
  col = col + headCol * (coma + exp(-length(rel) * 80.0) * 1.5);
  col = col + vec3f(0.88, 0.90, 0.98) * (speckle(px, 1.0, seed, 0.972) + speckle(px, 1.8, seed + 4.0, 0.991));
  return sat3(col);
}
