// @material moss_carpet
// @slug moss-carpet
// @name Moss Carpet
// @board liminal
// @variant-labels Deep Green, Bright Lichen, Dried Peat
// @kind surface
// @tags liminal, moss, carpet
// @author legacy
fn moss_carpet(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Dense cushion moss with spore capsules and damp sheen.
  let tuft = fbm(uv.x * 14.0 + seed, uv.y * 14.0 - seed, 5.0) * 0.5 + 0.5;
  let grain = fbm(uv.x * 42.0 + seed, uv.y * 38.0, 4.0) * 0.5 + 0.5;
  var low = vec3f(0.030, 0.085, 0.045);
  var high = vec3f(0.12, 0.34, 0.16);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.065, 0.20, 0.10);
    high = vec3f(0.24, 0.48, 0.28);
  } else if (variant >= 1.5) {
    low = vec3f(0.16, 0.12, 0.06);
    high = vec3f(0.38, 0.32, 0.18);
  }
  var col = mix(low, high, tuft * 0.55 + grain * 0.22 + 0.15);
  // Spore pods — tiny pale capsules on stalks.
  let spore = speckle(px + vec2f(7.0, 13.0), 5.0, seed, 0.93);
  col = mix(col, vec3f(0.48, 0.44, 0.30), spore * 0.32);
  // Moisture sheen — darker, glossier patches.
  let damp = smoothstep(0.42, 0.80, fbm(uv.x * 6.0 - seed, uv.y * 6.0 + seed, 4.0) * 0.5 + 0.5);
  col = col + vec3f(0.06, 0.09, 0.05) * damp;
  // Micro-fronds at high frequency.
  let frond = line_near(sin((uv.x + fbm(uv.x * 3.0, uv.y * 3.0 + seed, 3.0) * 0.04) * 68.0), 0.14);
  col = col + vec3f(0.04, 0.08, 0.03) * frond * (0.5 + variant * 0.15);
  return sat3(col);
}
