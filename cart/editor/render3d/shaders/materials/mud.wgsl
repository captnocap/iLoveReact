// @material mud
// @slug mud
// @name Mud
// @board environment
// @variant-labels Wet, Cracked, Trampled
// @kind surface
// @tags environment, mud, earth, wet
// @author editor
fn mud(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Wet dark earth — nothing like sand: low value, cool-brown, puddle sheen.
  let tone = fbm(uv.x * 6.0 + seed, uv.y * 6.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.13, 0.09, 0.06), vec3f(0.27, 0.20, 0.13), tone);
  // Standing water collects in the low fbm basins and reads glossy-bright.
  let basin = smoothstep(0.28, 0.16, fbm(uv.x * 3.4 - seed, uv.y * 3.4 + seed * 0.6, 4.0) * 0.5 + 0.5);
  let sheen = fbm(uv.x * 14.0, uv.y * 14.0 + seed, 3.0) * 0.5 + 0.5;
  col = mix(col, vec3f(0.20, 0.19, 0.17) + vec3f(0.10, 0.11, 0.12) * sheen, basin * 0.55);
  if (variant > 0.5 && variant < 1.5) {
    // Cracked: dried-out crust — lighter, with a shrinkage crack web.
    col = mix(col, vec3f(0.38, 0.30, 0.20), 0.45);
    col = col - vec3f(crack_field(uv, seed, 9.0) * 0.22);
  } else if (variant >= 1.5) {
    // Trampled: tire/boot ruts dragged through the wet surface.
    let rut = line_near(sin(uv.y * 22.0 + fbm(uv.x * 4.0, uv.y * 1.5 + seed, 3.0) * 3.5), 0.10);
    col = col - vec3f(0.05, 0.04, 0.03) * rut;
    col = col + vec3f(0.05, 0.045, 0.035) * line_near(sin(uv.y * 22.0 + 0.35 + fbm(uv.x * 4.0, uv.y * 1.5 + seed, 3.0) * 3.5), 0.05);
  }
  // Scattered debris flecks; darker clods.
  col = col + vec3f(0.06, 0.05, 0.035) * speckle(px, 2.2, seed, 0.94);
  col = col - vec3f(0.045, 0.04, 0.03) * speckle(px + vec2f(7.0, 17.0), 3.0, seed, 0.90);
  return sat3(col);
}
