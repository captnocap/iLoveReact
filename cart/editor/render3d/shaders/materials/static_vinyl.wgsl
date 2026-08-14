// @material static_vinyl
// @slug static-vinyl
// @name Static Vinyl
// @board second_pass
// @variant-labels Matte Film, Charged Film, Burnt Film
// @kind surface
// @tags second_pass, static, vinyl, noise
// @author editor
fn static_vinyl(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var matte = vec3f(0.28, 0.27, 0.24);
  var charged = vec3f(0.18, 0.90, 0.92);
  var char = vec3f(0.08, 0.03, 0.03);
  if (variant > 0.5 && variant < 1.5) {
    matte = vec3f(0.26, 0.24, 0.22);
    charged = vec3f(0.90, 0.95, 0.35);
    char = vec3f(0.20, 0.18, 0.12);
  } else if (variant >= 1.5) {
    matte = vec3f(0.46, 0.41, 0.35);
    charged = vec3f(0.98, 0.26, 0.62);
    char = vec3f(0.34, 0.20, 0.15);
  }
  let noise = fbm(uv.x * 25.0 + seed, uv.y * 25.0 + seed * 0.4, 4.0) * 0.5 + 0.5;
  let wave = line_near(sin(uv.x * 60.0 + uv.y * 14.0 + seed), 0.03);
  var col = mix(matte, charged, noise * 0.22);
  col = mix(col, char, wave * 0.28);
  let grain = speckle(px, 1.4, seed + 11.0, 0.96);
  col = col + vec3f(0.06, 0.06, 0.06) * grain;
  col = col - vec3f(0.04, 0.04, 0.04) * speckle(px, 2.0, seed + 16.0, 0.93);
  return sat3(col);
}
