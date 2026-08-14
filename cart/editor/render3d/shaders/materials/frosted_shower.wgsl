// @material frosted_shower
// @slug frosted-shower
// @name Frosted Shower
// @board liminal
// @variant-labels Morning Steam, Seafoam Pane, Motel Evening
// @kind gradient
// @tags liminal, glass, bathroom
// @author fable-interior_home
fn frosted_shower(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var pane = vec3f(0.76, 0.84, 0.86);
  var clear_tone = vec3f(0.48, 0.62, 0.68);
  var scum = vec3f(0.82, 0.80, 0.68);
  if (variant > 0.5 && variant < 1.5) {
    pane = vec3f(0.72, 0.85, 0.76);
    clear_tone = vec3f(0.40, 0.60, 0.52);
    scum = vec3f(0.78, 0.80, 0.62);
  } else if (variant >= 1.5) {
    pane = vec3f(0.42, 0.50, 0.58);
    clear_tone = vec3f(0.18, 0.26, 0.36);
    scum = vec3f(0.55, 0.50, 0.42);
  }
  let frost = fbm(uv.x * 18.0 + seed, uv.y * 18.0, 3.0) * 0.5 + 0.5;
  var col = mix(pane * 0.9, pane * 1.08, frost);
  let tracks = vertical_drips(uv, seed, 0.7);
  col = mix(col, clear_tone, tracks * 0.65);
  let sheen = 1.0 - smoothstep(0.0, 0.35, abs(uv.x + uv.y * 0.4 - 0.55 - fract(seed * 0.07) * 0.3));
  col = col + vec3f(0.10, 0.10, 0.09) * sheen;
  let beads = speckle(px, 2.0, seed + 4.0, 0.94);
  col = mix(col, pane * 1.2, beads * 0.5);
  let scum_band = smoothstep(0.72, 1.0, uv.y) * (fbm(uv.x * 6.0, seed * 0.3, 3.0) * 0.5 + 0.5);
  col = mix(col, scum, scum_band * 0.5);
  col = col - vec3f(0.05) * smoothstep(0.85, 1.0, uv.y);
  return sat3(col);
}
