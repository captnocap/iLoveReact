// @material tarnished_silver
// @slug tarnished-silver
// @name Tarnished Silver
// @board liminal
// @variant-labels Diagonal Buff, Circular Polish, Crosshatch
// @kind surface
// @tags liminal, tarnished, silver
// @author legacy
fn tarnished_silver(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Polished metal with sulphide patina and directional buff marks.
  let scratch = fbm(uv.x * 32.0 + seed, uv.y * 32.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.42, 0.44, 0.45), vec3f(0.80, 0.82, 0.83), scratch * 0.48 + 0.28);
  // Buffing streaks — diagonal on variant 0, circular on 1, crosshatch on 2.
  var streak = 0.0;
  if (variant < 0.5) {
    streak = line_near(sin((uv.x + uv.y * 0.35) * 85.0 + seed), 0.07);
  } else if (variant < 1.5) {
    let p = uv - vec2f(0.5, 0.5);
    let r = length(p);
    streak = line_near(sin(r * 110.0 + seed), 0.08);
  } else {
    streak = line_near(sin((uv.x + uv.y * 0.35) * 75.0 + seed), 0.06) + line_near(sin((uv.x - uv.y * 0.35) * 75.0 + seed), 0.06);
  }
  col = col + vec3f(0.07, 0.07, 0.07) * streak;
  // Chemical tarnish — sulphide blues and browns.
  let patina = smoothstep(0.46, 0.76, fbm(uv.x * 6.5 + seed, uv.y * 6.5 - seed, 5.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.20, 0.26, 0.22), patina * 0.50);
  // Engraved monogram or scrollwork.
  let engrave = line_near(sin(uv.x * 55.0) * sin(uv.y * 48.0 + seed), 0.10) * smoothstep(0.25, 0.75, uv.y);
  col = col - vec3f(0.10, 0.10, 0.10) * engrave;
  // Edge wear — brighter on raised rims.
  let rim = (1.0 - smoothstep(0.0, 0.04, uv.x)) + (1.0 - smoothstep(0.0, 0.04, 1.0 - uv.x));
  col = col + vec3f(0.10, 0.10, 0.10) * rim * 0.35;
  return sat3(col);
}
