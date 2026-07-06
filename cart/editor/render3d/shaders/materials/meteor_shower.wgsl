// @material meteor_shower
// @slug meteor-shower
// @name Meteor Shower
// @board gradients
// @variant-labels Perseid White, Ember Fall, Rare Bolide
// @kind composition
// @tags gradients, meteor, night, streaks
// @author fable-sky_space
fn meteor_shower(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var night = vec3f(0.02, 0.03, 0.08);
  var streakCol = vec3f(0.90, 0.94, 0.99);
  var headCol = vec3f(0.80, 0.92, 0.99);
  var keep = 0.35;
  if (variant > 0.5 && variant < 1.5) {
    night = vec3f(0.05, 0.02, 0.05); streakCol = vec3f(0.98, 0.72, 0.35); headCol = vec3f(0.99, 0.88, 0.60); keep = 0.15;
  } else if (variant >= 1.5) {
    night = vec3f(0.02, 0.02, 0.06); streakCol = vec3f(0.70, 0.90, 0.85); headCol = vec3f(0.95, 0.98, 0.90); keep = 0.65;
  }
  var col = mix(night, night * 2.2, uv.y * 0.5);
  col = col + vec3f(0.04, 0.04, 0.08) * (fbm(uv.x * 3.0 + seed, uv.y * 3.0, 4.0) + 0.5);
  col = col + vec3f(0.60, 0.64, 0.75) * speckle(px, 1.0, seed, 0.965);
  col = col + vec3f(0.90, 0.90, 0.98) * speckle(px, 1.7, seed + 6.0, 0.990);
  let dir = normalize(vec2f(0.62, -0.42));
  for (var i = 0; i < 7; i = i + 1) {
    let fi = f32(i);
    let gate = step(rand(vec2f(fi * 2.9, seed * 0.07)), keep + 0.35);
    let ax = rand(vec2f(fi * 3.17 + seed, 2.71)) * 0.85;
    let ay = rand(vec2f(fi * 5.73, seed * 0.13 + 1.9)) * 0.6 + 0.35;
    let len = 0.10 + rand(vec2f(fi, seed)) * 0.16;
    let a = vec2f(ax, ay);
    let b = a + dir * len;
    let body = segment_mark(uv, a, b, 0.0035);
    let fadeT = sat(dot(uv - a, dir) / len);
    col = col + streakCol * body * gate * (0.25 + fadeT * 0.9);
    col = col + headCol * dot_mark(uv, b, 0.006) * gate;
  }
  let ridge = smoothstep(0.07, 0.0, uv.y - fbm(uv.x * 4.0 + seed, 8.8, 3.0) * 0.05 - 0.02);
  col = mix(col, vec3f(0.01, 0.01, 0.02), ridge);
  return sat3(col);
}
