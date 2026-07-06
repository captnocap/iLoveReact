// @material star_cluster
// @slug star-cluster
// @name Star Cluster
// @board gradients
// @variant-labels Globular Core, Young Blues, Old Amber
// @kind composition
// @tags gradients, cluster, stars, space
// @author fable-sky_space
fn star_cluster(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var night = vec3f(0.02, 0.02, 0.06);
  var haloCol = vec3f(0.85, 0.82, 0.72);
  var starTint = vec3f(0.95, 0.92, 0.85);
  var accent = vec3f(0.95, 0.65, 0.35);
  if (variant > 0.5 && variant < 1.5) {
    night = vec3f(0.02, 0.03, 0.07); haloCol = vec3f(0.60, 0.72, 0.95); starTint = vec3f(0.80, 0.88, 0.99); accent = vec3f(0.45, 0.62, 0.98);
  } else if (variant >= 1.5) {
    night = vec3f(0.04, 0.02, 0.04); haloCol = vec3f(0.90, 0.70, 0.45); starTint = vec3f(0.98, 0.85, 0.62); accent = vec3f(0.92, 0.45, 0.28);
  }
  let ctr = vec2f(0.5 + (fract(seed * 0.17) - 0.5) * 0.14, 0.5 + (fract(seed * 0.29) - 0.5) * 0.14);
  let r = length(uv - ctr);
  var col = night + vec3f(0.02, 0.02, 0.04) * (fbm(uv.x * 3.0 + seed, uv.y * 3.0, 3.0) + 0.5);
  col = col + haloCol * exp(-r * r * 26.0) * 0.75;
  col = col + vec3f(0.98, 0.96, 0.90) * exp(-r * r * 220.0) * 0.9;
  let shellCore = smoothstep(0.30, 0.02, r);
  let shellMid = smoothstep(0.44, 0.10, r);
  let shellOut = smoothstep(0.60, 0.22, r);
  col = col + starTint * speckle(px, 1.2, seed, 0.900) * shellCore;
  col = col + starTint * speckle(px, 1.4, seed + 5.0, 0.945) * shellMid;
  col = col + vec3f(0.60, 0.62, 0.70) * speckle(px, 1.0, seed + 9.0, 0.955) * shellOut;
  col = col + accent * speckle(px, 2.2, seed + 13.0, 0.990);
  col = col + vec3f(0.40, 0.42, 0.50) * speckle(px, 1.0, seed + 21.0, 0.975);
  return sat3(col);
}
