// @material blade_steel
// @slug blade-steel
// @name Blade Steel
// @board props
// @variant-labels Take 1, Take 2, Take 3
// @kind surface
// @tags props, blade, steel
// @author legacy
fn blade_steel(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let broad = fbm(uv.x * 5.0 + seed, uv.y * 8.0 - seed, 4.0) * 0.5 + 0.5;
  let brush = sin((uv.x + fbm(uv.x * 7.0, uv.y * 4.0 + seed, 3.0) * 0.035) * (180.0 + variant * 28.0)) * 0.5 + 0.5;
  var low = vec3f(0.34, 0.36, 0.36);
  var high = vec3f(0.82, 0.84, 0.80);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.18, 0.20, 0.21);
    high = vec3f(0.54, 0.57, 0.56);
  } else if (variant >= 1.5) {
    low = vec3f(0.42, 0.36, 0.29);
    high = vec3f(0.78, 0.72, 0.62);
  }
  var col = mix(low, high, broad * 0.44 + brush * 0.34 + 0.12);
  let bevel = line_near(uv.y - 0.76 + snoise(uv.x * 4.0 + seed, seed) * 0.018, 0.026);
  let spine = line_near(uv.y - 0.22 + snoise(uv.x * 3.0 - seed, seed) * 0.014, 0.014);
  let scratch = line_near(snoise(uv.x * 12.0 + seed, uv.y * 42.0 - seed), 0.014) * smoothstep(0.25, 0.80, fbm(uv.x * 4.0, uv.y * 4.0 + seed, 4.0) * 0.5 + 0.5);
  let nick = speckle(px, 5.0, seed, 0.955) * smoothstep(0.66, 0.95, uv.y);
  col = mix(col, vec3f(0.95, 0.96, 0.90), bevel * 0.45 + spine * 0.22);
  col = col + vec3f(0.18, 0.18, 0.16) * scratch - vec3f(0.24, 0.22, 0.18) * nick;
  if (variant >= 1.5) {
    let tarnish = blotch(uv, vec2f(0.25, 0.72), 0.16, vec2f(1.6, 0.7), seed + 8.0) + blotch(uv, vec2f(0.72, 0.30), 0.12, vec2f(1.2, 1.0), seed + 11.0);
    col = mix(col, vec3f(0.40, 0.17, 0.055), sat(tarnish) * 0.22);
  }
  return sat3(col);
}
